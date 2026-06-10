"""Expense summary and aggregation module.

Provides business logic for calculating totals, averages, and generating
human-readable summary strings for voice and text interfaces.
"""
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from config import DATE_FORMAT
from database import get_db, get_daily_totals_for_month
from logger import log_error


def _fetch_single(query: str, params: Tuple = ()) -> float:
    try:
        with get_db() as conn:
            cur = conn.execute(query, params)
            result = cur.fetchone()
            if result:
                if hasattr(result, "keys"):
                    keys = list(result.keys())
                    val = result[keys[0]] if keys else 0
                else:
                    val = result[0]
            else:
                val = 0
            return float(val or 0.0)
    except sqlite3.Error as exc:
        log_error("Summary fetch error: %s", exc)
        raise


def get_total_expenses(user_id: Optional[str] = None) -> float:
    """Calculate the lifetime total of all expenses for a user.

    Args:
        user_id: The ID of the user to filter expenses for.

    Returns:
        float: Total expense amount.

    """
    query = "SELECT COALESCE(SUM(amount), 0) FROM expenses"
    params: Tuple = ()
    if user_id:
        query += " WHERE user_id = ?"
        params = (user_id,)
    return _fetch_single(query, params)


def get_monthly_total(
    year: Optional[int] = None,
    month: Optional[int] = None,
    user_id: Optional[str] = None,
) -> float:
    """Calculate the total expenses for a specific month.

    Args:
        year: The target year (defaults to current year).
        month: The target month (defaults to current month).
        user_id: The ID of the user to filter expenses for.

    Returns:
        float: Total expense amount for the specified month.

    """
    from utils.dates import get_local_now
    now = get_local_now()
    year = year or now.year
    month = month or now.month
    from utils.dates import month_range

    start, end = month_range(year, month)
    query = "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date >= ? AND date < ?"
    params: List[str] = [start.strftime(DATE_FORMAT), end.strftime(DATE_FORMAT)]
    if user_id:
        query += " AND user_id = ?"
        params.append(user_id)
    return _fetch_single(query, tuple(params))


def get_expenses_by_category(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    *,
    end_inclusive: bool = True,
    user_id: Optional[str] = None,
) -> List[Dict[str, float]]:
    """Aggregate expenses by category within a date range.

    Args:
        start_date: Optional start date string (YYYY-MM-DD).
        end_date: Optional end date string (YYYY-MM-DD).
        end_inclusive: Whether the end_date should be inclusive or exclusive.
        user_id: The ID of the user to filter expenses for.

    Returns:
        List[Dict[str, float]]: A list of dictionaries containing 'category' and 'total'.

    """
    try:
        with get_db() as conn:
            conditions: List[str] = []
            params: List[str] = []
            if start_date:
                conditions.append("date >= ?")
                params.append(start_date)
            if end_date:
                comparator = "<=" if end_inclusive else "<"
                conditions.append(f"date {comparator} ?")
                params.append(end_date)
            if user_id:
                conditions.append("user_id = ?")
                params.append(user_id)

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
            query = f"""
                SELECT category, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                {where_clause}
                GROUP BY category
                ORDER BY total DESC
            """
            cur = conn.execute(query, params)
            return [dict(row) for row in cur.fetchall()]
    except sqlite3.Error as exc:
        log_error("Category breakdown error: %s", exc)
        raise


def get_daily_totals(days: int = 7, user_id: Optional[str] = None) -> List[Dict[str, float]]:
    """Retrieve total spending grouped by day for the last N days.

    Args:
        days: Number of recent days to include.
        user_id: The ID of the user to filter expenses for.

    Returns:
        List[Dict[str, float]]: A list of dictionaries with 'date' and 'total'.

    """
    from utils.dates import get_local_now
    start = get_local_now() - timedelta(days=days - 1)
    try:
        with get_db() as conn:
            query = (
                """
                SELECT date, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                WHERE date >= ?
                {user_filter}
                GROUP BY date
                ORDER BY date
                """
            )
            params: List[str] = [start.strftime(DATE_FORMAT)]
            user_filter = ""
            if user_id:
                user_filter = "AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(query.format(user_filter=user_filter), params)
            return [dict(row) for row in cur.fetchall()]
    except sqlite3.Error as exc:
        log_error("Daily totals error: %s", exc)
        raise


def get_weekly_summary_data(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Calculate structured weekly summary metrics and lines."""
    totals = get_daily_totals(days=7, user_id=user_id)
    total_amount = sum(row["total"] for row in totals)
    avg = total_amount / 7 if totals else 0.0
    from utils.dates import get_local_now
    today = get_local_now()
    start = (today - timedelta(days=6)).strftime(DATE_FORMAT)
    end = today.strftime(DATE_FORMAT)
    top_cats = get_expenses_by_category(start, end, user_id=user_id)[:3]
    top_categories = [{"category": c["category"], "total": float(c["total"])} for c in top_cats]

    lines = [
        f"Weekly spend: ₹{total_amount:.2f}",
        f"Daily average: ₹{avg:.2f}",
    ]
    if top_cats:
        cats = ", ".join(f"{c['category']} (₹{c['total']:.0f})" for c in top_cats)
        lines.append(f"Top categories: {cats}")
    if totals:
        peak_entry = max(totals, key=lambda row: row["total"])
        try:
            peak_date = datetime.strptime(peak_entry["date"], DATE_FORMAT)
            peak_label = peak_date.strftime("%a")
        except (TypeError, ValueError):
            peak_label = str(peak_entry["date"])
        lines.append(f"Peak day: {peak_label} at ₹{peak_entry['total']:.0f}.")
        if len(totals) >= 2:
            first_total = totals[0]["total"]
            last_total = totals[-1]["total"]
            change = last_total - first_total
            if abs(change) >= 1:
                direction = "up" if change > 0 else "down"
                lines.append(
                    f"Trend: {direction} by ₹{abs(change):.0f} compared to the start of the week."
                )
    return {
        "total": total_amount,
        "daily_average": avg,
        "top_categories": top_categories,
        "lines": lines,
    }


def get_weekly_summary_text(user_id: Optional[str] = None) -> str:
    """Generate a human-readable text summary of the past week's spending.

    Args:
        user_id: The ID of the user to generate the summary for.

    Returns:
        str: A multi-line summary string.

    """
    data = get_weekly_summary_data(user_id)
    return "\n".join(data["lines"])


def get_monthly_summary_data(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Calculate structured monthly summary metrics and lines."""
    from utils.dates import get_local_now
    now = get_local_now()
    from utils.dates import month_range

    start, next_month = month_range(now.year, now.month)

    end_str = next_month.strftime(DATE_FORMAT)
    total = get_monthly_total(now.year, now.month, user_id=user_id)
    cat_breakdown = get_expenses_by_category(
        start.strftime(DATE_FORMAT),
        end_str,
        end_inclusive=False,
        user_id=user_id,
    )
    top_categories = [{"category": c["category"], "total": float(c["total"])} for c in cat_breakdown[:5]]
    daily_rows = get_daily_totals_for_month(now.year, now.month, user_id=user_id)

    lines = [f"{now.strftime('%B %Y')} total: ₹{total:.2f}"]
    days_elapsed = max((now.date() - start.date()).days + 1, 1)
    avg_daily = total / days_elapsed if days_elapsed else 0.0
    lines.append(f"Daily average so far: ₹{avg_daily:.2f}")
    if cat_breakdown:
        cats = ", ".join(f"{c['category']} (₹{c['total']:.0f})" for c in cat_breakdown[:5])
        lines.append(f"Leading categories: {cats}")

    if daily_rows:
        peak_entry = max(daily_rows, key=lambda row: row["total"])
        try:
            peak_date = datetime.strptime(peak_entry["date"], DATE_FORMAT)
            peak_label = peak_date.strftime("%d %b")
        except (TypeError, ValueError):
            peak_label = str(peak_entry["date"])
        lines.append(f"Peak day: {peak_label} at ₹{peak_entry['total']:.0f}.")
    prev_year = start.year
    prev_month = start.month - 1
    if prev_month == 0:
        prev_month = 12
        prev_year -= 1
    prev_total = get_monthly_total(prev_year, prev_month, user_id=user_id)
    if prev_total > 0:
        diff = total - prev_total
        direction = "higher" if diff >= 0 else "lower"
        percent = abs(diff) / prev_total * 100
        lines.append(
            f"Change vs last month: {direction} by ₹{abs(diff):.0f} ({percent:.0f}%)."
        )
    return {
        "total": total,
        "daily_average": avg_daily,
        "top_categories": top_categories,
        "lines": lines,
    }


def get_monthly_summary_text(user_id: Optional[str] = None) -> str:
    """Generate a human-readable text summary of the current month's spending.

    Args:
        user_id: The ID of the user to generate the summary for.

    Returns:
        str: A multi-line summary string comparing the current month to the previous.

    """
    data = get_monthly_summary_data(user_id)
    return "\n".join(data["lines"])

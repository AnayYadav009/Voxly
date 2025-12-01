import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from config import DATE_FORMAT
from database import create_connection
from logger import log_error

def _fetch_single(query: str, params: Tuple = ()) -> float:
    try:
        with create_connection() as conn:
            cur = conn.execute(query, params)
            result = cur.fetchone()
            return float(result[0] or 0.0)
    except sqlite3.Error as exc:
        log_error("Summary fetch error: %s", exc)
        raise

def get_total_expenses(user_id: Optional[str] = None) -> float:
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
    now = datetime.now()
    year = year or now.year
    month = month or now.month
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
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
    try:
        with create_connection() as conn:
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
    start = datetime.now() - timedelta(days=days - 1)
    try:
        with create_connection() as conn:
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

def get_weekly_summary_text(user_id: Optional[str] = None) -> str:
    totals = get_daily_totals(days=7, user_id=user_id)
    total_amount = sum(row["total"] for row in totals)
    avg = total_amount / 7 if totals else 0
    today = datetime.now()
    start = (today - timedelta(days=6)).strftime(DATE_FORMAT)
    end = today.strftime(DATE_FORMAT)
    top_categories = get_expenses_by_category(start, end, user_id=user_id)[:3]
    lines = [
        f"Weekly spend: ₹{total_amount:.2f}",
        f"Daily average: ₹{avg:.2f}",
    ]
    if top_categories:
        cats = ", ".join(f"{c['category']} (₹{c['total']:.0f})" for c in top_categories)
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
    return "\n".join(lines)

def get_monthly_summary_text(user_id: Optional[str] = None) -> str:
    now = datetime.now()
    total = get_monthly_total(now.year, now.month, user_id=user_id)
    start = datetime(now.year, now.month, 1)
    if now.month == 12:
        next_month = datetime(now.year + 1, 1, 1)
    else:
        next_month = datetime(now.year, now.month + 1, 1)
    cat_breakdown = get_expenses_by_category(
        start.strftime(DATE_FORMAT),
        next_month.strftime(DATE_FORMAT),
        end_inclusive=False,
        user_id=user_id,
    )
    lines = [f"{now.strftime('%B %Y')} total: ₹{total:.2f}"]
    days_elapsed = max((now.date() - start.date()).days + 1, 1)
    avg_daily = total / days_elapsed if days_elapsed else 0
    lines.append(f"Daily average so far: ₹{avg_daily:.2f}")
    if cat_breakdown:
        cats = ", ".join(f"{c['category']} (₹{c['total']:.0f})" for c in cat_breakdown[:5])
        lines.append(f"Leading categories: {cats}")
    daily_rows: List[Dict[str, float]] = []
    try:
        with create_connection() as conn:
            query = (
                """
                SELECT date, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                WHERE date >= ? AND date < ?
                {user_filter}
                GROUP BY date
                ORDER BY date
                """
            )
            params: List[str] = [start.strftime(DATE_FORMAT), next_month.strftime(DATE_FORMAT)]
            user_filter = ""
            if user_id:
                user_filter = "AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(query.format(user_filter=user_filter), params)
            daily_rows = [dict(row) for row in cur.fetchall()]
    except sqlite3.Error as exc:
        log_error("Monthly daily totals error: %s", exc)
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
    return "\n".join(lines)

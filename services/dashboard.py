"""Dashboard context and serialization helpers."""

from __future__ import annotations

import os
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from budget_module import (
    BudgetLimit,
    BudgetStatus,
    evaluate_monthly_budgets,
    summarize_alerts,
)
from config import DATE_FORMAT
from database import (
    get_dashboard_snapshot,
    get_recent_expenses,
)
from summary_module import (
    get_monthly_summary_data,
    get_monthly_summary_text,
    get_monthly_total,
    get_weekly_summary_data,
    get_weekly_summary_text,
)
from visual_module import (
    get_category_breakdown,
    get_monthly_totals_by_month,
    get_recent_daily_totals,
)


def _to_static_path(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    rel = os.path.relpath(path, "static")
    return rel.replace(os.sep, "/")


def _serialize_category_breakdown(user_id: Optional[str] = None) -> Dict[str, Any]:
    rows = get_category_breakdown(user_id=user_id)
    if not rows:
        return {"items": []}
    items = [
        {"category": str(row["category"]), "total": float(row["total"])}
        for row in rows
    ]
    return {"items": items}


def _serialize_daily_totals(days: int = 7, user_id: Optional[str] = None) -> Dict[str, Any]:
    rows = get_recent_daily_totals(days, user_id=user_id)
    totals_by_date = {
        str(row["date"]): float(row["total"])
        for row in rows
    }
    from utils.dates import get_local_now
    today = get_local_now().date()
    start_date = today - timedelta(days=days - 1)
    series = []
    for offset in range(days):
        current = start_date + timedelta(days=offset)
        key = current.strftime(DATE_FORMAT)
        series.append(
            {
                "date": key,
                "label": current.strftime("%a"),
                "total": totals_by_date.get(key, 0.0),
            }
        )
    return {"items": series}


def _serialize_monthly_totals(months: int = 6, user_id: Optional[str] = None) -> Dict[str, Any]:
    rows = get_monthly_totals_by_month(months, user_id=user_id)
    totals_by_month = {
        str(row["month"]): float(row["total"])
        for row in rows
    }
    from utils.dates import get_local_now
    first_of_month = get_local_now().replace(day=1)
    months_sequence = []
    current = first_of_month
    for _ in range(max(months, 1)):
        months_sequence.append(current)
        if current.month == 1:
            current = current.replace(year=current.year - 1, month=12)
        else:
            current = current.replace(month=current.month - 1)
    months_sequence.reverse()
    series = []
    for month_date in months_sequence:
        key = month_date.strftime("%Y-%m")
        series.append(
            {
                "month": key,
                "label": month_date.strftime("%b %Y"),
                "total": totals_by_month.get(key, 0.0),
            }
        )
    return {"items": series}


def _build_chart_series(days: int = 7, months: int = 6, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Compile chart-friendly aggregates for API consumers."""
    return {
        "category_breakdown": _serialize_category_breakdown(user_id=user_id)["items"],
        "daily_totals": _serialize_daily_totals(days, user_id=user_id)["items"],
        "monthly_totals": _serialize_monthly_totals(months, user_id=user_id)["items"],
    }


def _safe_limit(value: Any, default: int = 5, *, minimum: int = 1, maximum: int = 50) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(numeric, maximum))


def _fetch_totals(user_id: Optional[str] = None) -> Tuple[float, List[Tuple[str, float]]]:
    """Return (total_today, category_totals) in a single DB connection."""
    from database import _normalize_date, _user_and, _user_where, get_db

    today = _normalize_date()
    with get_db() as conn:
        params_today = [today]
        sql_today = "SELECT COALESCE(SUM(amount), 0) AS total_today FROM expenses WHERE date = ?"
        sql_today += f" {_user_and(user_id)}"
        if user_id:
            params_today.append(user_id)
        row = conn.execute(sql_today, params_today).fetchone()
        total_today = float(row["total_today"] if row and "total_today" in row else 0)

        where = _user_where(user_id)
        params_cat = (user_id,) if user_id else ()
        rows = conn.execute(
            f"SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses {where} "
            f"GROUP BY category ORDER BY total DESC",
            params_cat,
        ).fetchall()
        category_totals = [(r["category"], float(r["total"])) for r in rows]
    return total_today, category_totals


def _build_dashboard_context(user_id: Optional[str] = None, fields: Optional[Set[str]] = None) -> Dict[str, Any]:
    requested = fields or {
        "total_today",
        "monthly_total",
        "category_totals",
        "recent_expenses",
        "weekly_summary",
        "weekly_summary_data",
        "monthly_summary",
        "monthly_summary_data",
        "budget_status",
        "budget_alerts",
        "charts",
        "chart_series",
    }
    charts: Dict[str, Any] = {}
    needs_budgets = bool({"budget_status", "budget_alerts"} & requested)
    budget_statuses = evaluate_monthly_budgets(user_id=user_id) if user_id and needs_budgets else []

    if user_id and bool({"total_today", "monthly_total", "category_totals", "recent_expenses"} & requested):
        from utils.dates import get_local_now
        now = get_local_now()
        snapshot = get_dashboard_snapshot(user_id, now.year, now.month)
        total_today = snapshot["total_today"]
        monthly_total = snapshot["monthly_total"]
        category_totals = snapshot["category_totals"]
        recent_expenses = snapshot["recent_expenses"]
    else:
        total_today, category_totals = _fetch_totals(user_id) if "total_today" in requested or "category_totals" in requested else (0.0, [])
        monthly_total = get_monthly_total(user_id=user_id) if "monthly_total" in requested else 0.0
        recent_expenses = get_recent_expenses(5, user_id=user_id) if "recent_expenses" in requested else []

    context: Dict[str, Any] = {}
    if "total_today" in requested:
        context["total_today"] = total_today
    if "monthly_total" in requested:
        context["monthly_total"] = monthly_total
    if "category_totals" in requested:
        context["category_totals"] = category_totals
    if "recent_expenses" in requested:
        context["recent_expenses"] = recent_expenses
    if "weekly_summary" in requested:
        context["weekly_summary"] = get_weekly_summary_text(user_id=user_id)
    if "weekly_summary_data" in requested:
        context["weekly_summary_data"] = get_weekly_summary_data(user_id=user_id)
    if "monthly_summary" in requested:
        context["monthly_summary"] = get_monthly_summary_text(user_id=user_id)
    if "monthly_summary_data" in requested:
        context["monthly_summary_data"] = get_monthly_summary_data(user_id=user_id)
    if "budget_status" in requested:
        context["budget_status"] = [
            {
                "category": status.category,
                "limit": status.limit,
                "spent": status.spent,
                "remaining": status.remaining,
                "percentage": status.percentage,
                "level": status.level,
                "message": status.message,
            }
            for status in budget_statuses
        ]
    if "budget_alerts" in requested:
        context["budget_alerts"] = summarize_alerts(budget_statuses)
    if "charts" in requested:
        context["charts"] = {
            key: _to_static_path(path)
            for key, path in charts.items()
        }
    if "chart_series" in requested:
        context["chart_series"] = _build_chart_series(user_id=user_id)
    return context


def _refresh_dashboard(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Return a fresh snapshot of dashboard data for the frontend."""
    return _build_dashboard_context(user_id=user_id)


def _serialize_budget_status(statuses: List[BudgetStatus]) -> List[Dict[str, Any]]:
    return [asdict(status) for status in statuses]


def _humanize_category_name(category: str) -> str:
    if not category:
        return "General"
    return str(category).replace("_", " ").title()


def _format_budget_status_line(status: BudgetStatus, limit_info: Optional[BudgetLimit]) -> str:
    name = _humanize_category_name(status.category)
    pct_used = status.percentage * 100
    summary = (
        f"{name}: ₹{status.spent:.0f} of ₹{status.limit:.0f} used "
        f"({pct_used:.0f}%); ₹{status.remaining:.0f} remaining."
    )
    detail = status.message if status.level in {"warning", "critical"} else "Budget is on track."
    if limit_info is not None:
        detail += f" Alerts at {int(round(limit_info.warn_ratio * 100))}%"
    return f"{summary} {detail}.".replace("..", ".")


def _collect_budget_lines(statuses: List[BudgetStatus], limits: Dict[str, BudgetLimit]) -> List[str]:
    return [
        _format_budget_status_line(status, limits.get(status.category))
        for status in statuses
    ]


def _find_budget_status(category: str, statuses: List[BudgetStatus]) -> Optional[BudgetStatus]:
    category_key = category.lower()
    for status in statuses:
        if status.category == category_key:
            return status
    return None


def _summarize_chart_series(series: Dict[str, Any]) -> str:
    lines: List[str] = []
    breakdown = series.get("category_breakdown") or []
    if breakdown:
        top = max(breakdown, key=lambda item: float(item.get("total", 0.0)))
        top_name = _humanize_category_name(top.get("category"))
        top_total = float(top.get("total", 0.0))
        lines.append(f"Top category is {top_name} at ₹{top_total:.0f}.")
        if len(breakdown) >= 2:
            ordered = sorted(breakdown, key=lambda item: float(item.get("total", 0.0)), reverse=True)
            runner_up = ordered[1]
            gap = top_total - float(runner_up.get("total", 0.0))
            if gap > 0:
                lines.append(
                    f"That's ₹{gap:.0f} ahead of {_humanize_category_name(runner_up.get('category'))}."
                )

    daily = series.get("daily_totals") or []
    if daily:
        daily_totals = [float(item.get("total", 0.0)) for item in daily]
        if daily_totals:
            average = sum(daily_totals) / len(daily_totals)
            latest = daily[-1]
            latest_label = latest.get("label") or latest.get("date")
            latest_total = float(latest.get("total", 0.0))
            lines.append(
                f"Last {len(daily)} day average is ₹{average:.0f}; latest {latest_label} at ₹{latest_total:.0f}."
            )
            peak_index = max(range(len(daily_totals)), key=lambda idx: daily_totals[idx])
            peak_item = daily[peak_index]
            if peak_item is not latest:
                peak_label = peak_item.get("label") or peak_item.get("date")
                lines.append(f"Peak day was {peak_label} with ₹{daily_totals[peak_index]:.0f}.")

    monthly = series.get("monthly_totals") or []
    if len(monthly) >= 2:
        current = monthly[-1]
        previous = monthly[-2]
        current_total = float(current.get("total", 0.0))
        previous_total = float(previous.get("total", 0.0))
        diff = current_total - previous_total
        if abs(diff) >= 1:
            direction = "up" if diff > 0 else "down"
            if previous_total > 0:
                percent = abs(diff) / previous_total * 100
                lines.append(
                    f"Monthly spend is {direction} by ₹{abs(diff):.0f} ({percent:.0f}%) versus the prior month."
                )
            else:
                lines.append(
                    f"Monthly spend is {direction} by ₹{abs(diff):.0f} compared to the prior month."
                )

    if not lines:
        return "Not enough data for a chart recap yet."
    return " ".join(lines)

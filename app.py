"""Main application entry point and API routes."""

import os
import sqlite3
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from flask import Flask, jsonify, request, send_from_directory, g, make_response
from flask_cors import CORS

from auth import (
    PasswordPolicyError,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from budget_module import (
    BudgetLimit,
    BudgetStatus,
    evaluate_monthly_budgets,
    get_alert_for_category,
    get_budget_limits,
    remove_budget_limit,
    set_budget_limit,
    summarize_alerts,
)
from config import (
    COMMAND_LOGGING_ENABLED,
    DATE_FORMAT,
    REACT_BUILD_DIR,
    REACT_INDEX_FILE,
    init_directories,
    ACCESS_TOKEN_EXPIRES_MINUTES,
    REFRESH_TOKEN_EXPIRES_DAYS,
)
from database import (
    add_expense,
    create_user,
    delete_last_expense,
    ensure_schema_once,
    get_dashboard_snapshot,
    get_recent_expenses,
    get_total_today,
    get_user_by_email,
    get_user_by_id,
    get_cached_insight,
    log_command_event,
    save_insight,
    touch_user_timestamp,
    update_user_log_opt_in,
)
from summary_module import (
    get_monthly_summary_text,
    get_monthly_total,
    get_weekly_summary_text,
)
from visual_module import (
    get_category_breakdown,
    get_monthly_totals_by_month,
    get_recent_daily_totals,
)
from logger import log_error, log_info
from voice_module import parse_expense
from insight_module import generate_insight

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from config import RATE_LIMIT_STORAGE_URI

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("VOXLY_SESSION_SECRET", os.urandom(24))
from config import ALLOWED_ORIGINS
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)
init_directories()  # make sure directories exist at startup

app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=[],
    storage_uri=RATE_LIMIT_STORAGE_URI,
)

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Payload too large. Maximum size is 1MB."}), 413

@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    return response

_MAX_CATEGORY_LENGTH = 50

def _sanitize_category(raw: str) -> str:
    """Normalize and validate a category string."""
    cleaned = (raw or "").strip().lower()
    if not cleaned:
        return "uncategorized"
    return cleaned[:_MAX_CATEGORY_LENGTH]

VOICE_HELP_TEXT = (
    "Try commands like:\n"
    "- Add 200 to food\n"
    "- What's my balance today\n"
    "- Show recent expenses\n"
    "- Give weekly summary\n"
    "- Delete last expense\n"
    "- Set budget for food to 5000\n"
    "- What's my budget / Show budgets\n"
    "- Stop to exit"
)

def _public_user_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    if not user:
        return {}
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "display_name": user.get("display_name"),
        "log_opt_in": bool(user.get("log_opt_in")),
    }

def _user_preferences_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    return {"log_opt_in": bool(user.get("log_opt_in"))}

def _extract_bearer_token() -> Optional[str]:
    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return request.cookies.get("access_token")

def _unauthorized_response():
    return jsonify({"error": "Authentication required."}), 401

def _require_authenticated_user() -> Optional[Dict[str, Any]]:
    user = getattr(g, "current_user", None)
    if not user:
        return None
    return user

def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()

def _auth_success_response(user: Dict[str, Any]):
    access_token = create_access_token(user["id"])
    refresh_token = create_refresh_token(user["id"])
    touch_user_timestamp(user["id"])

    response = make_response(jsonify({"user": _public_user_payload(user)}))
    response.set_cookie(
        "access_token",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRES_MINUTES * 60,
        httponly=True,
        secure=os.environ.get("FLASK_ENV") == "production",
        samesite="Strict",
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRES_DAYS * 24 * 3600,
        httponly=True,
        secure=os.environ.get("FLASK_ENV") == "production",
        samesite="Strict",
        path="/api/auth/refresh",
    )
    return response

def _should_log_commands(user: Optional[Dict[str, Any]]) -> bool:
    return COMMAND_LOGGING_ENABLED and bool(user and user.get("log_opt_in"))

@app.before_request
def attach_current_user() -> None:
    """Attach current user."""
    ensure_schema_once()
    g.current_user = None
    token = _extract_bearer_token()
    if not token:
        return
    user_id = decode_access_token(token)
    if not user_id:
        return
    user = get_user_by_id(user_id)
    if user:
        g.current_user = user

def _to_static_path(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    rel = os.path.relpath(path, "static")
    return rel.replace(os.sep, "/")

def _react_build_exists() -> bool:
    return os.path.isfile(REACT_INDEX_FILE)

def _serve_react_asset(path: Optional[str] = None):
    if not _react_build_exists():
        return None
    relative_path = (path or "").strip()
    if relative_path:
        candidate = os.path.join(REACT_BUILD_DIR, relative_path)
        if os.path.isfile(candidate):
            return send_from_directory(REACT_BUILD_DIR, relative_path)
    return send_from_directory(REACT_BUILD_DIR, "index.html")

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
    today = datetime.now().date()
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
    first_of_month = datetime.now().replace(day=1)
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

def _fetch_totals(user_id: Optional[str] = None):
    """Return (total_today, category_totals) in a single DB connection."""
    from database import get_db, _normalize_date
    today = _normalize_date()
    with get_db() as conn:
        params_today = [today]
        sql_today = "SELECT COALESCE(SUM(amount), 0) AS total_today FROM expenses WHERE date = ?"
        if user_id:
            sql_today += " AND user_id = ?"
            params_today.append(user_id)
        row = conn.execute(sql_today, params_today).fetchone()
        total_today = float(row["total_today"] if row and "total_today" in row else 0)

        where = "WHERE user_id = ?" if user_id else ""
        params_cat = (user_id,) if user_id else ()
        rows = conn.execute(
            f"SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses {where} "
            f"GROUP BY category ORDER BY total DESC",
            params_cat,
        ).fetchall()
        category_totals = [(r["category"], float(r["total"])) for r in rows]
    return total_today, category_totals

def _build_dashboard_context(user_id: Optional[str] = None):
    charts = {}   # PNG pipeline removed — frontend uses chart_series JSON
    budget_statuses = evaluate_monthly_budgets(user_id=user_id) if user_id else []
    
    if user_id:
        now = datetime.now()
        snapshot = get_dashboard_snapshot(user_id, now.year, now.month)
        total_today = snapshot["total_today"]
        monthly_total = snapshot["monthly_total"]
        category_totals = snapshot["category_totals"]
        recent_expenses = snapshot["recent_expenses"]
    else:
        total_today, category_totals = _fetch_totals(user_id)
        monthly_total = get_monthly_total(user_id=user_id)
        recent_expenses = get_recent_expenses(5, user_id=user_id)

    return {
        "total_today": total_today,
        "monthly_total": monthly_total,
        "category_totals": category_totals,
        "recent_expenses": recent_expenses,
        "weekly_summary": get_weekly_summary_text(user_id=user_id),
        "monthly_summary": get_monthly_summary_text(user_id=user_id),
        "budget_status": [
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
        ],
        "budget_alerts": summarize_alerts(budget_statuses),
        "charts": {
            key: _to_static_path(path)
            for key, path in charts.items()
        },
        "chart_series": _build_chart_series(user_id=user_id),
    }

@app.route("/")
def index():
    """Index."""
    response = _serve_react_asset()
    if response is not None:
        return response
    return jsonify(
        {
            "status": "react_build_missing",
            "message": "React build not found. Run `npm run build` inside the frontend/ directory.",
        }
    )

@app.route("/app", defaults={"path": ""})
@app.route("/app/<path:path>")
def serve_react_app(path: str):
    """Serve react app."""
    response = _serve_react_asset(path)
    if response is not None:
        return response
    return (
        jsonify(
            {
                "status": "react_build_missing",
                "message": "React build not found. Run `npm run build` inside the frontend/ directory.",
            }
        ),
        404,
    )

def _refresh_dashboard(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Return a fresh snapshot of dashboard data for the frontend."""
    return _build_dashboard_context(user_id=user_id)

def _serialize_budget_status(statuses):
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

from routes.auth import auth_bp
from routes.expenses import expenses_bp
from routes.charts import charts_bp
from routes.voice import voice_bp

app.register_blueprint(auth_bp)
app.register_blueprint(expenses_bp)
app.register_blueprint(charts_bp)
app.register_blueprint(voice_bp)


if __name__ == "__main__":
    app.run(debug=True)

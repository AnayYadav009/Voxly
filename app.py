"""Main application entry point and API routes."""

import os
import sqlite3
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from flask import Flask, jsonify, request, send_from_directory, g
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
)
from database import (
    add_expense,
    create_user,
    delete_last_expense,
    get_recent_expenses,
    get_total_today,
    get_user_by_email,
    get_user_by_id,
    log_command_event,
    touch_user_timestamp,
    update_user_log_opt_in,
)
from summary_module import (
    get_monthly_summary_text,
    get_monthly_total,
    get_weekly_summary_text,
)
from visual_module import (
    generate_all_charts,
    get_category_breakdown,
    get_monthly_totals_by_month,
    get_recent_daily_totals,
)
from logger import log_error, log_info
from voice_module import parse_expense
from database import get_cached_insight, save_insight
from insight_module import generate_insight

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# keyed by user_id (str) → last parsed command dict
_last_commands: Dict[str, Dict[str, Any]] = {}

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("VOXLY_SESSION_SECRET", os.urandom(24))
_RAW_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000",
)
_ALLOWED_ORIGINS = [o.strip() for o in _RAW_ORIGINS.split(",") if o.strip()]

CORS(app, origins=_ALLOWED_ORIGINS, supports_credentials=True)
init_directories()  # make sure directories exist at startup

app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
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
    return None

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
    payload = {
        "access_token": access_token,
        "user": _public_user_payload(user),
    }
    if app.testing or app.config.get("TESTING"):
        payload["refresh_token"] = refresh_token
    resp = jsonify(payload)
    resp.set_cookie(
        "voxly_refresh",
        refresh_token,
        httponly=True,
        samesite="None",
        secure=True,
        max_age=60 * 60 * 24 * 7,  # 7 days
    )
    return resp


def _should_log_commands(user: Optional[Dict[str, Any]]) -> bool:
    return COMMAND_LOGGING_ENABLED and bool(user and user.get("log_opt_in"))

@app.before_request
def attach_current_user() -> None:
    """Attach current user."""
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
    df = get_category_breakdown(user_id=user_id)
    if df.empty:
        return {"items": []}
    items = [
        {"category": str(row["category"]), "total": float(row["total"])}
        for _, row in df.iterrows()
    ]
    return {"items": items}

def _serialize_daily_totals(days: int = 7, user_id: Optional[str] = None) -> Dict[str, Any]:
    df = get_recent_daily_totals(days, user_id=user_id)
    totals_by_date = {
        str(row["date"]): float(row["total"])
        for _, row in df.iterrows()
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
    df = get_monthly_totals_by_month(months, user_id=user_id)
    totals_by_month = {
        str(row["month"]): float(row["total"])
        for _, row in df.iterrows()
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
    from database import create_connection, _normalize_date
    today = _normalize_date()
    with create_connection() as conn:
        params_today = [today]
        sql_today = "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date = ?"
        if user_id:
            sql_today += " AND user_id = ?"
            params_today.append(user_id)
        total_today = float(conn.execute(sql_today, params_today).fetchone()[0] or 0)

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
    charts = generate_all_charts(user_id=user_id)
    budget_statuses = evaluate_monthly_budgets(user_id=user_id) if user_id else []
    total_today, category_totals = _fetch_totals(user_id)
    return {
        "total_today": total_today,
        "monthly_total": get_monthly_total(user_id=user_id),
        "category_totals": category_totals,
        "recent_expenses": get_recent_expenses(5, user_id=user_id),
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

@app.route("/api/budgets", methods=["GET", "POST"])
def api_budgets():
    """Handle API budgets."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
        
    if request.method == "POST":
        data = request.json or {}
        category = data.get("category")
        limit = data.get("limit")
        try:
            limit_val = float(limit)
            set_budget_limit(user["id"], category, limit_val)
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    limits = get_budget_limits(user["id"])
    data = {cat: {"limit": lim.limit, "warn_ratio": lim.warn_ratio} for cat, lim in limits.items()}
    return jsonify(data)

@app.route("/api/summary")
def api_summary():
    """Handle API summary."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    context = _build_dashboard_context(user_id=user["id"])
    raw_totals = context["category_totals"]          # List[Tuple[str, float]]
    category_totals = [
        {"category": cat, "total": total}
        for cat, total in raw_totals
    ]
    return jsonify(
        total_today=context["total_today"],
        monthly_total=context["monthly_total"],
        weekly_summary=context["weekly_summary"],
        monthly_summary=context["monthly_summary"],
        category_totals=category_totals,             # now a list of objects
        budget_alerts=context["budget_alerts"],
    )

@app.route("/api/recent")
def api_recent():
    """Handle API recent."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    user_id = user["id"]
    limit = _safe_limit(request.args.get("limit"), default=5)
    date_from = request.args.get("from")
    date_to = request.args.get("to")
    category = request.args.get("category", "").strip().lower() or None

    from database import create_connection
    conditions = ["user_id = ?"]
    params = [user_id]
    if date_from:
        conditions.append("date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("date <= ?")
        params.append(date_to)
    if category:
        conditions.append("LOWER(category) = ?")
        params.append(category)
    params.append(limit)
    where = " AND ".join(conditions)
    with create_connection() as conn:
        rows = conn.execute(
            f"SELECT id, amount, category, description, payment_method, date, time "
            f"FROM expenses WHERE {where} ORDER BY date DESC, time DESC, id DESC LIMIT ?",
            params,
        ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/charts/category-breakdown")
def api_chart_category_breakdown():
    """Handle API chart category breakdown."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload = _serialize_category_breakdown(user_id=user["id"])
    # use timezone-aware UTC timestamp
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    return jsonify(payload)

@app.route("/api/charts/daily-totals")
def api_chart_daily_totals():
    """Handle API chart daily totals."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    try:
        requested_days = int(request.args.get("days", 7))
    except (TypeError, ValueError):
        requested_days = 7
    days = max(1, min(requested_days, 90))
    payload = _serialize_daily_totals(days, user_id=user["id"])
    # use timezone-aware UTC timestamp
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["days"] = days
    return jsonify(payload)

@app.route("/api/charts/monthly-totals")
def api_chart_monthly_totals():
    """Handle API chart monthly totals."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    try:
        requested_months = int(request.args.get("months", 6))
    except (TypeError, ValueError):
        requested_months = 6
    months = max(1, min(requested_months, 24))
    payload = _serialize_monthly_totals(months, user_id=user["id"])
    # use timezone-aware UTC timestamp
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["months"] = months
    return jsonify(payload)

@app.route("/api/forecast")
def api_forecast():
    """
    Linear regression over the last N months to project current month total.
    Returns:
        projected_total   — estimated spend by end of current month
        confidence        — 'low' | 'medium' | 'high' based on R²
        trend             — 'up' | 'down' | 'flat'
        monthly_series    — the raw data used for the regression
        days_remaining    — days left in current month (for context)
    """
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()

    import numpy as np
    from datetime import date

    user_id = user["id"]

    # Fetch last 6 complete months + current partial month
    df = get_monthly_totals_by_month(months=7, user_id=user_id)

    if df.empty or len(df) < 2:
        return jsonify({
            "projected_total": None,
            "confidence": "low",
            "trend": "flat",
            "monthly_series": [],
            "days_remaining": None,
            "message": "Not enough data yet. Add expenses across at least 2 months for a forecast.",
        })

    today = date.today()
    current_month_key = today.strftime("%Y-%m")

    # Separate complete months from the current partial month
    complete = df[df["month"] != current_month_key].copy()
    current_rows = df[df["month"] == current_month_key]
    current_spent = float(current_rows["total"].iloc[0]) if not current_rows.empty else 0.0

    series = [
        {"month": str(row["month"]), "total": float(row["total"])}
        for _, row in df.iterrows()
    ]

    if len(complete) < 2:
        return jsonify({
            "projected_total": None,
            "confidence": "low",
            "trend": "flat",
            "monthly_series": series,
            "days_remaining": None,
            "message": "Not enough complete months for a forecast.",
        })

    # Regression over complete months
    x = np.arange(len(complete), dtype=float)
    y = complete["total"].astype(float).values

    coeffs = np.polyfit(x, y, 1)        # [slope, intercept]
    slope = float(coeffs[0])
    next_x = float(len(complete))
    trend_prediction = float(np.polyval(coeffs, next_x))

    # R² for confidence
    y_mean = float(np.mean(y))
    ss_tot = float(np.sum((y - y_mean) ** 2))
    ss_res = float(np.sum((y - np.polyval(coeffs, x)) ** 2))
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    if r_squared >= 0.75:
        confidence = "high"
    elif r_squared >= 0.4:
        confidence = "medium"
    else:
        confidence = "low"

    # Adjust projection for how far through current month we are
    import calendar
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_elapsed = today.day
    days_remaining = days_in_month - days_elapsed

    # Daily run rate this month (if we have data) vs regression prediction
    if current_spent > 0 and days_elapsed > 0:
        daily_rate = current_spent / days_elapsed
        run_rate_projection = current_spent + (daily_rate * days_remaining)
        # Blend: 60% run rate (more responsive), 40% regression (smoother)
        projected_total = round(0.6 * run_rate_projection + 0.4 * trend_prediction, 2)
    else:
        projected_total = round(trend_prediction, 2)

    if slope > 50:
        trend = "up"
    elif slope < -50:
        trend = "down"
    else:
        trend = "flat"

    return jsonify({
        "projected_total": projected_total,
        "current_spent": round(current_spent, 2),
        "confidence": confidence,
        "r_squared": round(r_squared, 4),
        "trend": trend,
        "slope": round(slope, 2),
        "monthly_series": series,
        "days_remaining": days_remaining,
        "days_elapsed": days_elapsed,
    })

@app.route("/api/recurring")
def api_recurring():
    """Detect recurring expenses and return them with next expected dates."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    from database import get_recurring_expenses
    items = get_recurring_expenses(user_id=user["id"])
    return jsonify({"items": items, "count": len(items)})

@app.route("/api/insight")
def api_insight():
    """
    Return the cached weekly AI insight, or generate a fresh one.
    Pass ?refresh=1 to force regeneration.
    """
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()

    user_id = user["id"]
    force_refresh = request.args.get("refresh") == "1"

    if not force_refresh:
        cached = get_cached_insight(user_id)
        if cached:
            return jsonify({"insight": cached, "cached": True})

    # Generate fresh insight
    try:
        daily_data = _serialize_daily_totals(7, user_id=user_id)["items"]
        cat_data = _serialize_category_breakdown(user_id=user_id)["items"]

        if not daily_data and not cat_data:
            return jsonify({
                "insight": "Add some expenses this week to see your first spending insight.",
                "cached": False,
            })

        insight_text = generate_insight(daily_data, cat_data)
        save_insight(user_id, insight_text, ttl_days=7)
        return jsonify({"insight": insight_text, "cached": False})

    except Exception as exc:
        log_error("Insight endpoint failed: %s", exc)
        return jsonify({"insight": None, "error": "Could not generate insight."}), 500

@app.route("/api/auth/register", methods=["POST"])
@limiter.limit("5 per minute")
def api_auth_register():
    """Handle API auth register."""
    data = request.get_json(silent=True) or {}
    email = _normalize_email(data.get("email", ""))
    password = str(data.get("password", ""))
    display_name = data.get("name") or data.get("display_name")

    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required."}), 400
    if get_user_by_email(email):
        return jsonify({"error": "Email already in use."}), 409

    try:
        password_hash = hash_password(password)
    except PasswordPolicyError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        user = create_user(email=email, password_hash=password_hash, display_name=display_name)
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already in use."}), 409

    return _auth_success_response(user)

@app.route("/api/auth/login", methods=["POST"])
@limiter.limit("10 per minute")
def api_auth_login():
    """Handle API auth login."""
    data = request.get_json(silent=True) or {}
    email = _normalize_email(data.get("email", ""))
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = get_user_by_email(email)
    if not user or not verify_password(password, user.get("password_hash", "")):
        return jsonify({"error": "Invalid email or password."}), 401

    return _auth_success_response(user)

@app.route("/api/auth/me")
def api_auth_me():
    """Handle API auth me."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    return jsonify({"user": _public_user_payload(user)})


@app.route("/api/preferences", methods=["GET", "PUT"])
def api_preferences():
    """Handle API preferences."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    if request.method == "GET":
        return jsonify(
            {
                "preferences": _user_preferences_payload(user),
                "logging_available": COMMAND_LOGGING_ENABLED,
            }
        )
    data = request.get_json(silent=True) or {}
    raw_value = data.get("log_opt_in")
    if isinstance(raw_value, str):
        value = raw_value.lower() in {"1", "true", "yes", "on"}
    else:
        value = bool(raw_value)
    update_user_log_opt_in(user["id"], value)
    user["log_opt_in"] = 1 if value else 0
    return jsonify({"preferences": _user_preferences_payload(user)})


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    """Handle API auth logout."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    touch_user_timestamp(user["id"])
    resp = jsonify({"status": "logged_out"})
    resp.delete_cookie("voxly_refresh", samesite="Strict")
    # TODO: add refresh token to a server-side blocklist to prevent reuse
    return resp


@app.route("/api/auth/refresh", methods=["POST"])
def api_auth_refresh():
    """Handle API auth refresh."""
    # Primary: HttpOnly cookie. Fallback: JSON body (backward compat).
    refresh_token = request.cookies.get("voxly_refresh")
    if not refresh_token:
        data = request.get_json(silent=True) or {}
        refresh_token = data.get("refresh_token") or _extract_bearer_token()
    user_id = decode_refresh_token(refresh_token)
    if not user_id:
        return _unauthorized_response()
    user = get_user_by_id(user_id)
    if not user:
        return _unauthorized_response()
    access_token = create_access_token(user_id)
    new_refresh_token = create_refresh_token(user_id)
    touch_user_timestamp(user_id)
    resp = jsonify({
        "access_token": access_token,
        "user": _public_user_payload(user),
    })
    resp.set_cookie(
        "voxly_refresh",
        new_refresh_token,
        httponly=True,
        samesite="None",
        secure=True,
        max_age=60 * 60 * 24 * 7,
    )
    return resp

@app.route("/api/regenerate-charts", methods=["POST"])
def api_regenerate_charts():
    """Handle API regenerate charts."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    try:
        charts = generate_all_charts()
        rel_paths = {key: _to_static_path(path) for key, path in charts.items()}
        log_info("Charts regenerated manually.")
        return jsonify({"status": "ok", "charts": rel_paths})
    except Exception as exc:
        log_error("Failed to regenerate charts: %s", exc)
        return jsonify({"status": "error"}), 500

@app.route("/api/add", methods=["POST"])
def api_add():
    """Handle API add."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount", 0))
        category = _sanitize_category(data.get("category", ""))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount or category."}), 400

    if amount <= 0 or not category:
        return jsonify({"error": "Amount must be positive and category required."}), 400

    try:
        expense_id = add_expense(amount, category, user_id=user["id"])
        context = _build_dashboard_context(user_id=user["id"])
        log_info("Expense added via API (id=%s)", expense_id)
        return jsonify(
            {
                "message": f"Added ₹{amount:.2f} to {category}.",
                "expense_id": expense_id,
                "total_today": context["total_today"],
                "monthly_total": context["monthly_total"],
            }
        )
    except Exception as exc:
        log_error("Add expense API failed: %s", exc)
        return jsonify({"error": "Failed to add expense."}), 500

@app.route("/api/expenses/<int:expense_id>", methods=["PATCH"])
def api_update_expense(expense_id: int):
    """Handle API update expense."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    data = request.get_json(silent=True) or {}
    from database import update_expense
    try:
        amount = float(data["amount"]) if "amount" in data else None
        updated = update_expense(
            expense_id,
            amount=amount,
            category=data.get("category"),
            description=data.get("description"),
            user_id=user["id"],
        )
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid field value."}), 400
    except Exception as exc:
        log_error("Update expense failed: %s", exc)
        return jsonify({"error": "Failed to update expense."}), 500
    if not updated:
        return jsonify({"error": "Expense not found."}), 404
    return jsonify({"message": "Expense updated."})

@app.route("/api/export")
def api_export():
    """Handle API export."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    from database import get_all_expenses
    import csv
    import io
    fmt = request.args.get("format", "csv").lower()
    if fmt != "csv":
        return jsonify({"error": "Only format=csv is supported."}), 400
    rows = get_all_expenses(user_id=user["id"])
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["id", "date", "time", "amount", "category", "description", "payment_method"],
        extrasaction="ignore",
    )
    writer.writeheader()
    writer.writerows(rows)
    from flask import Response
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=voxly_expenses.csv"},
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


@app.route("/api/voice_command", methods=["POST"])
def api_voice_command():
    """Handle API voice command."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload: Dict[str, Any] = request.get_json(silent=True) or {}
    command_text = str(payload.get("command", "")).strip()
    if not command_text:
        return jsonify({"error": "Command text required."}), 400
    user_id = user["id"]

    try:
        parsed = parse_expense(command_text)
    except Exception as exc:
        log_error("Failed to parse voice command: %s", exc)
        return jsonify({"error": "Could not understand the command."}), 500

    action = parsed.get("action", "unknown")
    response: Dict[str, Any] = {"action": action}

    if _should_log_commands(user):
        try:
            entity_keys = ["amount", "category", "date", "warn_ratio"]
            entities = {key: parsed.get(key) for key in entity_keys if parsed.get(key) is not None}
            log_command_event(
                user_id=user_id,
                raw_text=command_text,
                parsed_payload=parsed,
                intent=action,
                entities=entities,
                channel="voice",
                confidence=parsed.get("confidence"),
                metadata={"payload": {k: payload.get(k) for k in ("limit", "channel") if k in payload}},
            )
        except Exception as exc:
            log_error("Command logging failed: %s", exc)

    if action == "none":
        response["reply"] = "I did not hear a command."
        return jsonify(response), 400

    if action == "unknown":
        response["reply"] = "I did not understand that. Try saying help."
        return jsonify(response)

    if action == "help":
        response["reply"] = VOICE_HELP_TEXT
        return jsonify(response)

    if action == "repeat":
        prior = _last_commands.get(user_id) if user_id else None
        if not prior:
            response["reply"] = "No previous command available to repeat."
            return jsonify(response)
        parsed = prior.copy()
        action = parsed.get("action", "unknown")

    if action == "exit":
        response["reply"] = "The assistant stays ready. Say another command when you are ready."
        return jsonify(response)

    if action == "add":
        amount = parsed.get("amount")
        category = _sanitize_category(parsed.get("category") or "uncategorized")
        if amount is None or float(amount) <= 0:
            response["reply"] = "Please include a valid amount to add an expense."
            return jsonify(response), 400
        try:
            expense_id = add_expense(
                float(amount),
                category,
                date=parsed.get("date"),
                description=parsed.get("description"),
                user_id=user_id,
            )

            # Handle multi-item commands parsed by Groq
            extra_expenses = parsed.get("_additional_expenses") or []
            extra_ids = []
            for extra in extra_expenses:
                try:
                    eid = add_expense(
                        float(extra.get("amount", 0)),
                        extra.get("category", "uncategorized"),
                        date=extra.get("date"),
                        description=extra.get("description"),
                        user_id=user_id,
                    )
                    extra_ids.append(eid)
                except Exception as exc:
                    log_error("Failed to add extra expense from multi-item command: %s", exc)

            response["reply"] = f"Added ₹{float(amount):.2f} to {category}."
            if extra_ids:
                response["additional_expense_ids"] = extra_ids
                response["reply"] = f"Added {1 + len(extra_ids)} expenses."
            response["expense_id"] = expense_id
            dashboard = _refresh_dashboard(user_id=user_id)
            response["dashboard"] = dashboard
            # record this as the last performed command for repeat
            if user_id:
                _last_commands[user_id] = parsed.copy()

            alert_year = alert_month = None
            if parsed.get("date"):
                try:
                    parsed_date = datetime.strptime(parsed["date"], DATE_FORMAT)
                    alert_year, alert_month = parsed_date.year, parsed_date.month
                except ValueError:
                    pass
            status = get_alert_for_category(category, user_id=user_id, year=alert_year, month=alert_month)
            if status:
                response["budget_alert"] = status.message
        except Exception as exc:
            log_error("Voice add expense failed: %s", exc)
            response["reply"] = "Failed to add the expense."
            return jsonify(response), 500
        return jsonify(response)

    if action == "delete":
        try:
            removed_id = delete_last_expense(user_id=user_id)
        except Exception as exc:
            log_error("Voice delete expense failed: %s", exc)
            response["reply"] = "Failed to delete the last expense."
            return jsonify(response), 500
        if not removed_id:
            response["reply"] = "No expense to delete."
            return jsonify(response)
        response["reply"] = f"Deleted expense number {removed_id}."
        response["deleted_expense_id"] = removed_id
        response["dashboard"] = _refresh_dashboard(user_id=user_id)
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "balance":
        total_today = get_total_today(user_id=user_id)
        response["reply"] = f"Today's total spend is ₹{total_today:.2f}."
        response["total_today"] = total_today
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "recent":
        limit = _safe_limit(payload.get("limit"), default=5)
        recent_items = get_recent_expenses(limit, user_id=user_id)
        response["reply"] = "Here are the most recent expenses."
        response["recent_expenses"] = recent_items
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "weekly":
        summary_text = get_weekly_summary_text(user_id=user_id)
        response["reply"] = summary_text
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "monthly":
        summary_text = get_monthly_summary_text(user_id=user_id)
        statuses = evaluate_monthly_budgets(user_id=user_id)
        limits = get_budget_limits(user_id)
        if statuses:
            lines = _collect_budget_lines(statuses, limits)
            summary_text = summary_text + "\n" + "\n".join(lines)
            response["budget_statuses"] = _serialize_budget_status(statuses)
            response["budget_lines"] = lines
        response["reply"] = summary_text
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "show_budgets":
        category = parsed.get("category")
        limits = get_budget_limits(user_id)
        statuses = evaluate_monthly_budgets(user_id=user_id)
        if category:
            status = _find_budget_status(category, statuses)
            limit_info = limits.get(category.lower()) if category else None
            human_name = _humanize_category_name(category)
            if status:
                line = _format_budget_status_line(status, limit_info)
                response["reply"] = line
                response["budget_status"] = asdict(status)
            elif limit_info:
                warn_percent = int(round(limit_info.warn_ratio * 100))
                response["reply"] = (
                    f"{human_name} budget is ₹{limit_info.limit:.0f} per month with alerts at {warn_percent}%."
                )
                response["budget_limit"] = {
                    "category": limit_info.category,
                    "limit": limit_info.limit,
                    "warn_ratio": limit_info.warn_ratio,
                }
            else:
                response["reply"] = f"No budget configured for {human_name}."
            if statuses:
                response["budget_statuses"] = _serialize_budget_status(statuses)
        else:
            if statuses:
                lines = _collect_budget_lines(statuses, limits)
                response["reply"] = "\n".join(lines)
                response["budget_statuses"] = _serialize_budget_status(statuses)
                response["budget_lines"] = lines
            else:
                response["reply"] = "No budgets configured."
        # record command for repeat — applies to both specific-category and full-list
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "set_budget":
        category = parsed.get("category")
        amount = parsed.get("amount")
        warn_ratio = parsed.get("warn_ratio")
        if not category:
            response["reply"] = "Please specify which category the budget should apply to."
            return jsonify(response), 400
        try:
            limit_value = float(amount) if amount is not None else None
        except (TypeError, ValueError):
            limit_value = None
        if limit_value is None or limit_value <= 0:
            response["reply"] = "Please provide a positive budget amount."
            return jsonify(response), 400
        try:
            set_budget_limit(user_id, category, limit_value, warn_at=warn_ratio if warn_ratio is not None else None)
            log_info(
                "Voice set budget for user=%s category=%s amount=%s warn_ratio=%s",
                user_id,
                category,
                limit_value,
                warn_ratio,
            )
        except ValueError as exc:
            response["reply"] = str(exc)
            return jsonify(response), 400
        except Exception as exc:
            log_error("Voice set budget failed: %s", exc)
            response["reply"] = "Failed to update that budget."
            return jsonify(response), 500
        limits = get_budget_limits(user_id)
        limit_info = limits.get(category.lower())
        statuses = evaluate_monthly_budgets(user_id=user_id)
        status = _find_budget_status(category, statuses)
        if status:
            lines = _collect_budget_lines([status], limits)
            response["reply"] = lines[0]
            response["budget_status"] = asdict(status)
        elif limit_info:
            warn_percent = int(round(limit_info.warn_ratio * 100))
            human_name = _humanize_category_name(category)
            response["reply"] = (
                f"Set {human_name} budget to ₹{limit_info.limit:.0f} with alerts at {warn_percent}%."
            )
        else:
            human_name = _humanize_category_name(category)
            response["reply"] = f"Set {human_name} budget to ₹{limit_value:.0f}."
        if statuses:
            response["budget_statuses"] = _serialize_budget_status(statuses)
            response["budget_lines"] = _collect_budget_lines(statuses, limits)
        if limit_info:
            response["budget_limit"] = {
                "category": limit_info.category,
                "limit": limit_info.limit,
                "warn_ratio": limit_info.warn_ratio,
            }
        if warn_ratio is not None:
            response["warn_ratio"] = warn_ratio
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "remove_budget":
        category = parsed.get("category")
        if not category:
            response["reply"] = "Please tell me which budget to remove."
            return jsonify(response), 400
        try:
            removed = remove_budget_limit(user_id, category)
            log_info("Voice remove budget for user=%s category=%s removed=%s", user_id, category, removed)
        except ValueError as exc:
            response["reply"] = str(exc)
            return jsonify(response), 400
        except Exception as exc:
            log_error("Voice remove budget failed: %s", exc)
            response["reply"] = "Failed to remove that budget."
            return jsonify(response), 500
        human_name = _humanize_category_name(category)
        if not removed:
            response["reply"] = f"No budget configured for {human_name}."
            return jsonify(response)
        limits = get_budget_limits(user_id)
        statuses = evaluate_monthly_budgets(user_id=user_id)
        lines = _collect_budget_lines(statuses, limits) if statuses else []
        if lines:
            response["reply"] = f"Removed {human_name} budget. " + " ".join(lines)
        else:
            response["reply"] = f"Removed {human_name} budget. No budgets remain."
        if statuses:
            response["budget_statuses"] = _serialize_budget_status(statuses)
            response["budget_lines"] = lines
        response["removed_budget"] = category.lower()
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    if action == "chart_summary":
        try:
            series = _build_chart_series(user_id=user_id)
        except Exception as exc:
            log_error("Voice chart summary failed: %s", exc)
            response["reply"] = "Chart data is unavailable right now."
            return jsonify(response), 500
        response["chart_series"] = series
        response["reply"] = _summarize_chart_series(series)
        # include speak field so frontends can optionally play this text-to-speech
        response["speak"] = response["reply"]
        if user_id:
            _last_commands[user_id] = parsed.copy()
        return jsonify(response)

    response["reply"] = "That command is not supported yet."
    return jsonify(response)


if __name__ == "__main__":
    app.run(debug=True)

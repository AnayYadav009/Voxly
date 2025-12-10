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
)
from database import (
    add_expense,
    create_user,
    delete_last_expense,
    get_user_preferences,
    get_recent_expenses,
    get_total_by_category,
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
    ensure_chart_dir,
    generate_all_charts,
    get_category_breakdown,
    get_monthly_totals_by_month,
    get_recent_daily_totals,
)
from logger import log_error, log_info
parse_expense = None
last_performed_command: Optional[Dict[str, Any]] = None

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)  # allow frontend dev server to reach the API
ensure_chart_dir()  # make sure chart directory exists at startup

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
    return jsonify(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": _public_user_payload(user),
        }
    )


def _should_log_commands(user: Optional[Dict[str, Any]]) -> bool:
    return COMMAND_LOGGING_ENABLED and bool(user and user.get("log_opt_in"))

@app.before_request
def attach_current_user() -> None:
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

def _build_dashboard_context(user_id: Optional[str] = None):
    charts = generate_all_charts() if user_id is None else {}
    budget_statuses = evaluate_monthly_budgets(user_id=user_id)
    return {
        "total_today": get_total_today(user_id=user_id),
        "monthly_total": get_monthly_total(user_id=user_id),
        "category_totals": get_total_by_category(user_id=user_id),
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

@app.route("/api/summary")
def api_summary():
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    context = _build_dashboard_context(user_id=user["id"])
    return jsonify(
        total_today=context["total_today"],
        weekly_summary=context["weekly_summary"],
        monthly_summary=context["monthly_summary"],
        category_totals=context["category_totals"],
        budget_alerts=context["budget_alerts"],
    )

@app.route("/api/recent")
def api_recent():
    user = _require_authenticated_user()
    if not user and not app.testing:
        return _unauthorized_response()
    user_id = user["id"] if user else None
    limit = _safe_limit(request.args.get("limit"), default=5)
    return jsonify(get_recent_expenses(limit, user_id=user_id))

@app.route("/api/charts/category-breakdown")
def api_chart_category_breakdown():
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload = _serialize_category_breakdown(user_id=user["id"])
    # use timezone-aware UTC timestamp
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    return jsonify(payload)

@app.route("/api/charts/daily-totals")
def api_chart_daily_totals():
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

@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
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
def api_auth_login():
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
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    return jsonify({"user": _public_user_payload(user)})


@app.route("/api/preferences", methods=["GET", "PUT"])
def api_preferences():
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
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    touch_user_timestamp(user["id"])
    return jsonify({"status": "logged_out"})


@app.route("/api/auth/refresh", methods=["POST"])
def api_auth_refresh():
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
    return jsonify(
        {
            "access_token": access_token,
            "refresh_token": new_refresh_token,
            "user": _public_user_payload(user),
        }
    )

@app.route("/api/regenerate-charts", methods=["POST"])
def api_regenerate_charts():
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
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount", 0))
        category = str(data.get("category", "")).strip()
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
    user = _require_authenticated_user()
    if not user and not app.testing:
        return _unauthorized_response()
    payload: Dict[str, Any] = request.get_json(silent=True) or {}
    command_text = str(payload.get("command", "")).strip()
    if not command_text:
        return jsonify({"error": "Command text required."}), 400
    user_id = user["id"] if user else None

    try:
        global parse_expense  # type: ignore
        if parse_expense is None:
            from voice_module import parse_expense as _parse_fn  # local import
            parse_expense = _parse_fn  # cache for subsequent calls
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
        # If the client asks to repeat, re-run the previously performed
        # command (if any). This keeps the web assistant stateless while
        # allowing a simple repeat feature.
        global last_performed_command
        if not last_performed_command:
            response["reply"] = "No previous command available to repeat."
            return jsonify(response)
        # overwrite parsed/action with the last performed command and continue
        parsed = last_performed_command.copy()
        action = parsed.get("action", "unknown")

    if action == "exit":
        response["reply"] = "The assistant stays ready. Say another command when you are ready."
        return jsonify(response)

    if action == "add":
        amount = parsed.get("amount")
        category = parsed.get("category") or "uncategorized"
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
            response["reply"] = f"Added ₹{float(amount):.2f} to {category}."
            response["expense_id"] = expense_id
            dashboard = _refresh_dashboard(user_id=user_id)
            response["dashboard"] = dashboard
            # record this as the last performed command for repeat
            last_performed_command = parsed.copy()

            alert_year = alert_month = None
            if parsed.get("date"):
                try:
                    parsed_date = datetime.strptime(parsed["date"], DATE_FORMAT)
                    alert_year, alert_month = parsed_date.year, parsed_date.month
                except ValueError:
                    pass
            status = get_alert_for_category(category, year=alert_year, month=alert_month, user_id=user_id)
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
        last_performed_command = parsed.copy()
        return jsonify(response)

    if action == "balance":
        total_today = get_total_today(user_id=user_id)
        response["reply"] = f"Today's total spend is ₹{total_today:.2f}."
        response["total_today"] = total_today
        last_performed_command = parsed.copy()
        return jsonify(response)

    if action == "recent":
        limit = _safe_limit(payload.get("limit"), default=5)
        recent_items = get_recent_expenses(limit, user_id=user_id)
        response["reply"] = "Here are the most recent expenses."
        response["recent_expenses"] = recent_items
        last_performed_command = parsed.copy()
        return jsonify(response)

    if action == "weekly":
        summary_text = get_weekly_summary_text(user_id=user_id)
        response["reply"] = summary_text
        last_performed_command = parsed.copy()
        return jsonify(response)

    if action == "monthly":
        summary_text = get_monthly_summary_text(user_id=user_id)
        statuses = evaluate_monthly_budgets(user_id=user_id)
        limits = get_budget_limits()
        if statuses:
            lines = _collect_budget_lines(statuses, limits)
            summary_text = summary_text + "\n" + "\n".join(lines)
            response["budget_statuses"] = _serialize_budget_status(statuses)
            response["budget_lines"] = lines
        response["reply"] = summary_text
        last_performed_command = parsed.copy()
        return jsonify(response)

    if action == "show_budgets":
        category = parsed.get("category")
        limits = get_budget_limits()
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
            # record command when showing a specific category or full list
            last_performed_command = parsed.copy()
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
            set_budget_limit(category, limit_value, warn_at=warn_ratio if warn_ratio is not None else None)
            log_info(
                "Voice set budget for category=%s amount=%s warn_ratio=%s",
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
        limits = get_budget_limits()
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
        last_performed_command = parsed.copy()
        return jsonify(response)

    if action == "remove_budget":
        category = parsed.get("category")
        if not category:
            response["reply"] = "Please tell me which budget to remove."
            return jsonify(response), 400
        try:
            removed = remove_budget_limit(category)
            log_info("Voice remove budget for category=%s removed=%s", category, removed)
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
        limits = get_budget_limits()
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
        last_performed_command = parsed.copy()
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
        last_performed_command = parsed.copy()
        return jsonify(response)

    response["reply"] = "That command is not supported yet."
    return jsonify(response)


if __name__ == "__main__":
    app.run(debug=True)

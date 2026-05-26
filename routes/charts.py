import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from flask import Blueprint, request, jsonify, make_response, g, Response

# from app.py
from app import (
    _require_authenticated_user,
    _unauthorized_response,
    _sanitize_category,
    _build_dashboard_context,
    _safe_limit,
    _serialize_category_breakdown,
    _serialize_daily_totals,
    _serialize_monthly_totals,
    _to_static_path,
    _should_log_commands,
    limiter
)
from database import (
    add_expense, create_connection, update_expense, get_all_expenses,
    get_cached_insight, save_insight, log_command_event, update_user_log_opt_in
)
from budget_module import set_budget_limit, get_budget_limits
from summary_module import get_monthly_summary_text, get_weekly_summary_text, get_monthly_total
from visual_module import generate_all_charts, get_category_breakdown, get_monthly_totals_by_month, get_recent_daily_totals
from logger import log_error, log_info
from insight_module import generate_insight
from voice_nlp import parse_expense

charts_bp = Blueprint("charts", __name__, url_prefix="/api")

@charts_bp.route("/charts/category-breakdown")
def api_chart_category_breakdown():
    """Handle API chart category breakdown."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload = _serialize_category_breakdown(user_id=user["id"])
    # use timezone-aware UTC timestamp
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    return jsonify(payload)


@charts_bp.route("/charts/daily-totals")
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


@charts_bp.route("/charts/monthly-totals")
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





@charts_bp.route("/regenerate-charts", methods=["POST"])
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




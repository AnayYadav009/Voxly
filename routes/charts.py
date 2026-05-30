from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from app import (
    _require_authenticated_user,
    _unauthorized_response,
)
from extensions import limiter
from services.dashboard import (
    _serialize_category_breakdown,
    _serialize_daily_totals,
    _serialize_monthly_totals,
    _to_static_path,
)
from visual_module import generate_all_charts
from logger import log_error, log_info

charts_bp = Blueprint("charts", __name__, url_prefix="/api")

@charts_bp.route("/charts/category-breakdown")
def api_chart_category_breakdown():
    """Handle API chart category breakdown."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload = _serialize_category_breakdown(user_id=user["id"])
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

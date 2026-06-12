import io
import csv
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from flask import Blueprint, request, jsonify, Response

from app import (
    _require_authenticated_user,
    _unauthorized_response,
    _should_log_commands,
    _error,
)
from extensions import limiter
from services.dashboard import (
    _build_dashboard_context,
    _safe_limit,
    _serialize_category_breakdown,
    _serialize_daily_totals,
)
from services.validation import sanitize_category, validate_expense
from database import (
    add_expense,
    get_all_expenses,
    get_cached_insight,
    save_insight,
    log_command_event,
)
from budget_module import set_budget_limit, get_budget_limits, check_and_trigger_budget_alert
from visual_module import get_monthly_totals_by_month
from logger import log_error, log_info
from insight_module import generate_insight

expenses_bp = Blueprint("expenses", __name__, url_prefix="/api")

@expenses_bp.route("/budgets", methods=["GET", "POST"])
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
            set_budget_limit(category, limit_val, user_id=user["id"])
            return jsonify({"success": True})
        except Exception as e:
            return _error(str(e), 400)

    limits = get_budget_limits(user["id"])
    data = {cat: {"limit": lim.limit, "warn_ratio": lim.warn_ratio} for cat, lim in limits.items()}
    return jsonify(data)


@expenses_bp.route("/summary")
def api_summary():
    """Handle API summary."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    context = _build_dashboard_context(user_id=user["id"])
    raw_totals = context["category_totals"]
    category_totals = [
        {"category": cat, "total": total}
        for cat, total in raw_totals
    ]
    return jsonify(
        total_today=context["total_today"],
        monthly_total=context["monthly_total"],
        weekly_summary=context["weekly_summary"],
        monthly_summary=context["monthly_summary"],
        category_totals=category_totals,
        budget_alerts=context["budget_alerts"],
    )


@expenses_bp.route("/recent")
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

    from database import get_db
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
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, amount, category, description, payment_method, date, time "
            f"FROM expenses WHERE {where} ORDER BY date DESC, time DESC, id DESC LIMIT ?",
            params,
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@expenses_bp.route("/add", methods=["POST"])
@limiter.limit("60 per minute")
def api_add():
    """Handle API add."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount", 0))
        category = sanitize_category(data.get("category", ""))
    except (TypeError, ValueError):
        return _error("Invalid amount or category.", 400)

    if amount <= 0 or not category:
        return _error("Amount must be positive and category required.", 400)

    is_valid, error_message = validate_expense(amount, category)
    if not is_valid:
        return _error(error_message, 400)

    try:
        expense_id = add_expense(
            amount,
            category,
            description=data.get("description"),
            user_id=user["id"],
        )
        log_info("Expense added via API (id=%s)", expense_id)
        # Check and trigger push warning if budget threshold breached
        check_and_trigger_budget_alert(user["id"], category)
        return jsonify(
            {
                "message": f"Added ₹{amount:.2f} to {category}.",
                "expense_id": expense_id,
                "reload": True,
            }
        )
    except Exception as exc:
        log_error("Add expense API failed: %s", exc)
        return _error("Failed to add expense.", 500)


@expenses_bp.route("/expenses/<int:expense_id>", methods=["PATCH"])
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
        return _error("Invalid field value.", 400)
    except Exception as exc:
        log_error("Update expense failed: %s", exc)
        return _error("Failed to update expense.", 500)
    if not updated:
        return _error("Expense not found.", 404)
    return jsonify({"message": "Expense updated.", "reload": True})


@expenses_bp.route("/expenses/<int:expense_id>", methods=["DELETE"])
def api_delete_expense(expense_id: int):
    """Delete an expense by id (scoped to the authenticated user)."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    from database import delete_expense
    try:
        deleted = delete_expense(expense_id, user_id=user["id"])
    except Exception as exc:
        log_error("Delete expense failed: %s", exc)
        return _error("Failed to delete expense.", 500)
    if not deleted:
        return _error("Expense not found.", 404)
    return jsonify({"message": "Expense deleted.", "reload": True})


@expenses_bp.route("/export")
def api_export():
    """Handle API export."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    fmt = request.args.get("format", "csv").lower()
    if fmt != "csv":
        return _error("Only format=csv is supported.", 400)
    rows = get_all_expenses(user_id=user["id"], limit=10000)
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["id", "date", "time", "amount", "category", "description", "payment_method"],
        extrasaction="ignore",
    )
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=voxly_expenses.csv"},
    )

@expenses_bp.route("/forecast")
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

    from utils.dates import get_local_now
    today = get_local_now().date()
    current_month_key = today.strftime("%Y-%m")

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

    x = np.arange(len(complete), dtype=float)
    y = complete["total"].astype(float).values

    coeffs = np.polyfit(x, y, 1)
    slope = float(coeffs[0])
    next_x = float(len(complete))
    trend_prediction = float(np.polyval(coeffs, next_x))

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

    import calendar
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_elapsed = today.day
    days_remaining = days_in_month - days_elapsed

    if current_spent > 0 and days_elapsed > 0:
        daily_rate = current_spent / days_elapsed
        run_rate_projection = current_spent + (daily_rate * days_remaining)
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


@expenses_bp.route("/recurring")
def api_recurring():
    """Detect recurring expenses and return them with next expected dates."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    from database import get_recurring_expenses
    items = get_recurring_expenses(user_id=user["id"])
    return jsonify({"items": items, "count": len(items)})


@expenses_bp.route("/insight")
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


@expenses_bp.route("/dashboard")
@limiter.limit("60 per minute")
def api_dashboard():
    """Single endpoint returning all dashboard data at once."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    try:
        context = _build_dashboard_context(user_id=user["id"])
        return jsonify(context)
    except Exception as exc:
        log_error("Dashboard endpoint failed: %s", exc)
        return _error("Failed to load dashboard.", 500)


@expenses_bp.route("/expenses/bulk_sync", methods=["POST"])
def api_bulk_sync():
    """Sync offline recorded expenses in a bulk transaction block."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()

    data = request.get_json(silent=True) or {}
    expenses = data.get("expenses", [])
    if not isinstance(expenses, list):
        return _error("Invalid bulk expenses format. Expected list.", 400)

    from database import get_db
    synced_count = 0
    errors = []

    try:
        with get_db() as conn:
            for item in expenses:
                try:
                    amount = float(item.get("amount", 0))
                    category = sanitize_category(item.get("category", ""))
                except (ValueError, TypeError):
                    errors.append(f"Invalid parameters: {item}")
                    continue

                if amount <= 0 or not category:
                    errors.append(f"Invalid values: amount={amount}, category={category}")
                    continue

                is_valid, error_msg = validate_expense(amount, category)
                if not is_valid:
                    errors.append(error_msg)
                    continue

                try:
                    add_expense(
                        amount,
                        category,
                        description=item.get("description"),
                        date=item.get("date"),
                        user_id=user["id"]
                    )
                    synced_count += 1
                except Exception as exc:
                    errors.append(f"Insert failed for item {item}: {exc}")

            conn.commit()
    except Exception as exc:
        log_error("Bulk sync transaction failed: %s", exc)
        return _error("Failed to sync expenses bulk block.", 500)

    return jsonify({
        "success": True,
        "count": synced_count,
        "errors": errors
    })


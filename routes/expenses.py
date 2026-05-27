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
            return jsonify({"error": str(e)}), 400

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
        category = _sanitize_category(data.get("category", ""))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount or category."}), 400

    if amount <= 0 or not category:
        return jsonify({"error": "Amount must be positive and category required."}), 400

    try:
        expense_id = add_expense(amount, category, user_id=user["id"])
        log_info("Expense added via API (id=%s)", expense_id)
        return jsonify(
            {
                "message": f"Added ₹{amount:.2f} to {category}.",
                "expense_id": expense_id,
                "reload": True,
            }
        )
    except Exception as exc:
        log_error("Add expense API failed: %s", exc)
        return jsonify({"error": "Failed to add expense."}), 500


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
        return jsonify({"error": "Invalid field value."}), 400
    except Exception as exc:
        log_error("Update expense failed: %s", exc)
        return jsonify({"error": "Failed to update expense."}), 500
    if not updated:
        return jsonify({"error": "Expense not found."}), 404
    return jsonify({"message": "Expense updated.", "reload": True})


@expenses_bp.route("/export")
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
        return jsonify({"error": "Failed to load dashboard."}), 500

import io
import csv
from flask import Blueprint, request, jsonify, Response

from app import (
    _require_authenticated_user,
    _unauthorized_response,
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
)
from budget_module import set_budget_limit, get_budget_limits, remove_budget_limit, check_and_trigger_budget_alert
from visual_module import get_monthly_totals_by_month
from logger import log_error, log_info
from insight_module import generate_insight

expenses_bp = Blueprint("expenses", __name__, url_prefix="/api")

@expenses_bp.route("/budgets", methods=["GET", "POST", "DELETE"])
def api_budgets():
    """Handle API budgets."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
        
    if request.method == "POST":
        data = request.json or {}
        category = data.get("category")
        limit = data.get("limit")
        warn_ratio = data.get("warn_ratio")
        try:
            limit_val = float(limit)
            warn_val = float(warn_ratio) if warn_ratio is not None else None
            set_budget_limit(category, limit_val, warn_at=warn_val, user_id=user["id"])
            return jsonify({"success": True})
        except Exception as e:
            return _error(str(e), 400)

    if request.method == "DELETE":
        data = request.json or {}
        category = data.get("category")
        if not category:
            return _error("Category is required.", 400)
        try:
            removed = remove_budget_limit(category, user_id=user["id"])
            return jsonify({"success": True, "removed": removed})
        except Exception as e:
            return _error(str(e), 400)

    limits = get_budget_limits(user["id"])
    data = {cat: {"limit": lim.limit, "warn_ratio": lim.warn_ratio} for cat, lim in limits.items()}
    return jsonify(data)





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
    
    description = data.get("description", "") or ""
    amount_raw = data.get("amount")
    category_raw = data.get("category")
    date_val = None

    import re
    from datetime import date

    def parse_custom_date(date_str: str) -> str | None:
        match = re.match(r'^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$', date_str.strip())
        if not match:
            return None
        try:
            day = int(match.group(1))
            month = int(match.group(2))
            year = int(match.group(3))
            if year < 100:
                year += 2000
            parsed_dt = date(year, month, day)
            return parsed_dt.strftime("%Y-%m-%d")
        except ValueError:
            return None

    # Pattern 1: Full command format, e.g. "20 food swiggy 30/06/26"
    # Matches: <amount> <category> <description> <date>
    full_pattern = r'^(\d+(?:\.\d+)?)\s+(\w+)\s+(.+?)\s+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})$'
    full_match = re.match(full_pattern, description.strip())

    # Pattern 2: Suffix format, e.g. "swiggy 30/06/26"
    # Matches: <description> <date>
    suffix_pattern = r'^(.+?)\s+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})$'
    suffix_match = re.match(suffix_pattern, description.strip())

    if full_match:
        try:
            parsed_amt = float(full_match.group(1))
            parsed_cat = sanitize_category(full_match.group(2))
            parsed_desc = full_match.group(3)
            parsed_dt = parse_custom_date(full_match.group(4))
            if parsed_dt:
                amount = parsed_amt
                category = parsed_cat
                description = parsed_desc
                date_val = parsed_dt
        except Exception:
            pass
    elif suffix_match:
        try:
            parsed_dt = parse_custom_date(suffix_match.group(2))
            if parsed_dt:
                description = suffix_match.group(1)
                date_val = parsed_dt
                amount = float(amount_raw) if amount_raw is not None else 0.0
                category = sanitize_category(category_raw or "")
        except Exception:
            pass

    if date_val is None:
        try:
            amount = float(amount_raw) if amount_raw is not None else 0.0
            category = sanitize_category(category_raw or "")
        except (TypeError, ValueError):
            return _error("Invalid amount or category.", 400)
        date_val = data.get("date")

    if amount <= 0 or not category:
        return _error("Amount must be positive and category required.", 400)

    is_valid, error_message = validate_expense(amount, category)
    if not is_valid:
        return _error(error_message, 400)

    try:
        expense_id = add_expense(
            amount,
            category,
            date=date_val,
            description=description,
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

    from utils.dates import get_local_now
    import calendar as cal_module

    user_id = user["id"]

    rows = get_monthly_totals_by_month(months=7, user_id=user_id)

    # rows is list[dict] with keys: "month" (str YYYY-MM), "total" (float)
    _NOT_ENOUGH = {
        "projected_total": None,
        "confidence": "low",
        "trend": "flat",
        "monthly_series": [],
        "days_remaining": None,
        "message": "Not enough data yet. Add expenses across at least 2 months for a forecast.",
    }

    if not rows or len(rows) < 2:
        return jsonify(_NOT_ENOUGH)

    today = get_local_now().date()
    current_month_key = today.strftime("%Y-%m")

    complete = [r for r in rows if str(r["month"]) != current_month_key]
    current_rows = [r for r in rows if str(r["month"]) == current_month_key]
    current_spent = float(current_rows[0]["total"]) if current_rows else 0.0

    series = [
        {"month": str(r["month"]), "total": float(r["total"])}
        for r in rows
    ]

    if len(complete) < 2:
        return jsonify({**_NOT_ENOUGH, "monthly_series": series,
                        "message": "Not enough complete months for a forecast."})

    # --- Pure-Python linear regression (no pandas / numpy required) ---
    y_vals = [float(r["total"]) for r in complete]
    n = len(y_vals)
    x_vals = list(range(n))

    x_mean = sum(x_vals) / n
    y_mean = sum(y_vals) / n

    ss_xy = sum((x_vals[i] - x_mean) * (y_vals[i] - y_mean) for i in range(n))
    ss_xx = sum((x_vals[i] - x_mean) ** 2 for i in range(n))

    slope = ss_xy / ss_xx if ss_xx else 0.0
    intercept = y_mean - slope * x_mean

    next_x = float(n)
    trend_prediction = slope * next_x + intercept

    # R² calculation
    ss_tot = sum((y - y_mean) ** 2 for y in y_vals)
    ss_res = sum((y_vals[i] - (slope * x_vals[i] + intercept)) ** 2 for i in range(n))
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    if r_squared >= 0.75:
        confidence = "high"
    elif r_squared >= 0.4:
        confidence = "medium"
    else:
        confidence = "low"

    days_in_month = cal_module.monthrange(today.year, today.month)[1]
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


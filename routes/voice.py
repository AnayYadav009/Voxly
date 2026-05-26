import os
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from flask import Blueprint, request, jsonify, make_response, g, Response

# from app.py
from app import (
    COMMAND_LOGGING_ENABLED,
    DATE_FORMAT,
    VOICE_HELP_TEXT,
    _build_chart_series,
    _require_authenticated_user,
    _unauthorized_response,
    _sanitize_category,
    _build_dashboard_context,
    _collect_budget_lines,
    _find_budget_status,
    _format_budget_status_line,
    _humanize_category_name,
    _refresh_dashboard,
    _safe_limit,
    _serialize_category_breakdown,
    _serialize_budget_status,
    _summarize_chart_series,
    _should_log_commands,
    _user_preferences_payload,
    limiter
)
from database import (
    add_expense, create_connection, update_expense, get_all_expenses,
    get_cached_insight, save_insight, log_command_event, update_user_log_opt_in,
    delete_last_expense, get_recent_expenses, get_total_today
)
from budget_module import (
    evaluate_monthly_budgets,
    get_alert_for_category,
    get_budget_limits,
    remove_budget_limit,
    set_budget_limit,
)
from summary_module import get_monthly_summary_text, get_weekly_summary_text, get_monthly_total
from visual_module import generate_all_charts, get_category_breakdown, get_monthly_totals_by_month, get_recent_daily_totals
from logger import log_error, log_info
from insight_module import generate_insight
from voice_nlp import parse_expense

voice_bp = Blueprint("voice", __name__, url_prefix="/api")

@voice_bp.route("/voice_command", methods=["POST"])
@limiter.limit("30 per minute")
def api_voice_command():
    """Handle API voice command."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload: Dict[str, Any] = request.get_json(silent=True) or {}
    command_text = str(payload.get("command", "")).strip()
    MAX_COMMAND_LENGTH = 500
    if len(command_text) > MAX_COMMAND_LENGTH:
        return jsonify({"error": "Command too long."}), 400
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
        response["reply"] = "Repeat is not supported in the web interface. Please say your command again."
        return jsonify(response)

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
            # removed due to stateless repeat handling

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
        return jsonify(response)

    if action == "balance":
        total_today = get_total_today(user_id=user_id)
        response["reply"] = f"Today's total spend is ₹{total_today:.2f}."
        response["total_today"] = total_today
        return jsonify(response)

    if action == "recent":
        limit = _safe_limit(payload.get("limit"), default=5)
        recent_items = get_recent_expenses(limit, user_id=user_id)
        response["reply"] = "Here are the most recent expenses."
        response["recent_expenses"] = recent_items
        return jsonify(response)

    if action == "weekly":
        summary_text = get_weekly_summary_text(user_id=user_id)
        response["reply"] = summary_text
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
            set_budget_limit(category, limit_value, warn_at=warn_ratio if warn_ratio is not None else None, user_id=user_id)
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
        return jsonify(response)

    if action == "remove_budget":
        category = parsed.get("category")
        if not category:
            response["reply"] = "Please tell me which budget to remove."
            return jsonify(response), 400
        try:
            removed = remove_budget_limit(category, user_id=user_id)
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
        return jsonify(response)

    response["reply"] = "That command is not supported yet."
    return jsonify(response)

@voice_bp.route("/preferences", methods=["GET", "PUT"])
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


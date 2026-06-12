import os
import unicodedata
import requests
from dataclasses import asdict
from typing import Dict, Any
from flask import Blueprint, request, jsonify, Response, stream_with_context

# from app.py
from app import (
    COMMAND_LOGGING_ENABLED,
    VOICE_HELP_TEXT,
    _require_authenticated_user,
    _unauthorized_response,
    _should_log_commands,
    _user_preferences_payload,
    _error,
    _set_last_command,
)
from extensions import limiter
from services.dashboard import (
    _build_chart_series,
    _collect_budget_lines,
    _find_budget_status,
    _format_budget_status_line,
    _humanize_category_name,
    _safe_limit,
    _serialize_budget_status,
    _summarize_chart_series,
    _build_dashboard_context,
)
from services.validation import sanitize_category, validate_expense
from database import (
    add_expense, log_command_event, update_user_log_opt_in,
    delete_last_expense, get_recent_expenses, get_total_today
)
from budget_module import (
    evaluate_monthly_budgets,
    get_budget_limits,
    remove_budget_limit,
    set_budget_limit,
    check_and_trigger_budget_alert,
)
from summary_module import get_monthly_summary_text, get_weekly_summary_text
from logger import log_error
from voice_nlp import parse_expense

voice_bp = Blueprint("voice", __name__, url_prefix="/api")
MAX_COMMAND_LENGTH = 500

@voice_bp.route("/voice_command", methods=["POST"])
@limiter.limit("60 per minute")
def api_voice_command():
    """Handle API voice command."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    payload: Dict[str, Any] = request.get_json(silent=True) or {}
    command_text = str(payload.get("command", "")).strip()
    command_text = "".join(ch for ch in command_text if unicodedata.category(ch)[0] != "C")
    if len(command_text) > MAX_COMMAND_LENGTH:
        return _error("Command too long.", 400)
    if not command_text:
        return _error("Command text required.", 400)
    user_id = user["id"]

    try:
        parsed = parse_expense(command_text)
    except Exception as exc:
        log_error("Failed to parse voice command: %s", exc)
        return _error("Could not understand the command.", 500)

    intents = parsed.get("intents", [])
    if not intents and "action" in parsed:
        from voice_nlp import _normalize_parsed_intents
        parsed = _normalize_parsed_intents(parsed)
        intents = parsed.get("intents", [])

    if not intents:
        return jsonify({"reply": "I did not hear a command.", "action": "none"}), 400

    if _should_log_commands(user):
        try:
            primary_action = intents[0].get("action") if intents else "unknown"
            log_command_event(
                user_id=user_id,
                raw_text=command_text,
                parsed_payload=parsed,
                intent=primary_action,
                channel="voice",
                metadata={"intents_count": len(intents)}
            )
        except Exception as exc:
            log_error("Command logging failed: %s", exc)

    replies = []
    reload_dashboard = False
    dashboard_overrides = {}

    from database import get_db
    try:
        with get_db() as conn:
            total_add_expenses = sum(1 for item in intents if item.get("action") == "add_expense")
            add_expenses_processed = 0

            for intent in intents:
                action = intent.get("action", "unknown")

                if action == "add_expense":
                    amount = intent.get("amount")
                    category = sanitize_category(intent.get("category") or "uncategorized")
                    try:
                        amount_val = float(amount) if amount is not None else None
                    except (TypeError, ValueError):
                        amount_val = None
                    if amount_val is None or amount_val <= 0:
                        conn.rollback()
                        return jsonify({
                            "reply": "Please include a valid amount to add an expense.",
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400

                    is_valid, error_message = validate_expense(amount_val, category)
                    if not is_valid:
                        conn.rollback()
                        return jsonify({
                            "reply": error_message,
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400

                    try:
                        add_expense(
                            amount_val,
                            category,
                            date=intent.get("date"),
                            description=intent.get("description"),
                            user_id=user_id,
                        )
                    except Exception as exc:
                        log_error("Voice add expense failed: %s", exc)
                        conn.rollback()
                        return _error("Failed to add the expense.", 500)

                    check_and_trigger_budget_alert(user_id, category)

                    if add_expenses_processed == 0:
                        msg = f"Added ₹{amount_val:.2f} to {category}."
                        if total_add_expenses > 1:
                            msg += f" Also recorded {total_add_expenses - 1} additional item(s)."
                        replies.append(msg)
                    else:
                        replies.append(f"Recorded ₹{amount_val:.2f} to {category}.")

                    add_expenses_processed += 1
                    reload_dashboard = True
                    _set_last_command(user_id, intent)

                elif action == "delete_expense":
                    try:
                        removed_id = delete_last_expense(user_id=user_id)
                    except Exception as exc:
                        log_error("Voice delete expense failed: %s", exc)
                        conn.rollback()
                        return _error("Failed to delete the last expense.", 500)
                    if not removed_id:
                        replies.append("No expense to delete.")
                    else:
                        replies.append(f"Deleted last expense (ID {removed_id}).")
                        reload_dashboard = True

                elif action == "check_balance":
                    total_today = get_total_today(user_id=user_id)
                    replies.append(f"Today's total spend is ₹{total_today:.2f}.")
                    dashboard_overrides["total_today"] = total_today

                elif action == "recent_expenses":
                    limit = _safe_limit(payload.get("limit"), default=5)
                    recent_items = get_recent_expenses(limit, user_id=user_id)
                    replies.append("Here are your recent expenses.")
                    dashboard_overrides["recent_expenses"] = recent_items

                elif action == "weekly_summary":
                    summary_text = get_weekly_summary_text(user_id=user_id)
                    replies.append(summary_text)

                elif action == "monthly_summary":
                    summary_text = get_monthly_summary_text(user_id=user_id)
                    statuses = evaluate_monthly_budgets(user_id=user_id)
                    limits = get_budget_limits(user_id)
                    if statuses:
                        lines = _collect_budget_lines(statuses, limits)
                        summary_text = summary_text + "\n" + "\n".join(lines)
                        dashboard_overrides["budget_statuses"] = _serialize_budget_status(statuses)
                        dashboard_overrides["budget_lines"] = lines
                    replies.append(summary_text)

                elif action == "get_budget_status":
                    category = intent.get("category")
                    limits = get_budget_limits(user_id)
                    statuses = evaluate_monthly_budgets(user_id=user_id)
                    if category:
                        status = _find_budget_status(category, statuses)
                        limit_info = limits.get(category.lower())
                        human_name = _humanize_category_name(category)
                        if status:
                            line = _format_budget_status_line(status, limit_info)
                            replies.append(line)
                            dashboard_overrides["budget_status"] = asdict(status)
                        elif limit_info:
                            warn_percent = int(round(limit_info.warn_ratio * 100))
                            replies.append(f"{human_name} budget is ₹{limit_info.limit:.0f} per month with alerts at {warn_percent}%.")
                            dashboard_overrides["budget_limit"] = {
                                "category": limit_info.category,
                                "limit": limit_info.limit,
                                "warn_ratio": limit_info.warn_ratio,
                            }
                        else:
                            replies.append(f"No budget configured for {human_name}.")
                        if statuses:
                            dashboard_overrides["budget_statuses"] = _serialize_budget_status(statuses)
                    else:
                        if statuses:
                            lines = _collect_budget_lines(statuses, limits)
                            replies.append("\n".join(lines))
                            dashboard_overrides["budget_statuses"] = _serialize_budget_status(statuses)
                            dashboard_overrides["budget_lines"] = lines
                        else:
                            replies.append("No budgets configured.")

                elif action == "set_budget":
                    category = intent.get("category")
                    amount = intent.get("amount")
                    warn_ratio = intent.get("warn_ratio")
                    if not category:
                        conn.rollback()
                        return jsonify({
                            "reply": "Please specify which category the budget should apply to.",
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400
                    try:
                        limit_value = float(amount) if amount is not None else None
                    except (TypeError, ValueError):
                        limit_value = None
                    if limit_value is None or limit_value <= 0:
                        conn.rollback()
                        return jsonify({
                            "reply": "Please provide a positive budget amount.",
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400

                    try:
                        set_budget_limit(category, limit_value, warn_at=warn_ratio, user_id=user_id)
                    except ValueError as exc:
                        conn.rollback()
                        return jsonify({
                            "reply": str(exc),
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400
                    except Exception as exc:
                        log_error("Voice set budget failed: %s", exc)
                        conn.rollback()
                        return _error("Failed to update that budget.", 500)

                    limits = get_budget_limits(user_id)
                    limit_info = limits.get(category.lower())
                    statuses = evaluate_monthly_budgets(user_id=user_id)
                    status = _find_budget_status(category, statuses)
                    if status:
                        lines = _collect_budget_lines([status], limits)
                        replies.append(lines[0])
                        dashboard_overrides["budget_status"] = asdict(status)
                    elif limit_info:
                        warn_percent = int(round(limit_info.warn_ratio * 100))
                        replies.append(f"Set {_humanize_category_name(category)} budget to ₹{limit_info.limit:.0f} with alerts at {warn_percent}%.")
                    else:
                        replies.append(f"Set {_humanize_category_name(category)} budget to ₹{limit_value:.0f}.")
                    
                    if statuses:
                        dashboard_overrides["budget_statuses"] = _serialize_budget_status(statuses)
                        dashboard_overrides["budget_lines"] = _collect_budget_lines(statuses, limits)
                    if limit_info:
                        dashboard_overrides["budget_limit"] = {
                            "category": limit_info.category,
                            "limit": limit_info.limit,
                            "warn_ratio": limit_info.warn_ratio,
                        }
                    if warn_ratio is not None:
                        dashboard_overrides["warn_ratio"] = warn_ratio
                    reload_dashboard = True

                elif action == "remove_budget":
                    category = intent.get("category")
                    if not category:
                        conn.rollback()
                        return jsonify({
                            "reply": "Please tell me which budget to remove.",
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400
                    try:
                        removed = remove_budget_limit(category, user_id=user_id)
                    except ValueError as exc:
                        conn.rollback()
                        return jsonify({
                            "reply": str(exc),
                            "reload": False,
                            "action": parsed.get("action", "unknown")
                        }), 400
                    except Exception as exc:
                        log_error("Voice remove budget failed: %s", exc)
                        conn.rollback()
                        return _error("Failed to remove that budget.", 500)

                    human_name = _humanize_category_name(category)
                    limits = get_budget_limits(user_id)
                    statuses = evaluate_monthly_budgets(user_id=user_id)
                    lines = _collect_budget_lines(statuses, limits) if statuses else []
                    if removed:
                        if lines:
                            replies.append(f"Removed {human_name} budget. " + " ".join(lines))
                        else:
                            replies.append(f"Removed {human_name} budget. No budgets remain.")
                        reload_dashboard = True
                        dashboard_overrides["removed_budget"] = category.lower()
                    else:
                        replies.append(f"No budget configured for {human_name}.")
                    if statuses:
                        dashboard_overrides["budget_statuses"] = _serialize_budget_status(statuses)
                        dashboard_overrides["budget_lines"] = lines

                elif action == "chart_summary":
                    try:
                        series = _build_chart_series(user_id=user_id)
                    except Exception as exc:
                        log_error("Voice chart summary failed: %s", exc)
                        conn.rollback()
                        return _error("Chart data is unavailable right now.", 500)
                    summary_text = _summarize_chart_series(series)
                    replies.append(summary_text)
                    dashboard_overrides["chart_series"] = series
                    dashboard_overrides["speak"] = summary_text

                elif action == "help":
                    replies.append(VOICE_HELP_TEXT)

                elif action == "exit":
                    replies.append("The assistant stays ready. Say another command when you are ready.")

                elif action == "repeat":
                    replies.append("The 'repeat' command is not supported in the web API. Please re-send your original command.")

                elif action == "unknown":
                    replies.append("I did not understand that command. Try saying help.")

                else:
                    replies.append(f"Command '{action}' is not supported yet.")

            conn.commit()
    except Exception as exc:
        log_error("Failed to execute voice transaction: %s", exc)
        return _error("Error executing commands.", 500)

    # Consolidate output response
    response_reply = " ".join(replies)
    response = {
        "reply": response_reply,
        "reload": reload_dashboard,
        "action": parsed.get("action", "unknown")
    }
    # If reload is required, fetch fresh dashboard snapshot, otherwise merge specific query structures
    if reload_dashboard:
        response["dashboard"] = _build_dashboard_context(user_id=user_id)
    
    if dashboard_overrides:
        response.update(dashboard_overrides)

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


@voice_bp.route("/voice/tts", methods=["POST"])
@limiter.limit("30 per minute")
def api_voice_tts():
    """High-Fidelity Text-to-Speech endpoint streaming audio chunks from OpenAI TTS API."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()

    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    if not text:
        return _error("Text is required.", 400)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # Fallback if API key is not configured: just log and return 400 or 500
        return _error("OPENAI_API_KEY is not configured.", 500)

    url = "https://api.openai.com/v1/audio/speech"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "tts-1",
        "input": text,
        "voice": "alloy",
        "response_format": "mp3"
    }

    try:
        # Stream audio chunks directly from OpenAI to the client
        res = requests.post(url, json=payload, headers=headers, stream=True)
        if res.status_code != 200:
            log_error("OpenAI TTS request failed: %s", res.text)
            return _error("Failed to generate speech.", 500)

        def generate():
            for chunk in res.iter_content(chunk_size=4096):
                if chunk:
                    yield chunk

        return Response(stream_with_context(generate()), mimetype="audio/mpeg")
    except Exception as exc:
        log_error("OpenAI TTS exception: %s", exc)
        return _error("Failed to communicate with TTS service.", 500)


import warnings
from datetime import datetime
from typing import Any, Dict, List, Optional

from budget_module import (
    evaluate_monthly_budgets,
    get_alert_for_category,
    set_budget_limit,
    remove_budget_limit,
    format_budget_summary,
    get_budget_limits,
)
from config import DATE_FORMAT

from voice_module import (
    confirm_amount_flow,
    get_voice_input,
    parse_expense,
    respond,
    speak,
)
from visual_module import generate_all_charts
from database import (
    add_expense,
    create_table,
    delete_last_expense,
    get_recent_expenses,
    get_total_today,
)
from summary_module import get_monthly_summary_text, get_weekly_summary_text

def show_help() -> str:
    help_text = (
        "Try commands like:\n"
        "- Add 200 to food\n"
        "- What's my balance today\n"
        "- Show recent expenses\n"
        "- Give weekly summary\n"
        "- Delete last expense\n"
        "- Set budget for food to 5000\n"
        "- What's my budget / Show budgets\n"
        "- Repeat last command\n"
        "- Stop to exit"
    )
    print(help_text)
    speak(
        "You can add expenses, set or ask about budgets, ask for balance, recent items, weekly or monthly summary, delete last expense, or say stop.",
        tone="info",
    )
    return help_text

def _speak_recent(items: List[dict]) -> None:
    if not items:
        respond("recent", "No recent expenses recorded.")
        return
    top = items[0]
    respond(
        "recent",
        f"Most recent is ₹{top['amount']} on {top['category']} dated {top['date']} at {top['time']}.",
    )


def main() -> None:
    warnings.warn(
        "The CLI entry point (main.py) is deprecated and does not support "
        "multi-user authentication. Use the Flask API (app.py) instead.",
        DeprecationWarning,
        stacklevel=1,
    )
    create_table()

    speak("Voice tracker ready. Say a command or stop to quit.")
    MAX_ATTEMPTS = 5
    attempts = 0

    previous_command: Optional[Dict] = None
    previous_parsed: Optional[Dict[str, Any]] = None
    while attempts < MAX_ATTEMPTS:
        user_text = get_voice_input(duration=5)

        if not user_text:
            attempts += 1
            print(f"No input. Attempt {attempts}/{MAX_ATTEMPTS}.")
            continue

        attempts = 0
        command = parse_expense(user_text)
        action = command.get("action", "unknown")

        if action == "repeat":
            # Prefer the full parsed command (previous_parsed) if available,
            # fall back to the older lightweight previous_command for safety.
            if previous_parsed:
                respond("info", "Repeating the last command.")
                command = previous_parsed.copy()
                action = command.get("action", "unknown")
            elif previous_command:
                respond("info", "Repeating the last command.")
                command = previous_command.copy()
                action = command.get("action", "unknown")
            else:
                respond("repeat", "No previous command available.")
                continue

        if action == "exit":
            respond("info", "Goodbye. Stopping the tracker.")
            break

        if action == "help":
            show_help()
            continue

        if action == "add":
            amount = command.get("amount")
            category = command.get("category", "uncategorized")
            expense_date = command.get("date")
            description = command.get("description")
            if amount is None:
                amount = confirm_amount_flow()
                if amount is None:
                    respond("error", "Amount still missing. Expense not added.")
                    continue
            try:
                expense_id = add_expense(amount, category, date=expense_date, description=description)
                respond("add", f"Added ₹{amount} to {category}. Entry number {expense_id}.")
                previous_command = {"action": "add", "amount": amount, "category": category}
                previous_parsed = command.copy()
                alert_year: Optional[int] = None
                alert_month: Optional[int] = None
                if expense_date:
                    try:
                        parsed = datetime.strptime(expense_date, DATE_FORMAT)
                        alert_year, alert_month = parsed.year, parsed.month
                    except ValueError:
                        pass
                budget_status = get_alert_for_category(category, year=alert_year, month=alert_month)
                if budget_status:
                    tone = "error" if budget_status.level == "critical" else "info"
                    speak(budget_status.message, tone=tone)
            except Exception as exc:
                respond("error", "Failed to add the expense.")
            continue

        if action == "set_budget":
            amount = command.get("amount")
            category = command.get("category") or "uncategorized"
            if amount is None:
                amount = confirm_amount_flow("Please tell the monthly budget amount.")
                if amount is None:
                    respond("error", "Budget amount missing. Budget not set.")
                    continue
            try:
                set_budget_limit(category, float(amount))
                respond("info", f"Budget set: ₹{float(amount):.0f} per month for {category}.")
                previous_command = {"action": "set_budget", "amount": float(amount), "category": category}
                previous_parsed = command.copy()
            except Exception:
                respond("error", "Failed to set budget.")
            continue

        if action == "show_budgets":
            category = command.get("category")
            if category:
                status = get_alert_for_category(category)
                if status:
                    respond("info", status.message)
                else:
                    limits = get_budget_limits()
                    limit = limits.get(category.lower())
                    if limit:
                        respond("info", f"{category} budget is ₹{limit.limit:.0f} per month.")
                    else:
                        respond("info", f"No budget configured for {category}.")
            else:
                summary = format_budget_summary()
                respond("info", summary)
            previous_command = {"action": "show_budgets", "category": category} if category else {"action": "show_budgets"}
            previous_parsed = command.copy()
            continue

        if action == "remove_budget":
            category = command.get("category")
            if not category:
                respond("error", "Please specify which budget to remove.")
                continue
            try:
                removed = remove_budget_limit(category)
                if removed:
                    respond("info", f"Removed budget for {category}.")
                else:
                    respond("info", f"No budget configured for {category}.")
                previous_command = {"action": "remove_budget", "category": category}
                previous_parsed = command.copy()
            except Exception:
                respond("error", "Failed to remove budget.")
            continue

        if action == "balance":
            total = get_total_today()
            respond("balance", f"Today's total spend is ₹{total:.2f}.")
            previous_command = {"action": "balance"}
            previous_parsed = command.copy()
            continue

        if action == "recent":
            recent = get_recent_expenses(5)
            _speak_recent(recent)
            previous_command = {"action": "recent"}
            previous_parsed = command.copy()
            continue

        if action == "weekly":
            summary = get_weekly_summary_text()
            respond("weekly", summary)
            previous_command = {"action": "weekly"}
            previous_parsed = command.copy()
            continue

        if action == "monthly":
            summary = get_monthly_summary_text()
            respond("monthly", summary)
            for status in evaluate_monthly_budgets():
                if status.level == "warning":
                    speak(status.message, tone="info")
                elif status.level == "critical":
                    speak(status.message, tone="error")
            previous_command = {"action": "monthly"}
            previous_parsed = command.copy()
            continue

        if action == "chart_summary":
            try:
                charts = generate_all_charts()
                # For voice, we don't send file paths; just inform the user that
                # charts were generated and saved to the chart directory.
                respond("info", "Charts generated and saved.")
                previous_command = {"action": "chart_summary"}
                previous_parsed = command.copy()
            except Exception as exc:
                respond("error", "Failed to generate charts.")
            continue

        if action == "delete":
            removed = delete_last_expense()
            if removed:
                respond("delete", f"Deleted expense number {removed}.")
                previous_command = {"action": "delete"}
                previous_parsed = command.copy()
            else:
                respond("delete", "No expense to delete.")
            continue

        if action == "unknown":
            respond(
                "error",
                "I did not recognise that. Say help for a list of commands.",
            )
            attempts += 1
            continue

    if attempts >= MAX_ATTEMPTS:
        respond("error", "No command detected repeatedly. Exiting.")

if __name__ == "__main__":
    main()

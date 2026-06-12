from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from config import GROQ_API_KEY, GROQ_MODEL

_groq_client = None


def _get_client() -> Any:
    global _groq_client
    if _groq_client is None:
        try:
            from groq import Groq
        except Exception as exc:
            raise RuntimeError(
                "The 'groq' package is not installed. Install it or set GROQ_API_KEY only in environments that have it."
            ) from exc
        if not GROQ_API_KEY:
            raise RuntimeError(
                "GROQ_API_KEY is not set. Add it to your .env file."
            )
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


_SYSTEM_PROMPT = """
You are a voice command parser for a personal finance tracker app called Voxly.
The user speaks a command (which can contain multiple intents/actions combined) and you must return ONLY a valid JSON object containing an array under the "intents" key. No prose, no markdown, just raw JSON.

Output JSON structure:
{"intents": [{"action": "<action_name>", ...fields...}]}

Supported actions and their fields:
1. add_expense (equivalent to adding an expense):
   {"action": "add_expense", "amount": <number>, "category": "<string>", "date": "<YYYY-MM-DD or null>", "description": "<string or null>"}

2. delete_expense (equivalent to delete last expense):
   {"action": "delete_expense"}

3. check_balance (equivalent to check total/balance today):
   {"action": "check_balance"}

4. recent_expenses (equivalent to showing recent expenses):
   {"action": "recent_expenses"}

5. weekly_summary (weekly overview):
   {"action": "weekly_summary"}

6. monthly_summary (monthly overview):
   {"action": "monthly_summary"}

7. set_budget (set budget limit):
   {"action": "set_budget", "category": "<string>", "amount": <number>, "warn_ratio": <0.0-1.0 or null>}

8. get_budget_status (show budget limit/status):
   {"action": "get_budget_status", "category": "<string or null>"}

9. remove_budget (delete a budget limit):
   {"action": "remove_budget", "category": "<string>"}

10. chart_summary (chart/graph/visual breakdown):
    {"action": "chart_summary"}

11. help (requests command list):
    {"action": "help"}

12. exit (exit or stop):
    {"action": "exit"}

13. repeat (repeat last command):
    {"action": "repeat"}

14. unknown (unrecognized intent):
    {"action": "unknown"}

Rules:
- If the query contains multiple actions (e.g., "I spent $5 on coffee, $20 on gas, and what is my budget status?"), list each as a separate intent in the array in order of appearance.
- amount must always be a plain number (e.g., 500, not "500 rupees").
- category must be lowercase, one word from: food, transport, entertainment, shopping, utilities, health, education, rent, savings, personal, gifts, charity, insurance, fees. If none match, use "uncategorized".
- date must be ISO format YYYY-MM-DD if mentioned, otherwise null.
- warn_ratio must be a decimal between 0.0 and 1.0 (e.g., "80 percent" -> 0.8). If not mentioned, use null.
- description is any extra detail the user mentioned beyond amount and category. If none, use null.
- Never return anything except the JSON object.
""".strip()


def _parse_expense_offline(text: str) -> Dict[str, Any]:
    cleaned = text.lower().strip()

    # 1. Exit / Stop / Quit
    if cleaned in ("exit", "stop", "quit", "bye"):
        return {"action": "exit"}

    # 2. Help
    if cleaned in ("help", "info", "what can i say", "commands"):
        return {"action": "help"}

    # 3. Repeat
    if cleaned in ("repeat", "repeat last", "say again"):
        return {"action": "repeat"}

    # 4. Delete
    if any(kw in cleaned for kw in ("delete", "undo", "cancel last", "remove last")):
        return {"action": "delete"}

    # 5. Balance
    if any(kw in cleaned for kw in ("balance", "today's total", "spend today", "spent today")):
        return {"action": "balance"}

    # 6. Recent
    if any(kw in cleaned for kw in ("recent", "history")):
        return {"action": "recent"}

    # 7. Weekly summary
    if any(kw in cleaned for kw in ("weekly", "week's summary", "week summary")):
        return {"action": "weekly"}

    # 8. Monthly summary
    if any(kw in cleaned for kw in ("monthly", "month's summary", "month summary", "monthly report")):
        return {"action": "monthly"}

    # 9. Chart summary
    if any(kw in cleaned for kw in ("chart", "visual", "graph", "plot")):
        return {"action": "chart_summary"}

    # Categories list
    categories = [
        "food", "transport", "entertainment", "shopping", "utilities", "health",
        "education", "rent", "savings", "personal", "gifts", "charity", "insurance", "fees"
    ]

    category_synonyms = {
        "grocery": "food", "groceries": "food", "eat": "food", "eating": "food",
        "restaurant": "food", "dinner": "food", "lunch": "food", "breakfast": "food", "cafe": "food",
        "cab": "transport", "taxi": "transport", "uber": "transport", "ola": "transport",
        "bus": "transport", "train": "transport", "flight": "transport", "metro": "transport",
        "petrol": "transport", "fuel": "transport",
        "movie": "entertainment", "movies": "entertainment", "game": "entertainment",
        "games": "entertainment", "play": "entertainment", "party": "entertainment",
        "clothes": "shopping", "buy": "shopping", "mall": "shopping",
        "electricity": "utilities", "water": "utilities", "gas": "utilities",
        "internet": "utilities", "wifi": "utilities", "bill": "utilities", "bills": "utilities",
        "doctor": "health", "medicine": "health", "hospital": "health",
        "school": "education", "college": "education", "book": "education", "books": "education",
        "save": "savings",
        "gift": "gifts",
        "donate": "charity", "donation": "charity",
        "fee": "fees"
    }

    def find_category(s: str) -> str:
        for cat in categories:
            if cat in s:
                return cat
        for syn, cat in category_synonyms.items():
            if syn in s:
                return cat
        return "uncategorized"

    # Pre-extract date and remove it from number search to avoid parsing date components as amount
    date_match = re.search(r'\b(\d{4}-\d{2}-\d{2})\b', cleaned)
    date_val = date_match.group(1) if date_match else None
    cleaned_for_nums = cleaned
    if date_val:
        cleaned_for_nums = cleaned_for_nums.replace(date_val, "")

    # 10. Remove budget
    if "remove budget" in cleaned or "delete budget" in cleaned or "clear budget" in cleaned:
        cat = find_category(cleaned)
        if cat == "uncategorized":
            return {"action": "remove_budget", "category": None}
        return {"action": "remove_budget", "category": cat}

    # 11. Set budget
    if "budget" in cleaned and any(kw in cleaned for kw in ("set", "limit", "to")):
        warn_ratio = None
        warn_match = re.search(r'\b(?:warn|alert)(?:\s+me)?\s+(?:at\s+)?(\d+)\s*(?:percent|%|percentage)?', cleaned)
        if not warn_match:
            warn_match = re.search(r'(\d+)\s*(?:percent|%|percentage)', cleaned)
        if warn_match:
            try:
                percent = float(warn_match.group(1))
                warn_ratio = percent / 100.0
                cleaned_for_nums = cleaned_for_nums.replace(warn_match.group(0), "")
            except Exception:
                pass

        nums = re.findall(r'\b\d+(?:\.\d+)?\b', cleaned_for_nums)
        amount = None
        if nums:
            try:
                amount = float(nums[0])
            except ValueError:
                pass

        cat = find_category(cleaned)
        if amount is not None or cat != "uncategorized":
            return {
                "action": "set_budget",
                "category": cat if cat != "uncategorized" else None,
                "amount": amount,
                "warn_ratio": warn_ratio
            }

    # 12. Show budget status
    if "budget" in cleaned:
        cat = find_category(cleaned)
        if cat == "uncategorized":
            return {"action": "show_budgets", "category": None}
        return {"action": "show_budgets", "category": cat}

    # 13. Add expense (default add fallback)
    nums = re.findall(r'\b\d+(?:\.\d+)?\b', cleaned_for_nums)
    amount = None
    if nums:
        try:
            amount = float(nums[0])
        except ValueError:
            pass
    else:
        # Simple word-to-number parser
        number_words = {
            "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
            "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
            "hundred": 100, "thousand": 1000
        }
        tokens = cleaned_for_nums.split()
        val = 0
        temp = 0
        for token in tokens:
            token = re.sub(r'[^a-z]', '', token)
            if token in number_words:
                w_val = number_words[token]
                if w_val == 100:
                    if temp == 0:
                        temp = 1
                    temp *= 100
                elif w_val == 1000:
                    if temp == 0:
                        temp = 1
                    val += temp * 1000
                    temp = 0
                else:
                    val += temp
                    temp = w_val
        val += temp
        if val > 0:
            amount = float(val)

    if amount is not None:
        cat = find_category(cleaned)
        return {
            "action": "add",
            "amount": amount,
            "category": cat,
            "date": date_val,
            "description": None
        }

    # 14. Unknown fallback
    return {"action": "unknown", "raw": text}


def _normalize_parsed_intents(parsed: Dict[str, Any]) -> Dict[str, Any]:
    if not parsed:
        return {"intents": [], "action": "none"}
    
    if parsed.get("action") == "none":
        return {"intents": [], "action": "none"}
        
    intents = []
    # If it's already in the multi-intent intents array format, normalize the action names if needed
    if "intents" in parsed and isinstance(parsed["intents"], list):
        for intent in parsed["intents"]:
            action = intent.get("action")
            mapping = {
                "add": "add_expense",
                "delete": "delete_expense",
                "balance": "check_balance",
                "recent": "recent_expenses",
                "weekly": "weekly_summary",
                "monthly": "monthly_summary",
                "show_budgets": "get_budget_status",
                "unknown": "unknown",
            }
            if action in mapping:
                intent["action"] = mapping[action]
            intents.append(intent)
    else:
        # If it is a single action dictionary (from offline parser or older Groq prompt format)
        action = parsed.get("action", "unknown")
        mapping = {
            "add": "add_expense",
            "delete": "delete_expense",
            "balance": "check_balance",
            "recent": "recent_expenses",
            "weekly": "weekly_summary",
            "monthly": "monthly_summary",
            "show_budgets": "get_budget_status",
            "set_budget": "set_budget",
            "remove_budget": "remove_budget",
            "chart_summary": "chart_summary",
            "help": "help",
            "exit": "exit",
            "repeat": "repeat",
            "unknown": "unknown",
            "none": "unknown",
        }
        
        mapped_action = mapping.get(action, action)
        if mapped_action == "add_expense":
            intent = {
                "action": "add_expense",
                "amount": parsed.get("amount"),
                "category": parsed.get("category"),
                "date": parsed.get("date"),
                "description": parsed.get("description")
            }
        elif mapped_action == "set_budget":
            intent = {
                "action": "set_budget",
                "category": parsed.get("category"),
                "amount": parsed.get("amount"),
                "warn_ratio": parsed.get("warn_ratio")
            }
        elif mapped_action in ("get_budget_status", "remove_budget"):
            intent = {
                "action": mapped_action,
                "category": parsed.get("category")
            }
        else:
            intent = {
                "action": mapped_action
            }
            if "raw" in parsed:
                intent["raw"] = parsed["raw"]
        
        # If the offline parser matched additional expenses, map them too!
        intents = [intent]
        if action == "add" and parsed.get("_additional_expenses"):
            for extra in parsed["_additional_expenses"]:
                intents.append({
                    "action": "add_expense",
                    "amount": extra.get("amount"),
                    "category": extra.get("category"),
                    "date": extra.get("date"),
                    "description": extra.get("description")
                })
                
    result = {"intents": intents}
    if intents:
        first = intents[0]
        first_action = first["action"]
        legacy_action_mapping = {
            "add_expense": "add",
            "delete_expense": "delete",
            "check_balance": "balance",
            "recent_expenses": "recent",
            "weekly_summary": "weekly",
            "monthly_summary": "monthly",
            "get_budget_status": "show_budgets",
            "set_budget": "set_budget",
            "remove_budget": "remove_budget",
            "chart_summary": "chart_summary",
            "help": "help",
            "exit": "exit",
            "repeat": "repeat",
            "unknown": "unknown",
        }
        result["action"] = legacy_action_mapping.get(first_action, first_action)
        for key in ["amount", "category", "date", "description", "warn_ratio", "raw"]:
            if key in first:
                result[key] = first[key]
    else:
        result["action"] = "unknown"
        
    return result


def parse_expense(text: str) -> Dict[str, Any]:
    """Parse a voice command string into a structured action dict using Groq with offline fallback."""
    if not text or not text.strip():
        return {"intents": [], "action": "none"}

    try:
        client = _get_client()
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": text.strip()},
            ],
            temperature=0.0,
            max_tokens=256,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        # Verify it parsed intents or has keys
        if "intents" in parsed or "action" in parsed:
            return _normalize_parsed_intents(parsed)
    except Exception as exc:
        from logger import log_error
        log_error("Groq parse_expense failed: %s. Using offline parser.", exc)

    return _normalize_parsed_intents(_parse_expense_offline(text))


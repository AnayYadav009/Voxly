from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from config import GROQ_API_KEY, GROQ_MODEL

_groq_client = None


def _get_client() -> Groq:
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
The user speaks a command and you must return ONLY a valid JSON object — no prose,
no markdown, no explanation, just the raw JSON.

Supported actions and their required fields:

1. add an expense:
   {"action": "add", "amount": <number>, "category": "<string>", "date": "<YYYY-MM-DD or null>", "description": "<string or null>"}

2. delete the last expense:
   {"action": "delete"}

3. show today's balance / total:
   {"action": "balance"}

4. show recent expenses:
   {"action": "recent"}

5. weekly summary:
   {"action": "weekly"}

6. monthly summary:
   {"action": "monthly"}

7. set a budget limit:
   {"action": "set_budget", "category": "<string>", "amount": <number>, "warn_ratio": <0.0-1.0 or null>}

8. show budget status (all or one category):
   {"action": "show_budgets", "category": "<string or null>"}

9. remove a budget:
   {"action": "remove_budget", "category": "<string>"}

10. chart / visual summary:
    {"action": "chart_summary"}

11. help:
    {"action": "help"}

12. exit / stop / quit:
    {"action": "exit"}

13. repeat last command:
    {"action": "repeat"}

14. unrecognisable input:
    {"action": "unknown"}

Rules:
- amount must always be a plain number (e.g. 500, not "500 rupees").
- category must be lowercase, one word from: food, transport, entertainment,
  shopping, utilities, health, education, rent, savings, personal, gifts,
  charity, insurance, fees. If none match, use "uncategorized".
- date must be ISO format YYYY-MM-DD if mentioned, otherwise null.
- warn_ratio must be a decimal between 0.0 and 1.0 (e.g. "80 percent" → 0.8).
  If not mentioned, use null.
- description is any extra detail the user mentioned beyond amount and category.
  If none, use null.
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


def parse_expense(text: str) -> Dict[str, Any]:
    """Parse a voice command string into a structured action dict using Groq with offline fallback."""
    if not text or not text.strip():
        return {"action": "none"}

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
        if "action" in parsed:
            return parsed
    except Exception as exc:
        from logger import log_error
        log_error("Groq parse_expense failed: %s. Using offline parser.", exc)

    return _parse_expense_offline(text)


"""
Groq-backed NLP parser for voice commands.
Falls back to the regex parser in voice_module if Groq is unavailable.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from config import GROQ_API_KEY, GROQ_PARSE_MODEL, GROQ_ENABLED
from logger import log_error, log_info

_SYSTEM_PROMPT = """
You are a financial assistant that parses voice commands into structured JSON.

Extract the intent and entities from the user's command and return ONLY valid JSON.
No explanation, no markdown, no code fences. Just the JSON object.

Supported actions and their JSON shapes:

add expense:
{"action":"add","amount":<number>,"category":<string>,"date":<"YYYY-MM-DD" or null>,"description":<string or null>}

delete last expense:
{"action":"delete"}

show balance / today's total:
{"action":"balance"}

show recent expenses:
{"action":"recent"}

weekly summary:
{"action":"weekly"}

monthly summary:
{"action":"monthly"}

set budget (e.g. "set food budget to 5000"):
{"action":"set_budget","category":<string>,"amount":<number>,"warn_ratio":<0.0-1.0 or null>}

show budgets:
{"action":"show_budgets","category":<string or null>}

remove budget:
{"action":"remove_budget","category":<string>}

chart summary:
{"action":"chart_summary"}

help:
{"action":"help"}

unrecognised command:
{"action":"unknown"}

Categories to use (pick the closest match, default to "uncategorized"):
food, transport, entertainment, shopping, utilities, health, education,
rent, savings, personal, gifts, charity, insurance, fees, uncategorized

Rules:
- Amounts: extract numeric value only. "five hundred" → 500, "2k" → 2000,
  "fifty k" → 50000, "two and a half thousand" → 2500, "1.5 lakh" → 150000
- Dates: convert relative dates to YYYY-MM-DD based on today's date if mentioned.
  "yesterday" → yesterday's date, "last monday" → last monday's date.
  If no date is mentioned, use null.
- Multi-item commands: if the user says "add 200 food and 50 transport",
  return {"action":"add_multiple","expenses":[{"amount":200,"category":"food","date":null,"description":null},{"amount":50,"category":"transport","date":null,"description":null}]}
- If the command is in Hindi/Hinglish (e.g. "khaane ke liye 300 add karo"), still parse it correctly.
- description: extract any meaningful label beyond the category (e.g. "Swiggy order", "petrol", "gym fees").
  If nothing specific, use null.
"""

_client = None

def _get_client():
    global _client
    if _client is not None:
        return _client
    if not GROQ_ENABLED:
        return None
    try:
        from groq import Groq
        _client = Groq(api_key=GROQ_API_KEY)
        return _client
    except Exception as exc:
        log_error("Failed to initialise Groq client: %s", exc)
        return None


def parse_with_groq(text: str) -> Optional[Dict[str, Any]]:
    """
    Parse a voice command using Groq. Returns a parsed dict or None if
    the API is unavailable or returns unparseable output.
    """
    client = _get_client()
    if not client:
        return None
    if not text or not text.strip():
        return {"action": "none"}
    try:
        from datetime import date
        today_str = date.today().isoformat()
        user_message = f"Today's date is {today_str}.\n\nVoice command: {text.strip()}"
        chat = client.chat.completions.create(
            model=GROQ_PARSE_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.0,
            max_tokens=256,
        )
        raw = chat.choices[0].message.content.strip()
        # Strip any accidental markdown code fences
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        parsed = json.loads(raw)
        log_info("Groq parsed '%s' → action=%s", text[:60], parsed.get("action"))
        return parsed
    except json.JSONDecodeError as exc:
        log_error("Groq returned invalid JSON for '%s': %s", text[:60], exc)
        return None
    except Exception as exc:
        log_error("Groq parse_with_groq failed: %s", exc)
        return None


def parse_expense_groq(text: str) -> Dict[str, Any]:
    """
    Public entry point. Tries Groq first, falls back to regex parser.
    Normalises the Groq result to match the shape that app.py expects.
    """
    result = parse_with_groq(text)

    if result is None:
        # Groq unavailable — fall back to regex
        log_info("Groq unavailable, falling back to regex parser")
        from voice_module import parse_expense as regex_parse
        return regex_parse(text)

    # Normalise add_multiple into the first expense + log the rest
    # (full multi-expense support can be added to the API layer later)
    if result.get("action") == "add_multiple":
        expenses = result.get("expenses") or []
        if expenses:
            first = expenses[0]
            first["action"] = "add"
            first.setdefault("description", None)
            first.setdefault("date", None)
            # Store extras so the caller can optionally handle them
            if len(expenses) > 1:
                first["_additional_expenses"] = expenses[1:]
            return first
        return {"action": "unknown", "raw": text}

    return result

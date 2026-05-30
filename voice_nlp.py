from __future__ import annotations

import json
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


def parse_expense(text: str) -> Dict[str, Any]:
    """Parse a voice command string into a structured action dict using Groq."""
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
        if "action" not in parsed:
            return {"action": "unknown", "raw": text}
        return parsed
    except json.JSONDecodeError:
        return {"action": "unknown", "raw": text}
    except Exception as exc:
        from logger import log_error
        log_error("Groq parse_expense failed: %s", exc)
        return {"action": "unknown", "raw": text}

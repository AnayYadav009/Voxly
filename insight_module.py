"""
Generates a single AI-powered spending insight for a user using Groq.
Falls back to a rule-based heuristic if Groq is unavailable.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from config import GROQ_ENABLED, GROQ_INSIGHT_MODEL, GROQ_API_KEY
from logger import log_error, log_info

_INSIGHT_SYSTEM_PROMPT = """
You are a sharp, concise personal finance analyst.

Given a user's spending data for the last 7 days, produce ONE specific,
non-obvious, actionable observation. Not a generic summary.

Rules:
- Maximum 25 words.
- Be specific with numbers: say "3× more" not "significantly more".
- Focus on patterns, anomalies, or day-of-week trends if present.
- Do not start with "You" — start with a verb or noun phrase.
- Do not include emojis.
- Return ONLY the insight sentence. Nothing else.

Bad example: "Your food spending was higher than usual this week."
Good example: "Food spending on Saturday was 4× the weekday average — ₹1,200 vs ₹280."
"""


def _rule_based_insight(
    daily_totals: List[Dict[str, Any]],
    category_totals: List[Dict[str, Any]],
) -> str:
    """Simple heuristic fallback when Groq is unavailable."""
    if not daily_totals:
        return "No spending data available for this week yet."

    amounts = [float(d.get("total", 0)) for d in daily_totals]
    labels = [d.get("label", d.get("date", "")) for d in daily_totals]

    max_amount = max(amounts)
    max_label = labels[amounts.index(max_amount)]
    avg = sum(amounts) / len(amounts) if amounts else 0

    if avg > 0 and max_amount > avg * 2:
        return f"Spending peaked on {max_label} at {int(max_amount / avg)}× the weekly average."

    if category_totals:
        top_cat = category_totals[0]
        cat_name = str(top_cat.get("category", "")).title()
        cat_total = float(top_cat.get("total", 0))
        weekly_total = sum(amounts)
        if weekly_total > 0:
            pct = int((cat_total / weekly_total) * 100)
            return f"{cat_name} accounted for {pct}% of this week's total spend."

    return f"Weekly total: ₹{int(sum(amounts))}. Daily average: ₹{int(avg)}."


def generate_insight(
    daily_totals: List[Dict[str, Any]],
    category_totals: List[Dict[str, Any]],
) -> str:
    """
    Generate a spending spending insight. Tries Groq first, falls back to heuristic.
    """
    if not GROQ_ENABLED:
        log_info("Groq not configured — using rule-based insight")
        return _rule_based_insight(daily_totals, category_totals)

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)

        # Format the data compactly for the prompt
        daily_lines = "\n".join(
            f"  {d.get('label', d.get('date', '?'))}: ₹{float(d.get('total', 0)):.0f}"
            for d in daily_totals
        )
        cat_lines = "\n".join(
            f"  {str(c.get('category', '?')).title()}: ₹{float(c.get('total', 0)):.0f}"
            for c in category_totals[:6]
        )

        user_message = f"""Last 7 days daily spending:
{daily_lines}

Category breakdown:
{cat_lines}"""

        chat = client.chat.completions.create(
            model=GROQ_INSIGHT_MODEL,
            messages=[
                {"role": "system", "content": _INSIGHT_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.4,
            max_tokens=60,
        )
        insight = chat.choices[0].message.content.strip().strip('"').strip("'")
        log_info("Generated Groq insight (%d chars)", len(insight))
        return insight

    except Exception as exc:
        log_error("Groq insight generation failed: %s", exc)
        return _rule_based_insight(daily_totals, category_totals)

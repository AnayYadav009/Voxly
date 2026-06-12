from __future__ import annotations
from typing import Any, Dict, List, Optional

# Maps a human-readable merchant/tag label to a set of lowercase keywords.
# Matching is a case-insensitive substring search against `description`.
_MERCHANT_KEYWORDS: Dict[str, set] = {
    "Cab Rides": {"rapido", "uber", "ola", "taxi", "cab"},
    "Food Delivery": {"swiggy", "zomato", "eternal", "eatsure"},
    "Public Transit": {"metro", "irctc", "redbus", "bus", "train"},
    "Groceries Delivery": {"blinkit", "zepto", "bigbasket", "instamart", "swiggy instamart"},
    "Streaming & Subscriptions": {"netflix", "prime", "hotstar", "spotify", "youtube"},
    "Fuel": {"petrol", "diesel", "indianoil", "hpcl", "bpcl", "shell"},
    "Online Shopping": {"amazon", "flipkart", "myntra", "ajio"},
}

OTHER_LABEL = "Other"


def _match_label(description: Optional[str]) -> str:
    """Return the merchant label matching `description`, or OTHER_LABEL."""
    if not description:
        return OTHER_LABEL
    lowered = description.lower()
    for label, keywords in _MERCHANT_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return label
    return OTHER_LABEL


def analyze_expenses(expenses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Group a list of expense rows by merchant keyword and return totals.

    Each expense dict is expected to have at least `amount` (float/number)
    and `description` (str or None) keys.

    Returns:
        {
            "total": float,
            "count": int,
            "breakdown": [
                {"label": str, "total": float, "count": int, "percentage": float},
                ...
            ]
        }
    `breakdown` is sorted by total descending, with the "Other" bucket always
    placed last regardless of its total (omitted entirely if its count is 0).
    """
    groups: Dict[str, Dict[str, float]] = {}
    grand_total = 0.0

    for expense in expenses:
        amount = float(expense.get("amount") or 0.0)
        label = _match_label(expense.get("description"))
        bucket = groups.setdefault(label, {"total": 0.0, "count": 0})
        bucket["total"] += amount
        bucket["count"] += 1
        grand_total += amount

    other = groups.pop(OTHER_LABEL, None)

    breakdown = [
        {
            "label": label,
            "total": data["total"],
            "count": data["count"],
            "percentage": (data["total"] / grand_total * 100) if grand_total else 0.0,
        }
        for label, data in groups.items()
    ]
    breakdown.sort(key=lambda item: item["total"], reverse=True)

    if other and other["count"] > 0:
        breakdown.append(
            {
                "label": OTHER_LABEL,
                "total": other["total"],
                "count": other["count"],
                "percentage": (other["total"] / grand_total * 100) if grand_total else 0.0,
            }
        )

    return {
        "total": grand_total,
        "count": len(expenses),
        "breakdown": breakdown,
    }


__all__ = ["analyze_expenses", "MERCHANT_KEYWORDS"]
MERCHANT_KEYWORDS = _MERCHANT_KEYWORDS

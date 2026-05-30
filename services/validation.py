"""Shared validation helpers for expense input."""

from __future__ import annotations

import re
from typing import Optional, Tuple

MAX_AMOUNT = 10_000_000
MAX_CATEGORY_LENGTH = 64
ALLOWED_CATEGORY_PATTERN = re.compile(r"^[a-zA-Z0-9 _-]+$")


def sanitize_category(raw: str) -> str:
    """Normalize and validate a category string."""
    cleaned = (raw or "").strip().lower()
    if not cleaned:
        return "uncategorized"
    return cleaned[:MAX_CATEGORY_LENGTH]


def validate_expense(amount: float, category: str) -> Tuple[bool, Optional[str]]:
    """Return (is_valid, error_message) for expense amount and category."""
    if amount > MAX_AMOUNT:
        return False, f"Amount exceeds maximum of {MAX_AMOUNT}."
    if len(category) > MAX_CATEGORY_LENGTH:
        return False, f"Category name too long (max {MAX_CATEGORY_LENGTH} chars)."
    if not ALLOWED_CATEGORY_PATTERN.match(category):
        return False, "Category contains invalid characters."
    return True, None

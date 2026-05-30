"""Date and time helpers."""

from __future__ import annotations

import calendar
from datetime import datetime, timedelta


def month_range(year: int, month: int) -> tuple[datetime, datetime]:
    """Return (first_of_month, first_of_next_month) as naive datetimes."""
    first = datetime(year, month, 1)
    _, last_day = calendar.monthrange(year, month)
    next_month = first.replace(day=last_day) + timedelta(days=1)
    return first, next_month

"""Date and time helpers."""

from __future__ import annotations

import calendar
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def get_timezone() -> ZoneInfo:
    """Return the configured application timezone."""
    from config import VOXLY_TIMEZONE
    return ZoneInfo(VOXLY_TIMEZONE)


def get_local_now() -> datetime:
    """Return the current datetime in the configured application timezone."""
    return datetime.now(get_timezone())



def month_range(year: int, month: int) -> tuple[datetime, datetime]:
    """Return (first_of_month, first_of_next_month) as naive datetimes."""
    first = datetime(year, month, 1)
    _, last_day = calendar.monthrange(year, month)
    next_month = first.replace(day=last_day) + timedelta(days=1)
    return first, next_month

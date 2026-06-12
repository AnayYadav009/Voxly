from zoneinfo import ZoneInfo
from utils.dates import get_timezone, get_local_now
from database import _normalize_date, _normalize_time

def test_timezone_helpers(monkeypatch):
    # Test setting America/New_York
    monkeypatch.setattr("config.VOXLY_TIMEZONE", "America/New_York")
    tz = get_timezone()
    assert tz == ZoneInfo("America/New_York")
    
    now_ny = get_local_now()
    assert now_ny.tzinfo == tz
    
    # Test setting Asia/Kolkata (IST)
    monkeypatch.setattr("config.VOXLY_TIMEZONE", "Asia/Kolkata")
    tz_ist = get_timezone()
    assert tz_ist == ZoneInfo("Asia/Kolkata")
    
    now_ist = get_local_now()
    assert now_ist.tzinfo == tz_ist
    
    # Verify they have different local time representations
    assert now_ny.strftime("%z") != now_ist.strftime("%z")

def test_normalize_date_time_respects_timezone(monkeypatch):
    monkeypatch.setattr("config.VOXLY_TIMEZONE", "Asia/Kolkata")
    date_str = _normalize_date()
    time_str = _normalize_time()
    
    now_ist = get_local_now()
    assert date_str == now_ist.strftime("%Y-%m-%d")
    # Check minutes to avoid race condition on seconds
    assert time_str[:5] == now_ist.strftime("%H:%M")

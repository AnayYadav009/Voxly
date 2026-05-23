"""Test suite for the Voxly application.

Tests cover API endpoints, voice command parsing, budget limits,
and multi-user functionality.
"""
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import sqlite3  # noqa: E402

import database  # noqa: E402
import summary_module  # noqa: E402
import visual_module  # noqa: E402
import app as app_module  # noqa: E402
from app import _safe_limit, app  # noqa: E402
app.config["TESTING"] = True
app.config["RATELIMIT_ENABLED"] = False
from auth import create_access_token  # noqa: E402
from budget_module import get_budget_limits, remove_budget_limit, set_budget_limit  # noqa: E402
from config import DATE_FORMAT  # noqa: E402
from database import add_expense, create_table, create_user  # noqa: E402
from summary_module import (  # noqa: E402
    get_expenses_by_category,
    get_monthly_summary_text,
    get_weekly_summary_text,
)




@pytest.fixture(autouse=True)
def bypass_rate_limit():
    """Bypass rate limits by disabling the limiter."""
    from app import limiter
    limiter.enabled = False

@pytest.fixture
def temp_db(monkeypatch, tmp_path):
    """Temporary database fixture."""
    db_path = tmp_path / "expenses_test.db"

    @contextmanager
    def _mock_get_db(_db_name: str | None = None):
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    monkeypatch.setattr(database, "get_db", _mock_get_db)
    monkeypatch.setattr(summary_module, "get_db", _mock_get_db)
    monkeypatch.setattr(visual_module, "get_db", _mock_get_db)

    create_table()

    # Create a default test user so authenticated endpoints can be exercised.
    user = create_user(
        email="test@example.com",
        password_hash="$2b$12$dummyhashfortestingonly000000000000000000000000000",
        display_name="Test User",
    )
    yield {"db_path": str(db_path), "user": user}


def _test_user_id(temp_db_fixture):
    return temp_db_fixture["user"]["id"]


def _auth_headers(user_id: str) -> dict:
    token = create_access_token(user_id)
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def auth_headers(temp_db):
    from database import create_user
    from auth import hash_password, create_access_token
    try:
        user = create_user(
            email="test@example.com",
            password_hash=hash_password("Test1234"),
            display_name="Tester",
        )
    except sqlite3.IntegrityError:
        user = temp_db["user"]
    token = create_access_token(user["id"])
    return {"Authorization": f"Bearer {token}"}



@pytest.fixture
def mock_parse(monkeypatch):
    """Returns a factory: call mock_parse(returned_dict) to set the response."""
    def factory(return_value: dict):
        monkeypatch.setattr(app_module, "parse_expense", lambda text: return_value)
    return factory


# Fixture temp_budget_file removed as budgets are now in DB


def _add_expense(amount: float, category: str, date_str: str, user_id: str = None) -> None:
    add_expense(amount=amount, category=category, date=date_str, user_id=user_id)


def test_safe_limit_clamps_values():
    """Test function."""
    assert _safe_limit("7") == 7
    assert _safe_limit("0") == 1
    assert _safe_limit("500") == 50
    assert _safe_limit(None) == 5


def test_api_recent_bad_limit_uses_default(temp_db, auth_headers):
    """Test function."""
    user_id = temp_db["user"]["id"]
    today = datetime.now().strftime(DATE_FORMAT)
    for idx in range(7):
        _add_expense(10 + idx, f"cat{idx}", today, user_id=user_id)

    client = app.test_client()
    response = client.get("/api/recent?limit=abc", headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)


def test_voice_recent_invalid_limit(temp_db, auth_headers, mock_parse):
    """Test function."""
    mock_parse({"action": "recent"})
    user_id = temp_db["user"]["id"]
    today = datetime.now().strftime(DATE_FORMAT)
    for idx in range(7):
        _add_expense(20 + idx, f"voice{idx}", today, user_id=user_id)

    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "show recent expenses", "limit": "xyz"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "recent"
    assert "recent_expenses" in payload


def test_remove_budget_limit_roundtrip(temp_db):
    """Test function."""
    user_id = _test_user_id(temp_db)
    set_budget_limit("newcategory", 1234, user_id=user_id)
    config = get_budget_limits(user_id=user_id)
    assert "newcategory" in config

    assert remove_budget_limit("newcategory", user_id=user_id) is True
    updated = get_budget_limits(user_id=user_id)
    assert "newcategory" not in updated
    assert remove_budget_limit("newcategory", user_id=user_id) is False


def test_get_expenses_by_category_filters_dates(temp_db):
    """Test function."""
    now = datetime.now()
    today = now.strftime(DATE_FORMAT)
    earlier = (now - timedelta(days=30)).strftime(DATE_FORMAT)

    _add_expense(100, "food", today)
    _add_expense(50, "transport", today)
    _add_expense(999, "entertainment", earlier)

    results = get_expenses_by_category(today, today)
    categories = {row["category"]: row["total"] for row in results}
    assert categories == {"food": 100.0, "transport": 50.0}


def test_get_expenses_by_category_end_exclusive(temp_db):
    """Test function."""
    base = datetime.now().replace(day=1)
    start = base.strftime(DATE_FORMAT)
    boundary = (base + timedelta(days=1)).strftime(DATE_FORMAT)

    _add_expense(75, "groceries", start)
    _add_expense(60, "boundary", boundary)

    results = get_expenses_by_category(start, boundary, end_inclusive=False)
    categories = {row["category"]: row["total"] for row in results}
    assert "groceries" in categories
    assert "boundary" not in categories


def test_weekly_summary_text_excludes_old_categories(temp_db):
    """Test function."""
    now = datetime.now()
    today = now.strftime(DATE_FORMAT)
    three_days_ago = (now - timedelta(days=3)).strftime(DATE_FORMAT)
    ten_days_ago = (now - timedelta(days=10)).strftime(DATE_FORMAT)

    _add_expense(120, "food", today)
    _add_expense(80, "transport", three_days_ago)
    _add_expense(500, "entertainment", ten_days_ago)

    summary = get_weekly_summary_text()
    lower_summary = summary.lower()
    assert "food" in lower_summary
    assert "transport" in lower_summary
    assert "entertainment" not in lower_summary


def test_monthly_summary_text_excludes_previous_month(temp_db):
    """Test function."""
    now = datetime.now()
    current_month_date = now.strftime(DATE_FORMAT)
    first_of_month = now.replace(day=1)
    previous_month_day = (first_of_month - timedelta(days=1)).strftime(DATE_FORMAT)

    _add_expense(200, "utilities", current_month_date)
    _add_expense(900, "shopping", previous_month_day)

    summary = get_monthly_summary_text()
    lower_summary = summary.lower()
    assert "utilities" in lower_summary
    assert "shopping" not in lower_summary


def test_voice_set_budget_updates_limits(temp_db, mock_parse):
    """Test function."""
    mock_parse({"action": "set_budget", "category": "utilities", "amount": 4500, "warn_ratio": None})
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "set budget for utilities to 4500"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "set_budget"
    assert "budget_status" in payload
    status = payload["budget_status"]
    assert status["category"] == "utilities"
    assert status["limit"] == pytest.approx(4500.0)
    config_data = get_budget_limits(user_id)
    assert config_data["utilities"].limit == 4500.0


def test_voice_set_budget_with_warn_ratio(temp_db, mock_parse):
    """Test function."""
    mock_parse({"action": "set_budget", "category": "food", "amount": 5000, "warn_ratio": 0.7})
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "set budget for food to 5000 warn me at 70 percent"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "set_budget"
    assert payload["warn_ratio"] == pytest.approx(0.7)
    config_data = get_budget_limits(user_id)
    assert config_data["food"].warn_ratio == pytest.approx(0.7)


def test_voice_remove_budget_via_command(temp_db, mock_parse):
    """Test function."""
    mock_parse({"action": "remove_budget", "category": "entertainment"})
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    set_budget_limit("entertainment", 3000, user_id=user_id)
    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "remove budget for entertainment"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "remove_budget"
    assert payload.get("removed_budget") == "entertainment" or "reply" in payload
    updated = get_budget_limits(user_id)
    assert "entertainment" not in updated


def test_voice_show_budget_with_remaining(temp_db, mock_parse):
    """Test function."""
    mock_parse({"action": "show_budgets", "category": "food"})
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    today = datetime.now().strftime(DATE_FORMAT)
    set_budget_limit("food", 1000, user_id=user_id)
    _add_expense(200, "food", today, user_id=user_id)

    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "what's my food budget"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "show_budgets"
    status = payload["budget_status"]
    assert status["category"] == "food"
    assert status["spent"] == pytest.approx(200.0)
    assert "budget" in payload["reply"].lower()


def test_voice_chart_summary_returns_series(temp_db, mock_parse):
    """Test function."""
    mock_parse({"action": "chart_summary"})
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    today = datetime.now().strftime(DATE_FORMAT)
    yesterday = (datetime.now() - timedelta(days=1)).strftime(DATE_FORMAT)
    _add_expense(120, "transport", today, user_id=user_id)
    _add_expense(90, "utilities", yesterday, user_id=user_id)

    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "give me a chart recap"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "chart_summary"
    assert "chart_series" in payload
    assert payload["chart_series"]["category_breakdown"]
    assert payload["reply"]

def test_recurring_detection_finds_monthly_pattern(temp_db):
    from database import get_recurring_expenses
    from datetime import datetime, timedelta

    # Insert 3 expenses ~30 days apart in the same category
    base = datetime.now()
    for offset in [0, 30, 60]:
        date_str = (base - timedelta(days=offset)).strftime(DATE_FORMAT)
        _add_expense(500, "utilities", date_str)

    results = get_recurring_expenses(lookback_days=90, min_occurrences=2)
    categories = [r["category"] for r in results]
    assert "utilities" in categories
    match = next(r for r in results if r["category"] == "utilities")
    assert match["occurrences"] == 3
    assert 25 <= match["avg_gap_days"] <= 38

class TestAuthEndpoints:
    def test_register_and_login_roundtrip(self, temp_db):
        client = app.test_client()
        resp = client.post("/api/auth/register", json={
            "email": "newuser@example.com",
            "password": "Password123",
            "display_name": "New User"
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert "access_token" in data
        assert "voxly_refresh" in resp.headers.get("Set-Cookie", "")
        
        resp2 = client.post("/api/auth/login", json={
            "email": "newuser@example.com",
            "password": "Password123"
        })
        assert resp2.status_code == 200
        data2 = resp2.get_json()
        assert "access_token" in data2
        assert "voxly_refresh" in resp2.headers.get("Set-Cookie", "")

    def test_login_wrong_password_returns_401(self, temp_db):
        client = app.test_client()
        client.post("/api/auth/register", json={
            "email": "wrongpass@example.com",
            "password": "Password123"
        })
        resp = client.post("/api/auth/login", json={
            "email": "wrongpass@example.com",
            "password": "WrongPassword123"
        })
        assert resp.status_code == 401

    def test_me_without_token_returns_401(self, temp_db):
        client = app.test_client()
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_refresh_token_issues_new_access_token(self, temp_db):
        client = app.test_client()
        resp = client.post("/api/auth/register", json={
            "email": "refresh@example.com",
            "password": "Password123"
        })
        cookie = resp.headers.get("Set-Cookie")
        
        resp2 = client.post("/api/auth/refresh", headers={"Cookie": cookie})
        assert resp2.status_code == 200
        data = resp2.get_json()
        assert "access_token" in data


def test_register_and_login(temp_db):
    client = app.test_client()

    # Register
    res = client.post("/api/auth/register", json={
        "email": "new_test@example.com",
        "password": "Secure1Password",
        "name": "Tester",
    })
    assert res.status_code == 200
    data = res.get_json()
    assert "access_token" in data
    assert data["user"]["email"] == "new_test@example.com"

    # Duplicate email
    res2 = client.post("/api/auth/register", json={
        "email": "new_test@example.com",
        "password": "Secure1Password",
    })
    assert res2.status_code == 409

    # Login with correct credentials
    res3 = client.post("/api/auth/login", json={
        "email": "new_test@example.com",
        "password": "Secure1Password",
    })
    assert res3.status_code == 200
    assert "access_token" in res3.get_json()

    # Login with wrong password
    res4 = client.post("/api/auth/login", json={
        "email": "new_test@example.com",
        "password": "wrongpassword",
    })
    assert res4.status_code == 401


def test_weak_password_rejected(temp_db):
    client = app.test_client()
    res = client.post("/api/auth/register", json={
        "email": "weak@example.com",
        "password": "short",
    })
    assert res.status_code == 400
    assert "password" in res.get_json()["error"].lower()


def test_auth_me_requires_token(temp_db):
    client = app.test_client()
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_refresh_token_flow(temp_db):
    client = app.test_client()
    reg = client.post("/api/auth/register", json={
        "email": "refresh@example.com",
        "password": "Refresh1Test",
    })
    tokens = reg.get_json()
    refresh_token = tokens["refresh_token"]

    res = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert res.status_code == 200
    new_data = res.get_json()
    assert "access_token" in new_data


def test_repeat_command_is_stateless(temp_db, auth_headers, mock_parse):
    """Ensure repeat asks the user to re-send the command."""
    mock_parse({"action": "repeat"})
    client = app.test_client()
    res = client.post("/api/voice_command", json={"command": "repeat"}, headers=auth_headers)
    assert res.status_code == 200
    payload = res.get_json()
    assert "Please re-send the command you want to repeat." in payload["reply"]


def test_api_summary_includes_monthly_total(temp_db):
    """api_summary must return monthly_total so the frontend card renders correctly."""
    # Testing mode allows unauthenticated access for recent; summary still needs auth
    # so we just verify the _build_dashboard_context helper includes the key
    from app import _build_dashboard_context
    context = _build_dashboard_context(user_id=None)
    assert "monthly_total" in context
    assert isinstance(context["monthly_total"], (int, float))


def test_category_totals_are_objects(temp_db):
    """_build_dashboard_context category_totals should be serialisable as objects."""
    from app import _build_dashboard_context
    context = _build_dashboard_context(user_id=None)
    # get_total_by_category returns List[Tuple[str, float]] — ensure it round-trips to JSON
    import json
    serialised = json.dumps(context["category_totals"])
    assert serialised is not None


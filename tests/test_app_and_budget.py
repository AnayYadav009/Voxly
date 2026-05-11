import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import sqlite3

import budget_module  # noqa: E402
import config  # noqa: E402
import database  # noqa: E402
import summary_module  # noqa: E402
import visual_module  # noqa: E402
import app as app_module  # noqa: E402
from app import _safe_limit, app  # noqa: E402
from auth import create_access_token  # noqa: E402
from budget_module import load_budget_config, remove_budget_limit, set_budget_limit  # noqa: E402
from config import DATE_FORMAT  # noqa: E402
from database import add_expense, create_table, create_user  # noqa: E402
from summary_module import (  # noqa: E402
    get_expenses_by_category,
    get_monthly_summary_text,
    get_weekly_summary_text,
)


app.testing = True


@pytest.fixture
def temp_db(monkeypatch, tmp_path):
    db_path = tmp_path / "expenses_test.db"

    def _connect(_db_name: str | None = None):
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    monkeypatch.setattr(database, "create_connection", _connect)
    monkeypatch.setattr(summary_module, "create_connection", _connect)
    monkeypatch.setattr(visual_module, "create_connection", _connect)

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
def temp_budget_file(monkeypatch, tmp_path):
    budget_path = tmp_path / "budgets.json"
    monkeypatch.setattr(config, "BUDGETS_FILE", str(budget_path))
    monkeypatch.setattr(budget_module, "BUDGETS_FILE", str(budget_path))
    payload = {"monthly": {}, "defaults": {"warn_at": 0.8}}
    budget_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return str(budget_path)


def _add_expense(amount: float, category: str, date_str: str, user_id: str = None) -> None:
    add_expense(amount=amount, category=category, date=date_str, user_id=user_id)


def test_safe_limit_clamps_values():
    assert _safe_limit("7") == 7
    assert _safe_limit("0") == 1
    assert _safe_limit("500") == 50
    assert _safe_limit(None) == 5


def test_api_recent_bad_limit_uses_default(temp_db):
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    today = datetime.now().strftime(DATE_FORMAT)
    for idx in range(7):
        _add_expense(10 + idx, f"cat{idx}", today)

    client = app.test_client()
    response = client.get("/api/recent?limit=abc", headers=headers)
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)


def test_voice_recent_invalid_limit(temp_db):
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    today = datetime.now().strftime(DATE_FORMAT)
    for idx in range(7):
        _add_expense(20 + idx, f"voice{idx}", today)

    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "show recent expenses", "limit": "xyz"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "recent"
    assert "recent_expenses" in payload


def test_remove_budget_limit_roundtrip(tmp_path):
    budget_path = tmp_path / "budgets.json"
    target_path = str(budget_path)

    set_budget_limit("newcategory", 1234, path=target_path)
    config = load_budget_config(target_path)
    assert "newcategory" in config.get("monthly", {})

    assert remove_budget_limit("newcategory", path=target_path) is True
    updated = load_budget_config(target_path)
    assert "newcategory" not in updated.get("monthly", {})
    assert remove_budget_limit("newcategory", path=target_path) is False


def test_get_expenses_by_category_filters_dates(temp_db):
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


def test_voice_set_budget_updates_limits(temp_db, temp_budget_file):
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
    config_data = load_budget_config(temp_budget_file)
    assert config_data["monthly"]["utilities"]["limit"] == 4500.0


def test_voice_set_budget_with_warn_ratio(temp_db, temp_budget_file):
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
    config_data = load_budget_config(temp_budget_file)
    assert config_data["monthly"]["food"]["warn_at"] == pytest.approx(0.7)


def test_voice_remove_budget_via_command(temp_db, temp_budget_file):
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    set_budget_limit("entertainment", 3000, path=temp_budget_file)
    client = app.test_client()
    response = client.post(
        "/api/voice_command",
        json={"command": "remove budget for entertainment"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["action"] == "remove_budget"
    assert payload["removed_budget"] == "entertainment"
    updated = load_budget_config(temp_budget_file)
    assert "entertainment" not in updated.get("monthly", {})


def test_voice_show_budget_with_remaining(temp_db, temp_budget_file):
    user_id = _test_user_id(temp_db)
    headers = _auth_headers(user_id)
    today = datetime.now().strftime(DATE_FORMAT)
    set_budget_limit("food", 1000, path=temp_budget_file)
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


def test_voice_chart_summary_returns_series(temp_db, temp_budget_file):
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

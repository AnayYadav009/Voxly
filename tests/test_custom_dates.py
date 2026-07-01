import pytest
import sqlite3
from contextlib import contextmanager
from datetime import datetime
import database
import summary_module
import visual_module
from database import create_table, create_user
from auth import hash_password, create_access_token
from app import app as flask_app

@pytest.fixture(autouse=True)
def _disable_rate_limits():
    from extensions import limiter
    limiter.enabled = False
    yield
    limiter.enabled = True


@pytest.fixture
def test_setup(monkeypatch, tmp_path):
    db_path = tmp_path / "test_custom_dates.db"

    @contextmanager
    def _mock_get_db(_db_name=None):
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
    user = create_user(
        email="custom@example.com",
        password_hash=hash_password("CustomTest1"),
        display_name="Custom Tester",
    )
    token = create_access_token(user["id"])
    headers = {"Authorization": f"Bearer {token}"}

    with flask_app.test_client() as c:
        yield c, headers, user


def test_add_expense_full_command(test_setup):
    client, headers, user = test_setup

    # Test full command parsing: "20 food swiggy 30/06/26"
    resp = client.post(
        "/api/add",
        json={
            "amount": 0,
            "category": "other",  # default in form
            "description": "20 food swiggy 30/06/26"
        },
        headers=headers,
    )
    assert resp.status_code == 200
    res_data = resp.get_json()
    assert "Added ₹20.00 to food." in res_data["message"]

    # Verify stored in DB
    with database.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE user_id = ?", (user["id"],)
        ).fetchall()
        assert len(rows) == 1
        row = rows[0]
        assert row["amount"] == 20.0
        assert row["category"] == "food"
        assert row["description"] == "swiggy"
        assert row["date"] == "2026-06-30"


def test_add_expense_suffix(test_setup):
    client, headers, user = test_setup

    # Test suffix parsing: amount/category supplied, description is "swiggy 30/06/26"
    resp = client.post(
        "/api/add",
        json={
            "amount": 35.5,
            "category": "entertainment",
            "description": "movie ticket 15/07/2026"
        },
        headers=headers,
    )
    assert resp.status_code == 200
    res_data = resp.get_json()
    assert "Added ₹35.50 to entertainment." in res_data["message"]

    # Verify stored in DB
    with database.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE user_id = ? ORDER BY id DESC", (user["id"],)
        ).fetchall()
        assert len(rows) == 1
        row = rows[0]
        assert row["amount"] == 35.5
        assert row["category"] == "entertainment"
        assert row["description"] == "movie ticket"
        assert row["date"] == "2026-07-15"


def test_add_expense_default_date(test_setup):
    client, headers, user = test_setup

    # Test default date: no date in description
    resp = client.post(
        "/api/add",
        json={
            "amount": 100.0,
            "category": "shopping",
            "description": "new shirt"
        },
        headers=headers,
    )
    assert resp.status_code == 200
    
    # Verify stored in DB with today's date
    today_str = datetime.now().strftime("%Y-%m-%d")
    with database.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE user_id = ? ORDER BY id DESC", (user["id"],)
        ).fetchall()
        assert len(rows) == 1
        row = rows[0]
        assert row["amount"] == 100.0
        assert row["category"] == "shopping"
        assert row["description"] == "new shirt"
        # Since it defaults to local today's date, let's verify
        assert row["date"] == today_str


def test_add_expense_invalid_date_fallback(test_setup):
    client, headers, user = test_setup

    # Test invalid date in full command: e.g. 31/02/26 (February 31 is invalid)
    # It should fall back to treating it as description or standard parsing rather than crashing
    resp = client.post(
        "/api/add",
        json={
            "amount": 15,
            "category": "utilities",
            "description": "wifi bill 31/02/26"
        },
        headers=headers,
    )
    # Since February 31 is invalid, it falls back to suffix parsing failing to parse date,
    # so it falls back to standard payload: amount 15, category utilities, description "wifi bill 31/02/26", date today.
    assert resp.status_code == 200
    today_str = datetime.now().strftime("%Y-%m-%d")
    with database.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE user_id = ? ORDER BY id DESC", (user["id"],)
        ).fetchall()
        assert len(rows) == 1
        row = rows[0]
        assert row["amount"] == 15.0
        assert row["category"] == "utilities"
        assert row["description"] == "wifi bill 31/02/26"
        assert row["date"] == today_str

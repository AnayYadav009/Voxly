"""Standalone pure-unit tests for helpers that have no Flask/DB dependencies.

These tests are intentionally isolated: they import only the helpers under test
(no app context, no database, no network) so they run fast and never need
fixtures.

Covers:
- ``_safe_limit``     — input clamping helper (moved here from test_app_and_budget.py)
- ``getDashboard``    — /api/dashboard endpoint integration (needs Flask test client)
"""
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Pure unit tests – no app context required
# ---------------------------------------------------------------------------

class TestSafeLimit:
    """Pure unit tests for _safe_limit. No fixtures needed."""

    def test_returns_default_on_none(self):
        from services.dashboard import _safe_limit
        assert _safe_limit(None) == 5

    def test_returns_default_on_empty_string(self):
        from services.dashboard import _safe_limit
        assert _safe_limit("") == 5

    def test_returns_default_on_non_numeric(self):
        from services.dashboard import _safe_limit
        assert _safe_limit("abc") == 5
        assert _safe_limit("1.5x") == 5

    def test_clamps_below_minimum(self):
        from services.dashboard import _safe_limit
        assert _safe_limit("0") == 1
        assert _safe_limit("-10") == 1

    def test_clamps_above_maximum(self):
        from services.dashboard import _safe_limit
        assert _safe_limit("500") == 50
        assert _safe_limit("9999") == 50

    def test_accepts_valid_int_string(self):
        from services.dashboard import _safe_limit
        assert _safe_limit("7") == 7
        assert _safe_limit("1") == 1
        assert _safe_limit("50") == 50

    def test_accepts_integer_directly(self):
        from services.dashboard import _safe_limit
        assert _safe_limit(10) == 10

    def test_custom_default(self):
        from services.dashboard import _safe_limit
        assert _safe_limit(None, default=12) == 12

    def test_custom_bounds(self):
        from services.dashboard import _safe_limit
        assert _safe_limit("100", minimum=1, maximum=200) == 100
        assert _safe_limit("0", minimum=5, maximum=200) == 5


# ---------------------------------------------------------------------------
# Integration test – /api/dashboard endpoint
# ---------------------------------------------------------------------------

import sqlite3
import database
import summary_module
import visual_module


@pytest.fixture(autouse=True)
def _disable_rate_limits():
    """Ensure the Flask-Limiter does not interfere with test requests."""
    from extensions import limiter
    limiter.enabled = False
    yield
    limiter.enabled = True


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Configured test client with an isolated in-memory database."""
    db_path = tmp_path / "test_dashboard.db"

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

    from database import create_table, create_user
    create_table()
    from auth import hash_password, create_access_token
    user = create_user(
        email="dash@example.com",
        password_hash=hash_password("DashTest1"),
        display_name="Dash Tester",
    )

    from app import app
    app.config["TESTING"] = True
    token = create_access_token(user["id"])
    with app.test_client() as c:
        yield c, {"Authorization": f"Bearer {token}"}, user


class TestDashboardEndpoint:
    def test_returns_200(self, client):
        c, headers, _ = client
        resp = c.get("/api/dashboard", headers=headers)
        assert resp.status_code == 200

    def test_response_contains_required_keys(self, client):
        c, headers, _ = client
        data = c.get("/api/dashboard", headers=headers).get_json()
        for key in ("total_today", "monthly_total", "weekly_summary",
                    "monthly_summary", "category_totals", "budget_alerts",
                    "budget_status", "chart_series"):
            assert key in data, f"Missing key: {key}"

    def test_chart_series_has_expected_sub_keys(self, client):
        c, headers, _ = client
        data = c.get("/api/dashboard", headers=headers).get_json()
        cs = data["chart_series"]
        assert isinstance(cs.get("category_breakdown"), list)
        assert isinstance(cs.get("daily_totals"), list)
        assert isinstance(cs.get("monthly_totals"), list)

    def test_unauthenticated_returns_401(self, client):
        c, _, _ = client
        resp = c.get("/api/dashboard")
        assert resp.status_code == 401

    def test_total_today_reflects_added_expenses(self, client, monkeypatch):
        c, headers, user = client
        from database import add_expense
        from datetime import datetime
        today = datetime.now().strftime("%Y-%m-%d")
        add_expense(250.0, "food", date=today, user_id=user["id"])
        add_expense(100.0, "transport", date=today, user_id=user["id"])

        data = c.get("/api/dashboard", headers=headers).get_json()
        assert data["total_today"] == pytest.approx(350.0)

    def test_reload_true_after_add_expense(self, client):
        """POST /api/add should return reload:True so frontend calls getDashboard."""
        c, headers, _ = client
        resp = c.post(
            "/api/add",
            json={"amount": 500, "category": "food"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.get_json().get("reload") is True

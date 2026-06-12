import sys
import sqlite3
from contextlib import contextmanager
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import database  # noqa: E402
import merchant_module  # noqa: E402
from app import app  # noqa: E402
app.config["TESTING"] = True
app.config["RATELIMIT_ENABLED"] = False
from auth import create_access_token  # noqa: E402
from database import add_expense, create_table, create_user  # noqa: E402

@pytest.fixture(autouse=True)
def bypass_rate_limit():
    from extensions import limiter
    limiter.enabled = False

@pytest.fixture
def temp_db(monkeypatch, tmp_path):
    db_path = tmp_path / "expenses_test.db"

    @contextmanager
    def _mock_get_db(_db_name: str | None = None):
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _mock_create_connection(_db_name: str | None = None):
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    database._local.conn = None
    monkeypatch.setattr(database, "get_db", _mock_get_db)
    monkeypatch.setattr(database, "create_connection", _mock_create_connection)

    create_table()

    user = create_user(
        email="test@example.com",
        password_hash="$2b$12$dummyhashfortestingonly000000000000000000000000000",
        display_name="Test User",
    )
    yield {"db_path": str(db_path), "user": user}

@pytest.fixture
def auth_headers(temp_db):
    user = temp_db["user"]
    token = create_access_token(user["id"])
    return {"Authorization": f"Bearer {token}"}

# Unit test for merchant_module
def test_merchant_module_analyze():
    expenses = [
        {"amount": 100.0, "description": "rapido ride to office"},
        {"amount": 200.0, "description": "swiggy food delivery"},
        {"amount": 50.0, "description": "metro card recharge"},
        {"amount": 150.0, "description": "uber ride back"},
        {"amount": 300.0, "description": "zomato food"},
        {"amount": 75.0, "description": "unmatched random merchant"},
    ]
    analysis = merchant_module.analyze_expenses(expenses)
    assert analysis["total"] == 875.0
    assert analysis["count"] == 6

    breakdown = analysis["breakdown"]
    # Cab Rides: rapido (100) + uber (150) = 250
    # Food Delivery: swiggy (200) + zomato (300) = 500
    # Public Transit: metro (50)
    # Other: 75
    # Order should be Food Delivery (500), Cab Rides (250), Public Transit (50), Other (75) - Other must always be last!
    assert len(breakdown) == 4
    assert breakdown[0]["label"] == "Food Delivery"
    assert breakdown[0]["total"] == 500.0
    assert breakdown[0]["percentage"] == (500.0 / 875.0) * 100

    assert breakdown[1]["label"] == "Cab Rides"
    assert breakdown[1]["total"] == 250.0

    assert breakdown[2]["label"] == "Public Transit"
    assert breakdown[2]["total"] == 50.0

    assert breakdown[3]["label"] == "Other"
    assert breakdown[3]["total"] == 75.0

# Unit test for database.get_expenses_in_category
def test_db_get_expenses_in_category(temp_db):
    user_id = temp_db["user"]["id"]
    # Add expenses
    add_expense(100.0, "food", "2026-06-01", description="swiggy", user_id=user_id)
    add_expense(200.0, "Food", "2026-06-02", description="zomato", user_id=user_id)
    add_expense(300.0, "transport", "2026-06-03", description="uber", user_id=user_id)
    add_expense(400.0, "food", "2026-06-04", description="another swiggy", user_id="other_user_id")

    # Retrieve and check scoping and case insensitivity
    food_expenses = database.get_expenses_in_category("food", user_id=user_id)
    assert len(food_expenses) == 2
    # Check ordering is date DESC
    assert food_expenses[0]["amount"] == 200.0
    assert food_expenses[1]["amount"] == 100.0

    # Date range filters
    filtered = database.get_expenses_in_category("food", start_date="2026-06-02", end_date="2026-06-03", user_id=user_id)
    assert len(filtered) == 1
    assert filtered[0]["amount"] == 200.0

# Test for api endpoint
def test_api_expenses_by_category_unauthorized():
    client = app.test_client()
    response = client.get("/api/expenses/by-category?category=food")
    assert response.status_code == 401

def test_api_expenses_by_category_missing_category(temp_db, auth_headers):
    client = app.test_client()
    response = client.get("/api/expenses/by-category", headers=auth_headers)
    assert response.status_code == 400
    assert response.get_json()["error"] == "category is required."

def test_api_expenses_by_category_success(temp_db, auth_headers):
    user_id = temp_db["user"]["id"]
    # Add expenses in category
    add_expense(150.0, "Food", "2026-06-10", description="swiggy order", user_id=user_id)
    add_expense(80.0, "Food", "2026-06-11", description="local grocery store", user_id=user_id)

    client = app.test_client()
    response = client.get("/api/expenses/by-category?category=food&start=2026-06-01&end=2026-06-15", headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()

    assert data["category"] == "food"
    assert data["total"] == 230.0
    assert data["count"] == 2
    assert len(data["expenses"]) == 2
    assert len(data["merchant_breakdown"]) == 2

    # Verify merchant breakdown
    # Food Delivery (swiggy) should be 150
    # Other (local grocery) should be 80
    mb = data["merchant_breakdown"]
    assert mb[0]["label"] == "Food Delivery"
    assert mb[0]["total"] == 150.0
    assert mb[1]["label"] == "Other"
    assert mb[1]["total"] == 80.0

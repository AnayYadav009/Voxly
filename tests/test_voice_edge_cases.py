import sqlite3
from contextlib import contextmanager
import pytest
from app import app
from database import create_table, create_user, get_db
from extensions import limiter
import summary_module
import visual_module
import database
import voice_module
import routes.voice

@pytest.fixture(autouse=True)
def bypass_rate_limit():
    """Bypass rate limits by disabling the limiter."""
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

    # Create a default test user
    from auth import hash_password
    user = create_user(
        email="test@example.com",
        password_hash=hash_password("Pass123!"),
        display_name="Tester",
    )
    return {"user": user, "db_path": db_path}

@pytest.fixture
def auth_headers(temp_db):
    try:
        from auth import hash_password, create_access_token
        user = create_user(
            email="test2@example.com",
            password_hash=hash_password("Test1234"),
            display_name="Tester2",
        )
    except sqlite3.IntegrityError:
        from auth import create_access_token
        user = temp_db["user"]
    token = create_access_token(user["id"])
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def mock_parse(monkeypatch):
    """Returns a factory function to mock `parse_expense` payload directly."""
    def _mock_it(return_val):
        monkeypatch.setattr(routes.voice, "parse_expense", lambda txt: return_val)
    return _mock_it

def test_voice_command_unauthenticated():
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "hi"})
        assert res.status_code == 401

def test_voice_command_empty(auth_headers):
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "    "}, headers=auth_headers)
        assert res.status_code == 400
        assert "Command text required" in res.get_json()["error"]

def test_voice_command_too_long(auth_headers):
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "a" * 501}, headers=auth_headers)
        assert res.status_code == 400
        assert "Command too long" in res.get_json()["error"]

def test_voice_command_exception_in_parser(auth_headers, monkeypatch):
    def fake_parse(txt):
        raise ValueError("Parser failed completely")
    monkeypatch.setattr(routes.voice, "parse_expense", fake_parse)
    
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "do something"}, headers=auth_headers)
        assert res.status_code == 500
        assert "Could not understand the command" in res.get_json()["error"]

def test_voice_command_action_none(auth_headers, mock_parse):
    mock_parse({"action": "none"})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "blah"}, headers=auth_headers)
        assert res.status_code == 400
        assert "I did not hear a command." in res.get_json()["reply"]

def test_voice_command_action_unknown(auth_headers, mock_parse):
    mock_parse({"action": "unknown"})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "purple monkey"}, headers=auth_headers)
        assert res.status_code == 200
        assert "I did not understand that" in res.get_json()["reply"]

def test_voice_command_action_repeat_not_supported(auth_headers, mock_parse):
    mock_parse({"action": "repeat"})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "repeat"}, headers=auth_headers)
        assert res.status_code == 200
        assert "not supported in the web API" in res.get_json()["reply"]

def test_voice_command_add_missing_amount(auth_headers, mock_parse):
    mock_parse({"action": "add", "category": "food", "amount": None})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "add to food"}, headers=auth_headers)
        assert res.status_code == 400
        assert "valid amount" in res.get_json()["reply"]

def test_voice_command_add_negative_amount(auth_headers, mock_parse):
    mock_parse({"action": "add", "category": "food", "amount": -10})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "add minus 10 to food"}, headers=auth_headers)
        assert res.status_code == 400
        assert "valid amount" in res.get_json()["reply"]

def test_voice_command_add_validation_fail(auth_headers, mock_parse, monkeypatch):
    mock_parse({"action": "add", "category": "bad_cat", "amount": 100})
    # Mock validate_expense to fail
    monkeypatch.setattr(routes.voice, "validate_expense", lambda *args, **kwargs: (False, "Bad category rejected"))
    
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "add 100 to bad_cat"}, headers=auth_headers)
        assert res.status_code == 400
        assert "Bad category rejected" in res.get_json()["reply"]

def test_voice_command_add_exception(auth_headers, mock_parse, monkeypatch):
    mock_parse({"action": "add", "category": "food", "amount": 100})
    monkeypatch.setattr(routes.voice, "validate_expense", lambda *args, **kwargs: (True, ""))
    
    def fake_add(*args, **kwargs):
        raise ValueError("DB down")
    monkeypatch.setattr(routes.voice, "add_expense", fake_add)
    
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "add 100 to food"}, headers=auth_headers)
        assert res.status_code == 500
        assert "Failed to add the expense" in res.get_json()["error"]

def test_voice_command_set_budget_missing_category(auth_headers, mock_parse):
    mock_parse({"action": "set_budget", "category": None, "amount": 500})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "set budget to 500"}, headers=auth_headers)
        assert res.status_code == 400
        assert "specify which category" in res.get_json()["reply"]

def test_voice_command_set_budget_missing_amount(auth_headers, mock_parse):
    mock_parse({"action": "set_budget", "category": "food", "amount": None})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "set budget for food"}, headers=auth_headers)
        assert res.status_code == 400
        assert "positive budget amount" in res.get_json()["reply"]

def test_voice_command_set_budget_value_error(auth_headers, mock_parse, monkeypatch):
    mock_parse({"action": "set_budget", "category": "food", "amount": 500})
    def fake_set(*args, **kwargs):
        raise ValueError("Budget too large for sanity.")
    monkeypatch.setattr(routes.voice, "set_budget_limit", fake_set)
    
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "set budget to 500 on food"}, headers=auth_headers)
        assert res.status_code == 400
        assert "Budget too large for sanity." in res.get_json()["reply"]

def test_voice_command_remove_budget_missing_category(auth_headers, mock_parse):
    mock_parse({"action": "remove_budget", "category": None})
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "remove budget"}, headers=auth_headers)
        assert res.status_code == 400
        assert "tell me which budget to remove" in res.get_json()["reply"]

def test_voice_command_add_with_additional_expenses(auth_headers, mock_parse):
    mock_parse({
        "action": "add",
        "category": "food",
        "amount": 100,
        "_additional_expenses": [
            {"category": "transport", "amount": 50},
            {"category": "utilities", "amount": 200}
        ]
    })
    
    with app.test_client() as client:
        res = client.post("/api/voice_command", json={"command": "add 100 to food and 50 to transport and 200 to utilities"}, headers=auth_headers)
        assert res.status_code == 200
        reply = res.get_json()["reply"]
        assert "Added ₹100.00 to food" in reply
        assert "Also recorded 2 additional item(s)." in reply


"""Tests for parse_expense (Groq-based voice parser).

Every test monkeypatches voice_module._get_client so no real API call is made.
The mock returns the JSON string that the real Groq model would produce.
"""
import json
from unittest.mock import MagicMock

import pytest

import voice_module


def _make_mock_client(return_dict: dict):
    """Return a mock Groq client whose chat.completions.create() returns *return_dict*."""
    mock = MagicMock()
    choice = MagicMock()
    choice.message.content = json.dumps(return_dict)
    response = MagicMock()
    response.choices = [choice]
    mock.chat.completions.create.return_value = response
    return mock


@pytest.fixture(autouse=True)
def _patch_groq(monkeypatch):
    """Ensure _groq_client is reset before each test (tests supply their own)."""
    monkeypatch.setattr(voice_module, "_groq_client", None)


def _parse_with(monkeypatch, text: str, groq_returns: dict):
    """Helper: patch the client to return *groq_returns*, then call parse_expense."""
    monkeypatch.setattr(voice_module, "_get_client", lambda: _make_mock_client(groq_returns))
    return voice_module.parse_expense(text)


def test_add_simple(monkeypatch):
    res = _parse_with(monkeypatch, "add 500 to food", {
        "action": "add", "amount": 500, "category": "food", "date": None, "description": None
    })
    assert res["action"] == "add"
    assert res["amount"] == 500
    assert res["category"] == "food"


def test_add_word_amount_date(monkeypatch):
    res = _parse_with(monkeypatch, "spent two hundred on groceries yesterday", {
        "action": "add", "amount": 200, "category": "food", "date": "2026-05-18", "description": None
    })
    assert res["action"] == "add"
    assert res["amount"] == 200
    assert res["category"] == "food"
    assert res["date"] is not None
    assert len(res["date"]) == 10  # YYYY-MM-DD


def test_add_currency_symbol(monkeypatch):
    res = _parse_with(monkeypatch, "add ₹1500 to transport", {
        "action": "add", "amount": 1500, "category": "transport", "date": None, "description": None
    })
    assert res["action"] == "add"
    assert res["amount"] == 1500
    assert res["category"] == "transport"


def test_delete_action(monkeypatch):
    res = _parse_with(monkeypatch, "delete last expense", {"action": "delete"})
    assert res["action"] == "delete"


def test_balance_action(monkeypatch):
    res = _parse_with(monkeypatch, "what's my balance today", {"action": "balance"})
    assert res["action"] == "balance"


def test_recent_action(monkeypatch):
    res = _parse_with(monkeypatch, "show recent expenses", {"action": "recent"})
    assert res["action"] == "recent"


def test_weekly_summary(monkeypatch):
    res = _parse_with(monkeypatch, "give weekly summary", {"action": "weekly"})
    assert res["action"] == "weekly"


def test_monthly_report(monkeypatch):
    res = _parse_with(monkeypatch, "monthly report", {"action": "monthly"})
    assert res["action"] == "monthly"


def test_set_budget(monkeypatch):
    res = _parse_with(monkeypatch, "set budget for food to 5000", {
        "action": "set_budget", "amount": 5000, "category": "food", "warn_ratio": None
    })
    assert res["action"] == "set_budget"
    assert res["amount"] == 5000
    assert res["category"] == "food"


def test_set_budget_with_warn(monkeypatch):
    res = _parse_with(monkeypatch, "set budget for utilities to 4500 warn me at 70 percent", {
        "action": "set_budget", "amount": 4500, "category": "utilities", "warn_ratio": 0.7
    })
    assert res["action"] == "set_budget"
    assert res["amount"] == 4500
    assert res["category"] == "utilities"
    assert res["warn_ratio"] == 0.7


def test_remove_budget(monkeypatch):
    res = _parse_with(monkeypatch, "remove budget for entertainment", {
        "action": "remove_budget", "category": "entertainment"
    })
    assert res["action"] == "remove_budget"
    assert res["category"] == "entertainment"


def test_show_budget_specific(monkeypatch):
    res = _parse_with(monkeypatch, "what's my food budget", {
        "action": "show_budgets", "category": "food"
    })
    assert res["action"] == "show_budgets"
    assert res["category"] == "food"


def test_show_all_budgets(monkeypatch):
    res = _parse_with(monkeypatch, "show all budgets", {
        "action": "show_budgets", "category": None
    })
    assert res["action"] == "show_budgets"
    assert res["category"] is None


def test_chart_recap(monkeypatch):
    res = _parse_with(monkeypatch, "give me a chart recap", {"action": "chart_summary"})
    assert res["action"] == "chart_summary"


def test_exit_command(monkeypatch):
    res = _parse_with(monkeypatch, "stop", {"action": "exit"})
    assert res["action"] == "exit"


def test_help_command(monkeypatch):
    res = _parse_with(monkeypatch, "help", {"action": "help"})
    assert res["action"] == "help"


def test_none_input(monkeypatch):
    # Empty input short-circuits before calling Groq
    res = voice_module.parse_expense("")
    assert res["action"] == "none"


def test_unknown_input(monkeypatch):
    res = _parse_with(monkeypatch, "purple monkey dishwasher", {
        "action": "unknown", "raw": "purple monkey dishwasher"
    })
    assert res["action"] == "unknown"
    assert "purple monkey dishwasher" in res["raw"]

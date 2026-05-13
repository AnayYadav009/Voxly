from voice_module import parse_expense

def test_add_simple():
    res = parse_expense("add 500 to food")
    assert res["action"] == "add"
    assert res["amount"] == 500.0
    assert res["category"] == "food"

def test_add_word_amount_date():
    res = parse_expense("spent two hundred on groceries yesterday")
    assert res["action"] == "add"
    assert res["amount"] == 200.0
    assert res["category"] == "food"
    assert res["date"] is not None
    # Assuming yesterday is yesterday
    assert len(res["date"]) == 10 # YYYY-MM-DD

def test_add_currency_symbol():
    res = parse_expense("add ₹1500 to transport")
    assert res["action"] == "add"
    assert res["amount"] == 1500.0
    assert res["category"] == "transport"

def test_delete_action():
    res = parse_expense("delete last expense")
    assert res["action"] == "delete"

def test_balance_action():
    res = parse_expense("what's my balance today")
    assert res["action"] == "balance"

def test_recent_action():
    res = parse_expense("show recent expenses")
    assert res["action"] == "recent"

def test_weekly_summary():
    res = parse_expense("give weekly summary")
    assert res["action"] == "weekly"

def test_monthly_report():
    res = parse_expense("monthly report")
    assert res["action"] == "monthly"

def test_set_budget():
    res = parse_expense("set budget for food to 5000")
    assert res["action"] == "set_budget"
    assert res["amount"] == 5000.0
    assert res["category"] == "food"

def test_set_budget_with_warn():
    res = parse_expense("set budget for utilities to 4500 warn me at 70 percent")
    assert res["action"] == "set_budget"
    assert res["amount"] == 4500.0
    assert res["category"] == "utilities"
    assert res["warn_ratio"] == 0.7

def test_remove_budget():
    res = parse_expense("remove budget for entertainment")
    assert res["action"] == "remove_budget"
    assert res["category"] == "entertainment"

def test_show_budget_specific():
    res = parse_expense("what's my food budget")
    assert res["action"] == "show_budgets"
    assert res["category"] == "food"

def test_show_all_budgets():
    res = parse_expense("show all budgets")
    assert res["action"] == "show_budgets"
    assert res["category"] is None

def test_chart_recap():
    res = parse_expense("give me a chart recap")
    assert res["action"] == "chart_summary"

def test_exit_command():
    res = parse_expense("stop")
    assert res["action"] == "exit"

def test_help_command():
    res = parse_expense("help")
    assert res["action"] == "help"

def test_none_input():
    res = parse_expense("")
    assert res["action"] == "none"

def test_unknown_input():
    res = parse_expense("purple monkey dishwasher")
    assert res["action"] == "unknown"
    assert "purple monkey dishwasher" in res["raw"]

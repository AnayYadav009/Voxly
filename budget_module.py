from __future__ import annotations
import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

from config import BUDGETS_FILE, DEFAULT_BUDGET_WARN_THRESHOLD
from database import get_monthly_totals_by_category
from logger import log_error, log_info

# WARNING: Budget limits are currently stored in a single JSON file shared
# across ALL users. In a multi-user setup, one user's budget changes affect
# everyone. A future migration should move budgets into the SQLite database
# with a user_id column. See PHASE2_PLAN.md for details.

@dataclass
class BudgetLimit:
    category: str
    limit: float
    warn_ratio: float

    @property
    def warn_amount(self) -> float:
        return self.limit * self.warn_ratio

@dataclass
class BudgetStatus:
    category: str
    limit: float
    spent: float
    remaining: float
    percentage: float
    level: str
    message: str

_DEFAULT_BUDGETS: Dict[str, Dict[str, Dict[str, float]]] = {
    "monthly": {
        "food": {"limit": 10000, "warn_at": 0.8},
        "transport": {"limit": 4000, "warn_at": 0.75},
        "entertainment": {"limit": 3000, "warn_at": 0.8},
        "utilities": {"limit": 5000, "warn_at": 0.8},
        "uncategorized": {"limit": 2000, "warn_at": 0.9},
    },
    "defaults": {"warn_at": DEFAULT_BUDGET_WARN_THRESHOLD},
}

def _get_budget_file_path(path: Optional[str]) -> str:
    return path or BUDGETS_FILE

def _ensure_budget_file(path: Optional[str] = None) -> None:
    target = _get_budget_file_path(path)
    if os.path.exists(target):
        return
    try:
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(_DEFAULT_BUDGETS, handle, indent=2, ensure_ascii=False)
        log_info("Created default budget configuration at %s", target)
    except OSError as exc:
        log_error("Failed to create default budgets: %s", exc)

def load_budget_config(path: Optional[str] = None) -> Dict[str, Dict[str, Dict[str, float]]]:
    target = _get_budget_file_path(path)
    _ensure_budget_file(target)
    try:
        with open(target, "r", encoding="utf-8") as handle:
            config = json.load(handle)
    except FileNotFoundError:
        log_error("Budget file %s missing after ensure step", target)
        return _DEFAULT_BUDGETS
    except json.JSONDecodeError as exc:
        log_error("Budget file %s invalid JSON: %s", target, exc)
        return _DEFAULT_BUDGETS
    defaults = config.get("defaults", {})
    if "warn_at" not in defaults:
        defaults["warn_at"] = DEFAULT_BUDGET_WARN_THRESHOLD
    config["defaults"] = defaults
    return config

def _to_budget_limits(config: Dict[str, Dict[str, Dict[str, float]]]) -> Dict[str, BudgetLimit]:
    defaults = config.get("defaults", {})
    default_warn_ratio = float(defaults.get("warn_at", DEFAULT_BUDGET_WARN_THRESHOLD))
    budgets: Dict[str, BudgetLimit] = {}
    for category, payload in config.get("monthly", {}).items():
        limit = float(payload.get("limit", 0))
        if limit <= 0:
            continue
        warn_ratio = float(payload.get("warn_at", default_warn_ratio))
        warn_ratio = min(max(warn_ratio, 0.0), 1.0)
        budgets[category.lower()] = BudgetLimit(category=category.lower(), limit=limit, warn_ratio=warn_ratio)
    return budgets

def get_budget_limits(path: Optional[str] = None) -> Dict[str, BudgetLimit]:
    config = load_budget_config(path)
    return _to_budget_limits(config)

def set_budget_limit(category: str, limit: float, warn_at: Optional[float] = None, path: Optional[str] = None) -> None:
    """Create or update a monthly budget for a category and persist it.
    If warn_at is not provided, uses the default warn threshold from config or DEFAULT_BUDGET_WARN_THRESHOLD.
    The path parameter is optional and defaults to BUDGETS_FILE.
    """
    target = _get_budget_file_path(path)
    category_key = category.lower().strip()
    if not category_key:
        raise ValueError("category is required")
    if limit is None or float(limit) <= 0:
        raise ValueError("limit must be a positive number")

    config = load_budget_config(target)
    defaults = config.get("defaults", {})
    if warn_at is None:
        warn_at = float(defaults.get("warn_at", DEFAULT_BUDGET_WARN_THRESHOLD))
    config.setdefault("monthly", {})[category_key] = {"limit": float(limit), "warn_at": float(warn_at)}
    try:
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, ensure_ascii=False)
        log_info("Set budget for %s: limit=%s warn_at=%s", category_key, limit, warn_at)
    except OSError as exc:
        log_error("Failed to persist budget config: %s", exc)
        raise


def remove_budget_limit(category: str, path: Optional[str] = None) -> bool:
    """Remove a monthly budget for the category. Returns True if removed."""
    target = _get_budget_file_path(path)
    category_key = category.lower().strip()
    if not category_key:
        raise ValueError("category is required")

    config = load_budget_config(target)
    monthly = config.get("monthly", {})
    if category_key not in monthly:
        return False

    monthly.pop(category_key, None)
    try:
        os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, ensure_ascii=False)
        log_info("Removed budget for %s", category_key)
        return True
    except OSError as exc:
        log_error("Failed to persist budget removal: %s", exc)
        raise

def format_budget_summary(year: Optional[int] = None, month: Optional[int] = None) -> str:
    """Return a human-friendly summary of current budgets and spend."""
    statuses = evaluate_monthly_budgets(year=year, month=month)
    if not statuses:
        return "No budgets configured."
    lines: List[str] = []
    for s in statuses:
        pct = s.percentage * 100
        lines.append(f"{s.category}: ₹{s.spent:.0f} / ₹{s.limit:.0f} ({pct:.0f}%) — {s.level}")
    return "\n".join(lines)

def _assess_single_budget(spent: float, limit: BudgetLimit) -> BudgetStatus:
    percentage = spent / limit.limit if limit.limit else 0.0
    remaining = max(limit.limit - spent, 0.0)
    warn_amount = limit.warn_amount
    if spent >= limit.limit:
        level = "critical"
        message = f"Budget for {limit.category} exceeded. Spent ₹{spent:.0f} out of ₹{limit.limit:.0f}."
    elif spent >= warn_amount:
        level = "warning"
        message = (
            f"Budget for {limit.category} close to limit: ₹{spent:.0f} used, "
            f"₹{remaining:.0f} remaining."
        )
    else:
        level = "ok"
        message = f"Budget for {limit.category} is healthy with ₹{remaining:.0f} remaining."
    return BudgetStatus(
        category=limit.category,
        limit=limit.limit,
        spent=spent,
        remaining=remaining,
        percentage=percentage,
        level=level,
        message=message,
    )

def evaluate_monthly_budgets(
    year: Optional[int] = None,
    month: Optional[int] = None,
    user_id: Optional[str] = None,
) -> List[BudgetStatus]:
    now = datetime.now()
    year = year or now.year
    month = month or now.month
    limits = get_budget_limits()
    if not limits:
        return []
    totals = get_monthly_totals_by_category(year=year, month=month, user_id=user_id)
    spending = {row["category"].lower(): float(row["total"]) for row in totals}
    results: List[BudgetStatus] = []
    for category, limit in limits.items():
        spent = spending.get(category, 0.0)
        results.append(_assess_single_budget(spent, limit))
    return results

def get_alert_for_category(
    category: str,
    year: Optional[int] = None,
    month: Optional[int] = None,
    user_id: Optional[str] = None,
) -> Optional[BudgetStatus]:
    category_key = category.lower()
    limits = get_budget_limits()
    limit = limits.get(category_key)
    if not limit:
        return None
    statuses = evaluate_monthly_budgets(year=year, month=month, user_id=user_id)
    for status in statuses:
        if status.category == category_key and status.level in {"warning", "critical"}:
            return status
    return None

def summarize_alerts(statuses: List[BudgetStatus]) -> List[str]:
    return [status.message for status in statuses if status.level in {"warning", "critical"}]

__all__ = [
    "BudgetLimit",
    "BudgetStatus",
    "evaluate_monthly_budgets",
    "get_alert_for_category",
    "set_budget_limit",
    "remove_budget_limit",
    "format_budget_summary",
    "get_budget_limits",
    "load_budget_config",
    "summarize_alerts",
]

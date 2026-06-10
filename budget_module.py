"""Budget management module.

Provides logic to evaluate spending against user-defined limits and thresholds,
generating alerts when budgets are close to or exceed their limits.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

from config import DEFAULT_BUDGET_WARN_THRESHOLD

from database import (
    get_monthly_totals_by_category,
    get_budgets_for_user,
    upsert_budget,
    delete_budget,
)
from logger import log_error, log_info


@dataclass
class BudgetLimit:
    """Represents a configured budget limit for a category."""
    
    category: str
    limit: float
    warn_ratio: float

    @property
    def warn_amount(self) -> float:
        """Calculate the absolute amount at which a warning should trigger."""
        return self.limit * self.warn_ratio

@dataclass
class BudgetStatus:
    """Represents the current evaluation of spending against a budget limit."""
    
    category: str
    limit: float
    spent: float
    remaining: float
    percentage: float
    level: str
    message: str

def get_budget_limits(user_id: str) -> Dict[str, BudgetLimit]:
    """Retrieve all budget limits for a specific user from DB."""
    if not user_id:
        raise ValueError("user_id is required")

    budgets: Dict[str, BudgetLimit] = {}
    db_budgets = get_budgets_for_user(user_id)
    for row in db_budgets:
        category = row["category"].lower()
        limit = float(row["limit_amt"])
        if limit <= 0:
            continue
        warn_ratio = float(row["warn_at"])
        warn_ratio = min(max(warn_ratio, 0.0), 1.0)
        budgets[category] = BudgetLimit(category=category, limit=limit, warn_ratio=warn_ratio)
    return budgets

def set_budget_limit(category: str, limit: float, warn_at: Optional[float] = None, user_id: Optional[str] = None) -> None:
    """Create or update a monthly budget for a category and persist it."""
    if not user_id:
        raise ValueError("user_id is required")
        
    category_key = category.lower().strip()
    if not category_key:
        raise ValueError("category is required")
    if limit is None or float(limit) <= 0:
        raise ValueError("limit must be a positive number")

    if warn_at is None:
        warn_at = DEFAULT_BUDGET_WARN_THRESHOLD

    try:
        upsert_budget(user_id, category_key, float(limit), float(warn_at))
        log_info("Set budget for %s (user %s): limit=%s warn_at=%s", category_key, user_id, limit, warn_at)
    except Exception as exc:
        log_error("Failed to persist budget config: %s", exc)
        raise

def remove_budget_limit(category: str, user_id: Optional[str] = None) -> bool:
    """Remove a monthly budget for the category. Returns True if removed."""
    if not user_id:
        raise ValueError("user_id is required")

    category_key = category.lower().strip()
    if not category_key:
        raise ValueError("category is required")

    try:
        removed = delete_budget(user_id, category_key)
        if removed:
            log_info("Removed budget for %s (user %s)", category_key, user_id)
        return removed
    except Exception as exc:
        log_error("Failed to persist budget removal: %s", exc)
        raise

def format_budget_summary(user_id: str, year: Optional[int] = None, month: Optional[int] = None) -> str:
    """Return a human-friendly summary of current budgets and spend."""
    if not user_id:
        return "No budgets configured."
    statuses = evaluate_monthly_budgets(user_id=user_id, year=year, month=month)
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
    from utils.dates import get_local_now
    now = get_local_now()
    year = year or now.year
    month = month or now.month

    # Per-user DB budgets take precedence over the global budgets table
    if user_id:
        from database import get_user_budget_limits   # avoid circular import at module level
        db_rows = get_user_budget_limits(user_id)
        if db_rows:
            limits = {
                row["category"].lower(): BudgetLimit(
                    category=row["category"].lower(),
                    limit=float(row["monthly_limit"]),
                    warn_ratio=float(row["warn_at"]),
                )
                for row in db_rows
            }
        else:
            limits = get_budget_limits(user_id)   # legacy budgets table fallback
    else:
        return []

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
    user_id: str,
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> Optional[BudgetStatus]:
    """Check if a specific category has breached its warning or critical threshold.
    
    Args:
        category: The category name to check.
        user_id: The ID of the user.
        year: The year to evaluate.
        month: The month to evaluate.
        
    Returns:
        Optional[BudgetStatus]: The status object if an alert should be raised, None otherwise.

    """
    if not user_id:
        return None
    category_key = category.lower()
    limits = get_budget_limits(user_id)
    limit = limits.get(category_key)
    if not limit:
        return None
    statuses = evaluate_monthly_budgets(year=year, month=month, user_id=user_id)
    for status in statuses:
        if status.category == category_key and status.level in {"warning", "critical"}:
            return status
    return None

def summarize_alerts(statuses: List[BudgetStatus]) -> List[str]:
    """Extract alert messages from a list of budget statuses.
    
    Args:
        statuses: A list of BudgetStatus objects.
        
    Returns:
        List[str]: A list of alert messages for categories that are in warning or critical state.

    """
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
    "summarize_alerts",
]

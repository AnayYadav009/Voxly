"""Visualization data module.

Provides database aggregation functions for charts without matplotlib or pandas.
"""
from typing import Any, Dict, List, Optional
from database import get_db
from logger import log_error

def fetch_data(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Fetch data from database as list of dictionaries."""
    try:
        with get_db() as conn:
            cur = conn.execute(query, params)
            return [dict(row) for row in cur.fetchall()]
    except Exception as exc:
        log_error("Data fetch error: %s", exc)
        raise

def get_category_breakdown(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve total spending broken down by category."""
    where_clause = "WHERE user_id = ?" if user_id else ""
    params: tuple = (user_id,) if user_id else ()
    query = (
        """
        SELECT category, COALESCE(SUM(amount), 0) AS total
        FROM expenses
        {where}
        GROUP BY category
        ORDER BY total DESC
        """
    ).format(where=where_clause)
    return fetch_data(query, params)

def get_recent_daily_totals(days: int = 7, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve total spending grouped by day for the last N days."""
    query = """
        SELECT date, COALESCE(SUM(amount), 0) AS total
        FROM expenses
        WHERE date >= date('now', ?)
        {user_filter}
        GROUP BY date
        ORDER BY date
    """
    offset = f"-{days - 1} day"
    params: List[Any] = [offset]
    user_filter = ""
    if user_id:
        user_filter = "AND user_id = ?"
        params.append(user_id)
    return fetch_data(query.format(user_filter=user_filter), tuple(params))

def get_monthly_totals_by_month(months: int = 6, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve total spending grouped by month for the last N months."""
    where_clause = "WHERE user_id = ?" if user_id else ""
    params: tuple = (user_id,) if user_id else ()
    query = (
        """
        SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(amount), 0) AS total
        FROM expenses
        {where}
        GROUP BY strftime('%Y-%m', date)
        ORDER BY month
        """
    ).format(where=where_clause)
    data = fetch_data(query, params)
    if months and data:
        data = data[-months:]
    return data

def generate_all_charts(user_id: Optional[str] = None) -> Dict[str, Optional[str]]:
    """Stub function returning empty charts dictionary since PNG charts are deprecated."""
    return {
        "category": None,
        "daily": None,
    }

"""Visualization module for generating charts and graphs.

Provides functions to generate matplotlib charts from the SQLite database.
"""
import os
import sqlite3
from typing import Any, Dict, List, Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from config import CHART_DIR
from database import create_connection
from logger import log_error

def ensure_chart_dir() -> str:
    """Ensure the directory for saving charts exists.
    
    Returns:
        str: The path to the chart directory.

    """
    os.makedirs(CHART_DIR, exist_ok=True)
    return CHART_DIR

def fetch_dataframe(query: str, params: tuple = ()) -> pd.DataFrame:
    """Fetch data from the database into a pandas DataFrame.
    
    Args:
        query: SQL query string.
        params: Tuple of parameters for the SQL query.
        
    Returns:
        pd.DataFrame: The resulting dataset.

    """
    try:
        with create_connection() as conn:
            df = pd.read_sql_query(query, conn, params=params)
        return df
    except sqlite3.Error as exc:
        log_error("Data fetch error: %s", exc)
        raise

def plot_category_pie(df: pd.DataFrame, filename: str) -> Optional[str]:
    """Generate a pie chart for spending by category.
    
    Args:
        df: DataFrame containing 'total' and 'category' columns.
        filename: Name of the file to save the chart as.
        
    Returns:
        Optional[str]: Path to the generated chart image, or None if the DataFrame is empty.

    """
    if df.empty:
        return None
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.pie(df["total"], labels=df["category"], autopct="%1.1f%%", startangle=140)
    ax.set_title("Spending by Category")
    path = os.path.join(ensure_chart_dir(), filename)
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path

def plot_daily_bar(df: pd.DataFrame, filename: str) -> Optional[str]:
    """Generate a bar chart for daily spending.
    
    Args:
        df: DataFrame containing 'date' and 'total' columns.
        filename: Name of the file to save the chart as.
        
    Returns:
        Optional[str]: Path to the generated chart image, or None if the DataFrame is empty.

    """
    if df.empty:
        return None
    df = df.sort_values("date")
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.bar(df["date"], df["total"], color="#4e79a7")
    ax.set_title("Daily Spending")
    ax.set_xlabel("Date")
    ax.set_ylabel("Amount (₹)")
    ax.tick_params(axis="x", rotation=45)
    path = os.path.join(ensure_chart_dir(), filename)
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path

def get_category_breakdown(user_id: Optional[str] = None) -> pd.DataFrame:
    """Retrieve total spending broken down by category.
    
    Args:
        user_id: Optional ID of the user to filter expenses for.
        
    Returns:
        pd.DataFrame: DataFrame containing spending aggregated by category.

    """
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
    return fetch_dataframe(query, params)

def get_recent_daily_totals(days: int = 7, user_id: Optional[str] = None) -> pd.DataFrame:
    """Retrieve total spending grouped by day for the last N days.
    
    Args:
        days: Number of recent days to include.
        user_id: Optional ID of the user to filter expenses for.
        
    Returns:
        pd.DataFrame: DataFrame containing daily spending totals.

    """
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
    return fetch_dataframe(query.format(user_filter=user_filter), tuple(params))

def get_monthly_totals_by_month(months: int = 6, user_id: Optional[str] = None) -> pd.DataFrame:
    """Retrieve total spending grouped by month for the last N months.
    
    Args:
        months: Number of recent months to include.
        user_id: Optional ID of the user to filter expenses for.
        
    Returns:
        pd.DataFrame: DataFrame containing monthly spending totals.

    """
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
    df = fetch_dataframe(query, params)
    if months and not df.empty:
        df = df.tail(months)
    return df.reset_index(drop=True)

def generate_all_charts(user_id: Optional[str] = None) -> Dict[str, Optional[str]]:
    """Generate all standard charts (category pie and daily bar) for a user.
    
    Args:
        user_id: Optional ID of the user to generate charts for.
        
    Returns:
        Dict[str, Optional[str]]: Dictionary mapping chart names to their file paths.

    """
    charts: Dict[str, Optional[str]] = {
        "category": plot_category_pie(get_category_breakdown(user_id=user_id), "category_pie.png"),
        "daily": plot_daily_bar(get_recent_daily_totals(7, user_id=user_id), "daily_bar.png"),
    }
    return charts

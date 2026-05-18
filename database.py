"""Database and schema management module."""

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from config import DB_NAME, DATE_FORMAT
from logger import log_error, log_info

SCHEMA = """
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    payment_method TEXT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    log_opt_in INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);

CREATE TABLE IF NOT EXISTS command_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    parsed_payload TEXT,
    intent TEXT,
    entities TEXT,
    channel TEXT,
    confidence REAL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_command_logs_user_created ON command_logs(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_budgets (
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    limit_amount REAL NOT NULL,
    warn_ratio REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, category),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_states (
    user_id TEXT PRIMARY KEY,
    last_command TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    insight_text TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id, expires_at);
"""

def _current_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def _ensure_expense_user_column(conn: sqlite3.Connection) -> None:
    try:
        cur = conn.execute("PRAGMA table_info(expenses)")
        columns = {row[1] for row in cur.fetchall()}
        if "user_id" not in columns:
            conn.execute("ALTER TABLE expenses ADD COLUMN user_id TEXT")
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to ensure user_id column: %s", exc)


def _ensure_user_logging_column(conn: sqlite3.Connection) -> None:
    try:
        cur = conn.execute("PRAGMA table_info(users)")
        columns = {row[1] for row in cur.fetchall()}
        if "log_opt_in" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN log_opt_in INTEGER NOT NULL DEFAULT 0")
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to ensure log_opt_in column: %s", exc)

def create_connection(db_name: str = DB_NAME) -> sqlite3.Connection:
    """Create connection."""
    conn = sqlite3.connect(db_name, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn

@contextmanager
def get_db(db_name: str = DB_NAME):
    """Context manager for DB connections."""
    conn = create_connection(db_name)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def create_table() -> None:
    """Create table."""
    try:
        with get_db() as conn:
            # Ensure legacy `user_id` column exists on `expenses` before applying schema
            # (older DBs may lack the column, and index creation below would fail).
            _ensure_expense_user_column(conn)
            _ensure_user_logging_column(conn)
            conn.executescript(SCHEMA)
            conn.commit()
        log_info("Database schema ensured.")
    except sqlite3.Error as exc:
        log_error("Failed to create schema: %s", exc)
        raise


# Automatically ensure schema on import in normal runs.
# Tests may monkeypatch `create_connection`, so skip automatic creation
# when running under pytest or when explicitly requested via env var.
_skip_auto = os.environ.get("VOXLY_SKIP_AUTOCREATE", "false").lower() in {"1", "true", "yes"}
_running_pytest = any(k.startswith("PYTEST") for k in os.environ.keys())

if not _skip_auto and not _running_pytest:
    try:
        create_table()
    except Exception as exc:  # pragma: no cover - defensive startup behavior
        log_error("Automatic schema creation failed: %s", exc)

def _normalize_date(date: Optional[str] = None) -> str:
    if date:
        return date
    return datetime.now(timezone.utc).strftime(DATE_FORMAT)

def _normalize_time(time_str: Optional[str] = None) -> str:
    if time_str:
        return time_str
    return datetime.now(timezone.utc).strftime("%H:%M:%S")

def create_user(email: str, password_hash: str, display_name: Optional[str] = None) -> Dict[str, Any]:
    """Create user."""
    user_id = str(uuid4())
    timestamp = _current_timestamp()
    payload = {
        "id": user_id,
        "email": email.lower().strip(),
        "password_hash": password_hash,
        "display_name": display_name,
        "created_at": timestamp,
        "updated_at": timestamp,
        "log_opt_in": 0,
    }
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, log_opt_in)
                VALUES (:id, :email, :password_hash, :display_name, :created_at, :updated_at, :log_opt_in)
                """,
                payload,
            )
            conn.commit()
        log_info("Created user %s", user_id)
        return get_user_by_id(user_id) or payload
    except sqlite3.IntegrityError as exc:
        log_error("Failed to create user (duplicate email?): %s", exc)
        raise

_PUBLIC_USER_COLS = "id, email, display_name, created_at, updated_at, log_opt_in"

def get_user_by_email_public(email: str) -> Optional[Dict[str, Any]]:
    """Get user by email without sensitive fields."""
    if not email:
        return None
    try:
        with get_db() as conn:
            cur = conn.execute(
                f"SELECT {_PUBLIC_USER_COLS} FROM users WHERE email = ?",
                (email.lower().strip(),),
            )
            row = cur.fetchone()
        return dict(row) if row else None
    except sqlite3.Error as exc:
        log_error("Failed to fetch public user by email: %s", exc)
        raise

def get_user_by_id_public(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user by id without sensitive fields."""
    if not user_id:
        return None
    try:
        with get_db() as conn:
            cur = conn.execute(
                f"SELECT {_PUBLIC_USER_COLS} FROM users WHERE id = ?",
                (user_id,),
            )
            row = cur.fetchone()
        return dict(row) if row else None
    except sqlite3.Error as exc:
        log_error("Failed to fetch public user by id: %s", exc)
        raise

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Get user by email."""
    if not email:
        return None
    try:
        with get_db() as conn:
            cur = conn.execute(
                "SELECT id, email, password_hash, display_name, created_at, updated_at, log_opt_in FROM users WHERE email = ?",
                (email.lower().strip(),),
            )
            row = cur.fetchone()
        return dict(row) if row else None
    except sqlite3.Error as exc:
        log_error("Failed to fetch user by email: %s", exc)
        raise

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user by id."""
    if not user_id:
        return None
    try:
        with get_db() as conn:
            cur = conn.execute(
                "SELECT id, email, password_hash, display_name, created_at, updated_at, log_opt_in FROM users WHERE id = ?",
                (user_id,),
            )
            row = cur.fetchone()
        return dict(row) if row else None
    except sqlite3.Error as exc:
        log_error("Failed to fetch user by id: %s", exc)
        raise

def touch_user_timestamp(user_id: str) -> None:
    """Touch user timestamp."""
    if not user_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET updated_at = ? WHERE id = ?",
                (_current_timestamp(), user_id),
            )
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to update user timestamp: %s", exc)


def update_user_log_opt_in(user_id: str, enabled: bool) -> None:
    """Update user log opt in."""
    if not user_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET log_opt_in = ?, updated_at = ? WHERE id = ?",
                (1 if enabled else 0, _current_timestamp(), user_id),
            )
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to update user log preference: %s", exc)


def get_user_preferences(user_id: str) -> Dict[str, Any]:
    """Get user preferences."""
    user = get_user_by_id(user_id)
    return {"log_opt_in": bool(user.get("log_opt_in"))} if user else {"log_opt_in": False}


def log_command_event(
    user_id: str,
    raw_text: str,
    *,
    parsed_payload: Optional[Dict[str, Any]] = None,
    intent: Optional[str] = None,
    entities: Optional[Dict[str, Any]] = None,
    channel: str = "voice",
    confidence: Optional[float] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Log command event."""
    if not (user_id and raw_text):
        return
    payload = {
        "id": str(uuid4()),
        "user_id": user_id,
        "raw_text": raw_text,
        "parsed_payload": json.dumps(parsed_payload or {}),
        "intent": intent,
        "entities": json.dumps(entities or {}),
        "channel": channel,
        "confidence": confidence,
        "metadata": json.dumps(metadata or {}),
        "created_at": _current_timestamp(),
    }
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO command_logs (id, user_id, raw_text, parsed_payload, intent, entities, channel, confidence, metadata, created_at)
                VALUES (:id, :user_id, :raw_text, :parsed_payload, :intent, :entities, :channel, :confidence, :metadata, :created_at)
                """,
                payload,
            )
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to log command event: %s", exc)

def add_expense(
    amount: float,
    category: str,
    date: Optional[str] = None,
    description: Optional[str] = None,
    time: Optional[str] = None,
    payment_method: Optional[str] = None,
    user_id: Optional[str] = None,
) -> int:
    """Add expense."""
    payload = {
        "amount": amount,
        "category": category,
        "description": description,
        "payment_method": payment_method,
        "date": _normalize_date(date),
        "time": _normalize_time(time),
        "user_id": user_id,
    }
    try:
        with get_db() as conn:
            cur = conn.execute(
                """
                INSERT INTO expenses (amount, category, description, payment_method, date, time, user_id)
                VALUES (:amount, :category, :description, :payment_method, :date, :time, :user_id)
                """,
                payload,
            )
            conn.commit()
            expense_id = cur.lastrowid
        log_info("Inserted expense %s -> %s", expense_id, payload)
        return expense_id
    except sqlite3.Error as exc:
        log_error("Failed to insert expense: %s", exc)
        raise

def get_total_today(user_id: Optional[str] = None) -> float:
    """Get total today."""
    today = _normalize_date()
    try:
        with get_db() as conn:
            sql = "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date = ?"
            params: List[Any] = [today]
            if user_id:
                sql += " AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(sql, params)
            total = cur.fetchone()[0]
        return float(total or 0.0)
    except sqlite3.Error as exc:
        log_error("Failed to fetch today's total: %s", exc)
        raise

def get_total_by_category(user_id: Optional[str] = None) -> List[Tuple[str, float]]:
    """Get total by category."""
    try:
        with get_db() as conn:
            sql = (
                """
                SELECT category, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                {where}
                GROUP BY category
                ORDER BY total DESC
                """
            )
            where_clause = "WHERE user_id = ?" if user_id else ""
            query = sql.format(where=where_clause)
            params: Tuple[Any, ...] = (user_id,) if user_id else ()
            cur = conn.execute(query, params)
            results = [(row["category"], float(row["total"])) for row in cur.fetchall()]
        return results
    except sqlite3.Error as exc:
        log_error("Failed to fetch total by category: %s", exc)
        raise

def get_recent_expenses(limit: int = 5, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get recent expenses."""
    try:
        with get_db() as conn:
            params: List[Any] = []
            sql = (
                """
                SELECT id, amount, category, description, payment_method, date, time
                FROM expenses
                {where}
                ORDER BY date DESC, time DESC, id DESC
                LIMIT ?
                """
            )
            where_clause = "WHERE user_id = ?" if user_id else ""
            if user_id:
                params.append(user_id)
            params.append(limit)
            cur = conn.execute(sql.format(where=where_clause), params)
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        log_error("Failed to fetch recent expenses: %s", exc)
        raise

def delete_last_expense(user_id: Optional[str] = None) -> Optional[int]:
    """Delete last expense."""
    try:
        with get_db() as conn:
            sql = "SELECT id FROM expenses {where} ORDER BY date DESC, time DESC, id DESC LIMIT 1"
            where_clause = "WHERE user_id = ?" if user_id else ""
            params: Tuple[Any, ...] = (user_id,) if user_id else ()
            cur = conn.execute(sql.format(where=where_clause), params)
            row = cur.fetchone()
            if not row:
                return None
            expense_id = row["id"]
            delete_sql = "DELETE FROM expenses WHERE id = ?"
            delete_params: List[Any] = [expense_id]
            if user_id:
                delete_sql += " AND user_id = ?"
                delete_params.append(user_id)
            conn.execute(delete_sql, delete_params)
            conn.commit()
        log_info("Deleted last expense id=%s", expense_id)
        return expense_id
    except sqlite3.Error as exc:
        log_error("Failed to delete last expense: %s", exc)
        raise

def delete_expense(expense_id: int, user_id: Optional[str] = None) -> bool:
    """Delete expense."""
    try:
        with get_db() as conn:
            sql = "DELETE FROM expenses WHERE id = ?"
            params: List[Any] = [expense_id]
            if user_id:
                sql += " AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(sql, params)
            conn.commit()
        deleted = cur.rowcount > 0
        log_info("Delete expense id=%s -> %s", expense_id, deleted)
        return deleted
    except sqlite3.Error as exc:
        log_error("Failed to delete expense: %s", exc)
        raise

def update_expense(
    expense_id: int,
    amount: Optional[float] = None,
    category: Optional[str] = None,
    description: Optional[str] = None,
    payment_method: Optional[str] = None,
    date: Optional[str] = None,
    time: Optional[str] = None,
    user_id: Optional[str] = None,
) -> bool:
    """Update expense."""
    fields: List[str] = []
    params: List[Any] = []

    if amount is not None:
        try:
            amount = float(amount)
        except (ValueError, TypeError):
            raise ValueError("Amount must be a number.")
        if amount <= 0:
            raise ValueError("Amount must be positive.")
        fields.append("amount = ?")
        params.append(amount)
    if category:
        fields.append("category = ?")
        params.append(category)
    if description is not None:
        fields.append("description = ?")
        params.append(description)
    if payment_method is not None:
        fields.append("payment_method = ?")
        params.append(payment_method)
    if date:
        fields.append("date = ?")
        params.append(date)
    if time:
        fields.append("time = ?")
        params.append(time)

    if not fields:
        return False

    params.append(expense_id)

    sql = f"UPDATE expenses SET {', '.join(fields)} WHERE id = ?"
    if user_id:
        sql += " AND user_id = ?"
        params.append(user_id)

    try:
        with get_db() as conn:
            cur = conn.execute(sql, params)
            conn.commit()
        updated = cur.rowcount > 0
        log_info("Update expense id=%s -> %s", expense_id, updated)
        return updated
    except sqlite3.Error as exc:
        log_error("Failed to update expense: %s", exc)
        raise

def get_weekly_summary(weeks: int = 1, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get weekly summary."""
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(weeks=weeks)
    try:
        with get_db() as conn:
            sql = (
                """
                SELECT date, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                WHERE date BETWEEN ? AND ?
                {user_filter}
                GROUP BY date
                ORDER BY date DESC
                """
            )
            params: List[Any] = [start_date.strftime(DATE_FORMAT), end_date.strftime(DATE_FORMAT)]
            user_filter = ""
            if user_id:
                user_filter = "AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(sql.format(user_filter=user_filter), params)
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        log_error("Failed to fetch weekly summary: %s", exc)
        raise

def get_monthly_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get monthly summary."""
    now = datetime.now(timezone.utc)
    year = year or now.year
    month = month or now.month
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = datetime(year, month + 1, 1) - timedelta(days=1)
    try:
        with get_db() as conn:
            sql = (
                """
                SELECT date, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                WHERE date BETWEEN ? AND ?
                {user_filter}
                GROUP BY date
                ORDER BY date
                """
            )
            params: List[Any] = [start.strftime(DATE_FORMAT), end.strftime(DATE_FORMAT)]
            user_filter = ""
            if user_id:
                user_filter = "AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(sql.format(user_filter=user_filter), params)
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        log_error("Failed to fetch monthly summary: %s", exc)
        raise


def get_monthly_totals_by_category(
    year: Optional[int] = None,
    month: Optional[int] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get monthly totals by category."""
    now = datetime.now(timezone.utc)
    year = year or now.year
    month = month or now.month
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    try:
        with get_db() as conn:
            sql = (
                """
                SELECT category, COALESCE(SUM(amount), 0) AS total
                FROM expenses
                WHERE date >= ? AND date < ?
                {user_filter}
                GROUP BY category
                ORDER BY total DESC
                """
            )
            params: List[Any] = [start.strftime(DATE_FORMAT), end.strftime(DATE_FORMAT)]
            user_filter = ""
            if user_id:
                user_filter = "AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(sql.format(user_filter=user_filter), params)
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        log_error("Failed to fetch monthly category totals: %s", exc)
        raise

def get_recurring_expenses(
    user_id: Optional[str] = None,
    lookback_days: int = 90,
    min_occurrences: int = 2,
    gap_min_days: int = 25,
    gap_max_days: int = 38,
    amount_tolerance: float = 0.15,
) -> List[Dict[str, Any]]:
    """
    Detect likely recurring expenses in the last `lookback_days` days.

    Groups by (category, amount_bucket) where amount_bucket = round(amount, -2)
    (i.e. nearest 100). Then checks if consecutive occurrences are spaced
    gap_min_days..gap_max_days apart.

    Returns a list of dicts:
        category, representative_amount, occurrences, avg_gap_days,
        last_date, next_expected_date, confidence ('high'|'medium'|'low')
    """
    from datetime import datetime, timedelta

    start_date = (datetime.now() - timedelta(days=lookback_days)).strftime(DATE_FORMAT)
    try:
        with get_db() as conn:
            where = "WHERE date >= ?"
            params: List[Any] = [start_date]
            if user_id:
                where += " AND user_id = ?"
                params.append(user_id)
            cur = conn.execute(
                f"""
                SELECT category,
                       ROUND(amount / 100.0) * 100 AS amount_bucket,
                       amount,
                       date
                FROM expenses
                {where}
                ORDER BY category, amount_bucket, date
                """,
                params,
            )
            rows = [dict(r) for r in cur.fetchall()]
    except sqlite3.Error as exc:
        log_error("Failed to fetch recurring expense candidates: %s", exc)
        return []

    # Group by (category, amount_bucket)
    from itertools import groupby
    from math import isclose

    groups: Dict[tuple, List[dict]] = {}
    for row in rows:
        key = (row["category"], row["amount_bucket"])
        groups.setdefault(key, []).append(row)

    results = []
    for (category, bucket), entries in groups.items():
        if len(entries) < min_occurrences:
            continue

        # Sort by date and compute consecutive gaps
        entries.sort(key=lambda r: r["date"])
        dates = [datetime.strptime(r["date"], DATE_FORMAT) for r in entries]
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]

        if not gaps:
            continue

        periodic_gaps = [g for g in gaps if gap_min_days <= g <= gap_max_days]
        if len(periodic_gaps) < max(1, len(gaps) // 2):
            # Fewer than half the gaps are periodic — skip
            continue

        avg_gap = sum(periodic_gaps) / len(periodic_gaps)
        rep_amount = float(entries[-1]["amount"])  # most recent amount
        last_date = dates[-1]
        next_expected = last_date + timedelta(days=round(avg_gap))

        # Confidence
        periodicity_ratio = len(periodic_gaps) / max(len(gaps), 1)
        if periodicity_ratio >= 0.8 and len(entries) >= 3:
            confidence = "high"
        elif periodicity_ratio >= 0.6:
            confidence = "medium"
        else:
            confidence = "low"

        results.append({
            "category": category,
            "representative_amount": round(rep_amount, 2),
            "occurrences": len(entries),
            "avg_gap_days": round(avg_gap, 1),
            "last_date": last_date.strftime(DATE_FORMAT),
            "next_expected_date": next_expected.strftime(DATE_FORMAT),
            "confidence": confidence,
        })

    # Sort by confidence then by next expected date
    order = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (order[r["confidence"]], r["next_expected_date"]))
    return results

def get_all_expenses(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all expenses."""
    try:
        with get_db() as conn:
            sql = (
                """
                SELECT id, amount, category, description, payment_method, date, time
                FROM expenses
                {where}
                ORDER BY date DESC, time DESC, id DESC
                """
            )
            where_clause = "WHERE user_id = ?" if user_id else ""
            params: Tuple[Any, ...] = (user_id,) if user_id else ()
            cur = conn.execute(sql.format(where=where_clause), params)
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        log_error("Failed to fetch expenses: %s", exc)
        raise

def get_user_budgets(user_id: str) -> List[Dict[str, Any]]:
    """Get user budgets."""
    if not user_id:
        return []
    try:
        with get_db() as conn:
            cur = conn.execute(
                "SELECT category, limit_amount, warn_ratio FROM user_budgets WHERE user_id = ?",
                (user_id,)
            )
            return [dict(row) for row in cur.fetchall()]
    except sqlite3.Error as exc:
        log_error("Failed to fetch user budgets: %s", exc)
        raise

def set_user_budget(user_id: str, category: str, limit_amount: float, warn_ratio: float) -> None:
    """Set user budget."""
    if not user_id or not category:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO user_budgets (user_id, category, limit_amount, warn_ratio, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, category) DO UPDATE SET
                    limit_amount=excluded.limit_amount,
                    warn_ratio=excluded.warn_ratio,
                    updated_at=excluded.updated_at
                """,
                (user_id, category.lower(), limit_amount, warn_ratio, _current_timestamp())
            )
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to set user budget: %s", exc)
        raise

def remove_user_budget(user_id: str, category: str) -> bool:
    """Remove user budget."""
    if not user_id or not category:
        return False
    try:
        with get_db() as conn:
            cur = conn.execute(
                "DELETE FROM user_budgets WHERE user_id = ? AND category = ?",
                (user_id, category.lower())
            )
            conn.commit()
            return cur.rowcount > 0
    except sqlite3.Error as exc:
        log_error("Failed to remove user budget: %s", exc)
        raise

def get_last_command(user_id: str) -> Optional[Dict[str, Any]]:
    """Get last command."""
    if not user_id:
        return None
    try:
        with get_db() as conn:
            cur = conn.execute(
                "SELECT last_command FROM user_states WHERE user_id = ?",
                (user_id,)
            )
            row = cur.fetchone()
            if row and row["last_command"]:
                return json.loads(row["last_command"])
            return None
    except (sqlite3.Error, json.JSONDecodeError) as exc:
        log_error("Failed to get last command: %s", exc)
        return None

def set_last_command(user_id: str, payload: Dict[str, Any]) -> None:
    """Set last command."""
    if not user_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO user_states (user_id, last_command, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    last_command=excluded.last_command,
                    updated_at=excluded.updated_at
                """,
                (user_id, json.dumps(payload), _current_timestamp())
            )
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to set last command: %s", exc)
        raise

def get_cached_insight(user_id: str) -> Optional[str]:
    """Return the cached insight text if it has not expired, else None."""
    now = _current_timestamp()
    try:
        with get_db() as conn:
            cur = conn.execute(
                "SELECT insight_text FROM insights WHERE user_id = ? AND expires_at > ? ORDER BY generated_at DESC LIMIT 1",
                (user_id, now),
            )
            row = cur.fetchone()
        return row["insight_text"] if row else None
    except sqlite3.Error as exc:
        log_error("Failed to fetch cached insight: %s", exc)
        return None


def save_insight(user_id: str, insight_text: str, ttl_days: int = 7) -> None:
    """Persist a new insight, replacing any existing ones for this user."""
    from datetime import timedelta
    now_dt = datetime.utcnow()
    expires_dt = now_dt + timedelta(days=ttl_days)
    now_str = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    expires_str = expires_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with get_db() as conn:
            # Delete old insights for this user first
            conn.execute("DELETE FROM insights WHERE user_id = ?", (user_id,))
            conn.execute(
                "INSERT INTO insights (user_id, insight_text, generated_at, expires_at) VALUES (?, ?, ?, ?)",
                (user_id, insight_text, now_str, expires_str),
            )
            conn.commit()
    except sqlite3.Error as exc:
        log_error("Failed to save insight: %s", exc)

"""Dedicated auth endpoint tests."""

import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import sqlite3  # noqa: E402

import database  # noqa: E402
import summary_module  # noqa: E402
import visual_module  # noqa: E402
from app import app  # noqa: E402
from auth import create_access_token  # noqa: E402
from database import create_table, create_user  # noqa: E402

app.config["TESTING"] = True


@pytest.fixture(autouse=True)
def bypass_rate_limit():
    """Bypass rate limits by disabling the limiter."""
    from extensions import limiter
    limiter.enabled = False


@pytest.fixture
def temp_db(monkeypatch, tmp_path):
    """Temporary database fixture."""
    db_path = tmp_path / "auth_test.db"

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
    yield {"db_path": str(db_path)}


def test_register_success(temp_db):
    client = app.test_client()
    resp = client.post(
        "/api/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "Password123",
            "display_name": "New User",
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["user"]["email"] == "newuser@example.com"
    assert data.get("access_token")


def test_register_duplicate_email(temp_db):
    client = app.test_client()
    payload = {
        "email": "dup@example.com",
        "password": "Password123",
    }
    client.post("/api/auth/register", json=payload)
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 409


def test_register_weak_password(temp_db):
    client = app.test_client()
    resp = client.post(
        "/api/auth/register",
        json={"email": "weak@example.com", "password": "weak"},
    )
    assert resp.status_code == 400
    assert "password" in resp.get_json()["error"].lower()


def test_login_success(temp_db):
    client = app.test_client()
    client.post(
        "/api/auth/register",
        json={"email": "login@example.com", "password": "Password123"},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "Password123"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("access_token")
    assert data.get("refresh_token")


def test_login_wrong_password(temp_db):
    client = app.test_client()
    client.post(
        "/api/auth/register",
        json={"email": "wrongpass@example.com", "password": "Password123"},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": "wrongpass@example.com", "password": "WrongPassword123"},
    )
    assert resp.status_code == 401


def test_me_requires_auth(temp_db):
    client = app.test_client()
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_returns_user(temp_db):
    client = app.test_client()
    reg = client.post(
        "/api/auth/register",
        json={"email": "me@example.com", "password": "Password123"},
    )
    token = reg.get_json()["access_token"]
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["user"]["email"] == "me@example.com"


def test_refresh_token(temp_db):
    client = app.test_client()
    reg = client.post(
        "/api/auth/register",
        json={"email": "refresh@example.com", "password": "Password123"},
    )
    refresh_token = reg.get_json()["refresh_token"]
    resp = client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("access_token")


def test_logout_revokes_token(temp_db):
    client = app.test_client()
    reg = client.post(
        "/api/auth/register",
        json={"email": "logout@example.com", "password": "Password123"},
    )
    token = reg.get_json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    client.post("/api/auth/logout", headers=headers)
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_rate_limit_login(temp_db):
    from extensions import limiter

    limiter.enabled = True
    try:
        client = app.test_client()
        client.post(
            "/api/auth/register",
            json={"email": "ratelimit@example.com", "password": "Password123"},
        )
        last_status = None
        for _ in range(11):
            resp = client.post(
                "/api/auth/login",
                json={
                    "email": "ratelimit@example.com",
                    "password": "Password123",
                },
            )
            last_status = resp.status_code
        assert last_status == 429
    finally:
        limiter.enabled = False

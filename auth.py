from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from config import (
    ACCESS_TOKEN_EXPIRES_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET,
    REFRESH_TOKEN_EXPIRES_DAYS,
)

class PasswordPolicyError(ValueError):
    """Raised when a password fails validation."""


def hash_password(password: str) -> str:
    password = (password or "").strip()
    validate_password_strength(password)
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise PasswordPolicyError("Password must be at least 8 characters long.")
    if password.lower() == password or password.upper() == password:
        # Encourage mix of cases by requiring at least one lowercase and uppercase character.
        raise PasswordPolicyError("Password must include both uppercase and lowercase characters.")
    if not any(char.isdigit() for char in password):
        raise PasswordPolicyError("Password must include at least one number.")


def _encode_token(user_id: str, expires_delta: timedelta, token_type: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
        "type": token_type,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str, expected_type: str) -> Optional[str]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    token_type = payload.get("type", "access")
    if token_type != expected_type:
        return None
    return str(payload.get("sub"))


def create_access_token(user_id: str, expires_minutes: Optional[int] = None) -> str:
    lifetime_minutes = expires_minutes or ACCESS_TOKEN_EXPIRES_MINUTES
    return _encode_token(user_id, timedelta(minutes=lifetime_minutes), "access")


def create_refresh_token(user_id: str, expires_days: Optional[int] = None) -> str:
    lifetime_days = expires_days or REFRESH_TOKEN_EXPIRES_DAYS
    return _encode_token(user_id, timedelta(days=lifetime_days), "refresh")


def decode_access_token(token: str) -> Optional[str]:
    return _decode_token(token, "access")


def decode_refresh_token(token: str) -> Optional[str]:
    return _decode_token(token, "refresh")

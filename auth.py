"""Authentication and security module.

Provides functions for password hashing, validation, and JWT token generation
and decoding for secure API access.
"""
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
    """Hash a password using bcrypt.
    
    Args:
        password: The plaintext password.
        
    Returns:
        str: The bcrypt hash string.
        
    Raises:
        PasswordPolicyError: If the password fails validation.

    """
    password = (password or "").strip()
    validate_password_strength(password)
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a bcrypt hash.
    
    Args:
        password: The plaintext password.
        password_hash: The bcrypt hash string.
        
    Returns:
        bool: True if the password matches the hash, False otherwise.

    """
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def validate_password_strength(password: str) -> None:
    """Validate that a password meets complexity requirements.
    
    Requirements:
    - At least 8 characters long
    - Contains uppercase and lowercase characters
    - Contains at least one digit
    
    Args:
        password: The plaintext password.
        
    Raises:
        PasswordPolicyError: If any requirement is not met.

    """
    if len(password) < 8:
        raise PasswordPolicyError("Password must be at least 8 characters long.")
    if not any(c.isupper() for c in password) or not any(c.islower() for c in password):
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
    """Create a short-lived JWT access token for a user.
    
    Args:
        user_id: The ID of the user.
        expires_minutes: Optional explicit expiry time in minutes.
        
    Returns:
        str: The encoded JWT access token.

    """
    lifetime_minutes = expires_minutes or ACCESS_TOKEN_EXPIRES_MINUTES
    return _encode_token(user_id, timedelta(minutes=lifetime_minutes), "access")


def create_refresh_token(user_id: str, expires_days: Optional[int] = None) -> str:
    """Create a long-lived JWT refresh token for a user.
    
    Args:
        user_id: The ID of the user.
        expires_days: Optional explicit expiry time in days.
        
    Returns:
        str: The encoded JWT refresh token.

    """
    lifetime_days = expires_days or REFRESH_TOKEN_EXPIRES_DAYS
    return _encode_token(user_id, timedelta(days=lifetime_days), "refresh")


def decode_access_token(token: str) -> Optional[str]:
    """Decode and validate an access token.
    
    Args:
        token: The encoded JWT access token.
        
    Returns:
        Optional[str]: The user ID if valid, None otherwise.

    """
    return _decode_token(token, "access")


def decode_refresh_token(token: str) -> Optional[str]:
    """Decode and validate a refresh token.
    
    Args:
        token: The encoded JWT refresh token.
        
    Returns:
        Optional[str]: The user ID if valid, None otherwise.

    """
    return _decode_token(token, "refresh")

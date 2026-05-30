import os
import sqlite3
from typing import Dict, Any, Optional
from flask import Blueprint, request, jsonify, make_response, g

from config import ACCESS_TOKEN_EXPIRES_MINUTES, REFRESH_TOKEN_EXPIRES_DAYS
from database import get_user_by_email, create_user, touch_user_timestamp, get_user_by_id, seed_default_budgets, update_last_logout, revoke_token
from auth import (
    hash_password,
    PasswordPolicyError,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_refresh_token
)
from logger import log_error

# In order to avoid circular imports if app.py imports us, we can import limiter inside the routes or at the end.
# However, for decorators, we need it at module level. Let's try importing it.
from extensions import limiter

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

def _public_user_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    if not user:
        return {}
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "display_name": user.get("display_name"),
        "log_opt_in": bool(user.get("log_opt_in")),
    }

def _extract_bearer_token() -> Optional[str]:
    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return request.cookies.get("access_token")

def _unauthorized_response():
    return jsonify({"error": "Authentication required."}), 401

def _require_authenticated_user() -> Optional[Dict[str, Any]]:
    user = getattr(g, "current_user", None)
    if not user:
        return None
    return user

def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()

def _auth_success_response(user: Dict[str, Any]):
    access_token = create_access_token(user["id"])
    refresh_token = create_refresh_token(user["id"])
    touch_user_timestamp(user["id"])
    
    response = make_response(
        jsonify(
            {
                "user": _public_user_payload(user),
                "access_token": access_token,
                "refresh_token": refresh_token,
            }
        )
    )
    response.set_cookie(
        "access_token",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRES_MINUTES * 60,
        httponly=True,
        secure=os.environ.get("FLASK_ENV") == "production",
        samesite="None",
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRES_DAYS * 24 * 3600,
        httponly=True,
        secure=os.environ.get("FLASK_ENV") == "production",
        samesite="None",
        path="/api/auth/refresh",
    )
    return response

@auth_bp.route("/register", methods=["POST"])
@limiter.limit("5 per minute; 20 per hour")
def api_auth_register():
    """Handle API auth register."""
    data = request.get_json(silent=True) or {}
    email = _normalize_email(data.get("email", ""))
    password = str(data.get("password", ""))
    display_name = data.get("name") or data.get("display_name")

    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required."}), 400
    if get_user_by_email(email):
        return jsonify({"error": "Email already in use."}), 409

    try:
        password_hash = hash_password(password)
    except PasswordPolicyError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        user = create_user(email=email, password_hash=password_hash, display_name=display_name)
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already in use."}), 409

    seed_default_budgets(user["id"])        # ← seed default budgets for the new user
    return _auth_success_response(user)

@auth_bp.route("/login", methods=["POST"])
@limiter.limit("10 per minute; 50 per hour")
def api_auth_login():
    """Handle API auth login."""
    data = request.get_json(silent=True) or {}
    email = _normalize_email(data.get("email", ""))
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = get_user_by_email(email)
    if not user or not verify_password(password, user.get("password_hash", "")):
        return jsonify({"error": "Invalid email or password."}), 401

    return _auth_success_response(user)

@auth_bp.route("/me")
def api_auth_me():
    """Handle API auth me."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    return jsonify({"user": _public_user_payload(user)})

@auth_bp.route("/logout", methods=["POST"])
def api_auth_logout():
    """Handle API auth logout."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()
    jti = getattr(g, "token_jti", None)
    if jti:
        revoke_token(jti)
    update_last_logout(user["id"])
    response = make_response(jsonify({"status": "logged_out"}))
    secure_cookie = os.environ.get("FLASK_ENV") == "production"
    response.delete_cookie("access_token", path="/", samesite="None", secure=secure_cookie)
    response.delete_cookie("refresh_token", path="/api/auth/refresh", samesite="None", secure=secure_cookie)
    return response

@auth_bp.route("/refresh", methods=["POST"])
def api_auth_refresh():
    """Handle API auth refresh."""
    refresh_token = (
        (request.get_json(silent=True) or {}).get("refresh_token")
        or request.cookies.get("refresh_token")
        or _extract_bearer_token()
    )
    if not refresh_token:
        return _unauthorized_response()
    result = decode_refresh_token(refresh_token)
    if not result:
        return _unauthorized_response()
    user_id, _jti = result
    user = get_user_by_id(user_id)
    if not user:
        return _unauthorized_response()
    access_token = create_access_token(user_id)
    new_refresh_token = create_refresh_token(user_id)
    touch_user_timestamp(user_id)
    
    response = make_response(
        jsonify(
            {
                "user": _public_user_payload(user),
                "access_token": access_token,
                "refresh_token": new_refresh_token,
            }
        )
    )
    response.set_cookie(
        "access_token",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRES_MINUTES * 60,
        httponly=True,
        secure=os.environ.get("FLASK_ENV") == "production",
        samesite="None",
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        value=new_refresh_token,
        max_age=REFRESH_TOKEN_EXPIRES_DAYS * 24 * 3600,
        httponly=True,
        secure=os.environ.get("FLASK_ENV") == "production",
        samesite="None",
        path="/api/auth/refresh",
    )
    return response

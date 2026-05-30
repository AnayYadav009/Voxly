"""Main application entry point and API routes."""

import os
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request, send_from_directory, g, make_response
from flask_cors import CORS

from auth import decode_access_token
from config import (
    COMMAND_LOGGING_ENABLED,
    REACT_BUILD_DIR,
    REACT_INDEX_FILE,
    init_directories,
    ALLOWED_ORIGINS,
)
from database import (
    ensure_schema_once,
    get_user_by_id,
    is_token_revoked,
    purge_expired_revocations,
)
from extensions import limiter

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("VOXLY_SESSION_SECRET", os.urandom(24))
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)
init_directories()
purge_expired_revocations()

app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

limiter.init_app(app)


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Payload too large. Maximum size is 1MB."}), 413


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    return response


VOICE_HELP_TEXT = (
    "Try commands like:\n"
    "- Add 200 to food\n"
    "- What's my balance today\n"
    "- Show recent expenses\n"
    "- Give weekly summary\n"
    "- Delete last expense\n"
    "- Set budget for food to 5000\n"
    "- What's my budget / Show budgets\n"
    "- Stop to exit"
)


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


def _user_preferences_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    return {"log_opt_in": bool(user.get("log_opt_in"))}


def _should_log_commands(user: Optional[Dict[str, Any]]) -> bool:
    return COMMAND_LOGGING_ENABLED and bool(user and user.get("log_opt_in"))


@app.before_request
def attach_current_user() -> None:
    """Attach current user."""
    ensure_schema_once()
    g.current_user = None
    g.token_jti = None
    token = _extract_bearer_token()
    if not token:
        return
    result = decode_access_token(token)
    if not result:
        return
    user_id, jti = result
    if is_token_revoked(jti):
        return
    user = get_user_by_id(user_id)
    if user:
        g.current_user = user
        g.token_jti = jti


def _react_build_exists() -> bool:
    return os.path.isfile(REACT_INDEX_FILE)


def _serve_react_asset(path: Optional[str] = None):
    if not _react_build_exists():
        return None
    relative_path = (path or "").strip()
    if relative_path:
        candidate = os.path.join(REACT_BUILD_DIR, relative_path)
        if os.path.isfile(candidate):
            return send_from_directory(REACT_BUILD_DIR, relative_path)
    return send_from_directory(REACT_BUILD_DIR, "index.html")


@app.route("/")
def index():
    """Index."""
    response = _serve_react_asset()
    if response is not None:
        return response
    return jsonify(
        {
            "status": "react_build_missing",
            "message": "React build not found. Run `npm run build` inside the frontend/ directory.",
        }
    )


@app.route("/app", defaults={"path": ""})
@app.route("/app/<path:path>")
def serve_react_app(path: str):
    """Serve react app."""
    response = _serve_react_asset(path)
    if response is not None:
        return response
    return (
        jsonify(
            {
                "status": "react_build_missing",
                "message": "React build not found. Run `npm run build` inside the frontend/ directory.",
            }
        ),
        404,
    )


from routes.auth import auth_bp
from routes.expenses import expenses_bp
from routes.charts import charts_bp
from routes.voice import voice_bp

app.register_blueprint(auth_bp)
app.register_blueprint(expenses_bp)
app.register_blueprint(charts_bp)
app.register_blueprint(voice_bp)


if __name__ == "__main__":
    app.run(debug=True)

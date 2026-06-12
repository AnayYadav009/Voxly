"""Main application entry point and API routes."""

import os
import json
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request, send_from_directory, g, make_response
from flask_cors import CORS
from flask_limiter import Limiter

try:
    import redis
except Exception:  # pragma: no cover - optional runtime dependency fallback
    redis = None

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
from extensions import limiter as _limiter
from voice_module import parse_expense
from flasgger import Swagger

limiter: Limiter = _limiter

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SWAGGER"] = {
    "title": "Voxly API Docs",
    "uiversion": 3
}
swagger = Swagger(app)
app.secret_key = os.environ.get("VOXLY_SESSION_SECRET", os.urandom(24))
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)
init_directories()

app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

_purge_done = False
_last_command_fallback: Dict[str, Dict[str, Any]] = {}

_redis_client = None
if redis is not None:
    try:
        _client = redis.Redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
            socket_timeout=1.0,
        )
        _client.ping()
        _redis_client = _client
    except Exception:
        _redis_client = None


limiter.init_app(app)


def _error(message: str, status: int):
    return jsonify(error=message), status


def _get_last_command(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    key = f"voxly:last_command:{user_id}"
    if _redis_client is not None:
        try:
            raw = _redis_client.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            pass
    return _last_command_fallback.get(user_id)


def _set_last_command(user_id: str, cmd: Dict[str, Any]) -> None:
    if not user_id:
        return
    payload = dict(cmd or {})
    key = f"voxly:last_command:{user_id}"
    if _redis_client is not None:
        try:
            _redis_client.setex(key, 3600, json.dumps(payload))
            return
        except Exception:
            pass
    _last_command_fallback[user_id] = payload


@app.errorhandler(413)
def request_entity_too_large(error):
    return _error("Payload too large. Maximum size is 1MB.", 413)


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self';"
    )
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


def _request_needs_database(token: Optional[str]) -> bool:
    """Avoid initializing Turso/libsql for probes, preflights, and anonymous 401s."""
    if request.method == "OPTIONS":
        return False
    if request.path == "/api/health":
        return False
    if token:
        return True
    return request.path in {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
    }


def _unauthorized_response():
    return _error("Authentication required.", 401)


def _require_authenticated_user() -> Optional[Dict[str, Any]]:
    user = getattr(g, "current_user", None)
    if not user:
        return None
    return user


def _user_preferences_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    return {"log_opt_in": bool(user.get("log_opt_in"))}


def _should_log_commands(user: Optional[Dict[str, Any]]) -> bool:
    return COMMAND_LOGGING_ENABLED and bool(user and user.get("log_opt_in"))


def _build_dashboard_context(user_id: Optional[str] = None, fields: Optional[set[str]] = None) -> Dict[str, Any]:
    from services.dashboard import _build_dashboard_context as build_dashboard_context

    return build_dashboard_context(user_id=user_id, fields=fields)


@app.route("/api/health")
def api_health():
    return jsonify({"status": "ok"})


@app.route("/api/expenses/by-category")
def api_expenses_by_category():
    """Get individual expenses and merchant breakdown for a category and date range."""
    user = _require_authenticated_user()
    if not user:
        return _unauthorized_response()

    category = request.args.get("category")
    if not category:
        return jsonify({"error": "category is required."}), 400

    from datetime import datetime, timezone
    from utils.dates import get_local_now
    now = get_local_now()
    default_start = now.replace(day=1).strftime("%Y-%m-%d")
    default_end = now.strftime("%Y-%m-%d")

    start_param = request.args.get("start")
    end_param = request.args.get("end")

    start_date = default_start
    if start_param:
        try:
            datetime.strptime(start_param, "%Y-%m-%d")
            start_date = start_param
        except ValueError:
            pass

    end_date = default_end
    if end_param:
        try:
            datetime.strptime(end_param, "%Y-%m-%d")
            end_date = end_param
        except ValueError:
            pass

    from database import get_expenses_in_category
    from merchant_module import analyze_expenses

    try:
        expenses = get_expenses_in_category(category, start_date, end_date, user_id=user["id"])
        analysis = analyze_expenses(expenses)
    except Exception as exc:
        from logger import log_error
        log_error("Failed to fetch/analyze expenses by category: %s", exc)
        return _error("Internal database error.", 500)

    response = {
        "category": category,
        "period": {"start": start_date, "end": end_date},
        "total": analysis["total"],
        "count": analysis["count"],
        "expenses": expenses,
        "merchant_breakdown": analysis["breakdown"],
        "generated_at": datetime.now(timezone.utc).isoformat()
    }
    return jsonify(response)


@app.before_request
def attach_current_user() -> None:
    """Attach current user."""
    global _purge_done
    g.current_user = None
    g.token_jti = None
    token = _extract_bearer_token()
    if not _request_needs_database(token):
        return
    ensure_schema_once()
    if not _purge_done:
        _purge_done = True
        purge_expired_revocations()
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

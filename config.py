"""Configuration module.

Loads environment variables and sets up project-wide constants,
ensuring security defaults are respected depending on the environment.
"""
import os
import warnings
from dotenv import load_dotenv

load_dotenv()

DB_NAME = os.environ.get("VOXLY_DB_PATH", "expenses.db")
LOG_DIR = os.environ.get("VOXLY_LOG_DIR", "logs")
CHART_DIR = os.path.join("static", "charts")
BUDGETS_FILE = "budgets.json"
REACT_BUILD_DIR = os.path.join("frontend", "build")
REACT_INDEX_FILE = os.path.join(REACT_BUILD_DIR, "index.html")
GROQ_PARSE_MODEL = os.environ.get("VOXLY_GROQ_PARSE_MODEL", "llama-3.1-8b-instant")
GROQ_INSIGHT_MODEL = os.environ.get("VOXLY_GROQ_INSIGHT_MODEL", "llama-3.3-70b-versatile")

# Default percentage of a budget that should trigger a warning
DEFAULT_BUDGET_WARN_THRESHOLD = 0.8

LOG_FILE = os.path.join(LOG_DIR, "app.log")

DATE_FORMAT = "%Y-%m-%d"

# --- Turso (cloud SQLite) — set both in production, leave blank for local dev ---
TURSO_URL   = os.environ.get("TURSO_URL", "")
TURSO_TOKEN = os.environ.get("TURSO_TOKEN", "")
# --- CORS: comma-separated list of allowed frontend origins ---
# Use VOXLY_ALLOWED_ORIGINS (or legacy CORS_ORIGINS) in production.
_ALLOWED_ORIGINS_RAW = (
    os.environ.get("VOXLY_ALLOWED_ORIGINS")
    or os.environ.get("FRONTEND_ORIGIN")
    or os.environ.get("CORS_ORIGINS")
    or "http://localhost:3000"
)
# --- Rate limiting: swap to redis:// in production for distributed deployments ---
RATE_LIMIT_STORAGE_URI = os.environ.get("VOXLY_RATE_LIMIT_STORAGE_URI", "memory://")
_raw_jwt_secret = os.environ.get("VOXLY_JWT_SECRET", "")
_is_dev = os.environ.get("FLASK_ENV", "production") == "development"

if not _raw_jwt_secret:
    if _is_dev:
        _raw_jwt_secret = "dev-secret-change-me"
        warnings.warn(
            "VOXLY_JWT_SECRET is not set. Using an insecure default. "
            "Set this variable before deploying.",
            stacklevel=2,
        )
    else:
        raise RuntimeError(
            "VOXLY_JWT_SECRET environment variable must be set in production. "
            'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"'
        )

JWT_SECRET: str = _raw_jwt_secret
JWT_ALGORITHM = os.environ.get("VOXLY_JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRES_MINUTES = int(os.environ.get("VOXLY_JWT_EXPIRES_MINUTES", "60"))
REFRESH_TOKEN_EXPIRES_DAYS = int(os.environ.get("VOXLY_JWT_REFRESH_DAYS", "7"))

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in _ALLOWED_ORIGINS_RAW.split(",")
    if origin.strip()
]

COMMAND_LOGGING_ENABLED = os.environ.get("VOXLY_COMMAND_LOGGING_ENABLED", "false").lower() in {"1", "true", "yes"}

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_ENABLED = bool(GROQ_API_KEY)

def init_directories() -> None:
    """Create required runtime directories. Call once at application startup."""
    os.makedirs(LOG_DIR, exist_ok=True)
    os.makedirs(CHART_DIR, exist_ok=True)
    if JWT_SECRET == "dev-secret-change-me":
        warnings.warn(
            "VOXLY_JWT_SECRET is set to the default development value. "
            "Set the VOXLY_JWT_SECRET environment variable before deploying.",
            stacklevel=2,
        )


"""Configuration module.

Loads environment variables and sets up project-wide constants,
ensuring security defaults are respected depending on the environment.
"""
import os
from dotenv import load_dotenv

load_dotenv()

DB_NAME = "expenses.db"
LOG_DIR = "logs"
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

_JWT_SECRET_DEFAULT = "dev-secret-change-me"
JWT_SECRET = os.environ.get("VOXLY_JWT_SECRET", _JWT_SECRET_DEFAULT)
JWT_ALGORITHM = os.environ.get("VOXLY_JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRES_MINUTES = int(os.environ.get("VOXLY_JWT_EXPIRES_MINUTES", "60"))
REFRESH_TOKEN_EXPIRES_DAYS = int(os.environ.get("VOXLY_JWT_REFRESH_DAYS", "7"))

_env = os.environ.get("FLASK_ENV", "production")
if JWT_SECRET == _JWT_SECRET_DEFAULT and _env not in {"development", "testing"}:
    raise RuntimeError(
        "VOXLY_JWT_SECRET is not set. Set a strong random secret before "
        "starting the server in production."
    )

COMMAND_LOGGING_ENABLED = os.environ.get("VOXLY_COMMAND_LOGGING_ENABLED", "false").lower() in {"1", "true", "yes"}

# Groq NLP backend (free tier: 14,400 req/day)
GROQ_API_KEY = os.environ.get("VOXLY_GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("VOXLY_GROQ_MODEL", "llama3-8b-8192")
GROQ_ENABLED = bool(GROQ_API_KEY)

def ensure_dirs():
    """Ensure required directories exist."""
    os.makedirs(LOG_DIR, exist_ok=True)
    os.makedirs(CHART_DIR, exist_ok=True)



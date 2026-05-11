import os
import warnings
from datetime import datetime

DB_NAME = "expenses.db"
LOG_DIR = "logs"
CHART_DIR = os.path.join("static", "charts")
BUDGETS_FILE = "budgets.json"
REACT_BUILD_DIR = os.path.join("frontend", "build")
REACT_INDEX_FILE = os.path.join(REACT_BUILD_DIR, "index.html")

# Default percentage of a budget that should trigger a warning
DEFAULT_BUDGET_WARN_THRESHOLD = 0.8

LOG_FILE = os.path.join(LOG_DIR, "app.log")

DATE_FORMAT = "%Y-%m-%d"

_DEFAULT_JWT_SECRET = "dev-secret-change-me"
JWT_SECRET = os.environ.get("VOXLY_JWT_SECRET", _DEFAULT_JWT_SECRET)
JWT_ALGORITHM = os.environ.get("VOXLY_JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRES_MINUTES = int(os.environ.get("VOXLY_JWT_EXPIRES_MINUTES", "60"))
REFRESH_TOKEN_EXPIRES_DAYS = int(os.environ.get("VOXLY_JWT_REFRESH_DAYS", "7"))

_ENV_MODE = os.environ.get("FLASK_ENV", os.environ.get("VOXLY_ENV", "development")).lower()
if JWT_SECRET == _DEFAULT_JWT_SECRET:
    if _ENV_MODE == "production":
        raise RuntimeError(
            "SECURITY: VOXLY_JWT_SECRET is not set. "
            "Refusing to start in production with the default secret. "
            "Set the VOXLY_JWT_SECRET environment variable to a strong random string."
        )
    warnings.warn(
        "VOXLY_JWT_SECRET is using the default dev value. "
        "Set a strong secret before deploying to production.",
        stacklevel=1,
    )
COMMAND_LOGGING_ENABLED = os.environ.get("VOXLY_COMMAND_LOGGING_ENABLED", "false").lower() in {"1", "true", "yes"}

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(CHART_DIR, exist_ok=True)

def timestamp():
    """Return current timestamp string."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

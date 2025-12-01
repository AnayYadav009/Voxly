import os
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

JWT_SECRET = os.environ.get("VOXLY_JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = os.environ.get("VOXLY_JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRES_MINUTES = int(os.environ.get("VOXLY_JWT_EXPIRES_MINUTES", "60"))
REFRESH_TOKEN_EXPIRES_DAYS = int(os.environ.get("VOXLY_JWT_REFRESH_DAYS", "7"))
COMMAND_LOGGING_ENABLED = os.environ.get("VOXLY_COMMAND_LOGGING_ENABLED", "false").lower() in {"1", "true", "yes"}

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(CHART_DIR, exist_ok=True)

def timestamp():
    """Return current timestamp string."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

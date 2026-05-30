"""Flask extensions shared across the application."""

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import RATE_LIMIT_STORAGE_URI

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri=RATE_LIMIT_STORAGE_URI,
)

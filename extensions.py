"""Flask extensions shared across the application."""

import redis
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import RATE_LIMIT_STORAGE_URI, REDIS_URL

redis_client = None
if REDIS_URL and (REDIS_URL.startswith("redis://") or REDIS_URL.startswith("rediss://")):
    try:
        _client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=1.0)
        _client.ping()
        redis_client = _client
    except Exception:
        redis_client = None

storage_uri = RATE_LIMIT_STORAGE_URI
if redis_client is None and storage_uri.startswith("redis"):
    storage_uri = "memory://"

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri=storage_uri,
)


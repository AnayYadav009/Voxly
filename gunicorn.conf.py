"""Gunicorn configuration for Voxly production deployment.

Key decisions:
- worker_class = "gevent": async I/O workers that don't block on network calls.
  Each worker can handle hundreds of concurrent connections while waiting on
  SQLite or external APIs, instead of one at a time (sync default).
- workers = 2: safe for Render's starter tier (512 MB RAM). Raise to 3-4 on
  the standard tier (2 GB RAM). Formula: 2 × CPU cores + 1.
- worker_connections = 100: max simultaneous connections per gevent worker.
- timeout = 30: voice command NLP can take a moment; 30 s is safe headroom.
- preload_app = True: imports app (including spaCy model) once in the master
  process, then forks workers. Workers inherit the loaded model via copy-on-
  write, so each worker does NOT pay the spaCy startup cost independently.
"""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
worker_class = "gevent"
worker_connections = 100
timeout = 30
keepalive = 5
preload_app = True
accesslog = "-"       # log to stdout so Render captures it
errorlog = "-"
loglevel = "info"

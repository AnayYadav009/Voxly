"""Gunicorn configuration for Voxly production deployment.

Key decisions:
- worker_class = "gthread": native threaded workers fully compatible with Python 3.13+.
- workers = 2, threads = 4: safe for Render's tier, handles concurrent requests smoothly.
- timeout = 30: voice command NLP and database queries headroom.
- preload_app = True: imports app once in master process before forking workers.
"""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
worker_class = "gthread"
threads = 4
timeout = 30
keepalive = 5
preload_app = True
accesslog = "-"       # log to stdout so Render captures it
errorlog = "-"
loglevel = "info"

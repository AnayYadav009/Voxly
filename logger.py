"""Logging configuration module.

Provides a unified logger with both file and console handlers, ensuring UTF-8
encoding is strictly followed for terminal output.
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from typing import Any
from config import LOG_FILE, LOG_DIR


class Utf8StreamHandler(logging.StreamHandler):
    """A stream handler that falls back to encoding replacement on Unicode errors."""
    
    def emit(self, record: logging.LogRecord) -> None:
        """Emit a log record, handling encoding errors safely."""
        try:
            msg = self.format(record)
            stream = self.stream
            stream.write(msg + self.terminator)
            self.flush()
        except UnicodeEncodeError:
            msg = msg.encode("utf-8", errors="replace").decode("utf-8")
            stream = self.stream
            stream.write(msg + self.terminator)
            self.flush()


logger = logging.getLogger("voice_finance_tracker")
logger.setLevel(logging.INFO)

formatter = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Ensure log dir exists
os.makedirs(LOG_DIR, exist_ok=True)

# Use a rotating file handler to keep logs manageable
file_handler = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
file_handler.setFormatter(formatter)

stream_handler = Utf8StreamHandler()
stream_handler.setFormatter(formatter)

# avoid duplicate handlers on reload
if not logger.handlers:
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)


def log_info(message: str, *args: Any, **kwargs: Any) -> None:
    """Log an informational message.
    
    Args:
        message: The log message.
        *args: Positional arguments for message formatting.
        **kwargs: Keyword arguments passed to the logger.

    """
    logger.info(message, *args, **kwargs)


def log_error(message: str, *args: Any, **kwargs: Any) -> None:
    """Log an error message.
    
    Args:
        message: The log message.
        *args: Positional arguments for message formatting.
        **kwargs: Keyword arguments passed to the logger.

    """
    logger.error(message, *args, **kwargs)

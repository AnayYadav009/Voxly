"""Expense parsing helpers — pure NLP, no audio/TTS dependencies.

This module is the canonical import point for the expense-parsing logic that
was previously split across ``voice_module`` and ``voice_nlp``.  Both legacy
import paths continue to work; this file adds the new, clean one.

Usage::

    from expense_parser import parse_expense
"""

from __future__ import annotations

from voice_nlp import parse_expense  # re-export

__all__ = ["parse_expense"]

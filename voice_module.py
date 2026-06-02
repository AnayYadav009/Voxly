from __future__ import annotations

import json
import os
import random
import tempfile
import time
from typing import Any, Dict, Optional

from config import GROQ_API_KEY, GROQ_MODEL
from voice_nlp import parse_expense

_cli_state: Dict[str, Any] = {"engine": None, "recognizer": None}
last_transcript: Optional[str] = None



# ── Speech synthesis ──────────────────────────────────────────────────────────

_TONE_RESPONSES: Dict[str, list] = {
    "success": ["Done.", "Got it.", "All set.", "Expense recorded."],
    "info":    ["Okay.", "Here you go.", "Let me tell you."],
    "error":   ["Sorry, that failed.", "Hmm, something went wrong.", "I could not do that."],
    "summary": ["Here is the summary.", "Let me summarize."],
    "neutral": [""],
}


def _get_engine():
    if _cli_state["engine"] is not None:
        return _cli_state["engine"]
    try:
        import pyttsx3
        engine = pyttsx3.init()
        voices = engine.getProperty("voices")
        for voice in voices:
            if "zira" in getattr(voice, "name", "").lower() or "female" in getattr(voice, "name", "").lower():
                engine.setProperty("voice", voice.id)
                break
        engine.setProperty("rate", 170)
        engine.setProperty("volume", 1.0)
        _cli_state["engine"] = engine
    except Exception:
        _cli_state["engine"] = None
    return _cli_state["engine"]


# CLI only - not used by Flask
def speak(text: str, tone: str = "neutral") -> None:
    if not text:
        return
    prefix = random.choice(_TONE_RESPONSES.get(tone, [""]))
    utterance = f"{prefix} {text}" if prefix else text
    engine = _get_engine()
    if engine:
        try:
            engine.say(utterance)
            engine.runAndWait()
        except Exception:
            print(utterance)
    else:
        print(utterance)
    if len(utterance.split()) > 12:
        time.sleep(0.4)


# CLI only - not used by Flask
def respond(action: str, message: str) -> None:
    tone_map = {
        "add":     "success",
        "balance": "info",
        "recent":  "info",
        "weekly":  "summary",
        "monthly": "summary",
        "delete":  "success",
        "error":   "error",
        "help":    "neutral",
        "repeat":  "info",
    }
    speak(message, tone=tone_map.get(action, "neutral"))


# ── Microphone input ──────────────────────────────────────────────────────────

def _get_recognizer():
    if _cli_state["recognizer"] is not None:
        return _cli_state["recognizer"]
    try:
        import speech_recognition as sr
        _cli_state["recognizer"] = sr.Recognizer()
    except Exception:
        _cli_state["recognizer"] = None
    return _cli_state["recognizer"]


def _record_audio(duration: float, fs: int):
    import numpy as np
    import sounddevice as sd
    recording = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype="int16")
    sd.wait()
    recording = np.asarray(recording)
    if recording.ndim > 1:
        recording = recording.squeeze(axis=1)
    return recording.astype("int16")


# CLI only - not used by Flask
def get_voice_input(
    duration: float = 5.0,
    fs: int = 44100,
    language: str = "en-IN",
    retries: int = 1,
) -> str:
    global last_transcript
    attempt = 0
    while attempt <= retries:
        attempt += 1
        tmp_filename = None
        try:
            print(f"Recording for {duration} seconds…")
            recording = _record_audio(duration, fs)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_filename = tmp.name
            from scipy.io.wavfile import write
            write(tmp_filename, fs, recording)
            recognizer = _get_recognizer()
            if not recognizer:
                speak("Voice recognition unsupported in this environment.", tone="error")
                return ""
            import speech_recognition as sr
            with sr.AudioFile(tmp_filename) as source:
                audio = recognizer.record(source)
            transcript = recognizer.recognize_google(audio, language=language).strip()
            print("Heard:", transcript)
            last_transcript = transcript
            return transcript.lower()
        except Exception as exc:
            name = exc.__class__.__name__
            if name == "UnknownValueError":
                speak("Sorry, I did not catch that.", tone="error")
                continue
            if name == "RequestError":
                speak("Speech service unavailable.", tone="error")
                break
            if name == "PortAudioError":
                speak("Microphone error. Please check the device.", tone="error")
                break
            speak("I hit an unexpected problem.", tone="error")
        finally:
            if tmp_filename and os.path.exists(tmp_filename):
                try:
                    os.remove(tmp_filename)
                except OSError:
                    pass
    return ""


# CLI only - not used by Flask
def repeat_last_transcript() -> Optional[str]:
    return last_transcript


# CLI only - not used by Flask
def confirm_amount_flow(
    prompt_text: str = "Please say the amount now.",
    retries: int = 2,
) -> Optional[float]:
    speak(prompt_text)
    for _ in range(retries):
        follow_up = get_voice_input(duration=4)
        info = parse_expense(follow_up)
        amount = info.get("amount")
        if info.get("action") == "add" and amount is not None:
            return float(amount)
        try:
            return float(follow_up)
        except (TypeError, ValueError):
            speak("I still did not hear a number. Try again.", tone="error")
    return None


def _detect_action(text: str) -> str:
    return parse_expense(text).get("action", "unknown")


def _extract_amount(text: str) -> Optional[float]:
    amount = parse_expense(text).get("amount")
    try:
        return float(amount) if amount is not None else None
    except (TypeError, ValueError):
        return None


def _extract_category_and_description(text: str) -> tuple[Optional[str], Optional[str]]:
    parsed = parse_expense(text)
    return parsed.get("category"), parsed.get("description")

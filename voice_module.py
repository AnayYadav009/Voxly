"""Voice input and NLP command processing module."""

import os
import random
import re
import tempfile
import time
from typing import Any, Dict, Optional, Set

try:
    import dateparser
    from dateparser.search import search_dates  # type: ignore
    _HAS_DATEPARSER = True
except Exception:
    dateparser = None  # type: ignore
    def search_dates(*args, **kwargs):  # fallback stub
        """Search dates."""
        return None
    _HAS_DATEPARSER = False
from word2number import w2n
import nlp_engine

import threading

_engine = None
_tts_lock = threading.Lock()
_recognizer = None

def _get_engine():
    global _engine
    with _tts_lock:
        if _engine is not None:
            return _engine
        try:
            import pyttsx3

            _engine = pyttsx3.init()
            voices = _engine.getProperty("voices")
            for voice in voices:
                name = getattr(voice, "name", "").lower()
                if "zira" in name or "female" in name:
                    _engine.setProperty("voice", voice.id)
                    break
            _engine.setProperty("rate", 170)
            _engine.setProperty("volume", 1.0)
        except Exception:
            _engine = None
    return _engine

def _get_recognizer():
    global _recognizer
    if _recognizer is not None:
        return _recognizer
    try:
        import speech_recognition as sr
        _recognizer = sr.Recognizer()
    except Exception:
        _recognizer = None
    return _recognizer

def _preprocess(text: str) -> str:
    """Normalize text and fix tokenization for currency."""
    text = text.strip().lower()
    # Insert space between currency symbol and digits: ₹500 -> ₹ 500
    text = re.sub(r'([₹$€£])(\d)', r'\1 \2', text)
    # Remove commas inside numbers
    text = re.sub(r'(\d),(\d)', r'\1\2', text)
    return text

def _extract_amount(doc) -> Optional[float]:
    """Extract numeric amount from doc via NER and fallbacks."""
    # 1. NER check
    for ent in doc.ents:
        if ent.label_ in {"MONEY", "CARDINAL"}:
            try:
                # Strip currency symbols and whitespace
                cleaned = re.sub(r'[₹$€£\s]', '', ent.text)
                val = float(cleaned)
                if val > 0:
                    return val
            except ValueError:
                continue
    
    # 2. Token-level fallback
    for token in doc:
        if token.like_num or (token.text.replace('.', '', 1).isdigit()):
            try:
                val = float(token.text)
                if val > 0:
                    return val
            except ValueError:
                continue
                
    # 3. word2number fallback
    num_words = []
    for token in doc:
        # Simple heuristic for number words
        if token.lower_ in {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", 
                           "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
                           "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "lakh", "million"}:
            num_words.append(token.lower_)
        elif num_words:
            # Try to convert collected sequence
            try:
                val = float(w2n.word_to_num(" ".join(num_words)))
                if val > 0:
                    return val
            except ValueError:
                pass
            num_words = []
    
    if num_words:
        try:
            val = float(w2n.word_to_num(" ".join(num_words)))
            if val > 0:
                return val
        except ValueError:
            pass
            
    return None

def _extract_category(doc) -> str:
    """Match canonical category from doc."""
    # Words that are both category synonyms and action verbs — skip them
    _ACTION_WORDS = {"show", "buy", "purchase", "bought", "record", "log", "book", "pay", "paid", "spend", "spent", "note"}
    nlp = nlp_engine.get_nlp()
    matcher = nlp_engine.get_category_matcher(nlp)
    matches = matcher(doc)
    for match_id, start, end in matches:
        matched_text = doc[start:end].text.lower()
        if matched_text in _ACTION_WORDS:
            continue
        return nlp.vocab.strings[match_id]
    return "uncategorized"

def _extract_description(doc, category: str, amount_tokens: Set[int]) -> Optional[str]:
    """Build description by filtering tokens."""
    cat_synonyms = nlp_engine.CATEGORY_SYNONYMS.get(category, set()) | {category}
    
    desc_parts = []
    for token in doc:
        if token.i in amount_tokens:
            continue
        if token.is_stop or token.is_punct:
            continue
        if token.lower_ in cat_synonyms:
            continue
        # Also check lemmas for category synonyms
        if token.lemma_ in cat_synonyms:
            continue
        desc_parts.append(token.text)
        
    res = " ".join(desc_parts).strip()
    return res if res else None

def _extract_warn_ratio(doc) -> Optional[float]:
    """Extract budget warning ratio."""
    for ent in doc.ents:
        if ent.label_ == "PERCENT":
            # Check window before
            start_idx = max(0, ent.start - 5)
            window = doc[start_idx : ent.start]
            if any(t.lemma_ in {"warn", "alert", "notify", "remind"} for t in window):
                try:
                    val_str = ent.text.replace('%', '').replace('percent', '').strip()
                    val = float(val_str)
                    if val > 1:
                        val = val / 100.0
                    return max(0.0, min(val, 1.0))
                except ValueError:
                    continue
    return None

def _extract_date(text: str) -> Optional[str]:
    """Keep using dateparser for dates."""
    if not _HAS_DATEPARSER:
        return None
    
    settings = {
        "PREFER_DATES_FROM": "past",
        "RETURN_AS_TIMEZONE_AWARE": False,
        "DATE_ORDER": "DMY",
    }
    
    # Try search_dates first
    results = search_dates(text, settings=settings)
    if results:
        # Take the first parsed date
        return results[0][1].date().isoformat()
    
    # Try direct parse
    parsed = dateparser.parse(text, settings=settings)
    if parsed:
        return parsed.date().isoformat()
    
    return None

def _detect_action(doc) -> Optional[str]:
    """Detect command action using Matcher."""
    nlp = nlp_engine.get_nlp()
    matcher = nlp_engine.get_action_matcher(nlp)
    matches = matcher(doc)
    if matches:
        # Respect priority order from ACTION_PRIORITY
        found_actions = {nlp.vocab.strings[m_id] for m_id, start, end in matches}
        for candidate in nlp_engine.ACTION_PRIORITY:
            if candidate in found_actions:
                return candidate
    return None

_TONE_RESPONSES = {
    "success": [
        "Done.","Got it.","All set.","Expense recorded.",
    ],
    "info": [
        "Okay.","Here you go.","Let me tell you.",
    ],
    "error": [
        "Sorry, that failed.","Hmm, something went wrong.","I could not do that.",
    ],
    "summary": [
        "Here is the summary.","Let me summarize.",
    ],
    "neutral": [""],
}

last_transcript: Optional[str] = None

def speak(text: str, tone: str = "neutral") -> None:
    """Speak."""
    if not text:
        return
    tone = tone or "neutral"
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

def respond(action: str, message: str) -> None:
    """Respond."""
    tone_map = {
        "add": "success",
        "balance": "info",
        "recent": "info",
        "weekly": "summary",
        "monthly": "summary",
        "delete": "success",
        "error": "error",
        "help": "neutral",
        "repeat": "info",
    }
    speak(message, tone=tone_map.get(action, "neutral"))

def _record_audio(duration: float, fs: int) -> Any:
    import sounddevice as sd
    import numpy as np

    recording = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype="int16")
    sd.wait()
    recording = np.asarray(recording)
    if recording.ndim > 1:
        recording = recording.squeeze(axis=1)
    return recording.astype(np.int16)

def get_voice_input(
    duration: float = 5.0,
    fs: int = 44100,
    language: str = "en-IN",
    retries: int = 1,
) -> str:
    """Get voice input."""
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

            transcript = recognizer.recognize_google(audio, language=language)
            transcript = transcript.strip()
            print("Heard:", transcript)
            last_transcript = transcript
            return transcript.lower()
        except Exception as exc:
            name = exc.__class__.__name__ if exc else ""
            if name == "UnknownValueError":
                speak("Sorry, I did not catch that.", tone="error")
                continue
            if name == "RequestError":
                speak("Speech service unavailable.", tone="error")
                print("Speech service error:", exc)
                break
            if name == "PortAudioError":
                speak("Microphone error. Please check the device.", tone="error")
                print("Microphone error:", exc)
                break
            else:
                speak("I hit an unexpected problem.", tone="error")
                print("Voice input error:", exc)
        finally:
            if tmp_filename and os.path.exists(tmp_filename):
                try:
                    os.remove(tmp_filename)
                except OSError:
                    pass
    return ""

def parse_expense(text: str) -> Dict[str, Any]:
    """Parse expense."""
    if not text or not text.strip():
        return {"action": "none"}
    
    preprocessed = _preprocess(text)
    nlp = nlp_engine.get_nlp()
    doc = nlp(preprocessed)
    
    action = _detect_action(doc)
    
    if action is None:
        # check if there's an amount or category as implicit "add"
        amount = _extract_amount(doc)
        category = _extract_category(doc)
        if amount is not None or category != "uncategorized":
            action = "add"
        else:
            return {"action": "unknown", "raw": preprocessed}
    
    if action == "add":
        amount = _extract_amount(doc)
        category = _extract_category(doc)
        # find amount span for description extraction
        amount_tokens = {token.i for token in doc if token.like_num or token.is_currency}
        description = _extract_description(doc, category, amount_tokens)
        date = _extract_date(text)  # use original text for date parsing
        return {"action": "add", "amount": amount, "category": category, "date": date, "description": description}
    
    if action == "set_budget":
        amount = _extract_amount(doc)
        category = _extract_category(doc)
        warn_ratio = _extract_warn_ratio(doc)
        return {"action": "set_budget", "amount": amount, "category": None if category == "uncategorized" else category, "warn_ratio": warn_ratio}
    
    if action == "show_budgets":
        category = _extract_category(doc)
        return {"action": "show_budgets", "category": None if category == "uncategorized" else category}
    
    if action == "remove_budget":
        category = _extract_category(doc)
        return {"action": "remove_budget", "category": None if category == "uncategorized" else category}
    
    if action == "chart_summary":
        return {"action": "chart_summary"}
    
    return {"action": action}

def confirm_amount_flow(
    prompt_text: str = "Please say the amount now.",
    retries: int = 2,
) -> Optional[float]:
    """Confirm amount flow."""
    speak(prompt_text)
    for _ in range(retries):
        follow_up = get_voice_input(duration=4)
        info = parse_expense(follow_up)
        amount = info.get("amount")
        if info.get("action") == "add" and amount is not None:
            return amount
        potential = info.get("raw") if info.get("raw") else follow_up
        try:
            return float(potential)
        except (TypeError, ValueError):
            speak("I still did not hear a number. Try again.", tone="error")
    return None

def repeat_last_transcript() -> Optional[str]:
    """Repeat last transcript."""
    return last_transcript

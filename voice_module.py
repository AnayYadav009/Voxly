"""Database and schema management module."""

import os
import random
import re
import tempfile
import time
from datetime import datetime
from typing import Any, Dict, Optional

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

_engine = None
_recognizer = None

def _get_engine():
    global _engine
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

_AMOUNT_CONTEXT_WORDS = {
    "add","added","adding",
    "amount","cost","expense",
    "log","logged","logging",
    "pay","paid","paying",
    "purchase","purchased",
    "record","recorded","recording",
    "set","spend","spending","spent",
    "to","for","on","under",
}

_CURRENCY_WORDS = {
    "₹","rs","rs.","rupee","rupees","inr",
    "$","usd","dollar","dollars","bucks",
    "€","euro","euros","£","pound","pounds",
}

_NUMBER_WORD_TOKENS = {
    "zero","one","two","three","four","five",
    "six","seven","eight","nine","ten",
    "eleven","twelve","thirteen","fourteen","fifteen",
    "sixteen","seventeen","eighteen","nineteen","twenty",
    "thirty","forty","fifty","sixty","seventy","eighty","ninety","hundred",
    "thousand","lakh","lakhs","million","billion","trillion",
    "point","and","minus","negative",
}

_AMOUNT_PATTERN = re.compile(
    r"(?:₹|rs\.?|rupees?|inr|usd|dollars?|bucks|euros?|pounds?|[$€£])?\s*(-?\d+(?:[,\s]\d{3})*(?:\.\d+)?)",
)

_CATEGORY_SYNONYMS = {
    "food": {
        "food","meal","meals",
        "lunch","dinner","breakfast",
        "snack","snacks",
        "restaurant","restaurants",
        "groceries","grocery",
        "coffee","tea",
        "drink","drinks",
    },
    "transport": {
        "transport","travel",
        "taxi","cab","uber","ola",
        "bus","train","metro","ride","rides",
        "petrol","diesel","fuel","gas","commute",
    },
    "entertainment": {
        "entertainment","movie","movies",
        "netflix","prime","hotstar","ott",
        "show","shows","concert",
        "gaming","game","games","fun",
    },
    "shopping": {
        "shopping","amazon","mall","purchase","purchases",
        "bought","buy","buying","retail","clothes","clothing","apparel",
    },
    "utilities": {
        "utility","utilities",
        "electricity","power","water","gas",
        "internet","wifi","broadband",
        "phone","mobile","recharge","bill","bills",
    },
    "health": {
        "health","doctor","hospital",
        "medical","medicine","medicines",
        "pharmacy","clinic","fitness","gym",
    },
    "education": {
        "education","study","studies",
        "course","courses","tuition",
        "class","classes","training","book","books",
    },
    "rent": {
        "rent","renting","lease",
        "housing","house","apartment","flat",
    },
    "savings": {
        "savings","investment","invest","investing",
        "mutual fund","fixed deposit","fd","rd","sip",
    },
    "personal": {
        "personal","care","salon",
        "beauty","spa","grooming",
    },
    "gifts": {
        "gift","gifts","present","presents",
    },
    "charity": {
        "charity","donation","donations",
    },
    "insurance": {
        "insurance","premium","policy",
    },
    "fees": {
        "fee","fees","subscription","subscriptions",
    },
}

_CATEGORY_KEYWORDS = []
for _canonical, _synonyms in _CATEGORY_SYNONYMS.items():
    terms = {_canonical, *_synonyms}
    for term in terms:
        normalized_term = term.lower().strip()
        if normalized_term:
            _CATEGORY_KEYWORDS.append((normalized_term, _canonical))

_CATEGORY_KEYWORDS.sort(key=lambda item: -len(item[0]))

_CATEGORY_TERMS = {
    canonical: {term.lower() for term in terms | {canonical}}
    for canonical, terms in _CATEGORY_SYNONYMS.items()
}

_CATEGORY_PHRASE_PATTERN = re.compile(
    r"(?:\bto\b|\bon\b|\bfor\b|\bunder\b)\s+([a-z0-9 '&/-]+)",
)

_DATE_KEYWORDS = {
    "today","yesterday","tomorrow","tonight","tonite","yday",
}

_WEEKDAY_KEYWORDS = {
    "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
}

_MONTH_KEYWORDS = {
    "january","february","march","april","may","june",
    "july","august","september","october","november","december",
    "jan","feb","mar","apr","jun","jul","aug","sep","sept","oct","nov","dec",
}

_RELATIVE_DATE_PHRASES = {
    "last week","last month","next week","next month",
    "this week","this month","last night","last evening",
}

_NUMERIC_DATE_PATTERN = re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b")
_ORDINAL_DATE_PATTERN = re.compile(r"\b\d{1,2}(?:st|nd|rd|th)\b")

_ALL_DATE_TOKENS = (
    _DATE_KEYWORDS
    | _WEEKDAY_KEYWORDS
    | _MONTH_KEYWORDS
    | {word for phrase in _RELATIVE_DATE_PHRASES for word in phrase.split()}
)

_ACTION_PATTERNS = {
    "exit": [r"\b(?:stop|exit|quit|close|shut down|goodbye|bye)\b"],
    "help": [r"\bhelp\b", r"what can you do", r"list commands"],
    "repeat": [r"\brepeat\b", r"say (?:that )?again", r"last command"],
    "delete": [
        r"\b(?:delete|remove|undo|erase|cancel)(?:\s+(?:last\s+)?.*?(?:expense|entry|transaction))?\b",
        r"\bcancel last expense\b",
        r"\b(delete|remove|undo)\b",
    ],
    "recent": [
        r"\brecent\b.*\b(expense|expenses|entries|transactions)\b",
        r"\bshow (?:me )?(?:the )?(?:last|recent)\b",
        r"\blast\b.*\b(expense|entry)\b",
        r"\bexpense history\b",
        r"\brecent\b",
    ],
    "weekly": [
        r"\bweekly\b.*\b(summary|report|breakdown|spend|spending|expenses|stats)\b",
        r"\bthis week'?s?\b.*\b(summary|report|spending|expenses|stats)\b",
        r"\bweek(?:ly)? summary\b",
        r"\bweekly\b",
    ],
    "monthly": [
        r"\bmonthly\b.*\b(summary|report|breakdown|spend|spending|expenses|stats)\b",
        r"\bthis month'?s?\b.*\b(summary|report|spending|expenses|stats)\b",
        r"\bmonth(?:ly)? summary\b",
        r"\bmonthly\b",
    ],
    "balance": [
        r"\bbalance\b",
        r"total\s+(?:spent|spend)(?:\s+today)?",
        r"how much (?:have|did) i\s+(?:spend|spent)",
        r"\bspending\s+(?:today|so far)\b",
        r"\bexpense total\b",
        r"\btoday'?s? total\b",
    ],
}

_SET_BUDGET_PATTERNS = [
    r"\bset\b.*\bbudget\b",
    r"\bset a budget\b",
    r"\bbudget for\b.*\bset\b",
]

_SHOW_BUDGETS_PATTERNS = [
    r"\b(show|what(?:'s| is)|list)\b.*\bbudgets?\b",
    r"\bbudget status\b",
    r"\bshow my budgets\b",
    r"\bwhat'?s my budget\b",
    r"\bhow much\b.*\b(?:left|remaining)\b.*\bbudget\b",
    r"\bremaining\b.*\bbudget\b",
]

_REMOVE_BUDGET_PATTERNS = [
    r"\b(remove|delete|clear|cancel)\b.*\bbudget\b",
    r"\bbudget\b.*\b(remove|delete|clear|cancel)\b",
    r"\bno more\b.*\bbudget\b",
]

_CHART_SUMMARY_PATTERNS = [
    r"\bchart(?:s)?\b.*\b(?:summary|recap|overview|breakdown)\b",
    r"\b(?:graph|graphs|visuals?)\b.*\b(?:summary|recap)\b",
    r"\bchart recap\b",
    r"\bshow\b.*\bcharts\b",
]

_WARN_TRIGGER_PATTERN = re.compile(r"(warn|alert|notify|remind)[^.,;]*")
_WARN_PERCENT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:percent|%)")

def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())

def _has_amount_context(fragment: str, include_connectors: bool = True) -> bool:
    tokens = re.findall(r"[a-z₹$€£]+", fragment.lower())
    context_words = _AMOUNT_CONTEXT_WORDS if include_connectors else _AMOUNT_CONTEXT_WORDS - {
        "to","for","on","under",
    }
    if any(word in context_words for word in tokens):
        return True
    if any(token in _CURRENCY_WORDS for token in tokens):
        return True
    if any(symbol in fragment for symbol in {"₹", "$", "€", "£"}):
        return True
    return False

def _extract_numeric_amount(text: str) -> Optional[float]:
    for match in _AMOUNT_PATTERN.finditer(text):
        start, end = match.span()
        matched_text = match.group(0)
        numeric_part = match.group(1)
        if not numeric_part:
            continue
        context = text[max(0, start - 12) : min(len(text), end + 12)]
        has_currency = any(token in _CURRENCY_WORDS for token in re.findall(r"[a-z₹$€£]+", matched_text.lower()))
        if not has_currency and not _has_amount_context(context):
            continue
        try:
            cleaned = numeric_part.replace(",", "").replace(" ", "")
            value = float(cleaned)
        except ValueError:
            continue
        return int(value) if value.is_integer() else value

    for match in re.finditer(r"-?\d+(?:\.\d+)?", text):
        start, end = match.span()
        context = text[max(0, start - 10) : min(len(text), end + 10)]
        if not _has_amount_context(context):
            continue
        try:
            value = float(match.group(0).replace(",", ""))
        except ValueError:
            continue
        return int(value) if value.is_integer() else value
    return None


def _extract_word_amount(text: str) -> Optional[float]:
    tokens = re.findall(r"[a-z]+", text.lower())
    if not tokens:
        return None
    max_span = 7
    for index, token in enumerate(tokens):
        if token not in _NUMBER_WORD_TOKENS:
            continue
        phrase_tokens = []
        for inner in range(index, min(len(tokens), index + max_span)):
            candidate = tokens[inner]
            if candidate not in _NUMBER_WORD_TOKENS:
                break
            phrase_tokens.append(candidate)
        if not phrase_tokens:
            continue
        phrase = " ".join(phrase_tokens)
        try:
            value = float(w2n.word_to_num(phrase))
        except ValueError:
            continue
        prev_token = tokens[index - 1] if index > 0 else ""
        next_index = index + len(phrase_tokens)
        next_token = tokens[next_index] if next_index < len(tokens) else ""
        if _has_amount_context(prev_token, include_connectors=False) or _has_amount_context(
            next_token, include_connectors=False
        ):
            return int(value) if value.is_integer() else value
        context_slice = re.search(r"\b" + re.escape(phrase) + r"\b", text.lower())
        if context_slice:
            start, end = context_slice.span()
            context = text[max(0, start - 10) : min(len(text), end + 10)]
            if _has_amount_context(context, include_connectors=False):
                return int(value) if value.is_integer() else value
    return None

def _extract_amount(text: str) -> Optional[float]:
    numeric = _extract_numeric_amount(text)
    if numeric is not None:
        return numeric
    return _extract_word_amount(text)

def _extract_warn_ratio(text: str) -> Optional[float]:
    lowered = text.lower()
    trigger = _WARN_TRIGGER_PATTERN.search(lowered)
    if trigger:
        search_space = lowered[trigger.start() :]
    else:
        search_space = lowered
    match = _WARN_PERCENT_PATTERN.search(search_space)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except ValueError:
        return None
    if value > 1:
        value = value / 100.0
    value = max(0.0, min(value, 1.0))
    return value

def _category_from_text(fragment: str) -> Optional[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", fragment.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None
    padded = f" {cleaned} "
    for synonym, canonical in _CATEGORY_KEYWORDS:
        if f" {synonym} " in padded:
            return canonical
    return None

def _strip_known_terms(phrase: str, category: str) -> Optional[str]:
    cleaned = phrase
    for term in _CATEGORY_TERMS.get(category, set()):
        cleaned = re.sub(
            r"\b" + re.escape(term) + r"\b",
            " ",
            cleaned,
            flags=re.IGNORECASE,
        )
    for keyword in _ALL_DATE_TOKENS:
        cleaned = re.sub(
            r"\b" + re.escape(keyword) + r"\b",
            " ",
            cleaned,
            flags=re.IGNORECASE,
        )
    cleaned = re.sub(r"[^A-Za-z0-9\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or None

def _extract_category_and_description(text: str, original_text: str) -> tuple[str, Optional[str]]:
    for match in _CATEGORY_PHRASE_PATTERN.finditer(text):
        phrase_lower = match.group(1).strip()
        category = _category_from_text(phrase_lower)
        if category:
            original_slice = original_text[match.start(1) : match.end(1)]
            description = _strip_known_terms(original_slice, category)
            return category, description
    category = _category_from_text(text)
    if category:
        return category, None
    return "uncategorized", None

def _contains_date_signal(text: str) -> bool:
    lowered = text.lower()
    if any(keyword in lowered for keyword in _DATE_KEYWORDS):
        return True
    if any(phrase in lowered for phrase in _RELATIVE_DATE_PHRASES):
        return True
    tokens = set(re.findall(r"[a-z]+", lowered))
    if tokens & _WEEKDAY_KEYWORDS:
        return True
    if tokens & _MONTH_KEYWORDS:
        return True
    if _NUMERIC_DATE_PATTERN.search(lowered) or _ORDINAL_DATE_PATTERN.search(lowered):
        return True
    return False

def _extract_date(original_text: str, *, base_datetime: Optional[datetime] = None) -> Optional[str]:
    # If dateparser isn't installed, avoid trying to parse dates and return
    # None so the rest of the command still executes.
    if not _HAS_DATEPARSER:
        return None
    if not _contains_date_signal(original_text):
        return None

    base_reference = base_datetime or datetime.now()
    settings = {
        "PREFER_DATES_FROM": "past",
        "RELATIVE_BASE": base_reference,
        "RETURN_AS_TIMEZONE_AWARE": False,
        "DATE_ORDER": "DMY",
    }

    search_results = search_dates(original_text, settings=settings)
    if search_results:
        for fragment, parsed in search_results:
            fragment_lower = fragment.lower()
            if any(token in fragment_lower for token in _ALL_DATE_TOKENS) or _NUMERIC_DATE_PATTERN.search(
                fragment_lower
            ) or _ORDINAL_DATE_PATTERN.search(fragment_lower):
                return parsed.date().isoformat()

    parsed = dateparser.parse(original_text, settings=settings)
    if parsed:
        return parsed.date().isoformat()
    return None

def _detect_action(text: str, has_amount: bool, has_category: bool) -> Optional[str]:
    if any(re.search(p, text) for p in _SET_BUDGET_PATTERNS):
        return "set_budget"
    if any(re.search(p, text) for p in _SHOW_BUDGETS_PATTERNS):
        return "show_budgets"
    if any(re.search(p, text) for p in _REMOVE_BUDGET_PATTERNS):
        return "remove_budget"
    if any(re.search(p, text) for p in _CHART_SUMMARY_PATTERNS):
        return "chart_summary"

    for action, patterns in _ACTION_PATTERNS.items():
        if any(re.search(pattern, text) for pattern in patterns):
            return action

    add_patterns = [
        r"\b(add|record|log|note|register|capture|save|set aside)\b",
        r"\b(spend|spent|pay|paid|purchase|purchased|buy|bought)\b",
    ]
    if any(re.search(pattern, text) for pattern in add_patterns):
        return "add"

    if has_amount or has_category:
        return "add"
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

    raw_text = text.strip()
    lower_text = raw_text.lower()
    normalized_text = _normalize_text(raw_text)

    amount = _extract_amount(normalized_text)
    category, description = _extract_category_and_description(lower_text, raw_text)
    has_category = category != "uncategorized"

    action = _detect_action(normalized_text, amount is not None, has_category)

    if action is None:
        return {"action": "unknown", "raw": normalized_text}

    if action == "add":
        expense_date = _extract_date(raw_text)
        result: Dict[str, Any] = {
            "action": "add",
            "amount": amount,
            "category": category,
            "date": expense_date,
            "description": description,
        }
        return result

    if action == "set_budget":
        warn_ratio = _extract_warn_ratio(normalized_text)
        return {
            "action": "set_budget",
            "amount": amount,
            "category": None if category == "uncategorized" else category,
            "warn_ratio": warn_ratio,
        }

    if action == "show_budgets":
        return {
            "action": "show_budgets",
            "category": None if category == "uncategorized" else category,
        }

    if action == "remove_budget":
        return {
            "action": "remove_budget",
            "category": None if category == "uncategorized" else category,
        }

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

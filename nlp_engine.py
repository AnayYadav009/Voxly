import spacy
from spacy.matcher import Matcher, PhraseMatcher
from typing import Optional

# --- Singleton Cache ---
_nlp: Optional[spacy.language.Language] = None
_action_matcher: Optional[Matcher] = None
_category_matcher: Optional[PhraseMatcher] = None

CATEGORY_SYNONYMS = {
    "food": {"food", "meal", "meals", "lunch", "dinner", "breakfast", "snack", "snacks", "restaurant", "restaurants", "groceries", "grocery", "coffee", "tea", "drink", "drinks"},
    "transport": {"transport", "travel", "taxi", "cab", "uber", "ola", "bus", "train", "metro", "ride", "rides", "petrol", "diesel", "fuel", "gas", "commute"},
    "entertainment": {"entertainment", "movie", "movies", "netflix", "prime", "hotstar", "ott", "show", "shows", "concert", "gaming", "game", "games", "fun"},
    "shopping": {"shopping", "amazon", "mall", "purchase", "purchases", "bought", "buy", "buying", "retail", "clothes", "clothing", "apparel"},
    "utilities": {"utility", "utilities", "electricity", "power", "water", "gas", "internet", "wifi", "broadband", "phone", "mobile", "recharge", "bill", "bills"},
    "health": {"health", "doctor", "hospital", "medical", "medicine", "medicines", "pharmacy", "clinic", "fitness", "gym"},
    "education": {"education", "study", "studies", "course", "courses", "tuition", "class", "classes", "training", "book", "books"},
    "rent": {"rent", "renting", "lease", "housing", "house", "apartment", "flat"},
    "savings": {"savings", "investment", "invest", "investing", "mutual fund", "fixed deposit", "fd", "rd", "sip"},
    "personal": {"personal", "care", "salon", "beauty", "spa", "grooming"},
    "gifts": {"gift", "gifts", "present", "presents"},
    "charity": {"charity", "donation", "donations"},
    "insurance": {"insurance", "premium", "policy"},
    "fees": {"fee", "fees", "subscription", "subscriptions"},
}

def get_nlp() -> spacy.language.Language:
    """Load spaCy and return the nlp object (singleton)."""
    global _nlp
    if _nlp is None:
        try:
            _nlp = spacy.load("en_core_web_sm")
        except OSError:
            raise RuntimeError(
                "spaCy model 'en_core_web_sm' not found. "
                "Please run: python -m spacy download en_core_web_sm"
            )
    return _nlp

# Export the order for priority resolution
ACTION_PRIORITY = [
    "set_budget", "remove_budget", "show_budgets", "chart_summary",
    "exit", "help", "repeat", "delete", "recent", "weekly", "monthly", "balance", "add"
]

def get_action_matcher(nlp: spacy.language.Language) -> Matcher:
    """Build and cache the action Matcher (singleton)."""
    global _action_matcher
    if _action_matcher is None:
        matcher = Matcher(nlp.vocab)
        
        # 1. set_budget
        matcher.add("set_budget", [
            [{"LEMMA": {"IN": ["set", "update", "change", "create"]}}, {"OP": "*"}, {"LEMMA": "budget"}],
            [{"LEMMA": "budget"}, {"OP": "*"}, {"LEMMA": {"IN": ["set", "update", "change", "create"]}}]
        ])
        
        # 2. remove_budget
        matcher.add("remove_budget", [
            [{"LEMMA": {"IN": ["remove", "delete", "clear", "cancel"]}}, {"OP": "*"}, {"LEMMA": "budget"}],
            [{"LEMMA": "budget"}, {"OP": "*"}, {"LEMMA": {"IN": ["remove", "delete", "clear", "cancel"]}}]
        ])
        
        # 3. show_budgets
        matcher.add("show_budgets", [
            [{"LEMMA": {"IN": ["show", "what", "list", "how", "check"]}}, {"OP": "*"}, {"LEMMA": "budget"}],
            [{"LEMMA": "budget"}, {"OP": "*"}, {"LEMMA": {"IN": ["show", "what", "list", "how", "check"]}}]
        ])
        
        # 4. chart_summary
        matcher.add("chart_summary", [
            [{"LEMMA": {"IN": ["chart", "graph", "visual"]}}, {"LEMMA": {"IN": ["summary", "recap", "overview"]}, "OP": "?"}]
        ])
        
        # 5. exit
        matcher.add("exit", [
            [{"LEMMA": {"IN": ["stop", "exit", "quit", "close", "goodbye", "bye"]}}]
        ])
        
        # 6. help
        matcher.add("help", [
            [{"LEMMA": "help"}],
            [{"LOWER": "what"}, {"LOWER": "can"}, {"LOWER": "you"}, {"LOWER": "do"}]
        ])
        
        # 7. repeat
        matcher.add("repeat", [
            [{"LEMMA": "repeat"}],
            [{"LOWER": "say"}, {"LOWER": "again"}]
        ])
        
        # 8. delete
        matcher.add("delete", [
            [{"LEMMA": {"IN": ["delete", "remove", "undo", "erase", "cancel"]}}]
        ])
        
        # 9. recent
        matcher.add("recent", [
            [{"LEMMA": "recent"}],
            [{"LEMMA": "show"}, {"OP": "?"}, {"LEMMA": {"IN": ["expense", "transaction", "history"]}}],
            [{"LEMMA": "last"}, {"LEMMA": {"IN": ["expense", "transaction"]}}]
        ])
        
        # 10. weekly
        matcher.add("weekly", [
            [{"LOWER": "weekly"}],
            [{"LEMMA": "week"}, {"LEMMA": {"IN": ["summary", "report", "spending"]}}]
        ])
        
        # 11. monthly
        matcher.add("monthly", [
            [{"LOWER": "monthly"}],
            [{"LEMMA": "month"}, {"LEMMA": {"IN": ["summary", "report", "spending"]}}]
        ])
        
        # 12. balance
        matcher.add("balance", [
            [{"LEMMA": "balance"}],
            [{"LEMMA": "total"}, {"LEMMA": "today"}],
            [{"LOWER": "how"}, {"LOWER": "much"}, {"LEMMA": {"IN": ["spend", "spent"]}}]
        ])
        
        # 13. add
        matcher.add("add", [
            [{"LEMMA": {"IN": ["add", "record", "log", "note", "spend", "spent", "pay", "paid", "purchase", "buy", "bought"]}}]
        ])
        
        _action_matcher = matcher
        
    return _action_matcher

def get_category_matcher(nlp: spacy.language.Language) -> PhraseMatcher:
    """Build and cache the category PhraseMatcher (singleton)."""
    global _category_matcher
    if _category_matcher is None:
        matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
        for canonical, synonyms in CATEGORY_SYNONYMS.items():
            patterns = [nlp.make_doc(term) for term in synonyms | {canonical}]
            matcher.add(canonical, patterns)
        _category_matcher = matcher
    return _category_matcher

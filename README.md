# Voice Finance Tracker

Voice-enabled personal finance dashboard with a Flask backend and React frontend. Track spending manually or via natural language commands, review charts, and monitor budgets in real time.

---

## Prerequisites
- Python 3.13 (recommended) with virtualenv support
- Node.js 20 LTS and npm
- SQLite (bundled with Python)
- Speech recognition dependencies for optional voice features: microphone access, PyAudio-compatible stack (SoundDevice + PortAudio)

---

## Quick Start (Development)

### 1. Backend API
```powershell
# from repo root
python -m venv venv
& .\venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
python database.py  # ensures schema
python app.py       # runs Flask dev server on http://localhost:5000
```

### 2. Frontend UI
```powershell
cd .\frontend
npm install
npm start        # CRA dev server at http://localhost:3000
```
The frontend dev server proxies API calls to the Flask backend via the configured CRA proxy (set in frontend/package.json).

---

## Production Build & Serving
1. Create the optimized React build:
   ```powershell
   cd .\frontend
   npm run build
   cd .. 
   ```
2. Start Flask in production mode (any WSGI server or `python app.py`). Flask will serve the built assets from `/` or `/app`.
3. Optional environment variables:
   - `FLASK_ENV=production`
   - `PORT=5000` (override default)
   - `DATABASE_URL` (if you migrate off SQLite)

---

## Test Suite
```powershell
# backend integration tests
pytest -q

# frontend unit tests
cd .\frontend
npm test -- --watchAll=false
```

Integration tests use a stubbed SQLite database and verify key endpoints: `/api/add`, `/api/voice_command`, `/api/charts/*`.

---

## Voice Commands
Example phrases the assistant can parse:
- "Add 500 to food"
- "Delete last expense"
- "What's my balance today?"
- "Show recent expenses"
- "Give weekly summary"

The Web Speech API handles microphone input in the browser. Ensure HTTPS or localhost usage for microphone access.

---

## Folder Overview
```
app.py                # Flask app with REST endpoints and voice integration
frontend/             # React dashboard (Create React App)
  src/App.js          # Voice-enabled dashboard UI
  package.json        # Scripts and dependencies
static/voice.js       # Legacy voice client for non-React page
visual_module.py      # Chart data aggregations and Matplotlib exports
summary_module.py     # Weekly/monthly text summaries
budget_module.py      # Budget loading, evaluation, alerts
database.py           # SQLite helpers (CRUD)
logger.py             # Shared logger config
tests/                # Pytest integration suite
```

---

## Deployment Tips
- Run behind a production WSGI server (gunicorn/uvicorn) and reverse proxy (nginx) for static asset caching.
- Configure HTTPS to enable speech recognition in browsers.
- Provision SQLite backups or migrate to a hosted SQL database for multi-user setups.
- Monitor logs in the `logs/` directory; they rotate automatically.

---

## Troubleshooting
- **CORS errors**: ensure Flask is running on 5000 with CORS enabled (flask-cors is already configured).
- **Voice commands denied**: browsers require microphone permissions and secure contexts.
- **Chart endpoints empty**: add expenses to populate category/daily/monthly aggregations.
- **React build not found**: run `npm run build` so Flask can serve the bundle.

---

## License
MIT © 2025–2026
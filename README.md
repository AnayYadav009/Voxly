# Voxly: Voice-Powered Personal Finance Tracker

Voxly is a voice-enabled personal finance dashboard with a Flask backend and a React frontend. It helps users add expenses, monitor budgets, review summaries, and view spending insights through typed or spoken commands.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.13%2B-blue)
![React](https://img.shields.io/badge/react-19-61dafb)

## Features

- Natural language expense entry, such as "Add 500 for groceries" or "I spent 1200 on dinner".
- Dashboard charts for category breakdowns, daily trends, and monthly totals.
- Category budget limits with warning thresholds.
- Cookie-based JWT authentication with secure password hashing.
- Weekly and monthly summaries for quick spending review.
- Optional Groq-powered insights when `GROQ_API_KEY` is configured.

## Tech Stack

- Backend: Flask, SQLite or Turso/libSQL, Flask-Limiter, PyJWT, Groq
- Frontend: React 19, Lucide React, Tailwind CSS
- Voice I/O: Web Speech API in the browser, with Python CLI fallback modules
- Testing: Pytest, Jest, React Testing Library

## Getting Started

### Prerequisites

- Python 3.13+
- Node.js 20+
- Microphone access for browser voice features

### Backend Setup

```powershell
git clone https://github.com/AnayYadav009/Voxly.git
cd Voxly

python -m venv venv
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
copy .env.example .env

python app.py
```

Set a strong `VOXLY_JWT_SECRET` in `.env` before starting the backend.

### Frontend Setup

```powershell
cd frontend
npm install
npm start
```

The frontend runs at `http://localhost:3000` and proxies API requests to `http://localhost:5000`.

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VOXLY_JWT_SECRET` | Secret key for JWT signing. Required before startup. | None |
| `VOXLY_SESSION_SECRET` | Secret key for Flask sessions. | Random per process |
| `VOXLY_ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins. `CORS_ORIGINS` is still accepted as a legacy fallback. | `http://localhost:3000` |
| `FLASK_ENV` | Set to `production` for production deployments. | `development` |
| `TURSO_URL` | Optional Turso/libSQL database URL. | Local SQLite |
| `TURSO_TOKEN` | Optional Turso/libSQL auth token. | None |
| `GROQ_API_KEY` | Optional API key for AI-powered parsing and insights. | None |
| `GROQ_MODEL` | Groq model for command parsing. | `llama-3.3-70b-versatile` |

## Example Commands

| Intent | Example Phrase |
| :--- | :--- |
| Add expense | "Add 500 to food" |
| Check balance | "What's my balance today?" |
| Review history | "Show recent expenses" |
| Summarize | "Give me a weekly summary" |
| Budgeting | "Set budget for shopping to 5000" |
| Correction | "Delete last expense" |

## Running Tests

### Backend

```powershell
pytest
```

### Frontend

```powershell
cd frontend
npm test -- --watchAll=false
npm run build
```

## Project Structure

- `app.py`: Flask entry point, app-wide helpers, and blueprint registration.
- `routes/`: API blueprints for auth, expenses, charts, and voice commands.
- `auth.py`: Authentication and token helpers.
- `database.py`: SQLite and Turso/libSQL data access.
- `budget_module.py`: Budget limits, evaluation, and alerts.
- `summary_module.py`: Spending totals and summary text.
- `voice_nlp.py`: Groq-backed natural language command parsing.
- `voice_module.py`: Python speech input/output helpers and parser re-export.
- `frontend/`: React dashboard and UI components.
- `tests/`: Backend pytest suite.

## Deployment

`render.yaml` contains a Render web service definition for the Flask API. Configure production secrets in the Render dashboard, especially `VOXLY_JWT_SECRET`, `TURSO_URL`, `TURSO_TOKEN`, and `VOXLY_ALLOWED_ORIGINS`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, test, and pull request guidance.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

MIT (c) 2026 [Anay Yadav](https://github.com/AnayYadav009)

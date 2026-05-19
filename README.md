# 🎙️ Voxly: Voice-Powered Personal Finance Tracker

Voxly is a modern, voice-enabled personal finance dashboard that combines a **Flask** backend with a **React** frontend. It leverages **Groq API** to process natural language commands, allowing users to manage their expenses, monitor budgets, and view financial insights through intuitive voice or text interactions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.13%2B-blue)
![React](https://img.shields.io/badge/react-19-61dafb)

---

## ✨ Key Features

- **🗣️ Natural Language Processing:** Record expenses like "Add 500 for groceries" or "I spent 1200 on dinner" using LLM-driven intent recognition via Groq.
- **📊 Real-time Dashboard:** Visualize spending habits with dynamic charts (Category Breakdown, Daily Trends, Monthly Totals).
- **🛡️ Smart Budgeting:** Set category-specific limits and receive instant voice/visual alerts when you're nearing your threshold.
- **🔐 Secure & Private:** Local-first SQLite database with JWT-based authentication and secure password hashing.
- **📈 Insightful Summaries:** Get instant weekly and monthly text-to-speech summaries of your financial health.
- **⚡ Responsive UI:** A clean, modern dashboard built with React and Tailwind CSS.

---

## 🛠️ Tech Stack

- **Backend:** Flask, SQLite, Flask-Limiter, PyJWT, Groq
- **Frontend:** React 19, Lucide React, Tailwind CSS
- **Voice I/O:** Web Speech API (Browser), Pyttsx3/SpeechRecognition (CLI/Fallback)
- **Testing:** Pytest (Backend), Jest/React Testing Library (Frontend)

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.13+**
- **Node.js 20+**
- **Microphone Access** (for voice features)

### 1. Backend Setup
```powershell
# Clone the repository
git clone https://github.com/AnayYadav009/Voxly.git
cd Voxly

# Setup virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and set a secure VOXLY_JWT_SECRET

# Start the server
python app.py
```

### Environment Variables
Configure these in your `.env` file for production security:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VOXLY_JWT_SECRET` | Secret key for JWT signing (**Required in Production**) | `voxly-insecure-dev-secret` |
| `VOXLY_SESSION_SECRET` | Secret key for Flask sessions | (Randomly generated) |
| `VOXLY_ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `http://localhost:3000` |
| `FLASK_ENV` | Set to `production` to enable secure cookies and stricter guards | `development` |

**Optional environment variables:**
- `GROQ_API_KEY` — Groq API key for AI-powered voice parsing and insights.
  Free tier: 14,400 requests/day. Get one at https://console.groq.com
- `GROQ_MODEL` — Groq model to use (default: llama-3.3-70b-versatile).

### 2. Frontend Setup
```powershell
cd frontend
npm install
npm start
```
The dashboard will be available at `http://localhost:3000`.

---

## 🗣️ Example Commands

| Intent | Example Phrase |
| :--- | :--- |
| **Add Expense** | "Add 500 to food" / "Spent 100 on travel yesterday" |
| **Check Balance** | "What's my balance today?" |
| **Review History** | "Show recent expenses" |
| **Summarize** | "Give me a weekly summary" |
| **Budgeting** | "Set budget for shopping to 5000" |
| **Correction** | "Delete last expense" |

---

## 🧪 Running Tests

### Backend
```powershell
pytest
```

### Frontend
```powershell
cd frontend
npm test -- --watchAll=false
```

---

## 📂 Project Structure

- `app.py`: Main Flask entry point and REST API.
- `voice_module.py`: Voice input processing and command parsing via Groq.
- `budget_module.py`: Budget evaluation and alert logic.
- `database.py`: SQLite interaction layer.
- `frontend/`: React source code and dashboard components.
- `visual_module.py`: Data aggregation for charts.

---

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request or open an issue for any bugs or feature requests.

## 📄 License
This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---
MIT © 2026 [Anay Yadav](https://github.com/AnayYadav009)
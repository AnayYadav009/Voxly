# Contributing to Voxly

Thanks for taking the time to improve Voxly.

## Local Setup

```powershell
git clone https://github.com/AnayYadav009/Voxly.git
cd Voxly

python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

copy .env.example .env

cd frontend
npm install
```

## Development

Run the backend from the repository root:

```powershell
python app.py
```

Run the frontend from `frontend/`:

```powershell
npm start
```

## Checks

Before opening a pull request, run:

```powershell
pytest
cd frontend
npm test -- --watchAll=false
npm run build
```

The GitHub Actions workflow also runs a focused Flake8 syntax check and Bandit security scan.

## Pull Requests

- Keep changes focused and describe the user-facing behavior they affect.
- Add or update tests for backend routes, parsing behavior, or UI behavior when practical.
- Do not commit `.env`, local databases, logs, caches, virtual environments, or frontend build output.
- If you change required environment variables, update `.env.example` and `README.md`.

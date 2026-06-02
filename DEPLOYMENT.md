# Voxly Deployment Guide

This document describes how Voxly is deployed across three platforms: **Turso** (Database), **Render** (Backend), and **Vercel** (Frontend).

---

## 🏗 Architecture Overview

- **Turso**: Hosts the distributed SQLite edge database.
- **Render**: Hosts the Python/Flask API backend.
- **Vercel**: Hosts the React frontend application.

---

## 1. Turso (Database Deployment)

Voxly uses Turso to maintain a globally distributed SQLite database.

### Setup Instructions

1. Install the Turso CLI:
   ```bash
   curl -sL https://get.tur.so/install.sh | bash
   ```
2. Authenticate with Turso:
   ```bash
   turso auth login
   ```
3. Create a new database for the project:
   ```bash
   turso db create voxly-db
   ```
4. Retrieve your database URL and authentication token (you will need these for the Render backend):
   ```bash
   turso db show voxly-db --url
   turso db tokens create voxly-db
   ```

---

## 2. Render (Backend Deployment)

The Python backend is deployed as a Web Service on Render using the included `render.yaml` configuration (Infrastructure as Code).

### Setup Instructions

1. Log into your [Render Dashboard](https://dashboard.render.com).
2. Connect your GitHub account and select the **Voxly** repository.
3. Render will automatically detect the `render.yaml` file in the root directory (make sure it's committed to the repository).
4. **Environment Variables**: Navigate to the Environment tab of your backend service on Render and add the following variables:

   | Variable Name           | Description                           | Example                             |
   | ----------------------- | ------------------------------------- | ----------------------------------- |
   | `TURSO_URL`             | The Database URL from Turso.          | `libsql://voxly-db-user.turso.io`   |
   | `TURSO_TOKEN`           | The Database Auth Token from Turso.   | `eyJhb...`                          |
   | `VOXLY_JWT_SECRET`      | Secret key for JWT authentication.    | Generate via `openssl rand -hex 32` |
   | `GROQ_API_KEY`          | Your Groq API key for NLP / insights. | `gsk_...`                           |
   | `VOXLY_ALLOWED_ORIGINS` | The URL of your Vercel frontend.      | `https://voxly.vercel.app`          |
   | `FLASK_ENV`             | Sets the Flask environment.           | `production`                        |

5. Deploy the application. Once complete, copy the backend URL (e.g., `https://voxly-backend.onrender.com`).

---

## 3. Vercel (Frontend Deployment)

The React frontend (located in the `frontend` folder) is deployed to Vercel for fast, global edge delivery.

### Setup Instructions

1. Log into your [Vercel Dashboard](https://vercel.com).
2. Click **Add New... > Project** and import the **Voxly** GitHub repository.
3. **Configure the Project Build Details**:
   - **Framework Preset**: `Create React App`
   - **Root Directory**: Select the `frontend` directory.
   - **Install Command**: `npm install`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
4. **Environment Variables**: Add the backend API URL connection string:

   | Variable Name       | Value                                                                        |
   | ------------------- | ---------------------------------------------------------------------------- |
   | `REACT_APP_API_URL` | Your secure Render backend URL (e.g., `https://voxly-backend.onrender.com`). |

5. Click **Deploy**. Vercel will build and serve the application globally.

---

## 🔄 Deployment Pipeline Summary

Whenever you push to the `main` branch on GitHub:

- **Render** will automatically pull the branch, run `pip install -r requirements.txt`, and redeploy the backend API.
- **Vercel** will automatically pull the updated frontend, run `npm run build`, and deploy the latest user interface.
- **Turso** requires no manual redeploys unless a new database struct or replica is being configured.

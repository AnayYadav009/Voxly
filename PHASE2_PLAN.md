# Phase 2 Roadmap

## Objectives
- Deliver a conversational finance coach that understands natural language beyond regex heuristics.
- Provide trustworthy, personalized financial insights powered by the user's data with clear explanations.
- Expand budgeting capabilities to include smart forecasts and scenario modeling.
- Refresh the experience layer so new intelligence features feel intuitive on every device.
- Harden security, privacy, and hosting so advanced ML features can ship safely.

## Workstreams

### 1. Voice NLP Overhaul
**Goal:** Replace the regex parser with a modular NLP stack that can interpret varied utterances.
- Data: collect + label intent/slot datasets from existing transcripts and synthetic phrases; define ongoing annotation loop.
- Modeling: evaluate lightweight HuggingFace encoder-decoder models (e.g., DistilBERT, BART) plus fallback rule engine for low-confidence cases.
- Serving: expose inference via a Flask blueprint with async queueing; include latency budget, retry, and confidence scoring.
- Tooling: add evaluation harness, CI tests, and feature flags for gradual rollout.

### 2. Personalized Insights & Explainability Layer
**Goal:** Transform spending data into actionable narratives users trust.
- Analytics: compute baselines, rolling averages, anomaly scores, and cohort comparisons inside `database.py` + `visual_module.py` helpers.
- Modeling: pilot interpretable models (Prophet for trend forecasting, isolation forest for anomalies) and capture feature importance signals.
- Explainability Layer: surface driver statements (e.g., "Dining is +45% vs 3-mo avg") alongside charts; log rationale fields so emails, push, and UI share the same explanation payload.
- Privacy: process sensitive metrics with data-minimization rules and document opt-in/opt-out flows.

### 3. Smart Budgets & Forecasting
**Goal:** Move from static limits to adaptive coaching.
- Dynamic budgets that auto-adjust using historical spend and seasonality.
- Scenario simulator (what if I cut dining by 20%?) feeding the same forecast pipeline.
- Goal tracking for savings/debt payoff with milestone alerts.
- API changes in `budget_module.py` plus new endpoints for simulations; tie output to the insights service for unified messaging.

### 4. UI/UX Revamp
**Goal:** Present the new intelligence in a coherent, responsive interface.
- Layout: create dedicated Insights hub, scenario playground, NLP status tray, and conversational transcript view in the React app.
- Design system refresh (color, typography, spacing) with accessibility targets (WCAG AA+ speech contrast).
- Microcopy + onboarding flows that teach users how to use voice + insights.
- Add offline-friendly states and optimistic UI for NLP requests.

### 5. Security & Hosting Hardening
**Goal:** Prepare for production-grade ML + data personalization.
- Auth: stronger password policy, optional 2FA, role-based permissions surfaced in `auth.py` and frontend context.
- Data protection: encrypt PII at rest, rotate secrets, enforce TLS for voice endpoints.
- Observability: structured logging in `logger.py`, request tracing, and anomaly alerts for NLP misuse.
- Deployment: containerize services, define IaC (IaC choice TBD), add CI/CD gates, and plan for scalable background workers.

## Cross-Cutting Checklist
- **Instrumentation:** capture anonymized metrics (intent success, insight engagement) to measure ROI.
- **Testing:** synthetic personas + regression suites for NLP, insights, and budgeting math.
- **Compliance:** document data retention, consent, and opt-out processes before shipping personalized insights.
- **Feature Flags:** wrap each major feature for staged rollouts and A/B tests.

## Next Steps
1. Finalize data governance guidelines for training and analytics pipelines.
2. Define MVP scope per workstream (milestones, effort estimates, owners).
3. Build shared backlog and sequencing plan (likely start with NLP + insights, then budgets/UI, then hardening).
4. Kick off prototyping spikes (NLP model bake-off, explainability payload schema, new dashboard wireframes).

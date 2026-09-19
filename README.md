# Sari Rasa — UMKM Culinary Profile

Sari Rasa is a full-stack learning and portfolio application for a local Indonesian culinary business. Customers can browse a bilingual menu, maintain a guest or account-backed cart, and hand an order off to WhatsApp. Authenticated administrators can manage the product catalog.

The currently implemented system uses a vanilla browser frontend, an Express API, and SQLite persistence. A separate local Python workspace contains the analytics pipeline, deterministic next-day quantity forecasting, and the read-only AI menu-assistant runtime reached through Node. The dashboard derives compact cached aggregates from the same 750,000-row V2 history used by ML; its 11 products exactly match the application catalog, and raw rows never leave Python. That source spans 693 days and produces only 664 supervised forecasting observations—not 750,000 ML training examples. The Admin Analytics dashboard presents the production HGB next-day forecast and a separate experimental MLP comparison through strictly validated FastAPI → Node gateways. All synthetic data is fictional.

## Implemented features

### Menu and frontend

- Products loaded dynamically from the backend and rendered as responsive cards
- Category filters for `Makanan`, `Minuman`, and `Snack`
- Indonesian and English UI with a persisted language preference
- Current product data used for prices, totals, descriptions, and WhatsApp orders

### Authentication and accounts

- Account registration, login, logout, and session restoration
- Signed, HttpOnly cookie authentication
- Database-authoritative user roles and role-aware UI
- Server-side authorization for protected and admin-only operations

### Persistent cart

- Guest cart persistence in `localStorage`
- Account cart persistence in SQLite
- Idempotent guest-to-account cart merge after explicit login
- Quantity and note persistence, including serialized authenticated writes and debounced note updates
- Checkout protection while authenticated changes are not safely persisted
- WhatsApp checkout built from the current cart and product models

### Product administration

- Admin-only product creation, full update, and deletion
- Bilingual descriptions and product image metadata
- Backend validation and database persistence across refreshes

### Analytics and demand forecast

- Admin sales KPIs, trend, product performance, and category revenue with a shared historical date filter
- Next-day total-demand forecast that always uses the latest trusted history and is independent of that filter
- Inclusive trailing 7- and 28-calendar-day actual-demand averages, neutral comparisons, cutoff/horizon provenance, and transparent limitations
- Independent loading/error/retry behavior, effective-admin lifecycle caching, stale-response protection, responsive layout, accessibility, and Indonesian/English presentation
- Experimental model comparison over the common frozen TEST period: production HGB, experimental PyTorch MLP, and previous-week benchmark

### AI menu assistant

- Responsive bilingual menu assistant using the native modal dialog and the Node → FastAPI AI boundary
- Panel chrome follows the website language, while each AI answer follows the current message's clear Indonesian/English language and uses the website language only as an ambiguity fallback
- Desktop, narrow/mobile, short-height, keyboard, touch-sized viewport, and reduced-motion behavior verified through Phase 8G manual acceptance
- Keyboard-operable citations close the assistant and focus/highlight the referenced menu item without incorrectly restoring focus to the launcher
- One polite/atomic status live region announces loading and a concise localized response-ready message; it does not automatically read the full AI response or move focus

### Engineering quality

- Permanent backend, database, and frontend regression suites
- Isolated temporary SQLite databases and ephemeral backend ports in tests
- Actual `index.html` ↔ `script.js` element contracts
- Frontend ↔ backend API route and method contracts
- Guards that prevent tests from opening the development database directly, through symlinks, or through hard-link aliases
- Combined `npm test` runner with 167 passing tests at the Phase 6-EXT-H quality gate

## Technology stack

| Area | Technology |
|---|---|
| Frontend | Semantic HTML, CSS, vanilla browser JavaScript, browser `localStorage` and `<dialog>` APIs |
| Backend | Node.js 22+, Express 5, CommonJS |
| Python data/AI service | FastAPI and Uvicorn (health, analytics, forecasting, model comparison, and menu-assistant endpoints) |
| ML/DL development | Pandas/NumPy feature preparation, scikit-learn HGB, and a small CPU PyTorch MLP |
| Database | SQLite through `better-sqlite3` |
| Authentication and security | bcrypt password hashing, HMAC-signed cookies, HttpOnly/SameSite/Secure cookie controls, CORS, role middleware, in-memory rate limiting |
| Testing | Node's built-in `node:test` and `node:vm`; pytest and FastAPI `TestClient` for Python |

## Architecture at a glance

```mermaid
flowchart LR
    Browser[Browser<br/>HTML, CSS, JavaScript]
    API[Express API<br/>Node.js]
    DB[(SQLite)]
    PY[Python FastAPI<br/>Analytics and AI]
    CSV[(Canonical CSV)]
    WA[WhatsApp]

    Browser -->|JSON requests<br/>credentials where required| API
    API --> DB
    API -->|server-to-server HTTP/JSON| PY
    PY --> CSV
    Browser -->|checkout handoff| WA
```

The browser owns presentation and guest state. The Express API is authoritative for authenticated identity, authorization, products, and account carts. SQLite persists products, users, authenticated cart items, and merge receipts.

See [Architecture](docs/ARCHITECTURE.md) for component boundaries, security decisions, cart transitions, and test design.

## 🚀 Local Development Cheat Sheet

| What are you running? | Required processes |
|---|---|
| **Normal website** | Frontend + Node/Express — Python is not required |
| **Analytics / Forecast** | Frontend + Node/Express + Python FastAPI |
| **AI menu assistant** | Frontend + Node/Express + Python FastAPI and configured AI runtime |

One-time Node setup from the repository root requires Node.js 22+, npm, and VS Code Live Server:

```sh
npm ci
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `SESSION_SECRET=` inside `.env`. Never commit `.env` or disclose its values.

### Terminal 1 — Node / Express backend (required)

Working directory: repository root.

```sh
npm start
```

- App/API: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`

### Terminal 2 — frontend (required)

Working directory: repository root.

```text
VS Code → Live Server → Go Live (port 5500)
```

- Website: `http://localhost:5500`

### Terminal 3 — Python FastAPI (Analytics / Forecast / AI)

Working directory: `python/`. Activate the existing repository-level virtual environment, then start FastAPI:

```sh
source ../.venv/bin/activate
(set -a && source ../.env && exec uvicorn sari_rasa_data.service:app --reload --app-dir src)
```

- Service: `http://127.0.0.1:8000`
- Health: `http://127.0.0.1:8000/health`

Python is not needed for authentication, admin management, password recovery, email, carts, or ordinary website use. Use `localhost` for both browser-facing processes; do not substitute `127.0.0.1` for the frontend URL.

📖 **Need the full setup, troubleshooting, testing, and maintenance guide?** See [Full Local Development Startup](docs/RUNBOOK.md#full-local-development-startup).

## Environment variables

| Variable | Required | Current behavior |
|---|---|---|
| `SESSION_SECRET` | Yes | HMAC key for signed session cookies. Startup rejects missing, blank, or shorter-than-16-character values. Use a much longer random value and never commit it. |
| `NODE_ENV` | Yes for explicit runtime mode | `production` enables the cookie's `Secure` flag for HTTPS deployments; `development` keeps the signed HttpOnly cookie usable over local HTTP. |
| `HOST` | Yes in production | Node bind address for the trusted-edge private hop; development defaults to `127.0.0.1`. |
| `DATABASE_PATH` | Yes in production | Production requires an absolute durable-storage path. Development defaults to `data/umkm.db`; tests require an isolated path. |
| `DATABASE_BOOTSTRAP_ALLOWED` | Only for intentional first production bootstrap | Keep false/unset normally. Exact `true` permits creation of a missing production canonical database after the operator verifies the intended empty durable volume. |
| `PORT` | No | Defaults to `3000`; accepted values are integers from 1 through 65535. |
| `PYTHON_SERVICE_URL` | Yes in production | Private FastAPI base URL used only by Node; local development defaults to `http://127.0.0.1:8000`. |
| `PYTHON_AI_SERVICE_URL` | No | Optional AI-only private override; otherwise AI uses `PYTHON_SERVICE_URL`. Never exposed to the browser. |
| `FRONTEND_ORIGIN` | No locally; yes for deployment | Exact trusted browser origin for CORS and protected mutations; defaults to `http://localhost:5500`, and production requires HTTPS. |
| `APP_PUBLIC_ORIGIN` | No locally; yes in production | Trusted origin for reset links; defaults to `FRONTEND_ORIGIN`, never comes from request headers, and requires HTTPS in production. |
| `EMAIL_DELIVERY_MODE` | No locally; yes in production | `disabled` is the non-network local/test default; production requires `resend`. |
| `RESEND_API_KEY` | In `resend` mode | Server-only provider credential; keep it in runtime secrets and never expose or commit it. |
| `EMAIL_FROM` | In `resend` mode | Provider-verified sender address. |
| `EMAIL_FROM_NAME` | No | Sender display name; defaults to `Sari Rasa`. |
| `SARI_RASA_ANALYTICS_DATASET_PATH` | No | Trusted FastAPI analytics CSV path; defaults to generated `python/data/transactions_ml_v2.csv`. Never derive it from a browser request. |
| `SARI_RASA_ML_DATASET_PATH` | No | Trusted V2 forecast/inference CSV path. Defaults to `python/data/transactions_ml_v2.csv`. |
| `SARI_RASA_MODEL_ARTIFACT_PATH` | No | Trusted production HGB joblib path. Defaults to the generated V2 artifact. |
| `SARI_RASA_DL_MODEL_ARTIFACT_PATH` | No | Trusted experimental MLP artifact path. Defaults to ignored `python/models/next_day_quantity_mlp_v1.pt`. |
| `SARI_RASA_LLM_PROVIDER` | For live AI assistant | Must currently be `gemini`; basic website and non-AI features do not require it. |
| `SARI_RASA_LLM_MODEL` | For live AI assistant | Environment-configurable Gemini text model; Phase 7A live acceptance verified `gemini-3.1-flash-lite`, with intentionally no code default. |
| `SARI_RASA_LLM_API_KEY` | For live AI assistant | Server-side Gemini credential; never commit, paste into chat, or log it. |
| `SARI_RASA_LLM_TIMEOUT_SECONDS` | No | Bounded Gemini request timeout; defaults to 10 seconds and accepts 0.1–60. |

Phase 7D embeddings are local-first and use no API key or paid embedding API. The verified configurable model is `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` on CPU; loading is lazy, and the offline acceptance uses its provisioned local cache.

The explicit local Live Server split uses `http://localhost:5500` for frontend assets and `http://localhost:3000` for Node. Production browser requests use the current HTTPS origin, where the trusted edge routes `/api/*` to Node; browser code never addresses FastAPI.

See [.env.example](.env.example) for the safe local template and additional environment notes. `.env` is intentionally ignored by Git.

## Testing

Run the complete regression foundation:

```sh
npm test
```

Or run either permanent suite independently:

```sh
npm run test:backend
npm run test:frontend
```

Current verified baseline:

| Suite | Tests | Result |
|---|---:|---|
| Backend and database | 72 | 72 passed |
| Frontend VM and contracts | 95 | 95 passed |
| Combined Node suites | 167 | 167 passed |
| Python data/service/LLM foundation | 458 | 458 passed |

The backend suite uses Node's built-in test runner, temporary SQLite databases, and ephemeral HTTP ports. It covers authentication, authorization, products, carts, merge idempotency, constraints, cascades, schema evolution, and development-database protection.

The frontend suite loads the actual production `script.js` into `node:vm` with controlled DOM, storage, fetch, and timer boundaries. A test-only probe is appended in memory; production code contains no test hooks. Contract tests also compare the real HTML dependencies and frontend API calls with the backend routes.

These automated suites do not use Playwright, Cypress, Selenium, or a real browser. Real-browser verification was performed separately through user-executed Safari acceptance.

## Project structure

```text
.
├── index.html                  # Page structure and accessible UI controls
├── style.css                  # Responsive presentation
├── script.js                  # Browser state, rendering, auth, cart, and admin UI
├── server.js                  # Express application, routes, and startup seam
├── db/
│   └── database.js             # SQLite connection, schema evolution, and seeding
├── lib/                       # Password, session, user, and rate-limit helpers
├── middleware/                # Authentication, authorization, and rate limiting
├── tests/
│   ├── backend/                 # HTTP and live-database regression tests
│   ├── frontend/                # Production-script VM and contract tests
│   └── helpers/                 # Isolated backend and browser test harnesses
├── docs/
│   ├── ARCHITECTURE.md          # Technical system design
│   ├── ACCOUNT_ADMIN_EXTENSION.md # Detailed Phase 6-EXT contracts and evidence
│   └── RUNBOOK.md               # Local setup and operations
├── .env.example               # Environment-variable documentation
├── ROADMAP.md                 # Approved status and future learning roadmap
├── python/                    # Python data modules, FastAPI service, and pytest suite
└── package.json               # Runtime and test commands
```

## Engineering highlights

- **Server-verifiable sessions:** the browser receives an HMAC-signed cookie that JavaScript cannot read. Each protected request also checks the user's current database role and token version.
- **Separated cart authority:** anonymous carts remain browser-local, while authenticated carts are owned and persisted by the server using `req.user.id` rather than client-supplied identity.
- **Retry-safe cart merge:** `(user_id, merge_id)` receipts prevent a repeated login merge from reapplying quantities or notes.
- **Controlled authenticated writes:** per-product serialization, coalescing, note debounce, reconciliation, and auth/cart epochs prevent older work from overwriting newer state.
- **Safe logout and checkout:** required writes drain before logout, account state is not copied into guest storage, and checkout is disabled while authenticated persistence is unsafe.
- **Test-data isolation:** backend tests create disposable databases and reject direct and filesystem-aliased paths to `data/umkm.db` before SQLite initialization.
- **Executable integration contracts:** tests connect production HTML expectations, production frontend requests, and Express route definitions without adding a browser framework.
- **Separated production and experiment paths:** HGB remains the production forecast; the MLP uses its own validated weights-only artifact, inference function, service route, and explicitly experimental dashboard comparison.

These controls are appropriate to the current learning project; they are not a claim of enterprise scale or complete production hardening.

## Current status

- Phase 1 — Frontend Foundation: verified complete
- Phase 2 — Backend & API: verified complete
- Phase 3 — Full-Stack Application: verified complete
- Automated Regression Foundation: verified complete
- Project Documentation / Runbook: verified complete
- Quality Gate — Engineering Foundation: verified complete
- Phase 4A-1 — Python Foundation Scaffold: verified complete (foundation-only workspace, not a running service)
- Phase 4A-2 — Core Python Fundamentals & Error Handling: verified complete (list/dict/loop processing, pathlib, and JSON read/write; still foundation-only)
- Phase 4A-3 — Python Foundation Finalization: verified complete (adds a tested `python -m sari_rasa_data` entry point)
- Phase 4A overall: verified complete
- Phase 4B-1 — Dataset Foundation & Schema: verified complete
- Phase 4B-2 — CSV/JSON Loading & Validation: verified complete
- Phase 4B-3 — Cleaning & Transformation: verified complete
- Phase 4B-4 — Aggregation & Final Verification: verified complete
- Phase 4B overall: verified complete with a pure-Python local data pipeline
- Phase 4C-1 — Pandas Foundation & DataFrame: verified complete
- Phase 4C-2 — Filtering, Grouping & Aggregation: verified complete
- Phase 4C-3 — NumPy & Basic Statistics: verified complete
- Phase 4C-4 — Analysis Pipeline & Large Synthetic Dataset: verified complete (user manual analysis acceptance passed)
- Phase 4C overall: verified complete
- Phase 4D-1 — FastAPI Foundation & Health Endpoint: verified complete
- Phase 4D-2 — Analytics Summary API: verified complete
- Phase 4D-3 — Products & Categories API: verified complete
- Phase 4D-4 — Error Handling & Final Verification: verified complete
- Phase 4D overall: verified complete (final user manual acceptance passed)
- Phase 4E — Node.js ↔ Python Integration: verified complete (manual integration acceptance passed)
- Phase 4F — Integration & Quality Gate: verified complete
- Phase 4 overall: verified complete
- Phase 4G — Analytics Dashboard UI: verified complete (final user browser acceptance passed)
- Phase 5A — ML Problem Definition & Dataset Readiness: verified complete
- Phase 5B — ML Dataset & Feature Engineering: verified complete
- Phase 5C — Baseline Forecast: verified complete (previous-week validation MAE 9.3333 established the benchmark; final test remained untouched throughout 5C)
- Phase 5D — Model Training & Evaluation: verified complete (selected HistGradientBoosting validation MAE 6.9601; single final-test MAE 8.1000 versus previous-week 14.1792)
- Phase 5E — Prediction Service: verified complete (versioned trusted artifact and `GET /analytics/forecast/next-day`)
- Phase 5F — Node.js ↔ ML Integration: verified complete (`GET /api/analytics/forecast/next-day` with strict upstream validation and bounded failures)
- Phase 5G — ML Dashboard UI: verified complete (automated verification, independent review, CSV verification, and manual browser acceptance passed)
- Phase 5H — Final Integration & Quality Gate: verified complete (full regression, provenance/invariant verification, six focused reviews, and documentation consistency passed)
- Phase 5 overall: verified complete
- Phase 5F-R — Large-Scale ML V2 Dataset, Retraining & Serving Verification: verified complete (750K transaction rows → 664 daily observations; separate V2 evaluation/artifact)
- Phase 4G-R2 — 750K Analytics Alignment & Performance: verified complete (shared validated aggregate cache; browser acceptance passed)
- Phase 5F-R2 — 11-Product Domain Alignment & Full Pipeline Reverification: verified complete (750K shared analytics/ML history matches the 11 seeded products; automated review and browser acceptance passed)
- Phase 6 — Deep Learning Fundamentals: verified complete (experimental MLP training/evaluation, fail-closed artifact and inference, additive service comparison, responsive dashboard, full regression, and manual browser acceptance)
- Phase 6-EXT-A — Account & Admin Architecture & Contracts: verified complete
- Phase 6-EXT-B — Admin Backend & Business Rules: verified complete
- Phase 6-EXT-C — Admin Management UI/UX: verified complete (manual acceptance passed)
- Phase 6-EXT-D — Password Reset Backend & Token Lifecycle: verified complete
- Phase 6-EXT-E — Password Recovery UI/UX: verified complete (automated and core manual acceptance passed)
- Phase 6-EXT-F — Email Delivery Integration: verified complete (real Resend and controlled provider-failure acceptance passed)
- Phase 6-EXT-G — Security + Integration: verified complete (automated and core manual integration acceptance passed)
- Phase 6-EXT-H — Documentation + Final Quality Gate: verified complete
- Phase 6-EXT overall — verified complete
- Phase 7A — LLM API Fundamentals: verified complete after automated verification and real Gemini Developer API live acceptance with `gemini-3.1-flash-lite`.
- Phase 7B — Prompt Engineering: verified complete. Its deterministic offline contract verification is supplemented by successful downstream controlled Gemini acceptance through Phases 7C, 7F, 7G, and 7H.
- Phase 7C — Structured Output / Tools: verified complete after offline regression and real Gemini acceptance with `gemini-3.1-flash-lite`.
- Phase 7D — Embeddings: verified complete after automated regression and real local Indonesian/English acceptance with the configurable 384-dimensional `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` model. It provides deterministic catalog text/hash contracts, an offline fake, deterministic batching, and a lazy CPU-first adapter, with no storage or retrieval.
- Phase 7E — Vector DB: verified complete after automated verification and real local acceptance with cached 384-dimensional sentence-transformer vectors. Its derived SQLite/NumPy index provides compatible vector-space isolation, deterministic synchronization, and exact bounded cosine retrieval while canonical product data remains authoritative.
- Phase 7F — RAG: verified complete after automated verification and controlled live acceptance with the cached multilingual embedding model and `gemini-3.1-flash-lite`. The read-only pipeline embeds a query, retrieves from the derived 7E index, re-resolves and freshness-checks current canonical `PublicMenuItem` facts, supplies at most five request-local `menu:N` evidence items to the zero-tool structured LLM path, and validates exact citations.
- Phase 7G — AI Agents: verified complete after automated verification and three-scenario controlled Gemini acceptance. The bounded read-only recommendation agent may search, make one distinct refinement search, finish, or safely report that it cannot complete. It has one semantic `search_menu` tool, at most three decisions, two tool calls, and five request-local evidence items, with immutable request-local state, no persistent memory, and no exposed chain of thought.
- Phase 7H — AI Evaluation: verified complete. The fixed 12-case benchmark progressed from V1 MiniLM (`50.0%` Hit@1) through V2 and hybrid experiments to the user-verified E5 + V2 + hybrid result: Hit@1 `100.0%`, Hit@3 `100.0%`, Recall@5 `100.0%`, MRR `1.0000`, and bilingual both-Hit@1 `100.0%`. Controlled Gemini passed `8/8`, all hard safety gates passed, and human faithfulness/relevance review scored `16/16` each. This is a small controlled benchmark, not a universal accuracy claim.
- Phase 7 — AI Engineering: verified complete. E5 + V2 + hybrid is the preferred verified Phase 8 retrieval handoff; existing MiniLM runtime/default behavior remains unchanged and reproducible.
- Phase 8A–8H: verified complete. Phase 8H reconciles verified deadline/admission, diagnostics/readiness, generated-index recovery, abuse/response bounds, per-message ID/EN answer selection independent of website-language chrome, and a cwd-independent generated E5 index at `<repo>/python/data/sari_rasa_phase8_e5_vectors.db`.
- Phase 8I: **verified complete**. Deterministic integrated evaluation reuses the Phase 7H dataset/metrics and Phase 8 suites, adds a real loopback Node → FastAPI HTTP-contract seam, and repeats the local-only E5 + V2 + hybrid benchmark at 100% Hit@1/Hit@3/Recall@5/bilingual both-Hit@1 and MRR 1.0000. Automated evaluation made no Gemini or external network calls; required live/manual acceptance subsequently passed grounded bilingual and ambiguous-fallback behavior, citation navigation, public-data/read-only boundaries, unsupported-allergen handling, cart/auth smoke, and final health/readiness. These controlled results are not universal accuracy or reliability claims.
- Phase 8J and aggregate Phase 8: **verified complete**. A pre-8J browser finding showed that short Indonesian conversational text could tie the bounded language selector and incorrectly use English UI fallback. The selector now recognizes a small set of general ID/EN conversational markers; focused and complete regressions passed. User-performed browser acceptance confirmed Indonesian response under English UI, English response under Indonesian UI, ambiguous `Soto?` fallback in both UI languages, preserved historical answer text and canonical product names, and functional source navigation/highlighting. The repository is ready for the separately approved Phase-8 Git checkpoint.
- Final Engineering FE-A, FE-B, and FE-C: **verified complete**. FE-A records the conservative single-instance production contract. FE-B adds same-origin production API addressing, explicit sanitized production configuration validation, configurable Node binding, one-hop production proxy trust, and an absolute persistent production database path. FE-C adds guarded first bootstrap plus SQLite-native canonical backup/verification and conservative offline restore with protected Phase 7/Phase 8 boundaries and rollback preservation. FE-C focused tests passed 11/11 and the complete backend suite passed 113/113 without provider calls; FE-D is next and has not started.

See the [Project Roadmap](ROADMAP.md) for the approved phase sequence and current source of truth.

## Detailed documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flows, trust boundaries, and testing design
- [Production Deployment Architecture](docs/PRODUCTION_DEPLOYMENT_ARCHITECTURE.md) — FE-A production topology, persistence/runtime constraints, and vendor-neutral platform criteria
- [Account & Admin Extension](docs/ACCOUNT_ADMIN_EXTENSION.md) — detailed Phase 6-EXT contracts, implementation, and acceptance evidence
- [Local Development Runbook](docs/RUNBOOK.md) — setup, startup, testing, troubleshooting, and safe shutdown
- [Project Roadmap](ROADMAP.md) — verified status and approved future learning direction

## Known operational limitations

- The application is currently oriented around local development, not a documented production deployment.
- The frontend uses `http://localhost:3000` for the explicit local Live Server split and the current HTTPS origin in production. Backend CORS and privileged mutation checks use exact trusted `FRONTEND_ORIGIN`; production requires HTTPS.
- Registration creates normal users. An operator can promote an existing account with `npm run admin:provision -- --email <email>`; there is no bundled admin credential or public promotion endpoint.
- There is no destructive database reset/reseed command. `data/umkm.db` contains persistent local data and is intentionally ignored by Git. Canonical backup, integrity/schema verification, and conservative offline restore commands are documented in the runbook; they refuse protected Phase 7/Phase 8 targets.
- Authentication and registration rate limits are in memory and reset when the backend process restarts.
- Production hardening may add a shared rate-limit store, reviewed reverse-proxy/IP configuration, durable email queue/retry, broader browser coverage, and a production deployment runbook. Local startup orchestration (for example, a future `npm run dev`) is also deferred; current manual multi-process startup is documented in the runbook.
- The PyTorch MLP is an educational experiment, not the production forecasting model. Its generated local artifact is intentionally Git-ignored and must be exported before using the comparison endpoint.

## Phase 6 model result

All three records use the same frozen `2026-06-01` through `2026-09-01` TEST period:

| Role | Model | TEST MAE | TEST RMSE |
|---|---|---:|---:|
| Production | Phase 5 HGB | 135.5097 | 177.6172 |
| Experimental | Phase 6 MLP | 147.2643 | 193.5776 |
| Benchmark | Previous week | 178.3333 | 228.5035 |

MLP MAE is 8.67% higher than HGB, so HGB remains production. The MLP artifact, inference path, model-comparison endpoint, and dashboard panel are implemented but explicitly experimental. Phase 5 TEST outcomes were already known before Phase 6, so the comparison was not psychologically blind; the complete Phase 6 policy was nevertheless frozen using TRAIN/VALIDATION before the first and only Phase 6 TEST prediction, with no post-TEST tuning. Generated datasets and both HGB/MLP artifacts remain local ignored files and are not committed.

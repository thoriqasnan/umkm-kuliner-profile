# Sari Rasa — UMKM Culinary Profile

Sari Rasa is a full-stack learning and portfolio application for a local Indonesian culinary business. Customers can browse a bilingual menu, maintain a guest or account-backed cart, and hand an order off to WhatsApp. Authenticated administrators can manage the product catalog.

The currently implemented system uses a vanilla browser frontend, an Express API, and SQLite persistence. A separate local Python workspace contains the analytics pipeline and deterministic next-day quantity forecasting. The dashboard derives compact cached aggregates from the same 750,000-row V2 history used by ML; its 11 products exactly match the application catalog, and raw rows never leave Python. That source spans 693 days and produces only 664 supervised forecasting observations—not 750,000 ML training examples. The Admin Analytics dashboard now presents the V2 next-day total-demand forecast with independent 7/28-day historical context through the strictly validated FastAPI → Node gateway. All synthetic data is fictional.

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

### Engineering quality

- Permanent backend, database, and frontend regression suites
- Isolated temporary SQLite databases and ephemeral backend ports in tests
- Actual `index.html` ↔ `script.js` element contracts
- Frontend ↔ backend API route and method contracts
- Guards that prevent tests from opening the development database directly, through symlinks, or through hard-link aliases
- Combined `npm test` runner with 98 passing tests

## Technology stack

| Area | Technology |
|---|---|
| Frontend | Semantic HTML, CSS, vanilla browser JavaScript, browser `localStorage` and `<dialog>` APIs |
| Backend | Node.js 22+, Express 5, CommonJS |
| Python data service | FastAPI and Uvicorn (health, analytics, and next-day forecast endpoints) |
| ML development | Pandas/NumPy feature preparation and scikit-learn classical regression evaluation |
| Database | SQLite through `better-sqlite3` |
| Authentication and security | bcrypt password hashing, HMAC-signed cookies, HttpOnly/SameSite/Secure cookie controls, CORS, role middleware, in-memory rate limiting |
| Testing | Node's built-in `node:test` and `node:vm`; pytest and FastAPI `TestClient` for Python |

## Architecture at a glance

```mermaid
flowchart LR
    Browser[Browser<br/>HTML, CSS, JavaScript]
    API[Express API<br/>Node.js]
    DB[(SQLite)]
    PY[Python FastAPI<br/>Analytics]
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

## Core web app quick start

### Prerequisites

- Node.js 22 or later
- npm
- A static frontend server that can serve the repository root at exactly `http://localhost:5500`

Install the locked dependencies:

```sh
npm ci
```

The project does **not** load `.env` files automatically. Generate a random development-only secret in the current shell with the required Node runtime; the command does not print the value:

```sh
export SESSION_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
```

Do not print, share, or store this value in the repository. Then start the backend with that existing value:

```sh
NODE_ENV=development \
SESSION_SECRET="$SESSION_SECRET" \
npm start
```

An unset, blank, or too-short value fails at startup. Do not substitute a public example string merely because it passes the length check; a predictable signing key is unsafe.

The backend starts at `http://localhost:3000` by default. Check it at `http://localhost:3000/api/health`.

Serve the repository root with VS Code Live Server at `http://localhost:5500`. Live Server is external development tooling and is not installed by `npm ci`; configure its port to `5500` if necessary.

Use `localhost` consistently for both origins. Do not mix `localhost` and `127.0.0.1`, because they are different browser origins and can produce different cookie and CORS behavior.

This is only the shortest supported local path. See the [Local Development Runbook](docs/RUNBOOK.md) for detailed setup, operations, and troubleshooting.

The analytics gateway requires FastAPI to start before Node. Follow the runbook's Python-service and Node-to-Python integration sequence; the existing admin dashboard consumes four date-filtered analytics routes plus the independent next-day forecast route through Node.

## Environment variables

| Variable | Required | Current behavior |
|---|---|---|
| `SESSION_SECRET` | Yes | HMAC key for signed session cookies. Startup rejects missing, blank, or shorter-than-16-character values. Use a much longer random value and never commit it. |
| `NODE_ENV` | Yes for explicit runtime mode | `production` enables the cookie's `Secure` flag for HTTPS deployments; `development` keeps the signed HttpOnly cookie usable over local HTTP. |
| `DATABASE_PATH` | No for normal runtime | Defaults to `data/umkm.db`. Under `NODE_ENV=test`, an explicit isolated path is mandatory and aliases to the development database are rejected. |
| `PORT` | No | Defaults to `3000`; accepted values are integers from 1 through 65535. |
| `PYTHON_SERVICE_URL` | No | FastAPI base URL used only by Node analytics routes; defaults to `http://127.0.0.1:8000`. |
| `SARI_RASA_ANALYTICS_DATASET_PATH` | No | Trusted FastAPI analytics CSV path; defaults to generated `python/data/transactions_ml_v2.csv`. Never derive it from a browser request. |

The backend port is configurable, but the current frontend API base URL is fixed to `http://localhost:3000`. Changing `PORT` alone therefore breaks frontend API communication unless the frontend implementation is changed too.

See [.env.example](.env.example) for additional environment safety notes. Copying it to `.env` does not configure the application because no dotenv loader is installed.

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
| Backend and database | 35 | 35 passed |
| Frontend VM and contracts | 63 | 63 passed |
| Combined Node suites | 98 | 98 passed |
| Python data/service | 298 | 298 passed |

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
- Phase 6 deep-learning fundamentals is next; later AI phases remain future work

See the [Project Roadmap](ROADMAP.md) for the approved phase sequence and current source of truth.

## Detailed documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flows, trust boundaries, and testing design
- [Local Development Runbook](docs/RUNBOOK.md) — setup, startup, testing, troubleshooting, and safe shutdown
- [Project Roadmap](ROADMAP.md) — verified status and approved future learning direction

## Known operational limitations

- The application is currently oriented around local development, not a documented production deployment.
- Frontend and CORS origins are fixed to `http://localhost:5500`, and the frontend API URL is fixed to `http://localhost:3000`.
- Registration creates normal users; there is no supported admin-provisioning workflow or bundled admin credential.
- There is no supported development-database reset, backup, or recovery command. `data/umkm.db` contains persistent local data and is intentionally ignored by Git.
- Authentication and registration rate limits are in memory and reset when the backend process restarts.

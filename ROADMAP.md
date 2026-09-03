# Project 1 — UMKM Kuliner Profile
## AI Full-Stack Learning Roadmap

Project ini dimulai sebagai aplikasi web konvensional dan berkembang bertahap menjadi aplikasi full-stack berkemampuan AI. Tujuannya sekaligus edukasional dan portfolio-oriented.

Learning progression:

Frontend → Backend/API → Full-Stack Engineering → Engineering Quality → Python/Data → Machine Learning → Deep Learning Fundamentals → AI Engineering → Full-Stack + AI Integration → Deployment/Portfolio Finalization

## Roadmap Status Legend

- ✅ **VERIFIED COMPLETE** — implementation, automated/static verification, serta required manual acceptance/integration testing selesai.
- 🟡 **PROVISIONALLY COMPLETE** — implementation, automated/static checks, dan review selesai, tetapi feature-group/manual acceptance checkpoint belum dilakukan.
- 🔄 **IN PROGRESS** — pekerjaan fase sedang berlangsung.
- ⏭️ **NEXT** — fase terdekat setelah pekerjaan aktif.
- ⏳ **PLANNED** — arah disetujui tetapi belum diimplementasikan.

## Phase 1 — Frontend Foundation

Status: ✅ **VERIFIED COMPLETE**

Fondasi mencakup semantic HTML, CSS dan responsive UI, JavaScript DOM interaction, rendering menu/product, filtering, internationalization, cart/UI fundamentals, serta WhatsApp checkout flow.

## Phase 2 — Backend & API

Status: ✅ **VERIFIED COMPLETE**

Fondasi mencakup Node.js, Express, REST-style API, komunikasi frontend/backend, CORS, API error handling, dan product data yang disajikan backend.

## Phase 3 — Full-Stack Application

Status: ✅ **VERIFIED COMPLETE**

Kemampuan terverifikasi mencakup SQLite persistence, database-backed products/users, authentication, session handling, authorization dan role-aware behavior, admin product management, UX/error handling, serta persistent cart.

Verified Phase 3D sequence:

```text
Phase 3D — Admin & User Experience                         ✅
├── 3D-1 Frontend Authentication UI                       ✅
├── 3D-2 Authentication State                             ✅
├── 3D-3 Admin Dashboard Foundation                       ✅
├── 3D-4 Admin Product Management UI                      ✅
├── 3D-5 Role-Based UI                                    ✅
├── 3D-6 UX & Error Handling                              ✅
└── 3D-7 Persistent Cart                                  ✅
    ├── 3D-7A Cart State Foundation                       ✅
    ├── 3D-7B Authenticated Cart DB/API                   ✅
    ├── 3D-7C Guest/Auth Integration                      ✅
    └── 3D-7D Integration + Regression                    ✅
```

Exact historical names for Phase 3A/3B/3C are intentionally not reconstructed without repository evidence.

## Quality Gate — Engineering Foundation

Status: ✅ **VERIFIED COMPLETE**

This Quality Gate is intentionally **not Phase 4**. Its purpose is to stabilize the JavaScript full-stack application before Python, data, ML, and AI complexity is added.

### Automated Regression Foundation

Status: ✅ **VERIFIED COMPLETE**

```text
A — Safe Testability Seam                                 ✅ VERIFIED COMPLETE
B — Backend & Database Regression Suite                   ✅ VERIFIED COMPLETE
C — Frontend VM Regression Suite                          ✅ VERIFIED COMPLETE
D — Combined Runner, Safety Audit & Final Integration     ✅ VERIFIED COMPLETE
    Automated verification                                ✅ COMPLETE
    User-performed Safari acceptance                       ✅ COMPLETE
```

The Automated Regression Foundation is ✅ **VERIFIED COMPLETE** after implementation, repeated automated/static verification, specialist and independent review, and explicit user-performed Safari acceptance. Together with the verified Project Documentation / Runbook, it completes the Engineering Foundation Quality Gate.

### Project Documentation / Runbook

Status: ✅ **VERIFIED COMPLETE**

```text
A — Documentation Audit & Plan                         ✅ COMPLETE
B — README & Architecture                              ✅ VERIFIED COMPLETE
C — Setup / Operations Runbook                         ✅ VERIFIED COMPLETE
D — Final Documentation Verification                   ✅ VERIFIED COMPLETE
```

The completed documentation covers local setup, environment variables, frontend/backend startup, test commands, architecture overview, troubleshooting, manual verification, and project learning summary. Final static checks, the 56-test regression suite, independent review, and user-performed manual acceptance have passed.

## Phase 4 — Python & Data

Status: ✅ **VERIFIED COMPLETE**

Phase 4 is the bridge between the verified full-stack engineering foundation and the later Machine Learning and AI Engineering phases. Python will be introduced through application-relevant data problems rather than isolated syntax exercises.

Python will **not** replace the existing Node.js/Express backend. Node.js/Express remains the application-facing backend and gateway; Python is planned as a specialized data-processing service so later ML and AI capabilities can be added without unnecessarily rewriting the existing application architecture.

Target architecture for Phase 4 and later phases:

```text
Browser
  ↓
JavaScript Frontend
  ↓
Node.js / Express
  ├── SQLite
  │
  └── HTTP / JSON
         ↓
      Python Service
         ↓
   Data Processing
         ↓
   ML / AI in later phases
```

This is an approved planning boundary, not a description of currently implemented Python functionality.

### 4A — Python Foundation & Environment

Status: ✅ **VERIFIED COMPLETE**

Verified subphases:

```text
4A-1 Python Foundation Scaffold                          ✅ VERIFIED COMPLETE
4A-2 Core Python Fundamentals & Error Handling            ✅ VERIFIED COMPLETE
4A-3 Python Foundation Finalization                       ✅ VERIFIED COMPLETE
```

4A-1 established a repository-local `.venv`, the minimal `python/` workspace, a small foundation module (`sari_rasa_data.foundation`), and a passing pytest suite. 4A-2 extended `sari_rasa_data.foundation` with list/dict/loop processing, conditions, and function composition over UMKM-style order data, and added a new `sari_rasa_data.io_utils` module for pathlib-based JSON read/write. 4A-3 added a small `__main__.py` entry point so the package can be executed with `python -m sari_rasa_data`, added tests for that entry point, and consolidated documentation for the finished foundation. Independent final verification confirmed deterministic package execution and 36 passing Python tests. At the 4A checkpoint, no Phase 4B data handling, FastAPI, ML, or AI work had started.

Learning objectives:

- Python syntax and core types
- lists and dictionaries
- conditions and loops
- functions
- modules and imports
- exception handling
- filesystem and path fundamentals
- JSON fundamentals
- basic type hints
- `__name__ == "__main__"`
- Python virtual environments
- dependency management

Implementation intent:

- introduce a clean Python workspace inside the repository;
- use an isolated virtual environment;
- establish reproducible Python dependencies;
- create only small, meaningful foundation modules and tests needed for learning; and
- add no user-facing AI or ML feature yet.

4A-1 through 4A-3 together produced this structure:

```text
python/
├── requirements.txt
├── src/
│   └── sari_rasa_data/
│       ├── __init__.py
│       ├── __main__.py
│       ├── foundation.py
│       └── io_utils.py
└── tests/
    ├── test_foundation.py
    ├── test_io_utils.py
    └── test_main.py
```

`__main__.py` lets the package run as `python -m sari_rasa_data`, printing a small deterministic JSON report built entirely from existing `foundation.py` functions. It has no database, network, or filesystem side effects.

At the Phase 4A checkpoint, `pytest` was the only external Python dependency. Phase 4C later added Pandas and NumPy; Phase 4D-1 adds FastAPI and Uvicorn. ML/AI libraries remain future work.

### 4B — Data Handling & Transformation

Status: ✅ **VERIFIED COMPLETE**

Approved subphases:

```text
4B-1 Dataset Foundation & Schema                         ✅ VERIFIED COMPLETE
4B-2 CSV/JSON Loading & Validation                       ✅ VERIFIED COMPLETE
4B-3 Cleaning & Transformation                           ✅ VERIFIED COMPLETE
4B-4 Aggregation & Final Verification                    ✅ VERIFIED COMPLETE
```

4B-1 introduces a small canonical synthetic transaction dataset at `python/data/transactions.csv` and a beginner-readable schema module at `sari_rasa_data.transactions`. The canonical dataset and schema contract passed the complete Python suite and independent read-only review. It does not implement whole-dataset loading, cleaning, transformation, aggregation, analytics, a service, ML, or AI.

4B-2 adds reusable standard-library CSV and JSON loaders that normalize every record through the shared transaction parser and fail clearly on malformed files, shapes, columns, or values. The complete Python suite and independent read-only review passed. At the 4B-2 checkpoint, the normalized dictionaries were JSON-compatible while cleaning, transformation, aggregation, and analytics had not started.

4B-3 adds small transaction-level cleaning and transformation helpers. They trim text through shared validation, normalize only the canonical category/payment vocabularies, reject invalid or unknown business values, and derive `line_total` without mutating caller-owned records. The complete Python suite and independent read-only review passed. Dataset-level aggregation and analytics have not started.

4B-4 adds a small pure-Python aggregation baseline over transformed transaction lines: total revenue, total quantity sold, revenue by category, quantity by product, and daily revenue. It deliberately does not calculate unique order counts or later analytics such as averages, rankings, trends, or statistics. The complete Python suite, deterministic pipeline smoke test, and independent read-only review passed.

Learning objectives:

- CSV and JSON handling
- reading structured datasets
- validation
- cleaning
- transformation
- aggregation
- invalid and missing data handling
- converting processed results to structured JSON

The planned dataset is a synthetic UMKM transaction dataset relevant to the existing application rather than an unrelated tutorial dataset. Potential fields are:

- `order_id`
- `order_date`
- `product_id`
- `product_name`
- `category`
- `quantity`
- `unit_price`
- `payment_method`

4B-2 tests use temporary controlled invalid and missing inputs to exercise validation without changing the canonical dataset. Phase 4B-3 tests extend those cases for cleaning lessons. The canonical dataset introduced in 4B-1 remains valid and clean.

### 4C — Data Analysis with Pandas & NumPy

Status: ✅ **VERIFIED COMPLETE**

Approved subphases:

```text
4C-1 Pandas Foundation & DataFrame                       ✅ VERIFIED COMPLETE
4C-2 Filtering, Grouping & Aggregation                   ✅ VERIFIED COMPLETE
4C-3 NumPy & Basic Statistics                            ✅ VERIFIED COMPLETE
4C-4 Analysis Pipeline & Final Review                    ✅ VERIFIED COMPLETE
```

4C-1 introduces Pandas and NumPy as the only new dependencies and adds a small DataFrame bridge over the verified Phase 4B records. Canonical CSV loading still passes through Phase 4B validation, cleaning, and transformation before DataFrame construction. At the 4C-1 checkpoint, the complete Python suite, deterministic DataFrame smoke test, and independent read-only review passed; filtering, grouping, Pandas analytics, and explicit NumPy analysis had not started.

4C-2 adds canonical-value filters, inclusive ISO date-range filtering, Pandas `groupby` equivalents for the Phase 4B revenue/quantity results, and deterministic product-quantity sorting. The complete Python suite, deterministic smoke analysis, Phase 4B equivalence checks, and independent read-only review passed. Explicit NumPy analysis and statistics have not started.

4C-3 adds `sari_rasa_data.numpy_analysis`, a small function-based module that converts approved numeric DataFrame columns (`quantity`, `unit_price`, `line_total`) into NumPy arrays without mutating the DataFrame, and computes mean, median, min, max, population standard deviation, and percentiles as plain JSON-compatible Python scalars. Statistics on an empty array raise `ValueError` rather than returning NumPy's silent NaN. The complete Python suite, deterministic canonical smoke analysis, and independent read-only review passed.

4C-4 adds `sari_rasa_data.synthetic_data`, a deterministic (fixed-seed) large synthetic transaction generator producing a separate 10,000-line dataset at `python/data/transactions_large.csv`, and `sari_rasa_data.analysis_pipeline`, which composes the existing Phase 4B/4C-1/4C-2/4C-3 functions into one JSON-compatible summary (order-level average order value, category/product/time/payment breakdowns, and NumPy statistics). The small 30-row canonical fixture remains untouched. Implementation, the complete Python test suite, deterministic-regeneration verification, the large-dataset smoke analysis, and independent read-only review all passed. The user then personally performed the manual acceptance walkthrough — inspecting the generated dataset, confirming 10,000 transaction lines, running the integrated analysis pipeline, and verifying both dataset checksums — and it passed. 4C-4 and Phase 4C as a whole are therefore ✅ **VERIFIED COMPLETE**.

Learning objectives:

- Pandas DataFrame fundamentals
- filtering, grouping, aggregation, and sorting
- missing-value handling
- basic descriptive statistics
- DataFrame-to-JSON conversion
- NumPy array and numerical fundamentals sufficient to prepare for ML
- deterministic synthetic data generation
- order-line vs. unique-order metric semantics
- composing an integrated analysis pipeline from smaller verified functions

Phase 4B established plain-Python baselines for total revenue, revenue by category, daily revenue, and quantity sold by product. Phase 4C-2 provides equivalent Pandas filtering and grouped totals plus deterministic product-quantity sorting. Phase 4C-3 adds NumPy-based descriptive statistics (mean, median, min, max, population standard deviation, percentiles) over Pandas numeric columns. Phase 4C-4 adds a larger, pattern-bearing synthetic dataset and an integrated Pandas + NumPy analysis pipeline over it, completing the planned Phase 4C learning arc; user manual acceptance passed on 2026-08-31.

The Phase 4 dataset should be designed so it can potentially continue into Phase 5 Machine Learning instead of being discarded after Phase 4.

### 4D — Python Data Service

Status: ✅ **VERIFIED COMPLETE**

Approved subphases:

```text
4D-1 FastAPI Foundation & Health Endpoint                ✅ VERIFIED COMPLETE
4D-2 Analytics Summary API                               ✅ VERIFIED COMPLETE
4D-3 Products & Categories API                           ✅ VERIFIED COMPLETE
4D-4 Error Handling & Final Verification                 ✅ VERIFIED COMPLETE
```

4D-1 adds an importable `sari_rasa_data.service:app` FastAPI boundary and the intentionally small `GET /health` contract. Health returns `{"status":"ok"}` without reading datasets, running analytics, accessing SQLite, or depending on Node.js. Implementation, 3 targeted service tests, the complete 196-test Python regression suite, documentation, independent review, and user-performed manual API acceptance all passed. Manual acceptance confirmed that Uvicorn started successfully and `GET /health` returned HTTP 200, an `application/json` content type, and the expected response body. 4D-1 is therefore ✅ **VERIFIED COMPLETE**. No analytics endpoint or Node-to-Python integration is implemented at this checkpoint; 4D-2 is the next engineering task.

4D-2 adds `GET /analytics/summary`, a compact JSON contract over the canonical `python/data/transactions.csv` dataset. The thin FastAPI route composes the verified Phase 4B/4C loading and analytics functions at request time and returns total revenue, distinct-order count, total quantity, and order-level average order value as plain numeric JSON values. Its deterministic source-relative path does not depend on the shell working directory or the generated large dataset. Implementation, 7 targeted service tests, the complete 200-test Python suite, documentation, independent review, and user-performed manual API acceptance all passed. Manual acceptance confirmed that `GET /health` returned HTTP 200 with `{"status":"ok"}` and `GET /analytics/summary` returned HTTP 200 with total revenue 745000, 20 unique orders, total quantity 53, and average order value 37250.0. 4D-2 is therefore ✅ **VERIFIED COMPLETE**. Product/category endpoints and Node-to-Python integration are not implemented; 4D-3 is the next engineering task.

4D-3 adds `GET /analytics/products` and `GET /analytics/categories` over the same canonical dataset. Product results contain name, total quantity, and total revenue, ordered by quantity descending and then name ascending; category results contain category and total revenue in alphabetical category order. The service composes the verified loading, product-ranking, and grouped aggregation functions without putting Pandas grouping in the routes. Implementation, 15 targeted service tests, the complete 208-test Python suite, documentation, independent review, and user-performed manual API acceptance all passed. Manual acceptance confirmed that `GET /health`, `GET /analytics/summary`, `GET /analytics/products`, and `GET /analytics/categories` returned HTTP 200 with their expected contracts, including the documented canonical product and category values in deterministic order. 4D-3 is therefore ✅ **VERIFIED COMPLETE**. Broader error handling and final verification remain 4D-4 work, and Node-to-Python integration is not implemented.

4D-4 hardens and verifies the existing service without adding endpoints. Expected dataset, CSV parsing, validation, and analytics failures retain small endpoint-specific public HTTP 500 details while internal exception text and paths remain redacted. Final regression coverage verifies exact success contracts, deterministic ordering, canonical source-relative dataset use, independence from `transactions_large.csv` and the shell working directory, no import-time analytics/data access, and in-process service testing without Uvicorn. The service test dependency declaration was corrected, documentation was finalized, and the complete Python suite and independent cumulative Phase 4D review passed. Final user manual acceptance then confirmed that Uvicorn started successfully, all four endpoints returned their expected canonical responses and deterministic ordering, and the service stopped safely. 4D-4 and Phase 4D are therefore ✅ **VERIFIED COMPLETE**.

Planned minimal service technology:

- FastAPI
- Uvicorn

Learning objectives:

- expose Python functions through HTTP
- API routes and the request/response lifecycle
- structured JSON responses and validation
- service-level error handling
- a health endpoint

Implemented contracts are:

- `GET /health`
- `GET /analytics/summary`
- `GET /analytics/products`
- `GET /analytics/categories`

All four routes above are implemented Python-service contracts. Phase 4E now consumes the three analytics contracts through Node/Express while keeping the browser independent of FastAPI.

### 4E — Node.js ↔ Python Integration

Status: ✅ **VERIFIED COMPLETE**

Target request flow:

```text
Browser
  ↓
Node.js / Express
  ↓ HTTP / JSON
Python / FastAPI
  ↓
Data Processing / Analytics
  ↓
Node.js / Express
  ↓
Browser
```

Learning objectives:

- service-to-service HTTP communication
- Node.js as the application/API gateway
- Python as a specialized data-processing service
- JSON contracts between services
- timeout and failure handling
- controlled errors when Python is unavailable
- preventing frontend crashes when a downstream service fails

The frontend should not directly depend on the Python service unless a later explicitly approved architecture decision changes this boundary. Existing Node.js `fetch` capabilities are the approved minimal direction for Node-to-Python HTTP communication.

Phase 4E adds three application-facing Node routes — `GET /api/analytics/summary`, `GET /api/analytics/products`, and `GET /api/analytics/categories` — backed by a small shared client using Node's built-in `fetch`. `PYTHON_SERVICE_URL` defaults to `http://127.0.0.1:8000`. Successful FastAPI JSON is explicitly validated and forwarded without chart-specific transformation. Requests have a three-second timeout and no retries; timeouts return a controlled HTTP 504, while connection, upstream status, JSON parsing, and response-contract failures return controlled HTTP 502 responses without exposing upstream details. Deterministic mock-upstream integration coverage and the complete 31-test backend plus 26-test frontend regression suites passed. Final user manual integration acceptance then proved the live Node → HTTP → FastAPI success path for summary, products, and categories, plus the controlled failure path: with FastAPI stopped, Node returned the expected HTTP 502 response and remained healthy at `GET /api/health`. Phase 4E is therefore ✅ **VERIFIED COMPLETE**. No frontend analytics UI or direct browser-to-FastAPI dependency was added.

### 4F — Integration & Quality Gate

Status: ✅ **VERIFIED COMPLETE**

Expected verification categories:

- existing Node/backend regression tests
- existing frontend regression tests
- Python tests
- service integration tests
- Node-to-Python failure behavior
- manual acceptance
- documentation verification
- independent review
- Git checkpoint

Exact test counts must come from implementation evidence and are intentionally not defined during planning.

Phase 4F verifies the complete canonical-data → Python analytics → FastAPI → HTTP/JSON → Node gateway chain. The canonical checksum, 213-test Python suite, Python compilation/import checks, exact FastAPI routes, deterministic contracts, 31-test backend suite, 26-test frontend suite, failure behavior, security boundary, dependencies, and documentation all passed focused review. The deterministic mock-upstream suite remains the permanent Node integration test; a spawned-Uvicorn test was not added because it would couple `npm test` to a platform-specific `.venv`, introduce process/port lifecycle races, and duplicate the already-passed live Phase 4E manual acceptance. Final user acceptance then confirmed that the Node analytics summary returned HTTP 200 with the canonical result and Node health remained HTTP 200. Phase 4F and Phase 4 are therefore ✅ **VERIFIED COMPLETE**.

### Phase 4 Technology and Scope Boundaries

Approved minimal technology direction:

- Python 3
- `venv`
- CSV and JSON
- Pandas
- NumPy
- FastAPI
- Uvicorn
- pytest
- existing Node.js `fetch` capabilities for Node-to-Python HTTP communication

Avoid premature infrastructure. Phase 4 must not introduce the following unless separately approved for a concrete later learning objective:

- Docker
- Kubernetes
- Redis
- Celery
- message queues
- Airflow
- a second persistent application database
- cloud deployment infrastructure
- unnecessary Python frameworks
- Machine Learning libraries
- LLM or AI libraries

## Phase 4G — Analytics Dashboard UI

Status: ✅ **VERIFIED COMPLETE**

Phase 4G visualizes the verified Phase 4 analytics contracts inside the existing Admin Dashboard. The approved 4G-6 extension added date-range sales trends through the same Browser → Node/Express → FastAPI → Pandas boundary. The user-reviewed 4G-6R revision makes that selected period a coherent dashboard-wide filter for Summary, Sales Trend, Product Performance, and Revenue by Category while preserving independent endpoint failure states. The frontend continues to talk only to Node/Express; direct frontend-to-FastAPI calls remain explicitly out of scope.

Approved subphases:

```text
4G-1 Analytics Dashboard Foundation        ✅ VERIFIED COMPLETE
4G-2 Analytics API Integration             ✅ VERIFIED COMPLETE
4G-3 Product & Category Visualization      ✅ VERIFIED COMPLETE
4G-4 Responsive & Accessibility            ✅ VERIFIED COMPLETE
4G-5 Regression & Existing Dashboard Acceptance ✅ VERIFIED COMPLETE
4G-6 Sales Trend & Date Range Analytics     ✅ VERIFIED COMPLETE
4G-6R Sales Analytics UX & Global Date Filter Revision ✅ VERIFIED COMPLETE
4G-7 Final Dashboard Acceptance             ✅ MANUAL ACCEPTANCE PASSED
```

The detailed descriptions below preserve the provisional status recorded at each implementation checkpoint. Those provisional statuses are now resolved by the successful 4G-7 user-performed browser acceptance and final engineering verification.

4G-1 adds the static structural foundation only: a new `#adminAnalytics` section inside the existing Admin Dashboard with a dedicated "Analitik" navigation entry, four KPI placeholder cards (neutral `—` values, no fetched or fabricated data), a semantic product-performance `<table>` with an empty `<tbody>`, and an empty category container reserved for a future CSS proportional-bar visualization. No API integration, no chart library, and no backend change were introduced. 4G-1 is 🟡 **PROVISIONALLY COMPLETE**: implementation and automated verification passed, but user-performed manual/browser acceptance has not yet occurred.

4G-2 wires the 4G-1 foundation to the three existing, already-verified Node routes (`GET /api/analytics/summary`, `/api/analytics/products`, `/api/analytics/categories`) — the frontend still calls only Node, never FastAPI directly. It adds a small independent per-section analytics state (`summary`/`products`/`categories`, each with its own `idle`/`loading`/`success`/`empty`/`error` status), lazy-loaded once per admin session on first "Analitik" nav open via `Promise.allSettled` so one section's failure never blanks out another section's success, defensive response validation before rendering (no `NaN`/`undefined` ever shown), a generation/epoch guard in `renderAuthUI()` so a slow response arriving after logout/role-loss/admin-switch is discarded rather than rendered, caching so a succeeded section is not refetched on renavigate while a failed one retries, and reuse of the existing `formatRupiah()`/`.menu-status` conventions. Category data renders as a plain semantic `<ul>/<li>` text list only — no proportional bars, no chart library; that visualization work remains 4G-3. No backend file was modified. The frontend suite grew from 28 to 35 tests (7 new deterministic tests in `tests/frontend/admin-analytics.test.js` covering routing-to-Node-only, partial-failure isolation, empty/malformed-response handling, no-refetch/retry caching, and stale-response discard after logout), and the 31-test backend suite passes unchanged. 4G-2 is 🟡 **PROVISIONALLY COMPLETE**: implementation and automated verification passed, but user-performed manual/browser acceptance has not yet occurred.

4G-3 replaces the temporary category text list with accessible proportional HTML/CSS bars, and polishes product-table readability — both purely presentational over data already loaded by 4G-2, with no new API calls, no chart library, no SVG/canvas, and no backend change. A new pure function `computeCategoryBarWidth(revenue, maxRevenue)` derives a deterministic 0-100 integer bar width from each category's revenue relative to the largest category revenue in the current dataset, guarded against divide-by-zero (all-zero data renders 0%-width bars, never `NaN`/`Infinity`) and clamped to `[0,100]`; the absolute Rupiah revenue remains the displayed business value, with the bar as a purely visual, `aria-hidden` proportion indicator alongside real visible category-name and revenue text. The product table gained numeric alignment/wrapping polish (`text-align:right`, `font-variant-numeric:tabular-nums`, wrapping long names) with no sorting/filtering/pagination and no change to API ordering. All new/changed CSS reuses existing design tokens (`--color-accent`, `--color-bg-soft`, `--color-border`, `--radius`) — no new hardcoded colors. The frontend suite grew from 35 to 38 tests (3 new deterministic tests covering bar-width correctness, all-zero-revenue safety, and product-table order/formatting), and the 31-test backend suite passes unchanged. 4G-3 is 🟡 **PROVISIONALLY COMPLETE**: implementation and automated verification passed, but user-performed manual/browser acceptance has not yet occurred.

4G-4 is a focused responsive/accessibility audit-and-fix pass over the analytics work already built in 4G-1 through 4G-3 — no new analytics features, no new API calls, no new backend/Python change. A read-only accessibility audit of the actual cumulative implementation confirmed heading hierarchy, focus-stealing frequency, renavigate announcement behavior, decorative category-bar markup, KPI card structure, reduced motion, and responsive grid overflow were all already correct, and found three genuine, actionable gaps that were fixed: (1) the scrollable product-table wrapper (`.admin-analytics-table-wrap`) had no keyboard focusability or accessible name distinguishing it from the table it wraps — fixed with `tabindex="0"`, `role="region"`, and `aria-labelledby` pointing at the existing "Performa Produk" heading; (2) `#adminAnalytics` and the table wrapper, both newly/already keyboard-focusable, were missing from the shared `:focus-visible` outline selector list used by every other focusable element on the page — added; (3) the three analytics status regions hardcoded a static `aria-live="polite"` in HTML while JS toggled `role` between `"status"` and `"alert"`, so an explicit (but stale) `aria-live` attribute could override the assertive announcement implied by `role="alert"` — fixed by removing the static attribute and having `showAnalyticsSectionStatus`/`hideAnalyticsSectionStatus` set `aria-live` dynamically in lock-step with `role`. No table-to-cards conversion, no new animation, no new color tokens. The frontend suite grew from 38 to 41 tests (3 new deterministic tests covering the table-wrap accessible-name contract and aria-live/role consistency across error, empty, and success states), and the 31-test backend suite passes unchanged. 4G-4 is 🟡 **PROVISIONALLY COMPLETE**: implementation, the accessibility audit, and automated verification passed, but user-performed manual/browser acceptance (including actual screen-reader and viewport testing) has not yet occurred — that belongs to 4G-5.

4G-5's manual acceptance remains valid evidence for the existing dashboard. The user then approved an additive chart extension before Phase 4G finalization, so Phase 4G remains open.

4G-6 adds `GET /analytics/sales-trend` and the Node gateway route `GET /api/analytics/sales-trend`, with optional inclusive `start_date`/`end_date` query parameters, strict date and response validation, zero/null empty-range results, and redacted service failures. The existing dashboard gains an independently loaded Sales Trend panel with selected-range totals, high/low sales days, native responsive SVG revenue line, keyboard/touch date details, and a visually hidden daily-data table. Successful selected ranges are cached for the current admin identity, overlapping/stale responses are guarded, and failures do not affect Summary, Products, or the preserved Revenue by Category proportional bars. Automated suites and read-only final review passed; browser/manual chart acceptance remains required, so 4G-6 is 🟡 **PROVISIONALLY COMPLETE** and 4G-7 is next.

4G-6R implements the user's manual-review revisions without rewriting the dashboard: the SVG line is marker-free until interaction, a single active marker and clamped tooltip follow the nearest pointer/keyboard-selected date, and a short reduced-motion-aware reveal smooths successful range changes. A dependency-free accessible calendar provides direct month/year selection, day-grid keyboard interaction, Escape/outside close behavior, and mobile containment. Its minimum and maximum dates are derived at request time from the actual transaction dataset through `available_period` metadata in the Sales Trend response; no canonical dates are embedded in frontend production code. Summary, Products, Categories, and Sales Trend all accept the same optional inclusive range and are requested together after Apply. Draft calendar changes do not mutate analytics, caches are range-keyed, each section clears stale data and fails independently, and request/identity guards prevent older ranges from overwriting newer ones. Automated verification passes with 228 Python, 32 backend, and 57 frontend tests plus independent read-only review; 4G-6R is 🟡 **PROVISIONALLY COMPLETE** pending 4G-7 manual acceptance.

4G-7 manual acceptance ✅ **PASSED**. User-performed browser verification covered the Sales Trend marker/tooltip and repeated Apply behavior; desktop, mobile, and short-height calendar placement between the sticky navbar and cart bar; dataset boundary selection; one inclusive applied range across all four analytics sections; keyboard access; bilingual UI; responsive containment; and FastAPI failure/recovery without fabricated data. Final automated verification passed with 228 Python, 32 backend, and 57 frontend tests, plus syntax/import/compile and diff checks. The final focused engineering review found no blocking regression, so Phase 4G is ✅ **VERIFIED COMPLETE**.

Approved minimal technology direction for Phase 4G (unchanged from Phase 4):

- existing vanilla HTML/CSS/JavaScript only
- no React/Vue or frontend build tool
- native SVG for the approved 4G-6 sales trend; no chart dependency
- no direct frontend-to-FastAPI calls

### Phase 4G-R2 — 750K Analytics Alignment & Performance

Status: ✅ **VERIFIED COMPLETE**

This approved refinement aligns the existing Phase 4 dashboard analytics with the generated V2 source `transactions_ml_v2.csv` (750,000 transaction rows, 2024-10-09 through 2026-09-01) without sending raw rows to Node or the browser. FastAPI now uses trusted server-side dataset configuration and a stat-invalidated in-process cache. Each revision is vector-validated once, compacted into daily, daily-product, and daily-category aggregates, and the 750K raw DataFrame is released. Arbitrary supported date filters operate over these aggregates while existing FastAPI, Node, and frontend contracts remain unchanged.

The prior repeated-load benchmark was roughly seven seconds per calculation and 35.5 seconds for five sequential operations. Final local measurements are approximately 2.17–2.21 seconds cold, milliseconds warm, 2.20 seconds for all four sections from a cold cache, and 2.32 seconds through Node for a cold 693-point Sales Trend—within the unchanged three-second timeout. Automated regression, dataset identity checks, focused review, and user-performed browser acceptance pass. The acceptance confirmed the dashboard, V2 period, all four analytics sections, filtering, navigation, responsiveness, and overall 750K integration. It also identified the product-domain mismatch addressed separately by 5F-R2. Phase 5G remains unstarted.

## Phase 5 — Machine Learning

Status: 🔄 **IN PROGRESS**

Goal: learn practical ML using meaningful UMKM data. Expected concepts include problem formulation, dataset preparation, train/validation/test concepts, feature engineering, baseline models, training, metrics, overfitting/underfitting, inference, model persistence, and application integration.

The first approved ML problem is **next-day total quantity sold forecasting**. This aggregate daily-demand target is directly useful for inventory planning, easier to explain and evaluate than a product-level panel forecast, and less dependent on the current fixed product prices than daily revenue. Product-level forecasting and revenue forecasting remain possible later extensions, not part of the first implementation.

### 5A — ML Problem Definition & Dataset Readiness

Status: ✅ **VERIFIED COMPLETE**

The 10,000-line synthetic dataset is structurally clean and sufficient to exercise the future ML pipeline, but it requires generator improvement before meaningful model training. Its current nine-month generator deliberately contains weekend, month, and product-popularity effects, but samples transaction dates independently and has no sustained trend, autoregressive demand process, event/promotion signal, or price variation. Training on it unchanged would overstate the learning value of lag-based forecasting.

The approved supervised-learning shape is one continuous row per calendar date, including zero-sales dates, with next-day total quantity as the target. Known calendar features may include day of week, day of month, month, and weekend status. Lag and rolling features must be derived only from prior observations (for example, lag 1, lag 7, and shifted 7/28-day rolling statistics) to prevent target leakage. Same-day completed-sales fields are not valid prediction-time inputs.

Evaluation must preserve time order. For the current 273-day dataset, the reference split is 191 training days (2025-09-01 through 2026-03-10), 41 validation days (2026-03-11 through 2026-04-20), and 41 untouched test days (2026-04-21 through 2026-05-31), with rolling-feature warm-up handled explicitly. Model selection may use expanding-window validation inside the pre-test period. The future model must be compared with previous-day, previous-week, and trailing-seven-day-mean baselines. MAE is the primary metric and RMSE a secondary metric; percentage error is not primary because zero-demand dates must remain valid.

No ML dependency is installed in 5A. Scikit-learn is the preferred classical-ML dependency for later phases; deep-learning and AI-agent libraries remain out of scope.

### 5B — ML Dataset & Feature Engineering

Status: ✅ **VERIFIED COMPLETE**

Phase 5B adds a separate, ignored `python/data/transactions_ml.csv` generated deterministically from a fixed seed over 2024-01-01 through 2025-12-31. The chronological generator includes product/category demand differences, weekly and monthly structure, gradual growth, autoregressive continuity, known promotion windows, modest product-mix evolution, and random noise. It preserves both the canonical analytics CSV and the Phase 4 large integration dataset.

The verified forecasting pipeline validates transaction rows through the existing Phase 4 boundary, aggregates total quantity onto a continuous daily calendar, fills missing transaction dates with zero, and reconciles daily quantity to raw quantity. Each supervised row predicts the next calendar day's total quantity using target-day calendar fields, lag 1/7/14, and explicitly shifted 7/28-day rolling statistics. Rows without the full 28-day history and the final row without a known target are dropped without imputation. A deterministic chronological 70/15/15 utility returns non-overlapping train, validation, and untouched test frames without shuffling.

Automated verification and focused independent review confirmed determinism, temporal signals, schema validity, daily continuity, zero-day handling, target alignment, rolling-window leakage safety, warm-up policy, and split isolation. No model is trained, selected, scored, persisted, or exposed through an API in this subphase.

### 5C — Baseline Forecast

Status: ✅ **VERIFIED COMPLETE**

Phase 5C implements three deterministic next-day quantity baselines: previous day, previous week, and the mean of the seven actual calendar days immediately before the forecast date. Previous-day and previous-week forecasts reuse the verified `lag_1_quantity` and `lag_7_quantity` alignment. The trailing-seven baseline is calculated from the continuous daily series because Phase 5B's deliberately conservative `rolling_mean_7` feature excludes the origin day and therefore has different semantics.

Evaluation is restricted to the 105-row chronological validation period (2025-06-04 through 2025-09-16). The measured validation results are:

| Baseline | MAE | RMSE |
|---|---:|---:|
| Previous week | 9.3333 | 11.7344 |
| Previous day | 12.2095 | 16.1576 |
| Trailing seven-day mean | 12.4299 | 15.0607 |

**Previous week is the baseline to beat in Phase 5D**, selected by the approved primary metric, MAE. The final 106-row test partition was not evaluated or used for ranking. Reusable metrics validate shapes and reject empty, mismatched, non-numeric, NaN, Infinity, and overflowing residual inputs. Automated verification and focused independent review confirmed forecast alignment, rolling-window history, validation-only selection, metric correctness, deterministic ranking, and final-test isolation. No scikit-learn model is trained in this subphase.

### 5D — Model Training & Evaluation

Status: ✅ **VERIFIED COMPLETE**

Phase 5D adds a reproducible scikit-learn workflow over the approved ten-feature next-day quantity frame. Five scaled Ridge pipelines (`alpha` 0.01, 0.1, 1, 10, 100) and three conservative HistGradientBoosting configurations are fitted on TRAIN and ranked only on VALIDATION MAE, with RMSE as the secondary tie-breaker. Ridge preprocessing is encapsulated in a `Pipeline` and learns only from the training partition.

The selected validation candidate is `HistGradientBoostingRegressor(learning_rate=0.05, max_iter=100, max_leaf_nodes=7, l2_regularization=1.0, early_stopping=False, random_state=20260901)`. It achieved validation MAE `6.9601` and RMSE `8.9508`, improving MAE by `2.3732` units (`25.43%`) over the recomputed previous-week validation baseline MAE `9.3333`. The strongest Ridge configuration (`alpha=100`) achieved validation MAE `7.7654` and RMSE `9.6447`.

Only after model/configuration selection, validation permutation analysis, automated verification, and focused review were complete, the selected specification was rebuilt and refitted on combined TRAIN+VALIDATION data. Its issued selection token then permitted one final TEST evaluation in that process. On the untouched 106-row TEST period, the model achieved MAE `8.1000` and RMSE `11.4012`; the previous-week baseline achieved MAE `14.1792` and RMSE `18.2346`. The model improved TEST MAE by `6.0793` units (`42.87%`). No tuning or feature change followed TEST access.

Permutation importance on VALIDATION identifies day of week and lag-1 quantity as the strongest predictive associations; these are descriptive, not causal or unbiased test-set importance claims. Final TEST diagnostics show larger errors on weekends and deterministic promotion windows, but the model still improves over the baseline in both segments. No model artifact, prediction endpoint, Node route, or UI integration is created in 5D; serving and artifact policy remain Phase 5E work.

### 5E — Prediction Service

Status: ✅ **VERIFIED COMPLETE**

Phase 5E adds a reproducible joblib export for the frozen Phase 5D winner, a versioned metadata contract and fail-closed trusted loader, shared training/serving feature construction, and `GET /analytics/forecast/next-day`. The serving artifact refits the unchanged model on all approved supervised history only after the unbiased Phase 5D evaluation. The generated ML dataset and artifact remain Git-ignored; the endpoint returns a controlled 503 when trusted resources are unavailable or incompatible. No Node or frontend prediction integration is included.

### 5F — Node.js ↔ ML Integration

Status: ✅ **VERIFIED COMPLETE**

Phase 5F extends the existing trusted Node-to-Python client with a strict next-day forecast contract and exposes `GET /api/analytics/forecast/next-day`. Node calls only FastAPI's fixed forecast path using the operator-controlled `PYTHON_SERVICE_URL`, a three-second abort timeout, and no retries. It rejects all query parameters, exact-contract violations, malformed JSON, unsupported model metadata, and non-finite predictions. Timeouts become controlled HTTP 504 responses; network, upstream non-2xx, and invalid-response failures become controlled HTTP 502 responses without leaking Python details. Node performs no feature engineering or inference, and no frontend behavior is added.

### 5F-R — Large-Scale ML V2 Dataset, Retraining & Serving Verification

Status: ✅ **VERIFIED COMPLETE**

This approved refinement preserves the verified V1 experiment and adds a separate deterministic V2 iteration. V2 generates exactly 750,000 transaction rows—not 750,000 supervised examples—across 693 calendar days from 2024-10-09 through 2026-09-01. Daily aggregation and the unchanged ten-feature schema produce 664 supervised next-day observations: TRAIN 479, VALIDATION 92, and a recent TEST holdout of 93 rows.

Validation-only selection over the same predefined five Ridge and three HistGradientBoosting candidates froze `HistGradientBoostingRegressor(learning_rate=0.05, max_iter=150, max_leaf_nodes=15, l2_regularization=2.0, early_stopping=False, random_state=20260901)`. Its validation MAE/RMSE were `149.6509`/`188.4625`, versus previous-week `194.9239`/`246.2086`. After independent pre-test review, one final TEST evaluation produced model MAE/RMSE `135.5097`/`177.6172`, versus previous-week `178.3333`/`228.5035`; no post-test tuning occurred.

The separate ignored `next_day_quantity_v2.joblib` retains artifact schema `1.0` for external API compatibility while recording experiment version `2.0`, exact V2 dataset SHA-256, row counts, boundaries, and frozen parameters. FastAPI and Node both serve the V2 result without contract changes. A 750K analytics benchmark found the current repeated full CSV validation path takes roughly seven seconds per calculation, so shared-load/caching optimization is recommended before using this raw dataset for Phase 5G analytics; the V2 forecast path itself remained within Node's three-second timeout.

### 5F-R2 — 11-Product Domain Alignment & Full Pipeline Reverification

Status: ✅ **VERIFIED COMPLETE**

This approved refinement aligns the active V2 history with the authoritative 11-product application/database seed while preserving exactly 750,000 transaction rows, 693 continuous dates from 2024-10-09 through 2026-09-01, deterministic seed `20260902`, the approved feature semantics, chronological split boundaries, candidate set, and leakage protections. The regenerated CSV is the shared source for Phase 4 analytics and Phase 5 ML V2, with SHA-256 `9d87ac53771e5c4cd3eed39127fe50cb8bdbe749a885c2472cdacfb8e1cd8d3e`.

The regenerated dataset preserves the approved aggregate daily demand series and forecasting-target behavior, while product identities, product-level revenue distribution, categories, and dataset SHA-256 changed. The complete ML pipeline was rerun and reverified against that regenerated source; its validation, selection, TEST, artifact, and serving evidence comes from the rerun rather than being inferred from the preserved aggregate series. Formal integrity checks, analytics reconciliation/cache/performance verification, artifact rebuilding, FastAPI/Node forecast smoke tests, full automated regression, independent review, and user-performed browser acceptance all pass. Manual acceptance confirmed the documented local service startup, admin login, available period, all four analytics sections, shared date filtering, exactly 11 real products in Product Performance, repeated navigation stability, and overall 750K/11-product alignment. The artifact records the new dataset hash plus the 11-product catalog identity. Phase 5G remains unstarted.

### 5G — ML Dashboard UI

Status: ✅ **VERIFIED COMPLETE**

Phase 5G presents the existing verified next-day total-demand forecast in the Admin Analytics dashboard after Sales Trend. FastAPI now returns the latest historical cutoff, inclusive trailing 7- and 28-calendar-day actual-demand averages, and finite percentage comparisons (or `null` when an average is zero). Missing transaction dates contribute zero and incomplete windows fail safely. Node strictly validates the exact nested contract and one-day date invariant while preserving its three-second timeout, no-retry policy, and generic 502/504 failures.

The responsive bilingual panel provides independent loading/error/retry state, locale-aware presentation rounding, neutral comparison wording, provenance, filter-independence guidance, disclaimer, and native expandable model explanation. A successful forecast is reused within the effective-admin lifecycle, global historical filters never refetch it, and logout/admin changes invalidate it with stale-response protection. Automated Python/Node/frontend regression, independent review, CSV verification, and user-performed manual browser acceptance passed. No dataset regeneration, model artifact change, or retraining occurred.

### 5H — Final Integration & Quality Gate

Status: ⏭️ **NEXT / NOT STARTED**

Complete end-to-end verification, documentation, focused review, and required manual acceptance before Phase 5 can be marked verified complete.

## Phase 6 — Deep Learning

Status: ⏳ **PLANNED**

Goal: learn practical deep-learning fundamentals without turning Project 1 into a research project. Expected concepts include neural networks, tensors, training loops, loss, optimization, validation, overfitting, inference, comparison with traditional ML, and deciding when deep learning is appropriate.

Scope remains intentionally smaller than the later AI Engineering phase unless project evidence justifies more. Do not attempt to train a foundation model or LLM from scratch.

## Phase 7 — AI Engineering

Status: ⏳ **PLANNED**

Expected progression:

```text
7A — LLM API Fundamentals
7B — Prompt Engineering
7C — Structured Output / Tool Calling
7D — Embeddings
7E — Vector Database
7F — Retrieval-Augmented Generation (RAG)
7G — AI Agents
7H — AI Evaluation
```

Goals include reliable LLM application design, prompt/system instruction boundaries, structured responses, tool use, retrieval, grounding, vector search, agent workflows, hallucination handling, evaluation, latency/cost awareness, safety, and failure behavior.

A possible direction is an AI-powered UMKM/menu/customer assistant that reasons over current application data rather than a disconnected demo chatbot. Do not implement these features now.

## Phase 8 — Full-Stack + AI Integration

Status: ⏳ **PLANNED**

Goal: combine the application engineering foundation with Python, ML, and AI services as one coherent system.

Expected concerns include frontend/backend/Python communication, authentication and authorization around AI capabilities, structured AI responses, loading/error states, timeouts, retries/fallbacks, rate limits, cost controls, observability, hallucination/failure handling, evaluation integration, and end-to-end regression.

Conceptual architecture:

```text
Frontend
   ↓
Node / Express
   ├── SQLite
   ├── Python Data / ML Service
   └── AI Service
        ├── LLM
        ├── Embeddings / Vector Retrieval
        ├── RAG
        └── Agent workflows
```

This is conceptual, not a frozen architecture decision.

## Final Engineering — Deployment & Portfolio Finalization

Status: ⏳ **PLANNED**

Expected later scope includes deployment architecture, production configuration, environment/secrets management, production database considerations, logging/observability, CI when justified, backup/recovery, security/performance/accessibility review, final automated regression, final manual acceptance, architecture diagram, README/portfolio presentation, screenshots/demo, and interview-ready technical explanation.

Deployment belongs here unless an earlier phase needs a temporary deployment checkpoint for a concrete reason.

## Project 1 Completion Definition

Project 1 may be marked ✅ **VERIFIED COMPLETE** only after Phase 1, Phase 2, Phase 3, the Quality Gate, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, and Final Engineering are individually verified; final regression and required manual acceptance pass; documentation is complete; and the portfolio presentation is ready.

## Scope Discipline

1. Do not skip directly to attractive AI features.
2. Do not add technologies only for résumé keyword value.
3. Every phase needs both a learning purpose and an application purpose.
4. Prefer the minimum architecture that teaches the intended concept.
5. Avoid broad rewrites unless repository evidence requires them.
6. Preserve working behavior while introducing new layers.
7. Automated tests complement rather than replace browser/manual verification.
8. Security must not be weakened for testing or development convenience.
9. A phase is not complete merely because code was generated.
10. Git push always requires separate explicit user approval.

## Roadmap Maintenance Rules

1. Read `ROADMAP.md` before planning or implementing a new phase or subphase.
2. Update `ROADMAP.md` whenever verified project status changes.
3. Status must reflect actual repository and verification evidence.
4. Use 🟡 **PROVISIONALLY COMPLETE** when implementation, automated/static checks, and review pass but required integration/manual acceptance remains.
5. Use ✅ **VERIFIED COMPLETE** only after required verification and manual acceptance pass.
6. Approved new subphases may be added when their parent phase is formally planned.
7. Do not invent unsupported historical phase names or statuses.
8. Do not remove, renumber, skip, or substantially redesign approved future phases without explicit user approval.
9. Future architecture diagrams remain conceptual until formally planned.
10. Update Current Position before the relevant Git checkpoint.
11. A Git checkpoint follows the approved project workflow.
12. Git push always requires separate explicit user approval.
13. Documentation is part of implementation, not an afterthought. Whenever a verified change affects roadmap status, architecture, setup/operations, testing workflow, or portfolio-facing capabilities, update the appropriate Markdown documentation within the relevant phase or checkpoint.
14. Use `ROADMAP.md` for roadmap, subphase, Current Position, and status decisions.
15. Use `README.md` for portfolio-facing implemented capabilities and the project overview.
16. Use `docs/ARCHITECTURE.md` for implemented architecture, data flows, and technical decisions.
17. Use `docs/RUNBOOK.md` for reproducible setup, commands, operations, tests, and troubleshooting.
18. Planned functionality must never be documented as already implemented.

## Project Workflow

```text
Plan
  ↓
Implement
  ↓
Automated Checks
  ↓
Independent Review when appropriate
  ↓
Manual / Integration Acceptance when required
  ↓
Documentation Update
  ↓
Git Checkpoint
  ↓
Push only after explicit user approval
```

A phase is not verified merely because code exists. Use 🟡 **PROVISIONALLY COMPLETE** when implementation, automated/static checks, and review are complete but a required manual or integration acceptance checkpoint remains. Use ✅ **VERIFIED COMPLETE** only after all required verification and manual/integration acceptance have passed.

## Current Position

```text
Phase 1                           ✅ VERIFIED COMPLETE
Phase 2                           ✅ VERIFIED COMPLETE
Phase 3                           ✅ VERIFIED COMPLETE
Quality Gate                      ✅ VERIFIED COMPLETE
  Automated Regression            ✅ VERIFIED COMPLETE
    A Safe Testability Seam       ✅ VERIFIED COMPLETE
    B Backend/DB Suite            ✅ VERIFIED COMPLETE
    C Frontend VM Suite           ✅ VERIFIED COMPLETE
    D Final Integration           ✅ VERIFIED COMPLETE
      Automated verification      ✅ COMPLETE
      User Safari acceptance      ✅ COMPLETE
  Documentation / Runbook         ✅ VERIFIED COMPLETE
    A Documentation Audit & Plan  ✅ COMPLETE
    B README & Architecture       ✅ VERIFIED COMPLETE
    C Setup / Operations Runbook  ✅ VERIFIED COMPLETE
    D Final Doc Verification      ✅ VERIFIED COMPLETE
Phase 4 Python & Data                 ✅ VERIFIED COMPLETE
  4A Python Foundation & Environment ✅ VERIFIED COMPLETE
    4A-1 Python Foundation Scaffold  ✅ VERIFIED COMPLETE
    4A-2 Core Python Fundamentals & Error Handling ✅ VERIFIED COMPLETE
    4A-3 Python Foundation Finalization ✅ VERIFIED COMPLETE
  4B Data Handling & Transformation  ✅ VERIFIED COMPLETE
    4B-1 Dataset Foundation & Schema ✅ VERIFIED COMPLETE
    4B-2 CSV/JSON Loading & Validation ✅ VERIFIED COMPLETE
    4B-3 Cleaning & Transformation   ✅ VERIFIED COMPLETE
    4B-4 Aggregation & Final Verification ✅ VERIFIED COMPLETE
  4C Pandas & NumPy Analysis          ✅ VERIFIED COMPLETE
    4C-1 Pandas Foundation & DataFrame ✅ VERIFIED COMPLETE
    4C-2 Filtering, Grouping & Aggregation ✅ VERIFIED COMPLETE
    4C-3 NumPy & Basic Statistics    ✅ VERIFIED COMPLETE
    4C-4 Analysis Pipeline & Final Review ✅ VERIFIED COMPLETE
  4D Python Data Service              ✅ VERIFIED COMPLETE
    4D-1 FastAPI Foundation & Health Endpoint ✅ VERIFIED COMPLETE
    4D-2 Analytics Summary API        ✅ VERIFIED COMPLETE
    4D-3 Products & Categories API    ✅ VERIFIED COMPLETE
    4D-4 Error Handling & Final Verification ✅ VERIFIED COMPLETE
  4E Node.js ↔ Python Integration  ✅ VERIFIED COMPLETE
  4F Integration & Quality Gate       ✅ VERIFIED COMPLETE
Phase 4G Analytics Dashboard UI       ✅ VERIFIED COMPLETE
  4G-1 Analytics Dashboard Foundation ✅ VERIFIED COMPLETE
  4G-2 Analytics API Integration      ✅ VERIFIED COMPLETE
  4G-3 Product & Category Visualization ✅ VERIFIED COMPLETE
  4G-4 Responsive & Accessibility     ✅ VERIFIED COMPLETE
  4G-5 Existing Dashboard Acceptance  ✅ VERIFIED COMPLETE
  4G-6 Sales Trend & Date Range Analytics ✅ VERIFIED COMPLETE
  4G-6R Sales Analytics UX & Global Date Filter Revision ✅ VERIFIED COMPLETE
  4G-7 Final Dashboard Acceptance     ✅ MANUAL ACCEPTANCE PASSED
  4G-R2 750K Analytics Alignment & Performance ✅ VERIFIED COMPLETE
Phase 5 Machine Learning              🔄 IN PROGRESS
  5A ML Problem Definition & Dataset Readiness ✅ VERIFIED COMPLETE
  5B ML Dataset & Feature Engineering ✅ VERIFIED COMPLETE
  5C Baseline Forecast                ✅ VERIFIED COMPLETE
  5D Model Training & Evaluation      ✅ VERIFIED COMPLETE
  5E Prediction Service               ✅ VERIFIED COMPLETE
  5F Node.js ↔ ML Integration         ✅ VERIFIED COMPLETE
  5F-R Large-Scale ML V2 Dataset, Retraining & Serving Verification ✅ VERIFIED COMPLETE
  5F-R2 11-Product Domain Alignment & Full Pipeline Reverification ✅ VERIFIED COMPLETE
  5G ML Dashboard UI                  ✅ VERIFIED COMPLETE
  5H Final Integration & Quality Gate ⏭️ NEXT / NOT STARTED
Phase 6 Deep Learning Fundamentals    ⏳ PLANNED
Phase 7 AI Engineering                ⏳ PLANNED
Phase 8 Full-Stack + AI Integration   ⏳ PLANNED
Final Engineering                     ⏳ PLANNED
```

The **Quality Gate — Engineering Foundation**, **Phase 4 — Python & Data** (4A through 4F), and the approved post-quality-gate **Phase 4G — Analytics Dashboard UI** extension, including 4G-R2, are ✅ **VERIFIED COMPLETE** after automated/static verification, focused review, and user-performed browser acceptance. **Phase 5 — Machine Learning is in progress: 5A through 5G, 5F-R, and 5F-R2 are verified complete. Phase 5H Final Integration & Quality Gate is next and not started.**

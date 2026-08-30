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

Status: 🔄 **IN PROGRESS**

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

At the Phase 4A checkpoint, `pytest` was the only external Python dependency. Phase 4C later added Pandas and NumPy; FastAPI, Uvicorn, and ML/AI libraries remain future work.

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

Status: ⏭️ **NEXT**

Planned minimal service technology:

- FastAPI
- Uvicorn

Learning objectives:

- expose Python functions through HTTP
- API routes and the request/response lifecycle
- structured JSON responses and validation
- service-level error handling
- a health endpoint

Potential planning targets include:

- `GET /health`
- `GET /analytics/summary`
- `GET /analytics/products`
- `GET /analytics/categories`

These endpoints are planning targets, not currently implemented API contracts.

### 4E — Node.js ↔ Python Integration

Status: ⏳ **NOT STARTED**

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

### 4F — Integration & Quality Gate

Status: ⏳ **NOT STARTED**

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

## Phase 5 — Machine Learning

Status: ⏳ **PLANNED**

Goal: learn practical ML using meaningful UMKM data. Expected concepts include problem formulation, dataset preparation, train/validation/test concepts, feature engineering, baseline models, training, metrics, overfitting/underfitting, inference, model persistence, and application integration.

A possible use case is demand/sales prediction or another data-supported UMKM problem. Do not commit to a model before inspecting the Phase 4 dataset, and avoid AI/ML gimmicks.

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
Phase 4 Python & Data                 🔄 IN PROGRESS
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
  4D Python Data Service              ⏭️ NEXT
  4E Node.js ↔ Python Integration  ⏳ NOT STARTED
  4F Integration & Quality Gate       ⏳ NOT STARTED
Phase 5 Machine Learning              ⏳ PLANNED
Phase 6 Deep Learning Fundamentals    ⏳ PLANNED
Phase 7 AI Engineering                ⏳ PLANNED
Phase 8 Full-Stack + AI Integration   ⏳ PLANNED
Final Engineering                     ⏳ PLANNED
```

The **Quality Gate — Engineering Foundation** is ✅ **VERIFIED COMPLETE**: both the Automated Regression Foundation and Project Documentation / Runbook passed automated, static, independent-review, and required user-performed manual acceptance gates. **Phase 4 — Python & Data** remains in progress: subphases 4A, 4B, and 4C (with 4C-1 through 4C-4) are all verified complete, including the user-performed manual analysis acceptance for 4C-4. Subphase 4D is next; 4E–4F remain not yet started.

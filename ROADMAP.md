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

Status: ⏳ **PLANNED**

Goal: introduce Python through actual application and data problems rather than isolated syntax exercises.

Expected learning areas include Python project structure, virtual environments, variables and data structures, appropriate functions/classes, exceptions, JSON/CSV, data ingestion, cleaning, transformation, aggregation, pandas, NumPy, exploratory data analysis, and connecting Python output or services to the existing application.

A possible direction is UMKM transaction/order/menu analytics using realistic synthetic or application-generated data.

Do not replace Node/Express merely to introduce Python. Preferred conceptual architecture:

```text
Frontend
   ↓
Node / Express
   ├── SQLite
   └── Python data/AI service
```

The exact architecture must be designed when Phase 4 begins from repository evidence at that time.

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
Phase 4 Python & Data             ⏭️ NEXT
Phase 5 Machine Learning          ⏳ PLANNED
Phase 6 Deep Learning             ⏳ PLANNED
Phase 7 AI Engineering            ⏳ PLANNED
Phase 8 Full-Stack + AI           ⏳ PLANNED
Final Engineering                 ⏳ PLANNED
```

The **Quality Gate — Engineering Foundation** is ✅ **VERIFIED COMPLETE**: both the Automated Regression Foundation and Project Documentation / Runbook passed automated, static, independent-review, and required user-performed manual acceptance gates. The next planned phase is **Phase 4 — Python & Data**; it has not started.

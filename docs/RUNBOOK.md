# Local Development Runbook

## Purpose and scope

This runbook explains how to install, configure, start, verify, test, troubleshoot, and safely stop Sari Rasa in its supported local-development setup. It is intended for a first-time contributor, a returning project owner, or a technical reviewer running the repository locally.

For component design and data flows, see [Architecture](ARCHITECTURE.md). For verified project status and future learning phases, see the [Project Roadmap](../ROADMAP.md). This is not a production deployment runbook.

## Supported local environment

You need:

- Node.js 22 or later;
- npm;
- a current browser; and
- a static frontend server capable of serving the repository root at exactly `http://localhost:5500`.

The established frontend workflow uses VS Code Live Server. Live Server is external editor tooling: it is not listed in `package.json` and is not installed by npm.

The current local origin contract is fixed:

| Component | Required local address |
|---|---|
| Frontend | `http://localhost:5500` |
| Backend API | `http://localhost:3000` |

Use the hostname `localhost` consistently. Do not treat `localhost` and `127.0.0.1` as interchangeable: browsers consider them different origins, while the backend CORS allowlist accepts only `http://localhost:5500`.

## Full Local Development Startup

This is the canonical startup procedure for Project 1. There is no repository-provided process orchestrator: start each required long-running process manually and stop it with `Ctrl-C` in the terminal that owns it.

```text
Browser / static frontend (localhost:5500)
        |
        | all application API requests
        v
Node / Express (localhost:3000) <----> SQLite (data/umkm.db)
        |
        | server-to-server HTTP/JSON, analytics/forecast/AI routes
        v
Python FastAPI (127.0.0.1:8000) ---> trusted local datasets/model artifacts
```

The Python process is not involved in authentication, account/admin management, products, carts, password recovery, email delivery, or ordinary menu browsing. It is a separately started long-running service when Admin Analytics, forecasting/model comparison, or the AI menu assistant is needed. Node remains the only application-facing backend; the browser never calls FastAPI directly.

### One-time prerequisites

From the repository root (`umkm-kuliner-profile`):

```sh
npm ci
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r python/requirements.txt
```

Fill the local `.env` according to [Environment configuration](#environment-configuration), without committing or sharing it. The repository-local `.venv` is required for Python commands, but not for Node or Live Server. The ignored V2 dataset and model artifacts must exist before using analytics/forecast features; their verified generation/export commands remain in the maintenance sections below and are not normal startup commands.

### Process 1 — Node/Express backend (required for the website)

- Working directory: repository root.
- Command: `npm start`.
- Long-running: yes; keep it running for all website API, auth/admin, product, cart, recovery, and email functionality.
- Address: `http://localhost:3000` (default).
- Health check: `curl http://localhost:3000/api/health`.
- Stop: press `Ctrl-C` in its terminal.

### Process 2 — frontend / Live Server (required for the website)

- Working directory served: repository root; open `index.html` with VS Code Live Server.
- Command/action: VS Code **Go Live**, configured to port `5500`.
- Long-running: yes; keep it running while using the browser application.
- Address: `http://localhost:5500` exactly; do not substitute `127.0.0.1`.
- Health check: open the URL and confirm product cards replace the loading state.
- Stop: use Live Server's **Port: 5500 / Stop Live Server** action.

### Process 3 — Python FastAPI analytics and AI service (feature-specific)

- Working directory: `python/`.
- Prerequisite: create `.venv` once, install `python/requirements.txt`, and activate it with `source ../.venv/bin/activate`.
- Command: `(set -a && source ../.env && exec uvicorn sari_rasa_data.service:app --reload --app-dir src)`. The subshell exports the ignored root `.env` only to FastAPI and refuses to start Uvicorn if loading that file fails.
- Long-running: yes, but only for Admin Analytics, next-day forecast, model comparison, and the AI menu assistant.
- Address: `http://127.0.0.1:8000`.
- Health check: `curl http://127.0.0.1:8000/health`.
- Stop: press `Ctrl-C` in its terminal.

Normal website development therefore needs two live processes: Node and Live Server. Analytics, forecast, or AI-assistant work needs a third live process, FastAPI. Python tests, dataset generation, model training/export, and the sample `python -m sari_rasa_data` entry point are batch/testing/maintenance commands; they do not remain running and are not prerequisites for ordinary website startup.

## First-time installation

From the repository root, confirm the Node version and install exactly the dependency tree represented by `package-lock.json`:

```sh
node --version
npm ci
```

The Node version must be 22 or later. `npm ci` is the preferred clean, lockfile-driven installation command for a fresh clone. Use `npm install` only when intentionally changing dependencies or regenerating the lockfile; ordinary setup should not change either package file.

No global frontend package is required by this repository. Install or enable VS Code Live Server independently if you choose the established frontend workflow.

## Environment configuration

The application does not include `dotenv`. For local development, `npm start` uses Node's built-in `--env-file-if-exists=.env` support. It loads a local `.env` when present and otherwise keeps using variables supplied by the runtime, so production does not depend on a local file. Existing process environment values and fail-closed validation remain authoritative.

| Variable | Operational requirement |
|---|---|
| `SESSION_SECRET` | Required. Startup rejects missing, blank, or shorter-than-16-character values. Use a much longer random local value and never commit it. |
| `NODE_ENV` | Set to `development` for explicit local mode. `production` enables the session cookie's `Secure` flag; local development keeps the signed HttpOnly cookie usable over HTTP. |
| `HOST` | Development defaults to `127.0.0.1`. Production requires an explicit Node bind address compatible with the single trusted edge/private-hop topology. |
| `PORT` | Optional. Defaults to `3000`; valid values are integer strings from 1 through 65535. |
| `FRONTEND_ORIGIN` | Optional locally; defaults to `http://localhost:5500`. It controls CORS and must exactly match the browser `Origin` for privileged admin mutations. Set it explicitly for deployment; production requires HTTPS. |
| `APP_PUBLIC_ORIGIN` | Optional locally; defaults to `FRONTEND_ORIGIN`. Required explicitly in production. Trusted server origin used to compose reset links; never derived from request headers. It must contain no credentials/path/query/fragment, and production requires HTTPS. |
| `EMAIL_DELIVERY_MODE` | Defaults to `disabled` outside production. Set to `resend` for real delivery; production refuses a missing/disabled provider mode. |
| `RESEND_API_KEY` | Required in `resend` mode. Supply through runtime secrets; never expose it to frontend, logs, source, or examples. |
| `EMAIL_FROM` | Required valid and provider-verified sender address in `resend` mode. |
| `EMAIL_FROM_NAME` | Optional sender display name; defaults to `Sari Rasa`. |
| `DATABASE_PATH` | Optional in development, which defaults to `data/umkm.db`. Production requires an explicit absolute path on durable storage. Tests require an explicit isolated path internally. |
| `DATABASE_BOOTSTRAP_ALLOWED` | Production first-bootstrap guard. Leave `false`/unset for every normal start. Set exactly `true` only when intentionally creating the first canonical database after verifying that `DATABASE_PATH` is the intended empty durable volume. |
| `PYTHON_SERVICE_URL` | Optional locally and required in production. Trusted operator-controlled private FastAPI base URL used by Node; use HTTP/HTTPS without credentials, query, or fragment and never derive it from browser/request input. |
| `PYTHON_AI_SERVICE_URL` | Optional compatible AI-only override. When absent, AI uses `PYTHON_SERVICE_URL`; it remains server-only and must never reach browser code. |
| `SARI_RASA_ANALYTICS_DATASET_PATH` | Optional trusted FastAPI analytics CSV path. Development defaults to generated `python/data/transactions_ml_v2.csv`; tests pass the canonical fixture explicitly. Never derive this path from HTTP input. |
| `SARI_RASA_ML_DATASET_PATH` | Optional trusted V2 source used by production HGB and experimental MLP inference. Defaults to `python/data/transactions_ml_v2.csv`. |
| `SARI_RASA_MODEL_ARTIFACT_PATH` | Optional trusted production HGB artifact path. Defaults to `python/models/next_day_quantity_v2.joblib`. |
| `SARI_RASA_DL_MODEL_ARTIFACT_PATH` | Optional trusted experimental MLP artifact path. Defaults to `python/models/next_day_quantity_mlp_v1.pt`. |

Copy the safe template, then generate a random 32-byte session secret:

```sh
cp .env.example .env
openssl rand -hex 32
```

Paste the generated value after `SESSION_SECRET=` in `.env`. Leave `EMAIL_DELIVERY_MODE=disabled` for normal local development. If you intentionally enable `resend`, add your own `RESEND_API_KEY` and verified sender configuration. Do not print or share these values. `.env` is ignored by Git and must never be committed; production secrets remain deployment-platform/runtime configuration.

Start the backend:

```sh
npm start
```

If the variable is unset, blank, or too short, the server refuses to start. Do not replace this pattern with a public example value: any public string that meets the length check is still predictable and cryptographically unsafe. Never add the local value to documentation, source code, shell scripts committed to Git, or command output shared with others.

For ordinary development, leave `DATABASE_PATH` and `FRONTEND_ORIGIN` unset. The latter defaults to `http://localhost:5500`, and the local Live Server contract continues to call Node at `http://localhost:3000`. Outside that explicit local split, `script.js` uses the page's current HTTP(S) origin so the production edge can route `/api/*` to Node.

## Start the backend

1. Open a terminal at the repository root.
2. Create and fill the local `.env` as shown above.
3. Run `npm start`.
4. Keep that terminal open while using the application.

The backend should report that it is listening on `http://localhost:3000`. Verify the public health endpoint from another terminal:

```sh
curl http://localhost:3000/api/health
```

A healthy response is JSON containing:

```json
{"status":"ok","message":"Backend is running"}
```

Starting the normal backend opens the persistent development database. The first supported startup creates its schema and seeds products as described under [Development database lifecycle](#development-database-lifecycle).

## Start the frontend

With the backend still running:

1. Open the repository root in VS Code.
2. Configure Live Server to use port `5500` if it is not already configured that way.
3. Start Live Server for `index.html` using its normal **Go Live** action.
4. Open `http://localhost:5500` in the browser.

Do not use the Live Server address `http://127.0.0.1:5500` for the authenticated workflow. The exact allowed frontend origin is `http://localhost:5500`.

An optional working layout is:

- terminal 1: backend process;
- VS Code/Live Server: static frontend process; and
- terminal 2: health checks, tests, or development commands.

Both application processes must remain available while exercising browser features that call the API.

## Basic health and smoke verification

After both sides are running, verify only the essential integration path:

1. `curl http://localhost:3000/api/health` returns the healthy JSON fields.
2. `http://localhost:5500` loads without an obvious runtime error.
3. Product cards replace the menu loading state.
4. Category filters respond.
5. The page does not display an API connection error.

This checklist confirms basic startup. Use the automated tests for regression coverage and the [manual verification checklist](#manual-verification-checklist) for the documentation feature-group checkpoint.

## Automated testing

Run both permanent suites in sequence:

```sh
npm test
```

Run a suite independently when narrowing a problem:

```sh
npm run test:backend
npm run test:frontend
```

The final Phase 6-EXT-H regression baseline is recorded after the complete suites run:

| Command | Expected tests | Current result |
|---|---:|---|
| `npm run test:backend` | 72 | 72 passed |
| `npm run test:frontend` | 95 | 95 passed |
| `npm test` | 167 total | 167 passed |

Use these packaged commands without manually setting `NODE_ENV`, `SESSION_SECRET`, or `DATABASE_PATH`. The backend harness creates an isolated temporary SQLite database per test file, chooses an ephemeral HTTP port, restores environment variables, closes its server and database, and removes temporary resources.

Never set test `DATABASE_PATH` to `data/umkm.db`. Test-mode startup intentionally refuses the development database, including canonical/symlink aliases and existing hard links that identify the same file. Frontend tests run `script.js` inside `node:vm`; they do not start the normal backend or make real network calls.

### Password-reset email delivery

Phase 6-EXT-D exposes JSON-only `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`. Both require an `Origin` header that exactly matches `FRONTEND_ORIGIN`. A valid forgot request always returns the same generic `202`, whether the account exists or delivery fails. Reset links are composed exclusively from trusted `APP_PUBLIC_ORIGIN`; request `Host`, `Origin`, and redirect input never select the link destination.

Phase 6-EXT-F uses Resend because its small HTTP API works with Node's built-in `fetch`, adds no package dependency, and keeps vendor concepts inside one adapter. Local development/test defaults to `EMAIL_DELIVERY_MODE=disabled`: it makes no network request and records only a redacted operational failure when delivery is attempted. Automated tests inject a controlled in-memory adapter and never contact Resend. Do not add temporary token or URL logging to work around this boundary.

For controlled real-email acceptance, create a restricted Resend API key and verify the intended sender/domain in Resend. Supply `EMAIL_DELIVERY_MODE=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_FROM_NAME`, and HTTPS `APP_PUBLIC_ORIGIN` through runtime configuration, then restart. Request a reset only for a controlled mailbox, confirm receipt and 30-minute copy, confirm the link uses the exact configured origin, complete one reset, and verify replay fails. Also test an unknown address and an invalid/revoked provider credential: both must retain the same generic `202`. Never paste the key, full reset URL, or token into logs or reports.

Dispatch starts after the generic response finishes. Network/timeout, rejection/authentication, rate limit, and unavailable outcomes log only an allowlisted category; provider bodies, recipient, token, URL, and credential are omitted. There is no automatic retry. A committed token remains unconsumed after delivery failure because the provider may already have accepted it; a new request supersedes it safely.

Reset tokens expire after 30 minutes, are stored only as SHA-256 digests, are superseded by a newer request, and are consumed once. A successful reset atomically replaces the bcrypt hash, consumes all outstanding credentials for the account, increments `token_version`, clears the calling session cookie, and requires normal login. Recovery limiter state remains process-local and resets on restart; a shared store and reviewed proxy/IP configuration remain production prerequisites.

### Account-extension manual acceptance record

The user-performed Phase 6-EXT acceptance is complete and is not inferred from VM tests. Admin listing, promote/demote, search/filter/reset/empty states, confirmations, self-demotion protection, bilingual UI, responsive/mobile layout, keyboard access, zoom/reflow, hidden-page auth revalidation, duplicate-confirm prevention, and role persistence passed. Pagination beyond 25, network failure, and last-admin enforcement remain automated-covered because the manual dataset had only three accounts or the condition is safer and deterministic in tests.

Password recovery passed malformed-email validation, generic existing/nonexistent-account parity, request-new-link and back-to-login state resets, submitting/disabled behavior, mobile layout, URL token scrubbing, password mismatch handling, successful reset, no auto-login, post-reset Login transition and success message, consumed-token replay rejection, old-password rejection, and new-password login. Real Resend acceptance passed receipt, SariRasa sender display, subject **Reset password akun Sari Rasa**, 30-minute expiry wording, configured `localhost:5500` destination, and the complete link/reset flow.

Integrated security acceptance also passed old-session revocation after a reset performed in another browser session. A controlled invalid-provider credential test confirmed the backend still started, the UI remained generic, no email was delivered, and provider/API/internal details did not reach the UI; the real credential was then restored and startup succeeded.

Password visibility passed for Login, Register, both independent Reset Password fields, value preservation, reset-to-hidden on mode changes, Space-key activation, narrow/mobile presentation, and approximately 200% zoom/reflow. The final visual revisions align the right-side controls with the fields and retain a proportional visible focus ring. Safari + VoiceOver may occasionally announce wording containing “Closing” when visibility changes, but manual retest confirmed the navigation stays closed, the dialog stays open, focus remains on the native `type="button"` toggle, `aria-pressed` and bilingual accessible names remain synchronized, and no menu/status state changes. This is accepted as non-blocking platform-specific announcement behavior; do not add a nonstandard accessibility hack to force screen-reader wording.

## Python environment and FastAPI service

This section covers the repository-local Python workspace under `python/`, introduced in Phase 4A and extended with the FastAPI service in Phase 4D. Phase 4E makes Node/Express its application-facing HTTP gateway. The two processes still start separately, and the browser must not call FastAPI directly.

Requires a Homebrew-installed Python 3 (verified with 3.14.7). Do not use the Apple-provided `/usr/bin/python3` as the project baseline; it must remain untouched. Every command below runs inside the project's own virtual environment, never the system/Homebrew Python directly.

The Python workspace uses a project-local virtual environment (`.venv`) at the repository root. `.venv` is local only: it is gitignored and never committed, and each contributor creates their own.

1. Create it once, from the repository root, using the Homebrew-installed `python3`:

   ```sh
   python3 -m venv .venv
   ```

2. Activate it before installing dependencies or running Python commands:

   ```sh
   source .venv/bin/activate
   ```

3. Install the Python requirements inside the active virtual environment:

   ```sh
   python -m pip install -r python/requirements.txt
   ```

   Phase 4C adds Pandas and NumPy alongside pytest. Phase 4D-1 adds FastAPI, Uvicorn, and the HTTP test dependency used by FastAPI's test client. The requirements file is the project's dependency declaration; exact dependency locking is not part of this local learning phase.

4. Run the package as a small example:

   ```sh
   PYTHONPATH=python/src python -m sari_rasa_data
   ```

   This prints a small deterministic JSON report built from a sample UMKM order, demonstrating `if __name__ == "__main__"` and package execution. It has no database, network, or filesystem side effects.

5. Run the Python tests:

   ```sh
   PYTHONPATH=python/src python -m pytest python/tests
   ```

   `PYTHONPATH=python/src` lets pytest import `sari_rasa_data` directly from `python/src` without adding packaging tooling at this early stage. This runs every test file under `python/tests`, including the Phase 4A foundation tests, complete Phase 4B pipeline tests, Phase 4C DataFrame/filtering/grouping/NumPy-statistics tests, the Phase 4C-4 synthetic-generator/integrated-analysis tests, and FastAPI service contract/error tests. Service tests use FastAPI's in-process `TestClient`; Uvicorn does not need to be started manually. The Phase 4C-4 tests generate their own temporary large dataset (they do not depend on `python/data/transactions_large.csv` existing on disk).

### Phase 7A Gemini live acceptance

Phase 7A is **VERIFIED COMPLETE**. Its real Gemini Developer API live acceptance passed with the environment-configured `gemini-3.1-flash-lite` model: `finish_reason: stop`, 37 input / 34 output / 71 total normalized tokens, and 1032 ms latency. The response was successfully normalized through the provider-neutral LLM contract. The focused Gemini adapter tests passed (`24 passed`), as did the complete Phase 7A targeted suite (`47 passed`) and its then-current full Python regression (`388 passed`). At that checkpoint, Phase 7B was automated/technically verified and Phase 7C was verified complete; later downstream evidence and final reconciliation completed Phase 7.

Normal website, analytics, forecast, and the full automated Python suite require no Gemini configuration. The verified model remains environment-configurable through `SARI_RASA_LLM_MODEL`; `gemini-3.1-flash-lite` is the acceptance record, not a code default. For an explicitly authorized future smoke check, select a currently supported Free Tier text model in Google AI Studio, set the four `SARI_RASA_LLM_*` variables in the local environment (never commit or paste the key), then run from the repository root:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.llm_live_acceptance
```

The command sends one fixed harmless fictional-menu prompt with a 48-token output bound and prints only the normalized provider/model, response, finish reason, usage, latency, and correlation ID. The completed acceptance used only this fictional/public-safe menu content. The Free-Tier, zero-cost-first policy remains in effect, and no billing setup was required for Phase 7A. Do not modify the command to send passwords, API/session/reset credentials, cookies, personal email, private account/admin records, sensitive database rows, or confidential business data. Gemini Free Tier data-use terms differ from paid service terms.

The latest Phase 7A+7B+7C targeted regression result is `130 passed`.

### Phase 7B offline prompt verification

Phase 7B is **AUTOMATED/TECHNICALLY VERIFIED**. It has no live-provider or manual acceptance step. Run its deterministic public-menu domain, ID/EN prompt, trust-boundary, grounding, privacy/authority, injection, recommendation, versioning, and Phase 7A compatibility tests from the repository root:

```sh
PYTHONPATH=python/src .venv/bin/python -m pytest python/tests/test_menu_prompts.py -q
```

The focused result is `23 passed`. The Phase 7A+7B offline regression at that checkpoint was `70 passed`. Neither command needs `.env`, an API key, Node, SQLite, FastAPI, a browser, or network access. Fixtures must construct explicit `PublicMenuItem` values; do not substitute the Python `application_catalog` or add a database read. Prompt versions are `phase-7b.customer-menu.v1` and `phase-7b.menu-recommendation.v1`.

### Phase 7C structured/tool verification and live acceptance

Phase 7C is **VERIFIED COMPLETE**. Its focused structured/Gemini/live-acceptance/prompt tests passed, the latest Phase 7A+7B+7C regression passed (`130 passed`), and `git diff --check` passed. Offline tests cover the strict response/source contract, deterministic read-only tool, bounded loop, zero-tool requests, final tool-disabled turn, and mocked Gemini mapping without credentials or network.

```sh
PYTHONPATH=python/src .venv/bin/python -m pytest python/tests/test_llm_structured.py python/tests/test_menu_tools.py python/tests/test_llm_gemini_structured.py python/tests/test_llm_structured_live_acceptance.py python/tests/test_menu_prompts.py -q
```

The latest focused result is `83 passed`. Tests use synthetic `PublicMenuItem` catalogs and `httpx.MockTransport`, so no provider call, `.env`, key, database, Node process, or browser is required. The response schema version is `phase-7c.public-menu-response.v1`. A structured request has zero tools or exactly one registered `search_menu`; its result limit is 1–5, and one request permits at most two sequential calls with repeated-call detection and a final tool-disabled provider turn.

The real Gemini live gate passed with `gemini-3.1-flash-lite` using only fictional/public-safe menu fixtures:

- `structured_response`: PASS; Indonesian; `sources: ["product:7101"]`; zero tool calls; `insufficient_information: false`; strict parsing and source validation passed.
- `tool_calling`: PASS; Indonesian; `sources: ["product:7102"]`; one real `search_menu` execution; `insufficient_information: false`; the final strict response parsed and source-validated successfully.

This satisfies the real structured-response, strict validation, real function-call, bounded-call, trusted source-ID, and public-safe-data gates. No credentials, API keys, session/reset tokens, private customer data, or raw provider responses are acceptance fixtures or output.

For an explicitly authorized future recheck, this command performs the structured-only and required `search_menu` scenarios and prints only sanitized acceptance fields:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.llm_structured_live_acceptance
```

### Phase 7D embedding verification and local acceptance

Phase 7D is **VERIFIED COMPLETE**. Normal tests use the deterministic fake or mocked model objects and require no network or model:

```sh
PYTHONPATH=python/src .venv/bin/python -m pytest python/tests/test_embeddings.py python/tests/test_embedding_sentence_transformers.py -q
```

The focused result is `34 passed`; the Phase 7A–7D regression result is `164 passed`.

The real adapter uses the `sentence-transformers` dependency declared in `python/requirements.txt`, CPU by default, lazy model loading, and offline loading by default. Initial provisioning installed the declared dependency into the project virtual environment and downloaded/cached the public configurable model `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` once from Hugging Face. The model is not bundled with the repository, and no authentication token or paid embedding API is required. Provisioning and offline runtime are separate: provision the dependency and public model cache once while network access is explicitly authorized, then run the acceptance from that local cache.

The first offline acceptance attempt correctly failed because `local_files_only=True` and the model was not yet cached. This was expected safe/offline behavior, not an embedding-contract failure. After one-time provisioning, the exact offline acceptance command succeeded:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.embedding_local_acceptance --model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

The command forces `local_files_only=True`, so a missing cache fails safely rather than downloading. The verified sanitized result was:

```text
phase_7d_local_embedding: PASS
provider: sentence-transformers
model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
languages: id,en
dimensions: 384
```

Acceptance proved that the real local model loads from cache, Indonesian and English embedding both succeed, vectors pass finite/dimension validation with consistent dimensions, the provider-neutral adapter works against a real model, and no paid external embedding API is required. Verification history: focused Phase 7D tests `34 passed`; Phase 7A–7D regression `164 passed`; `git diff --check` passed; real local embedding acceptance PASS.

If a future offline run reports that model files are unavailable, confirm that the dependency and exact configured model were provisioned into the local environment/cache before retrying; do not weaken `local_files_only=True` as a troubleshooting shortcut. Phase 7D contains no SQLite vector persistence, BLOB serialization, cosine similarity search, nearest-neighbor retrieval, ranking, thresholds, RAG, chunking, or agent behavior. Phase 7E owns vector persistence/search.

### Phase 7E vector-store verification and local acceptance

Phase 7E is **VERIFIED COMPLETE**. Its SQLite/NumPy unit path uses temporary databases, deterministic synthetic vectors, no model load, and no network:

```sh
PYTHONPATH=python/src .venv/bin/python -m pytest python/tests/test_vector_contracts.py python/tests/test_vector_store.py -q
```

The focused Phase 7E result is `34 passed`; the Phase 7A–7E regression result is `198 passed`; and the final full Python regression is `539 passed` with one known joblib/loky warning that physical-core detection fell back to logical cores. Tests cover vector-space incompatibility, little-endian float32 round trips, schema/integrity behavior, transactional sync and rollback, reuse without vector rewrite, replacement/metadata/prune outcomes, bilingual identities, exact cosine ranking and filters, deterministic ties, bounded input, corruption failures, and import boundaries.

The default `python/data/sari_rasa_vectors.db` is ignored derived runtime data, not the canonical catalog. Tests and acceptance use temporary paths. The store never calls an embedding model itself: Phase 7D supplies records, and Phase 7E synchronizes/searches them. Phase 7F resolves current canonical products before using retrieval metadata as LLM context.

The controlled real local acceptance passed using the already provisioned Phase 7D public model cache. Its command was:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.vector_local_acceptance --model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

The observed sanitized result was:

```text
phase_7e_local_vector_store: PASS
provider: sentence-transformers
model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
dimensions: 384
languages: id,en
stored_records: 4
top_product_ids: 7501,7501
```

The command uses `local_files_only=True`, CPU, fictional/public menu fixtures, and a temporary SQLite database. It proved real local model loading, bilingual 384-dimensional persistence and round-trip, compatible vector-space checks, real query embedding, and repeated bounded deterministic exact cosine retrieval with validated finite results. It made no Gemini, paid embedding API, external vector database, or default-database call. This smoke does not measure retrieval quality, set a similarity threshold, establish production readiness, or complete RAG. A future missing-cache failure should be handled through the Phase 7D provisioning procedure rather than by weakening offline mode.

Verification history: focused Phase 7E tests `34 passed`; Phase 7A–7E regression `198 passed`; full Python regression `539 passed`; `git diff --check` passed; real local Phase 7E acceptance PASS. The known non-blocking joblib/loky warning fell back from physical-core detection to logical cores. A focused review previously found connection-closure and persisted-metadata-validation issues; both were fixed and retested before final verification.

Phase 7E does not implement persistence of canonical product truth, RAG orchestration, prompts/citations, final product resolution, chunking, or agents.

### Phase 7F RAG verification and controlled live acceptance

Phase 7F is **VERIFIED COMPLETE**. Run its offline contract, canonical-resolution, freshness, bilingual fallback, evidence/source, insufficiency, security, and live-harness tests from the repository root:

```sh
PYTHONPATH=python/src .venv/bin/python -m pytest python/tests/test_rag_contracts.py python/tests/test_rag.py python/tests/test_rag_live_acceptance.py -q
```

The earlier full Python regression passed (`570 passed`) with the known non-blocking joblib/loky physical-core fallback warning. After the final allergen-grounding fix, focused affected tests passed (`24 passed`), the Phase 7A–7F targeted regression passed (`232 passed`), and `git diff --check` passed. Offline tests use fake embeddings, temporary SQLite stores, in-memory canonical catalogs, and fake structured clients; they make no network or model call.

The successful controlled acceptance used the verified Phase 7D model from its local cache and the existing Phase 7A Gemini configuration. Its command was:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.rag_live_acceptance --embedding-model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

The command uses `local_files_only=True`, a temporary Phase 7E database, and three fictional/public-safe products. It builds real bilingual catalog embeddings, then runs two Indonesian scenarios through real exact retrieval, current-catalog resolution, bounded trusted evidence, and Gemini strict zero-tool structured generation. Acceptance passed with embedding model `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` and Gemini model `gemini-3.1-flash-lite`:

- `grounded_factual_retrieval`: PASS; Indonesian, no language fallback, `insufficient_information=false`, source `menu:1`, evidence product IDs `7601,7602,7603`, and no limitations.
- `unsupported_allergen_guarantee`: PASS; Indonesian, no language fallback, `insufficient_information=true`, empty sources, evidence product IDs `7601,7602,7603`, and limitation `Informasi mengenai alergen tidak tersedia dalam katalog.`

Output is sanitized to scenario status, language, source IDs, evidence product IDs, insufficiency/fallback flags, limitations, and provider/model names; it does not print prompts, raw provider responses, API keys, or private data. Any failed scenario exits nonzero. The initial allergen scenario failed because nearby product evidence was not explicitly distinguished from support for an allergen-free guarantee, while the harness reduced the observed valid structured response to a coarse contract error. The final principled fix made `insufficient_information=true` and `sources=[]` explicit for unsupported allergen facts and added sanitized field-level diagnostics. It did not bypass the LLM, weaken source validation, or change the normal retrieval plus zero-tool LLM path. The subsequent run passed both scenarios.

This gate proves integration and grounding-contract correctness, not retrieval quality or a similarity threshold, and it does not constitute Phase 7H evaluation. It required no paid embedding API or external vector database and used only fictional/public-safe catalog data; vector values were not exposed to Gemini.

RAG queries are read-only: they do not synchronize/prune the vector store, rebuild embeddings, or mutate canonical catalog, account, admin, cart, order, or payment state, and they have no SQL, shell, or browser authority.

### Phase 7G agent verification and controlled live acceptance

Phase 7G is **VERIFIED COMPLETE**. The agent has one read-only semantic `search_menu` tool; `get_menu_details` is intentionally absent because fresh search results already contain complete canonical public evidence. Each request has immutable local state, at most three decisions, two distinct sequential searches, and five evidence products, with no persistent memory or chain-of-thought field.

Run the offline agent contracts, controller, acceptance-harness, Gemini mapping, and Phase 7F preservation tests from the repository root:

```sh
PYTHONPATH=python/src .venv/bin/python -m pytest python/tests/test_agent_contracts.py python/tests/test_menu_agent.py python/tests/test_agent_live_acceptance.py python/tests/test_llm_gemini_structured.py python/tests/test_rag_contracts.py python/tests/test_rag.py python/tests/test_rag_live_acceptance.py -q
```

Pre-refactor Phase 7F characterization passed (`30 passed`), and focused Phase 7F passed after retrieval extraction (`35 passed`). The final affected focused suite passed (`99 passed`), the Phase 7A–7G targeted regression passed (`279 passed`), and the full Python regression passed (`620 passed`) with the known non-blocking joblib/loky physical-core fallback warning. Focused review findings for bilingual evidence precedence, scope-gate escapes, and over-strict acceptance call counts were fixed and retested.

The controlled acceptance passed using the already cached Phase 7D model and environment-configured Gemini setup. It uses a temporary Phase 7E database and fictional/public-safe products and prints only sanitized action/count/source/result metadata. Its command was:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.agent_live_acceptance --embedding-model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

The acceptance history records two resolved failures:

- Attempt 1: both menu scenarios returned `cannot_complete` before search because the empty pre-search projection was interpreted as an empty catalog. Explicit `NOT_SEARCHED`/`SEARCH_COMPLETED` state, a search-only initial schema, and rejection of premature terminal actions fixed the ambiguity. Post-fix verification: `68` focused agent/Gemini, `3` harness, `35` Phase 7F, and `283` Phase 7A–7G tests passed; `git diff --check` passed.
- Attempt 2: recommendation and mutation passed, but the allergen scenario returned insufficiency-shaped content under `finish`; strict validation rejected it with `AgentActionValidationError`. Explicit finish-versus-cannot-complete guidance fixed the discriminator without weakening validation or converting invalid output. Post-fix verification: `73` focused affected agent/contract/Gemini, `3` harness, and `288` Phase 7A–7G tests passed; `git diff --check` passed.

Final acceptance passed all three scenarios with Gemini `gemini-3.1-flash-lite` and embeddings from `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`:

- `simple_recommendation`: PASS; two decisions, one search, `finish`, Indonesian, sufficient, observed product `7701`, source `menu:1`, and no limitations.
- `unsupported_allergen_guarantee`: PASS; two decisions, one search, `cannot_complete`, Indonesian, insufficient, observed product `7701`, empty sources, and limitation `Informasi mengenai alergen tidak tersedia dalam katalog.`
- `unsupported_mutation`: PASS; deterministic pre-model `cannot_complete`, zero decisions and calls, Indonesian, insufficient, no observed products or sources, and the read-only-access limitation.

This 3/3 gate proves bounded decisions, application-owned search, canonical grounding, strict terminal semantics, and deterministic mutation refusal. No prompt, vector, provider body, key, secret, private record, or chain of thought is printed. Phase 7H now has accepted V1/V2 retrieval, controlled Gemini, hard-gate, and human-review results; retrieval Experiment #2 remains in progress.

### Phase 7H deterministic evaluation Stage 1

Phase 7H is **VERIFIED COMPLETE**. Its offline path needs no `.env`, secret, network, Gemini call, or sentence-transformer model load. Run the focused foundation tests from the repository root:

```bash
cd python && PYTHONPATH=src python -m pytest -q tests/test_eval_contracts.py tests/test_eval_dataset.py tests/test_eval_metrics.py tests/test_eval_runner.py
```

The dataset is `python/data/phase_7h_eval_v1.json` (`7h-eval-v1`, schema `v1`) and contains exactly 12 retrieval, 14 RAG, 10 agent cases, and four boundary probes. Offline fake embeddings verify contracts, indexing, temporary-SQLite search, and orchestration only; the result deliberately reports semantic retrieval quality as `null`/not run. JSON is written only when a new explicit output path is supplied, and an existing file is never silently overwritten. Quality thresholds, a composite score, controlled Gemini execution, and human rubric scoring are absent.

The exact next gate is a user-authorized local semantic baseline using the already cached `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` with `local_files_only=True`, measuring Hit@1, Hit@3, Recall@5, MRR, and bilingual retrieval agreement over the 12 manually labeled retrieval cases:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.eval_runner --mode local-model --dataset python/data/phase_7h_eval_v1.json --embedding-model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

The runner creates only a temporary Phase 7E database and prints aggregate plus per-case sanitized retrieval results. Add `--output <new-path.json>` only when a machine-readable result is wanted; existing files are not overwritten. The user-run V1 baseline is accepted: Hit@1 `50.0%`, Hit@3 `66.7%`, Recall@5 `88.9%`, MRR `0.6458`, and bilingual both-Hit@1 `16.7%`. English was materially stronger than Indonesian, all English gold products appeared within Top-5, and `ret-paraphrase-id` was the clearest miss. Labels were reviewed as reasonable; do not tune queries, gold labels, projection, model, or retrieval until the initial Phase 7H cycle completes.

The controlled Gemini harness selects exactly eight stable dataset cases (four RAG and four agent, balanced ID/EN), loads the same embedding model cache-only, creates a temporary vector store, then reuses Phase 7F and 7G. It prints only sanitized evaluation and human-review fields and never raw provider payloads or credentials. Its completed historical command was:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.eval_live_acceptance --dataset python/data/phase_7h_eval_v1.json --embedding-model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

Provider/auth/network/rate-limit/timeout/malformed-envelope failures are reported as infrastructure/provider failures rather than quality failures. The completed controlled run passed `8/8` (`4/4` RAG and `4/4` agent), all hard gates passed, and manual faithfulness and relevance review each scored `16/16`.

Pre-live automated verification passed: `30` focused Phase 7H tests, `317` Phase 7A–7H targeted tests, and the final full Python regression `659 passed` with the known non-blocking joblib/loky physical-core detection warning and logical-core fallback.

The controlled evaluation subsequently passed `8/8`, all hard gates passed, and human faithfulness and relevance review each scored `16/16`. Retrieval Experiment #1's verified V2 metrics are Hit@1 `83.3%`, Hit@3 `91.7%`, Recall@5 `97.2%`, MRR `0.8917`, and bilingual both-Hit@1 `66.7%`; V1 remains the stable projection default and its historical numbers are unchanged.

Retrieval Experiment #2's verified MiniLM V2 hybrid result is Hit@1 `83.3%`, Hit@3 `100.0%`, Recall@5 `97.2%`, MRR `0.9167`, and bilingual both-Hit@1 `66.7%`. Its `7h-retrieval-hybrid-v1` formula and `0.05` maximum lexical bonus remain unchanged.

Retrieval Experiment #3 is **SUCCESSFUL / VERIFIED COMPLETE**. The user manually downloaded and evaluated `intfloat/multilingual-e5-base` with `7h-embedding-profile-e5-v1`, 768 dimensions, `7d-catalog-text-v2`, and unchanged `7h-retrieval-hybrid-v1`. The fixed 12-case result was Hit@1 `100.0%`, Hit@3 `100.0%`, Recall@5 `100.0%`, MRR `1.0000`, and bilingual both-Hit@1 `100.0%`. Every case had a gold product at rank one; category recall was complete. E5 + V2 + hybrid is the preferred verified Phase 8 handoff, while MiniLM defaults remain unchanged and reproducible. E5 is materially heavier and doubles vector dimensions from 384 to 768. These scores describe only the small controlled benchmark and do not guarantee arbitrary-query or system-wide accuracy. Phase 7H and aggregate Phase 7 are **VERIFIED COMPLETE**; Phase 8 has not started.

### Phase 8G responsive and accessibility acceptance

Phase 8G is **VERIFIED COMPLETE**. Manual acceptance passed desktop, narrow/mobile (`375x812` included), short-height, cart-bar/floating-control, keyboard, native-dialog focus, citation-navigation, ID/EN presentation, touch-sized viewport, reduced-motion, and VoiceOver checks. Citations remain keyboard focusable and transfer focus/highlight to their menu destination; ordinary dialog close restores focus normally.

VoiceOver announces loading and then the concise localized completion status (for example, “The assistant response is available.”) from the one polite/atomic status live region. The complete AI answer is not automatically read and completion does not move focus. The targeted post-fix checks passed `node --check script.js`, the 35 focused menu-assistant foundation/interaction tests, and `git diff --check`. Phase 8A through 8J and aggregate Phase 8 are **VERIFIED COMPLETE**.

### Phase 8I verified deterministic and manual evaluation

Run the focused integrated selection from the repository root. The Node selection needs permission to bind isolated ephemeral loopback ports; it neither contacts Gemini nor uses a live FastAPI process.

```bash
node --test --test-concurrency=1 tests/backend/ai-contracts.test.js tests/backend/python-ai-client.test.js tests/backend/ai-gateway.test.js tests/backend/ai-integrated-evaluation.test.js tests/frontend/menu-assistant-foundation.test.js tests/frontend/menu-assistant-interaction.test.js
PYTHONPATH=python/src .venv/bin/pytest -q python/tests/test_ai_contracts.py python/tests/test_assistant_runtime.py python/tests/test_assistant_service.py python/tests/test_embedding_profiles.py python/tests/test_hybrid_retrieval.py python/tests/test_eval_contracts.py python/tests/test_eval_dataset.py python/tests/test_eval_metrics.py python/tests/test_eval_runner.py
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.eval_runner --mode offline
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.eval_runner --mode local-model --embedding-model intfloat/multilingual-e5-base --embedding-profile 7h-embedding-profile-e5-v1 --semantic-text-version 7d-catalog-text-v2 --retrieval-policy 7h-retrieval-hybrid-v1
```

Recorded 8I deterministic evidence is 66/66 Node/frontend tests, 145/145 Python tests, offline RAG contract validity 100% with safety/agent gates passing and 4/4 boundary probes, and the 12-case explicit E5 profile at 100% Hit@1, Hit@3, Recall@5, and bilingual both-Hit@1 with MRR 1.0000. The local model is loaded with `local_files_only=True`. Gemini/network call count is zero.

Phase 8I is **VERIFIED COMPLETE**. Manual acceptance started FastAPI from `<repo>/python` with root `.env`, then confirmed FastAPI `/health` and Node `/api/health`. Cold readiness correctly returned `not_ready`, profile `phase-8.customer-menu-e5-v1`, reason `runtime_prerequisite_unavailable`, configured provider, and no provider probe. The first Indonesian grounded request lazily initialized the runtime and recommended canonical Soto Ayam Kampung; readiness then became `ready` with empty reasons while provider configuration remained configured and unprobed.

The browser passed English response under Indonesian UI with the prior Indonesian response preserved, Indonesian `Soto?` fallback, English assistant chrome, and a later successful English `Soto?` fallback with English `Menu sources`. The panel was closed and reopened for the English-chrome screenshot, so that screenshot was not treated as new historical-answer-preservation evidence; preservation was already accepted separately and covered automatically. Canonical product naming and grounding were preserved, citation activation navigated/scrolled/highlighted the corresponding card, private registered-user email disclosure was refused, account-role mutation was refused as outside read-only public-menu authority, and the assistant did not claim peanut-allergy safety when catalog ingredient/allergen facts were unavailable. Cart and authentication smoke passed. Final FastAPI health, ready local runtime/index state, configured/unprobed provider visibility, and Node health all passed.

During the English ambiguous check, an initial request produced matching sanitized `provider.unavailable` / `ai_runtime_unavailable` (`503`) evidence, and one controlled retry produced `provider.timeout` / `upstream_timeout` (`504`). The browser showed distinct safe public errors. Without service restart, health stayed good, readiness stayed locally ready, and a later single retry succeeded. Record this only as observed provider failure and later recovery; do not infer a raw external cause or classify it as an E5/index/Node/browser defect. These events do not explain the older historical temporary 502, whose root cause remains **UNKNOWN**.

`/health` is cheap liveness. `/ai/readiness` reports local runtime/index readiness and static provider configuration with `provider_probe=not_performed`; it does not prove provider reachability, credential validity, quota, model availability, or successful inference. The naturally observed timeout was not intentionally forced. Destructive live index corruption was not performed. Admission/rate limiting remains process-local, and recovery remains bounded to the dedicated rebuildable Phase 8 index with canonical application and Phase 7 vector databases protected. Controlled benchmark results are not universal accuracy or reliability evidence.

Phase 8H-R1 is **VERIFIED COMPLETE**. The browser still sends `{ "message": "...", "language": "id|en" }`, where `language` is the interface/fallback language. Manual acceptance passed UI EN + EN/ID, UI ID + ID/EN, and ambiguous `Soto?` fallback in both UI languages. Panel chrome, accessibility/status/error labels, and `Menu sources`/`Sumber menu` remain website-localized; response language is per-message, historical answers are not rewritten, canonical product names are not translated, and citations remain grounded and functional. Because `npm start` does not watch CommonJS modules, restart Node after Node/lib changes; the first cross-language attempt used stale pre-R1 modules and passed after restart.

Phase 8H-R2 is **VERIFIED COMPLETE**. The Phase 8 generated E5 index is source-anchored to `<repo>/python/data/sari_rasa_phase8_e5_vectors.db`; the startup command below resolves that file from `<repo>/python`, and arbitrary startup working directories do not change the default. Automated verification passed 78 focused runtime/service tests without real E5/Gemini/network initialization. Manual acceptance restarted FastAPI using the documented procedure, completed a live request, and confirmed the intended index remained active while the old nested artifact was untouched. After FastAPI stopped, only the verified disposable nested artifact was removed; `python/python/` no longer appears in Git status. Do not broaden `.gitignore` beyond the intended generated-index target.

For 8H-3, never delete `data/umkm.db` or manually substitute it for the generated index. Recovery may rebuild only `python/data/sari_rasa_phase8_e5_vectors.db` after recognized corruption or incompatibility, once per synchronized request path and under its process lock; transient/unknown failures remain unavailable rather than destructive. Live destructive corruption and controlled provider timeout were intentionally not forced, while deterministic automated tests cover those edges. The public route applies 30 requests/60 seconds before the 4 KiB parser and retains 10 accepted requests/60 seconds before expensive work; both are process-local and reset on restart. FastAPI output is bounded to a 4,000-character answer, ten 256-character limitations, and five sources, while Node rejects FastAPI bodies above 32 KiB.

The completed consolidated manual run passed guarded root-`.env` startup, `/health`, cold-unavailable and initialized-ready readiness, `provider_configuration=configured`, `provider_probe=not_performed`, live grounded EN/ID requests, safe malformed and over-4-KiB rejection followed by normal recovery, two concurrent successes, fast third-request saturation and slot recovery, sanitized FastAPI failure logging, Node/FastAPI correlation propagation, healthy service after failure/saturation, and browser AI/citation navigation-highlight/cart/auth-login smoke. The historical temporary 502 root cause remains **UNKNOWN**; do not attribute it to R1 or R2.

A broader Phase 8H-3 Python selection previously produced **203 passed + 2 failures** associated with module-reload/order-sensitive identity behavior. Both affected files passed independently: `test_llm_client.py` **13 passed** and `test_llm_gemini_structured.py` **23 passed**. Phase 8J checked the complete combined order: the full Python run passed `800` tests and did not reproduce the historical identity failures.

### Phase 8J final regression and completed browser language gate

Phase 8J is **VERIFIED COMPLETE**. Before the fix, the exact selector test for UI fallback `en` plus `sepertinya enak ya` failed because none of its tokens existed in either bounded signal set; the zero/zero tie fell back to English. The selector now includes a small set of general Indonesian and English conversational markers. It still selects per current message, retains UI language only as genuine ambiguity fallback, sends no conversation history, and makes no detection network/provider call.

Focused results are `11 passed` for selector cases, `72 passed` for AI contracts/service, and `36 passed` for the historically affected Python pair. Complete results are backend `102 passed`, frontend `131 passed`, and Python `800 passed` with one known logical-core fallback warning. The historical `203 passed + 2 failures` did not reproduce in either combined run, and its historical root cause is not claimed as proven. One unrelated password-reset response-time-envelope assertion failed on the first complete backend attempt, then passed in the unchanged isolated file (`16 passed`) and unchanged complete backend rerun (`102 passed`).

The user completed the browser gate after restarting the changed Python service:

1. Under English UI, `sepertinya enak ya` produced an Indonesian answer while panel chrome remained English — PASS.
2. Under Indonesian UI, `looks really tasty` produced an English answer while panel chrome remained Indonesian — PASS.
3. `Soto?` followed English fallback under English UI and Indonesian fallback under Indonesian UI — PASS.
4. Earlier assistant answer text was not rewritten after website-language changes — PASS.
5. Canonical product names remained unchanged, and product-source navigation/highlighting remained functional — PASS.

Phase 8J and aggregate Phase 8 are **VERIFIED COMPLETE**. The repository is **READY FOR PHASE-8 GIT CHECKPOINT**; commit and push require separate explicit user approval.

### Final Engineering FE-A production planning handoff

FE-A is **VERIFIED COMPLETE** and created no production commands, manifests, containers, services, or cloud resources. Its [Production Deployment Architecture Contract](PRODUCTION_DEPLOYMENT_ARCHITECTURE.md) is the operator-facing source for the approved single-instance topology, persistent-versus-rebuildable classification, proxy/origin requirements, E5 sizing evidence, and vendor-neutral platform criteria. Existing commands in this runbook remain local-development and verified historical procedures; they must not be presented as a completed production deployment.

FE-B is **VERIFIED COMPLETE** with no manual acceptance gate. Production startup now fails closed unless `HOST`, HTTPS `FRONTEND_ORIGIN`, HTTPS `APP_PUBLIC_ORIGIN`, absolute persistent `DATABASE_PATH`, and private `PYTHON_SERVICE_URL` are explicit. Production trusts exactly one edge proxy hop; development/test trusts none. Focused tests passed 60/60, backend passed 106/106, and frontend passed 132/132.

FE-C is **VERIFIED COMPLETE** with no manual acceptance gate. It adds guarded first bootstrap plus repository-native canonical SQLite backup, verification, and conservative offline restore. Focused temporary-fixture tests passed 11/11 and the complete backend suite passed 113/113. These commands are persistence maintenance, not a completed production deployment; FE-D remains **NEXT / NOT STARTED**.

### Start and check the Python service

Start the local-only service on `http://127.0.0.1:8000` using the repository's
`src` layout explicitly:

```sh
cd ~/umkm-kuliner-profile/python
source ../.venv/bin/activate
(set -a && source ../.env && exec uvicorn sari_rasa_data.service:app --reload --app-dir src)
```

In another terminal, check the service health endpoint:

```sh
curl --fail-with-body -i http://127.0.0.1:8000/health
```

Expect HTTP `200`, a JSON content type, and this response body:

```json
{"status":"ok"}
```

For AI diagnostics, `GET /ai/readiness` remains a cheap local/static check. Its top-level `status` and `reasons` describe only the local E5/index runtime state. `provider_configuration` is a sanitized static configuration classification and `provider_probe` is always `not_performed`. It does not contact Gemini and does not prove network reachability, credential validity, quota, model availability, or successful inference. The startup command above loads the same ignored root `.env` used by `npm start`; it does not print its values.

The URL can also be opened at `http://127.0.0.1:8000/health` in a browser. Return to the Uvicorn terminal and press `Ctrl-C` to stop the service safely. The health route proves only that the Python HTTP service is running: it does not read either transaction dataset, access SQLite, perform analytics, or depend on Node/Express.

Check the compact analytics summary derived from the active 11-product V2 dataset:

```sh
curl --fail-with-body -i http://127.0.0.1:8000/analytics/summary
```

Expect HTTP `200`, a JSON content type, and these current totals:

```json
{"total_revenue":22652354000,"unique_orders":421130,"total_quantity":1657168,"average_order_value":53789.456937287774}
```

The summary uses numeric JSON values and counts distinct `order_id` values for `unique_orders`; average order value is total revenue divided by those orders. The trusted default path is `python/data/transactions_ml_v2.csv`. Ordinary automated tests explicitly substitute the unchanged canonical `transactions.csv` fixture for speed and deterministic small-fixture contracts.

Check product analytics:

```sh
curl --fail-with-body -i http://127.0.0.1:8000/analytics/products
```

The `products` array contains `product_name`, numeric `total_quantity`, and numeric `total_revenue`. Products are ordered by total quantity descending, then product name ascending when quantities tie.

Check category analytics:

```sh
curl --fail-with-body -i http://127.0.0.1:8000/analytics/categories
curl --fail-with-body -i 'http://127.0.0.1:8000/analytics/sales-trend?start_date=2026-07-01&end_date=2026-07-15'
```

The `categories` array contains `category` and numeric `total_revenue`, ordered alphabetically by category. Runtime analytics use the trusted configured dataset (V2 by default); deterministic unit tests continue to pass the canonical fixture explicitly. Neither dataset is selected by browser input.

If configured dataset loading, validation, or analytics fails, the analytics routes return HTTP `500` with a stable generic endpoint detail. Responses do not expose exception text, filesystem paths, Pandas details, or other internals. Do not modify either real dataset to test this behavior; automated tests use controlled temporary fixtures.

### Verify Node-to-Python analytics integration

Keep the FastAPI service running on `127.0.0.1:8000`. In a second terminal, start Node with its normal development variables. The default Python URL needs no extra setting; an explicit equivalent is:

```sh
NODE_ENV=development \
SESSION_SECRET="$SESSION_SECRET" \
PYTHON_SERVICE_URL=http://127.0.0.1:8000 \
npm start
```

In a third terminal, call the application-facing Node routes:

```sh
curl --fail-with-body -i http://localhost:3000/api/analytics/summary
curl --fail-with-body -i http://localhost:3000/api/analytics/products
curl --fail-with-body -i http://localhost:3000/api/analytics/categories
curl --fail-with-body -i 'http://localhost:3000/api/analytics/sales-trend?start_date=2026-07-01&end_date=2026-07-15'

# The same optional inclusive period is supported by every analytics route.
curl --fail-with-body -i 'http://localhost:3000/api/analytics/summary?start_date=2026-07-05&end_date=2026-07-10'
curl --fail-with-body -i 'http://localhost:3000/api/analytics/products?start_date=2026-07-05&end_date=2026-07-10'
curl --fail-with-body -i 'http://localhost:3000/api/analytics/categories?start_date=2026-07-05&end_date=2026-07-10'
```

Node calls the matching FastAPI routes and returns the validated JSON unchanged. The gateway has a three-second timeout and no retries. A timeout returns HTTP `504`; an unavailable service, non-2xx upstream response, invalid JSON, or invalid response contract returns HTTP `502`. Both use the existing Node `{status:"error", message:"..."}` shape without exposing upstream bodies, paths, or network errors.

For a safe failure check, stop only FastAPI with `Ctrl-C`, call `http://localhost:3000/api/analytics/summary` again, and confirm the controlled HTTP `502` response. Then call `http://localhost:3000/api/health` to confirm Node remains running. This workflow requires no frontend changes.

### Phase 4G-R2 — V2 analytics source and cache verification

Before starting FastAPI, verify the generated V2 source:

```sh
wc -l python/data/transactions_ml_v2.csv
shasum -a 256 python/data/transactions_ml_v2.csv
```

Expected: 750,001 lines and SHA-256 `9d87ac53771e5c4cd3eed39127fe50cb8bdbe749a885c2472cdacfb8e1cd8d3e`. The default configuration uses this 11-product source. An explicit equivalent is:

```sh
SARI_RASA_ANALYTICS_DATASET_PATH=python/data/transactions_ml_v2.csv \
PYTHONPATH=python/src .venv/bin/uvicorn sari_rasa_data.service:app --host 127.0.0.1 --port 8000
```

The first request vector-validates and compacts the file. Unchanged requests reuse daily, daily-product, and daily-category aggregates. The cache reloads when resolved path, device, inode, size, or nanosecond mtime changes; restarting FastAPI starts empty. Stop requests while regenerating the CSV. An invalid revision returns controlled errors and is never installed as a valid snapshot.

Verify the range and compact trend through Node:

```sh
curl --fail-with-body http://localhost:3000/api/analytics/sales-trend | \
  .venv/bin/python -c "import json,sys; d=json.load(sys.stdin); print(d['available_period'], len(d['daily_sales']))"
```

Expected: `2024-10-09` through `2026-09-01`, with 693 daily points—not raw transactions.

Cold/warm benchmark:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
import time
from sari_rasa_data.analytics_store import ANALYTICS_DATASET_CACHE, V2_ANALYTICS_PATH as p
from sari_rasa_data.service import build_analytics_summary, build_products_analytics, build_categories_analytics, build_sales_trend_analytics
calls=[('summary',build_analytics_summary),('products',build_products_analytics),('categories',build_categories_analytics),('trend',build_sales_trend_analytics)]
for name,fn in calls:
    ANALYTICS_DATASET_CACHE.clear(); t=time.perf_counter(); fn(p); print('cold',name,time.perf_counter()-t)
ANALYTICS_DATASET_CACHE.clear(); build_analytics_summary(p)
for name,fn in calls:
    t=time.perf_counter(); fn(p); print('warm',name,time.perf_counter()-t)
"
```

Final recorded cold timings: 2.208 s summary, 2.189 s products, 2.195 s categories, 2.166 s trend. Warm timings: 0.0005 s, 0.0036 s, 0.0008 s, 0.0016 s. Four-section cold/warm sequences took 2.198 s/0.0066 s; cold/warm FastAPI took 2.215 s/0.0025 s; cold/warm Node took 2.320 s/0.0045 s. Node's three-second timeout remains unchanged. If identity checks fail, regenerate V2; never silently fall back or expose a filesystem path to clients.

6. Leave the virtual environment when finished:

   ```sh
   deactivate
   ```

Activating or leaving `.venv` has no effect on the Node.js backend, frontend, or SQLite database, and does not require restarting them. This Python workspace is unrelated to the Node `.env`/`.env.example` files described earlier in this runbook; `.venv` is a Python virtual environment directory, not an environment-variable file.

Phase 4A is **VERIFIED COMPLETE** after automated tests, deterministic package execution, the user-performed runtime smoke test, and independent final verification. Conceptual explanations are not a technical completion gate; they can be consolidated separately into Learning Notes using the implementation and commands documented here.

### Inspect the synthetic transaction dataset

Phase 4B-1 uses the human-readable canonical CSV at `python/data/transactions.csv`. To inspect its header and first five synthetic rows without changing the file, run from the repository root:

```sh
sed -n '1,6p' python/data/transactions.csv
```

The complete Python test command above verifies that every canonical row matches the schema in `python/src/sari_rasa_data/transactions.py`. No database or service needs to be running.

### Phase 4C-4 — large synthetic dataset and integrated analysis (verified complete)

Phase 4C-4 adds a separate, larger synthetic dataset for meaningful Pandas + NumPy analysis. It is generated on demand and is distinct from the small canonical fixture above.

**Do not overwrite `python/data/transactions.csv`.** It is the small 30-row canonical regression fixture used by the Phase 4B/4C-1/4C-2/4C-3 tests, and every command below writes to a different path.

Generate (or regenerate) the 10,000-row large dataset at `python/data/transactions_large.csv`, using the documented fixed seed:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
from sari_rasa_data.synthetic_data import write_synthetic_transactions_csv, DEFAULT_ROW_COUNT, DEFAULT_SEED
count = write_synthetic_transactions_csv(
    'python/data/transactions_large.csv', row_count=DEFAULT_ROW_COUNT, seed=DEFAULT_SEED
)
print(f'wrote {count} rows')
"
```

Running this again with the same `row_count`/`seed` reproduces a byte-identical file; it does not touch the canonical fixture.

Run the integrated analysis over the generated file and print the JSON summary (dataset overview, sales totals including order-level average order value, category/product/time/payment breakdowns, and NumPy statistics):

```sh
PYTHONPATH=python/src .venv/bin/python -c "
import json
from sari_rasa_data.analysis_pipeline import analyze_transactions
print(json.dumps(analyze_transactions('python/data/transactions_large.csv'), indent=2, ensure_ascii=False))
"
```

To experiment safely, change only the `seed` (or `row_count`) argument and write to a **different** filename, for example `python/data/transactions_experiment.csv`, then point `analyze_transactions(...)` at that path instead. This regenerates a new, still-deterministic dataset without touching `transactions_large.csv` or the canonical `transactions.csv`.

### Phase 5B — generate and inspect the ML-development dataset

The forecasting-development dataset is separate from both existing transaction files. Generate its deterministic two-year default version from the repository root:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
from sari_rasa_data.ml_synthetic_data import write_ml_transactions_csv
count = write_ml_transactions_csv('python/data/transactions_ml.csv')
print(f'wrote {count} rows')
"
```

`python/data/transactions_ml.csv` is ignored by Git and can be regenerated. The writer refuses the canonical `python/data/transactions.csv` path. Do not substitute this generated ML file for the canonical FastAPI analytics dataset.

Build the continuous daily series, leakage-safe supervised frame, and chronological 70/15/15 partitions without training a model:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
from sari_rasa_data.forecasting import (
    load_daily_quantity_series,
    build_next_day_quantity_features,
    chronological_split,
)
daily = load_daily_quantity_series('python/data/transactions_ml.csv')
supervised = build_next_day_quantity_features(daily)
splits = chronological_split(supervised)
print('daily rows:', len(daily))
print('supervised rows:', len(supervised))
for name, frame in splits.items():
    print(name, len(frame), frame['forecast_date'].min(), frame['forecast_date'].max())
"
```

This command only prepares DataFrames. It does not fit, evaluate, or persist a model. Missing transaction dates are filled with zero daily quantity; feature warm-up rows and the final row without a known next-day target are dropped explicitly.

### Phase 5C — reproduce validation-only baseline evaluation

Generate `transactions_ml.csv` as above, then evaluate the three approved baselines only on the chronological validation frame:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
import json
from sari_rasa_data.baseline_forecasting import evaluate_validation_baselines
from sari_rasa_data.forecasting import (
    load_daily_quantity_series,
    build_next_day_quantity_features,
    chronological_split,
)
daily = load_daily_quantity_series('python/data/transactions_ml.csv')
supervised = build_next_day_quantity_features(daily)
validation = chronological_split(supervised)['validation']
print(json.dumps(evaluate_validation_baselines(validation, daily), indent=2))
"
```

For the fixed seed, previous week is the validation baseline to beat (MAE `9.3333`, RMSE `11.7344`). The command selects only `['validation']`; do not substitute `['test']`. Phase 5C intentionally leaves the final 106-row test period untouched and does not train a model.

### Phase 5D — reproduce model selection and final evaluation

Install the updated Python requirements before running Phase 5D commands:

```sh
.venv/bin/python -m pip install -r python/requirements.txt
```

The following workflow first selects candidates using TRAIN/VALIDATION only, freezes the winner, and then refits that fixed specification on TRAIN+VALIDATION for one final TEST evaluation:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
from sari_rasa_data.forecasting import (
    load_daily_quantity_series,
    build_next_day_quantity_features,
    chronological_split,
)
from sari_rasa_data.model_training import (
    select_model_on_validation,
    evaluate_frozen_selection_once,
)
daily = load_daily_quantity_series('python/data/transactions_ml.csv')
supervised = build_next_day_quantity_features(daily)
splits = chronological_split(supervised)
selection = select_model_on_validation(splits['train'], splits['validation'])
print('selected:', selection.selected_spec)
for candidate in selection.candidates:
    print(candidate)
final = evaluate_frozen_selection_once(
    selection, splits['train'], splits['validation'], splits['test']
)
print('test model MAE/RMSE:', final.model_mae, final.model_rmse)
print('test baseline MAE/RMSE:', final.baseline_mae, final.baseline_rmse)
"
```

For the fixed dataset/seed, the selected model is HistGradientBoosting with `learning_rate=0.05`, `max_iter=100`, `max_leaf_nodes=7`, and `l2_regularization=1.0`. Validation MAE/RMSE are `6.9601`/`8.9508`. The one final TEST evaluation produces model MAE/RMSE `8.1000`/`11.4012`, versus previous-week `14.1792`/`18.2346`. Treat TEST output as final diagnostics: do not rerun it to choose features or parameters. Phase 5D creates no model artifact; restarting the command rebuilds everything deterministically for learning/reproduction, not further selection.

### Phase 5E — export and serve the next-day model

Generate `transactions_ml.csv` with the Phase 5B command above if it is absent, then explicitly export the frozen serving model:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.model_artifact
```

This refits the unchanged Phase 5D winner on all approved supervised rows after final evaluation and writes `python/models/next_day_quantity_v1.joblib`. Both generated data and artifact are Git-ignored. Phase 5D test metrics remain the unbiased evaluation record. Never load downloaded, uploaded, or client-selected joblib files: joblib/pickle deserialization can execute code.

Start FastAPI with the normal command, then test the Python-only endpoint:

```sh
PYTHONPATH=python/src .venv/bin/uvicorn sari_rasa_data.service:app --host 127.0.0.1 --port 8000
curl --fail-with-body -i http://127.0.0.1:8000/analytics/forecast/next-day
```

The response contains `forecast_date`, an unrounded finite non-negative `predicted_quantity`, a `historical_context` object, and the model family, artifact version, and one-day horizon. Historical context contains `data_through`, trailing 7/28-calendar-day actual-demand averages, and comparison percentages (or `null` when the corresponding average is zero). Both windows end on `data_through`, include zero-transaction dates as zero, and are independent of browser date filters. If the artifact or internal ML source is missing, corrupt, incompatible, or lacks sufficient history, the endpoint returns `503 {"detail":"next-day forecast unavailable"}` without internal paths or deserialization details. It never trains automatically.

The safe defaults may be overridden only by trusted operator environment configuration before process start:

```sh
SARI_RASA_ML_DATASET_PATH=python/data/transactions_ml.csv \
SARI_RASA_MODEL_ARTIFACT_PATH=python/models/next_day_quantity_v1.joblib \
PYTHONPATH=python/src .venv/bin/uvicorn sari_rasa_data.service:app --host 127.0.0.1 --port 8000
```

To regenerate safely, stop FastAPI, regenerate the source dataset if intended, rerun the export command to the fixed generated path, validate it with the endpoint, then restart dependent local processes if any. Do not regenerate because of TEST results, alter feature order, or substitute another estimator.

### Phase 5F — verify the Node forecast gateway

With the generated dataset/artifact present, keep FastAPI running and start Node using the normal development command and trusted `PYTHON_SERVICE_URL`. Then request the Node endpoint:

```sh
curl --fail-with-body -i http://localhost:3000/api/analytics/forecast/next-day
```

Node sends exactly `GET /analytics/forecast/next-day` to FastAPI, waits at most three seconds, performs no retry, validates the exact response contract, and preserves the numeric prediction unchanged. The route accepts no query parameters. Attempts to provide `python_url`, `artifact_path`, `dataset_path`, `model`, or another path return HTTP 400 without contacting Python.

If FastAPI times out, Node returns HTTP 504 with `Layanan prediksi tidak merespons tepat waktu`. Network failures, Python 503/other non-2xx responses, malformed JSON, and invalid success contracts return HTTP 502 with `Layanan prediksi tidak tersedia`. Upstream response bodies and internal paths are never proxied. The read-only route matches existing Node analytics-route authorization behavior.

### Phase 5G — verify the dashboard forecast

Start FastAPI, Node, and the frontend using the existing commands, sign in as an administrator, and open **Analitik**. The forecast panel appears after Sales Trend. Its request is independent from Summary, Trend, Products, and Categories: applying another Analytics date range must not reload or change a successful forecast. A failed panel exposes **Coba Lagi / Try Again**, which retries only `GET /api/analytics/forecast/next-day`.

Manual acceptance passed for Indonesian and English, desktop and mobile widths, keyboard access to retry and **Tentang prediksi ini / About this forecast**, visible focus, loading/error announcements, and horizontal containment. It also confirmed the displayed cutoff is one calendar day before the forecast date, the 7/28-day comparison formatting, global date-filter independence, navigation/cache behavior, targeted retry, and logout/login lifecycle. This Phase 5G implementation did not regenerate the 750K dataset, change the model artifact, or retrain the model.

### Phase 5F-R — reproduce the V2 large-scale experiment

V1 commands and metrics above remain historical evidence. V2 uses a separate dataset and artifact. Generate exactly 750,000 transaction rows over all 693 dates:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.ml_v2_data
wc -l python/data/transactions_ml_v2.csv
shasum -a 256 python/data/transactions_ml_v2.csv
```

Expected: 750,001 CSV lines and SHA-256 `9d87ac53771e5c4cd3eed39127fe50cb8bdbe749a885c2472cdacfb8e1cd8d3e`. This scale is transaction rows across exactly the 11 seeded application products, not supervised samples. Daily aggregation produces 693 daily values and 664 supervised rows after warm-up/target boundaries.

Audit integrity, temporal coverage, and signals before TEST evaluation:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
import pandas as pd
from sari_rasa_data.ml_v2_data import V2_DEFAULT_PATH, EVENT_WINDOWS
d = pd.read_csv(V2_DEFAULT_PATH)
d['date'] = pd.to_datetime(d.order_date)
daily = d.groupby('date').agg(rows=('order_id','size'), orders=('order_id','nunique'), quantity=('quantity','sum'))
print('rows/dates/orders:', len(d), len(daily), d.order_id.nunique())
print('null/duplicates:', d.isna().sum().sum(), d.duplicated().sum())
print('daily quantity:', daily.quantity.describe())
print('weekday means:', daily.groupby(daily.index.dayofweek).quantity.mean())
print('lag 1/7/14:', *(daily.quantity.autocorr(n) for n in (1,7,14)))
"
```

Reproduce TRAIN/VALIDATION baseline selection and candidates without reading TEST metrics:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
from sari_rasa_data.forecasting import build_next_day_quantity_features
from sari_rasa_data.ml_v2_data import V2_DEFAULT_PATH
from sari_rasa_data.ml_v2_experiment import load_v2_daily_quantity_series, v2_temporal_split
from sari_rasa_data.baseline_forecasting import evaluate_validation_baselines
from sari_rasa_data.model_training import select_model_on_validation
daily = load_v2_daily_quantity_series(V2_DEFAULT_PATH)
splits = v2_temporal_split(build_next_day_quantity_features(daily))
print(evaluate_validation_baselines(splits['validation'], daily))
selection = select_model_on_validation(splits['train'], splits['validation'])
print(*selection.candidates, sep='\n')
print('frozen:', selection.selected_spec)
"
```

Only after the documented pre-test review, the controlled final evaluation is:

```sh
PYTHONPATH=python/src .venv/bin/python -c "
from sari_rasa_data.forecasting import build_next_day_quantity_features
from sari_rasa_data.ml_v2_data import V2_DEFAULT_PATH
from sari_rasa_data.ml_v2_experiment import V2_SELECTED_MODEL_SPEC, load_v2_daily_quantity_series, v2_temporal_split
from sari_rasa_data.model_training import select_model_on_validation, evaluate_frozen_selection_once
splits = v2_temporal_split(build_next_day_quantity_features(load_v2_daily_quantity_series(V2_DEFAULT_PATH)))
s = select_model_on_validation(splits['train'], splits['validation'])
assert s.selected_spec == V2_SELECTED_MODEL_SPEC
print(evaluate_frozen_selection_once(s, splits['train'], splits['validation'], splits['test']))
"
```

Do not use that command to retune. The frozen TEST record is model MAE/RMSE `135.5097`/`177.6172`, previous-week `178.3333`/`228.5035`.

Export the V2 serving artifact, then start and check both service layers using the earlier startup commands:

```sh
PYTHONPATH=python/src .venv/bin/python -m sari_rasa_data.model_artifact
curl --fail-with-body http://127.0.0.1:8000/analytics/forecast/next-day
curl --fail-with-body http://localhost:3000/api/analytics/forecast/next-day
```

The V2 artifact is `python/models/next_day_quantity_v2.joblib`; schema `1.0` keeps the public API compatible while metadata records experiment `2.0`.

### Phase 6 — export and verify the experimental MLP

Phase 6 does not change the production HGB endpoint. Its frozen common TEST record is:

| Role | Model | TEST MAE | TEST RMSE |
|---|---|---:|---:|
| Production | HGB | 135.5097 | 177.6172 |
| Experimental | MLP | 147.2643 | 193.5776 |
| Benchmark | Previous week | 178.3333 | 228.5035 |

MLP MAE is 8.67% higher than HGB; HGB remains production. Phase 5 TEST outcomes were already known before Phase 6, so this was not psychologically blind, although the complete MLP policy was frozen from TRAIN/VALIDATION before its single TEST evaluation and no post-TEST tuning occurred.

The generated MLP artifact is intentionally ignored by Git and is not included in a clone. With the V2 dataset present, export it once before starting FastAPI:

```sh
PYTHONPATH=python/src .venv/bin/python -c "from sari_rasa_data.dl_model_artifact import export_dl_model_artifact; export_dl_model_artifact()"
git check-ignore python/models/next_day_quantity_mlp_v1.pt
```

Export uses the frozen `10 → 16 → 1`/ReLU CPU policy, Adam `0.01`, batch size 32, seed `20260903`, MSE training loss, validation-MAE selection, at most 200 epochs, patience 20, best-weight restoration, and non-negative evaluation/inference clamp. It trains only through the established TRAIN/VALIDATION development path; it does not rerun TEST or tune a model. Do not load a downloaded or client-selected artifact.

After FastAPI and Node are running through the normal commands, verify both additive comparison routes:

```sh
curl --fail-with-body -i http://127.0.0.1:8000/analytics/forecast/model-comparison
curl --fail-with-body -i http://localhost:3000/api/analytics/forecast/model-comparison
```

Both responses label HGB `production`, MLP `experimental`, and previous week `benchmark`. The current MLP prediction is experimental secondary information, not a replacement for the production HGB forecast. Missing, corrupt, stale, version-incompatible, or provenance-mismatched DL artifacts fail closed: FastAPI returns generic 503 and Node returns generic 502 without paths or exception details. If the default endpoint returns 503 on a fresh checkout, confirm the V2 dataset and ignored MLP artifact exist, export the artifact with the frozen command above, and do not weaken validation or substitute another model.

In the Admin Analytics dashboard, Model Performance appears directly below Next-Day Demand Forecast. It is independent of the global historical date filter. HGB remains the visually emphasized production/best result; MLP is experimental; Previous Week is the benchmark. The MLP current inference appears only under **About model comparison**. Phase 6H manual browser acceptance covered the bilingual desktop/mobile layout, roles, metrics, disclosure, loading/error recovery, and unchanged production forecast card.

Historical pre-4G-R2 benchmark (retained only as optimization evidence):

```sh
PYTHONPATH=python/src .venv/bin/python -c "
import time
from sari_rasa_data.ml_v2_data import V2_DEFAULT_PATH as p
from sari_rasa_data.service import build_analytics_summary, build_products_analytics, build_categories_analytics, build_sales_trend_analytics
for name, fn in [('summary',lambda:build_analytics_summary(p)),('products',lambda:build_products_analytics(p)),('categories',lambda:build_categories_analytics(p)),('sales_trend',lambda:build_sales_trend_analytics(p)),('filtered',lambda:build_analytics_summary(p,'2026-08-01','2026-08-31'))]:
    started=time.perf_counter(); fn(); print(name, time.perf_counter()-started)
"
```

Before the shared aggregate cache existed, timings were 7.293 s summary, 6.928 s products, 7.106 s categories, 7.176 s sales trend, and 7.009 s filtered summary; five sequential calls took 35.512 s. This is historical evidence, not current runtime performance. The active cached dashboard measurements are documented in Phase 4G-R2 above, and the Node timeout remains three seconds.

## Normal user workflow

The normal browser workflow is:

1. Browse products, filter categories, or switch between `ID` and `EN`.
2. Add products and notes as a guest; the guest cart persists in browser storage.
3. Register a normal account, then log in explicitly.
4. The current guest snapshot merges into the authenticated account cart.
5. Continue changing quantities and notes; the account cart persists in SQLite.
6. Use **Pesan via WhatsApp** when checkout is enabled to hand off the current order.
7. Log out; the account cart is not copied into guest storage.

On a later login, the account's persisted cart is loaded from the backend. Session restoration depends on the local hostname and cookie configuration described above.

## Admin expectations

Normal registration always creates a user with role `user`. Admin controls appear only when `/api/auth/me` reports a current database user with role `admin`. Product creation, update, and deletion additionally require backend `requireAdmin` authorization; hiding controls in the browser is not the security boundary.

The verified **Users & Admins** UI lets an authenticated administrator list accounts and promote or demote other eligible accounts while preserving self/last-admin protections. To provision the first administrator, register the intended account normally, stop the backend so the operator command has exclusive operational ownership, and run from the repository root:

```sh
npm run admin:provision -- --email admin@example.com
```

The command uses `DATABASE_PATH` when explicitly configured, otherwise the normal development database. It only promotes an existing account, is safe to repeat, and fails for an unknown email. It never creates an account/password and there is no bundled credential or public promotion endpoint. Restart the backend afterward and sign in normally.

## Development database lifecycle

The default development database is:

```text
data/umkm.db
```

It is persistent local data and is ignored by Git through `data/*.db`. Normal application startup:

- creates the parent directory and SQLite file if needed;
- enables and verifies foreign keys;
- creates missing supported tables;
- applies the supported idempotent column evolution;
- seeds the 11 initial products only when the `products` table is empty; and
- preserves existing rows and product descriptions that have already been edited.

Do not casually delete or replace this file. Tests do not require a development-database reset and are designed to avoid opening it. Production is stricter: if the configured canonical file is missing, startup refuses to create it unless `DATABASE_BOOTSTRAP_ALLOWED=true`. Use that flag only for a verified, intentional first bootstrap on the correct empty durable volume; never use it as recovery from unexplained data loss. After first creation, remove the flag. Application code cannot prove that an underlying mount is durable, so storage durability remains an operator/deployment obligation.

There is no supported destructive reset or reseed command. FE-C provides the following canonical SQLite maintenance workflow. Every path shown is a placeholder; choose explicit absolute paths on the intended host. Never point these commands at Phase 7 `python/data/sari_rasa_vectors.db`, Phase 8 `python/data/sari_rasa_phase8_e5_vectors.db`, their sidecars, or repository fixtures.

### Backup

Node may remain running while `better-sqlite3` creates a consistent online backup through SQLite's backup API. The destination parent directory must already exist, and the command refuses to overwrite an existing file or use the source as its destination.

```sh
npm run db:backup -- --source /absolute/persistent/umkm.db --destination /absolute/backups/umkm-YYYYMMDDTHHMMSS.sqlite
```

Use the configured production `DATABASE_PATH` as `--source`. Prefer a restricted backup directory separate from the live database directory. Never use a raw copy of an actively written database as the supported backup procedure; WAL state may make such a copy inconsistent.

### Verify

The backup command verifies its output automatically. The standalone command reopens a candidate read-only, runs SQLite `PRAGMA integrity_check`, and requires the canonical tables (`users`, `products`, `cart_items`, `cart_merges`, and `password_reset_tokens`):

```sh
npm run db:verify -- --file /absolute/backups/umkm-YYYYMMDDTHHMMSS.sqlite
```

Successful integrity/schema verification proves the checked SQLite artifact is structurally usable under this application contract; it does not prove storage durability or business-level correctness.

### Restore

Restore is deliberately offline. Stop Node through the normal service control first and confirm that no application or database tool is using the canonical database. FastAPI does not own canonical SQLite, but it may also be stopped during coordinated recovery. The command requires `--confirm-offline`, verifies both candidate and current target before replacement, refuses a target with `-wal`, `-shm`, or `-journal` sidecars, stages the candidate in the target directory, and preserves the former target at the explicit non-existing rollback path.

```sh
DATABASE_PATH=/absolute/persistent/umkm.db npm run db:restore -- \
  --backup /absolute/backups/umkm-YYYYMMDDTHHMMSS.sqlite \
  --rollback /absolute/persistent/umkm.before-restore-YYYYMMDDTHHMMSS.sqlite \
  --confirm-offline
```

Restore can target only `DATABASE_PATH`; it cannot select another target from the command line. Candidate, target, and rollback must be distinct absolute paths. The rollback parent is intentionally the canonical database directory so the replacement and preservation renames remain within one filesystem. Do not use `DATABASE_BOOTSTRAP_ALLOWED` during restore.

### Post-restore validation

1. While Node is still stopped, run `npm run db:verify -- --file /absolute/persistent/umkm.db`.
2. Start Node normally, with `DATABASE_BOOTSTRAP_ALLOWED` false/unset.
3. Check `GET /api/health`, public products, authentication, the expected admin boundary, and persistent cart behavior appropriate to the incident. Do not expose or record private data during verification.
4. Keep the rollback file until operational acceptance is complete.
5. Treat the Phase 8 index through its existing generated/rebuildable lifecycle. It is not restored from the canonical backup; on later AI use its existing integrity/catalog fingerprint checks determine whether the dedicated index is reused or rebuilt. Never broaden that recovery to Phase 7 or canonical SQLite.

### Rollback after a failed restore

Stop Node again. Use the preserved pre-restore database as the next verified `--backup`, and choose a new, non-existing rollback destination so the failed restored database is retained for investigation:

```sh
DATABASE_PATH=/absolute/persistent/umkm.db npm run db:restore -- \
  --backup /absolute/persistent/umkm.before-restore-YYYYMMDDTHHMMSS.sqlite \
  --rollback /absolute/persistent/umkm.failed-restore-YYYYMMDDTHHMMSS.sqlite \
  --confirm-offline
```

Repeat post-restore validation before resuming normal operation. Do not delete either retained copy until the incident is resolved under the operator's retention policy.

### Backup storage and retention

- Store backups with restricted access and without credentials or exported logs alongside them.
- Use a finite, documented retention schedule appropriate to the deployment's change rate and recovery objective.
- Ensure backups survive application redeploys/restarts. For a real production deployment, keep at least one recovery copy outside the live database filesystem's failure domain.
- Periodically verify retained backups and rehearse the documented restore only with isolated fixtures or an approved non-production copy—not the live canonical database.
- FE-C does not choose or integrate a cloud backup vendor.

## Safe operational boundaries

- Never commit a real `SESSION_SECRET` or a `.env` file containing secrets.
- Keep `.env` out of Git; `npm start` loads it only for local convenience, while production secrets come from the deployment platform/runtime.
- Never point tests at `data/umkm.db` or an alias to it.
- Use the packaged npm test commands instead of constructing a test environment manually.
- Use `localhost` consistently; do not mix it with `127.0.0.1` for the current authentication flow.
- Do not treat frontend admin visibility as authorization; the backend is authoritative.
- Do not casually delete or edit the persistent development database.
- Outside explicit development mode, session cookies require HTTPS because they remain `Secure`.
- Do not expose the local backend or development database as though this were a production deployment.

## Troubleshooting

Begin with read-only checks. Preserve the development database and avoid changing configuration until the symptom and current process state are understood.

| Symptom | Likely cause | Safe checks | Resolution |
|---|---|---|---|
| Frontend loads, but products do not appear | Backend is stopped/unrouted, or the API request failed | Locally open `http://localhost:3000/api/health`; in production inspect the current origin's `/api/health`; inspect browser Network/Console output | Start or route Node using the documented origin and bind configuration, then reload the frontend |
| Login returns success, but the UI appears logged out | A stale pre-fix Secure localhost cookie or mismatched local origin may still be present | Confirm `NODE_ENV=development`, use `localhost` consistently, and inspect the login response plus `/api/auth/me` without exposing cookie values | Restart the backend with the documented development command, clear the stale localhost session cookie if needed, then log in again |
| Authentication behaves inconsistently | `localhost` and `127.0.0.1` were mixed, backend state changed, or browser cookie state is stale | Confirm both documented URLs use `localhost`; verify health; inspect only the Sari Rasa site's cookie presence and request status | Return to the exact documented origins and retry login; remove only the local Sari Rasa session cookie if a stale cookie remains |
| Browser reports a CORS error | Frontend origin is not exactly `http://localhost:5500` | Read the address bar and the failed request's Origin header | Serve the repository root from the documented localhost port; arbitrary frontend ports are not supported by current CORS configuration |
| Backend cannot listen on port 3000 | Another process already owns the port | On systems with `lsof`, run `lsof -nP -iTCP:3000 -sTCP:LISTEN`; otherwise use the operating system's read-only port/process viewer | Identify the owning application and stop it through its normal shutdown procedure; do not change only backend `PORT`, because the frontend remains fixed to 3000 |
| Live Server cannot use port 5500 | Another process owns the required frontend port | Inspect Live Server output and use a read-only port check such as `lsof -nP -iTCP:5500 -sTCP:LISTEN` where available | Stop the known conflicting application safely, then start Live Server on 5500; selecting another port does not satisfy current CORS behavior |
| Backend reports a `SESSION_SECRET` startup error | Secret is missing, blank, or shorter than 16 characters | Review how variables were supplied to the current backend process; do not print or share the real value | Provide a new long random local value through the shell and restart the backend; never commit it |
| SQLite reports an open, path, or lock error | Path is unavailable, permissions are insufficient, or another process holds the file | Confirm the selected path and parent-directory permissions; identify running backend/database tools; preserve the file | Stop known processes through normal controls and retry. Do not delete the database as a lock-recovery shortcut |
| Tests reject `DATABASE_PATH` | A manually constructed test environment omitted an isolated path or points to the development DB or an alias | Run the packaged command without custom test environment variables; review the rejected path without opening the DB | Use `npm test` or the standalone packaged suite; do not weaken the guard or redirect it to `data/umkm.db` |
| Node analytics route returns 502 or 504 | FastAPI is stopped/unreachable, `PYTHON_SERVICE_URL` is invalid, the upstream contract failed validation, or the three-second timeout elapsed | Check FastAPI `GET /health`, confirm the trusted operator-provided service URL and startup order, and distinguish 502 from timeout 504 without printing secrets | Start or repair FastAPI, then restart Node only if its environment configuration changed; do not expose raw upstream errors or point the browser directly at FastAPI |
| Test backend cannot bind an ephemeral port | Local security policy or another environment restriction blocks loopback listeners | Read the exact `listen` error and confirm no normal backend is required by the test | Permit isolated local test listeners according to the machine's security policy, then rerun; do not rewrite tests to use the development server |

If a symptom persists, record the exact command, URL, HTTP status, and non-secret error text before changing files. Do not include session cookies, password values, or `SESSION_SECRET` in reports.

## Shutdown and cleanup

1. If FastAPI is running, press `Ctrl+C` in its terminal and wait for Uvicorn to exit.
2. In the backend terminal, press `Ctrl+C` once and wait for Node to exit.
3. Stop VS Code Live Server through its normal **Go Live**/status-bar control if it is running.
4. Confirm both service terminals have returned to their shell prompts before closing them.

Normal shutdown does not require deleting `data/umkm.db`, browser storage, or dependency files. The packaged backend tests close their servers and databases and remove their temporary directories automatically.

## Existing application and documentation checklist

This historical checklist covers the established web application and documentation journey rather than repeating the full Safari feature regression.

### Environment and setup

- [ ] `node --version` reports Node 22 or later.
- [ ] `npm ci` completes from the repository root.
- [ ] A non-committed `SESSION_SECRET` is supplied directly to the backend process.
- [ ] `NODE_ENV=development` is set for local HTTP authentication.

### Backend and frontend

- [ ] `npm start` listens at `http://localhost:3000`.
- [ ] `/api/health` returns `status: "ok"` and the documented message.
- [ ] Live Server serves `index.html` at `http://localhost:5500`.
- [ ] The page loads and products appear without an obvious API error.

### Authentication and cart orientation

- [ ] The registration and login guidance is understandable and produces a normal account.
- [ ] The session persists after refresh under the documented local configuration.
- [ ] The distinction between guest browser storage and authenticated server persistence is clear.
- [ ] The local existing-account provisioning command is clear and does not imply hidden credentials or a public promotion route.

### Tests and documentation navigation

- [ ] `npm test` passes 115 tests.
- [ ] `npm run test:backend` passes 49 tests.
- [ ] `npm run test:frontend` passes 66 tests.
- [ ] Navigation among [README](../README.md), [Architecture](ARCHITECTURE.md), this runbook, and the [Roadmap](../ROADMAP.md) works.

### Phase 4 final quality-gate acceptance

- [ ] Start FastAPI, then Node, using the documented local commands.
- [ ] `GET /api/analytics/summary` returns the canonical summary through Node.
- [ ] `GET /api/health` confirms Node remains healthy.
- [ ] Stop FastAPI and Node cleanly with `Ctrl+C`.

## Known limitations

- The supported instructions target local development, not production deployment.
- The frontend uses `http://localhost:3000` only for the explicit local `localhost:5500` development split; production uses the current HTTPS origin. CORS/admin mutation checks use exact trusted `FRONTEND_ORIGIN` configuration.
- The repository has a local operator provisioning command and a verified admin-management UI, but no bundled admin account or credential.
- The repository has no destructive database reset/reseed workflow. It does have verified canonical backup, integrity/schema verification, and conservative offline restore commands; underlying durable storage, scheduling, retention, and off-host copying remain operator/deployment responsibilities.
- Authentication and registration rate limits are stored in process memory and reset with the backend.
- A production deployment runbook has not been implemented.

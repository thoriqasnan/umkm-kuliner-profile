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

## First-time installation

From the repository root, confirm the Node version and install exactly the dependency tree represented by `package-lock.json`:

```sh
node --version
npm ci
```

The Node version must be 22 or later. `npm ci` is the preferred clean, lockfile-driven installation command for a fresh clone. Use `npm install` only when intentionally changing dependencies or regenerating the lockfile; ordinary setup should not change either package file.

No global frontend package is required by this repository. Install or enable VS Code Live Server independently if you choose the established frontend workflow.

## Environment configuration

The application does not include `dotenv` and does not automatically load `.env`. [.env.example](../.env.example) is reference documentation, not an active configuration file. Supply variables to the backend process through your shell unless you independently configure external environment tooling.

| Variable | Operational requirement |
|---|---|
| `SESSION_SECRET` | Required. Startup rejects missing, blank, or shorter-than-16-character values. Use a much longer random local value and never commit it. |
| `NODE_ENV` | Set to `development` for explicit local mode. `production` enables the session cookie's `Secure` flag; local development keeps the signed HttpOnly cookie usable over HTTP. |
| `DATABASE_PATH` | Normally omit it. Runtime then uses `data/umkm.db`. Tests require an explicit isolated path internally. |
| `PORT` | Optional. Defaults to `3000`; valid values are integer strings from 1 through 65535. |
| `PYTHON_SERVICE_URL` | Optional. Trusted operator-controlled FastAPI base URL used by Node analytics and forecast routes; defaults to `http://127.0.0.1:8000`. Use HTTP/HTTPS without credentials, query, or fragment; never derive it from browser/request input. |
| `SARI_RASA_ANALYTICS_DATASET_PATH` | Optional trusted FastAPI analytics CSV path. Development defaults to generated `python/data/transactions_ml_v2.csv`; tests pass the canonical fixture explicitly. Never derive this path from HTTP input. |

Generate a random 32-byte value with the already-required Node runtime and export it into the current shell without printing it:

```sh
export SESSION_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
```

This value exists only in the current shell session unless you independently persist it. Do not print, share, or store it in this repository. Then start the backend with that existing value:

```sh
NODE_ENV=development \
SESSION_SECRET="$SESSION_SECRET" \
npm start
```

If the variable is unset, blank, or too short, the server refuses to start. Do not replace this pattern with a public example value: any public string that meets the length check is still predictable and cryptographically unsafe. Never add the local value to documentation, source code, shell scripts committed to Git, or command output shared with others.

For ordinary development, leave `DATABASE_PATH` unset. Although the backend accepts another `PORT`, `script.js` currently calls `http://localhost:3000` and CORS currently expects the frontend at `http://localhost:5500`. Changing the backend port alone breaks browser-to-API communication; this runbook does not redefine that contract.

## Start the backend

1. Open a terminal at the repository root.
2. Supply `NODE_ENV=development` and a local `SESSION_SECRET` as shown above.
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

Current verified baseline:

| Command | Expected tests | Current result |
|---|---:|---|
| `npm run test:backend` | 35 | 35 passed |
| `npm run test:frontend` | 63 | 63 passed |
| `npm test` | 98 total | 98 passed |

Use these packaged commands without manually setting `NODE_ENV`, `SESSION_SECRET`, or `DATABASE_PATH`. The backend harness creates an isolated temporary SQLite database per test file, chooses an ephemeral HTTP port, restores environment variables, closes its server and database, and removes temporary resources.

Never set test `DATABASE_PATH` to `data/umkm.db`. Test-mode startup intentionally refuses the development database, including canonical/symlink aliases and existing hard links that identify the same file. Frontend tests run `script.js` inside `node:vm`; they do not start the normal backend or make real network calls.

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

   Current verified Python data/service result: `298 passed`.

### Start and check the Python service

Start the local-only service on `http://127.0.0.1:8000` using the repository's
`src` layout explicitly:

```sh
cd ~/umkm-kuliner-profile/python
source ../.venv/bin/activate
uvicorn sari_rasa_data.service:app --reload --app-dir src
```

In another terminal, check the service health endpoint:

```sh
curl --fail-with-body -i http://127.0.0.1:8000/health
```

Expect HTTP `200`, a JSON content type, and this response body:

```json
{"status":"ok"}
```

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

Phase 4A is ✅ **VERIFIED COMPLETE** after automated tests, deterministic package execution, the user-performed runtime smoke test, and independent final verification. Conceptual explanations are not a technical completion gate; they can be consolidated separately into Learning Notes using the implementation and commands documented here.

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

There is currently no supported UI or CLI workflow for creating or promoting an administrator, and the repository provides no bundled admin credential. This runbook intentionally does not provide SQL edits, hidden credentials, or an unofficial promotion procedure.

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

Do not casually delete or replace this file. Tests do not require a development-database reset and are designed to avoid opening it.

There is no officially supported development-database reset, reseed, backup, or recovery command. Before any separately planned manual database maintenance, make an appropriate backup using your own reviewed procedure. Recovery and destructive reset operations are outside this runbook.

## Safe operational boundaries

- Never commit a real `SESSION_SECRET` or a `.env` file containing secrets.
- Do not assume `.env.example` or a copied `.env` is loaded automatically.
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
| Frontend loads, but products do not appear | Backend is stopped, not on port 3000, or the API request failed | Open `http://localhost:3000/api/health`; inspect the browser Network/Console output; confirm `script.js` still targets port 3000 | Start the backend with the documented environment on port 3000, then reload the frontend |
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
- [ ] The admin-provisioning limitation is clear and does not imply hidden credentials.

### Tests and documentation navigation

- [ ] `npm test` passes 57 tests.
- [ ] `npm run test:backend` passes 31 tests.
- [ ] `npm run test:frontend` passes 26 tests.
- [ ] Navigation among [README](../README.md), [Architecture](ARCHITECTURE.md), this runbook, and the [Roadmap](../ROADMAP.md) works.

### Phase 4 final quality-gate acceptance

- [ ] Start FastAPI, then Node, using the documented local commands.
- [ ] `GET /api/analytics/summary` returns the canonical summary through Node.
- [ ] `GET /api/health` confirms Node remains healthy.
- [ ] Stop FastAPI and Node cleanly with `Ctrl+C`.

## Known limitations

- The supported instructions target local development, not production deployment.
- The frontend/CORS origin is fixed to `http://localhost:5500`, and the frontend API URL is fixed to `http://localhost:3000`; although the backend listener supports `PORT`, changing it alone breaks browser integration.
- The repository has no supported admin-provisioning workflow or bundled admin account.
- The repository has no supported development-database reset, backup, or recovery workflow.
- Authentication and registration rate limits are stored in process memory and reset with the backend.
- A production deployment runbook has not been implemented.

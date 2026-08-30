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
| `NODE_ENV` | Set exactly to `development` for authentication over local HTTP. Any other or missing value keeps the session cookie `Secure`. |
| `DATABASE_PATH` | Normally omit it. Runtime then uses `data/umkm.db`. Tests require an explicit isolated path internally. |
| `PORT` | Optional. Defaults to `3000`; valid values are integer strings from 1 through 65535. |

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
| `npm run test:backend` | 30 | 30 passed |
| `npm run test:frontend` | 26 | 26 passed |
| `npm test` | 56 total | 56 passed |

Use these packaged commands without manually setting `NODE_ENV`, `SESSION_SECRET`, or `DATABASE_PATH`. The backend harness creates an isolated temporary SQLite database per test file, chooses an ephemeral HTTP port, restores environment variables, closes its server and database, and removes temporary resources.

Never set test `DATABASE_PATH` to `data/umkm.db`. Test-mode startup intentionally refuses the development database, including canonical/symlink aliases and existing hard links that identify the same file. Frontend tests run `script.js` inside `node:vm`; they do not start the normal backend or make real network calls.

## Python environment (Phase 4A foundation)

This section covers the repository-local Python workspace under `python/`, introduced in Phase 4A. It is a learning/foundation workspace only: it is not a running service, and it is not required to use the Node.js/Express application or run its tests.

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

   `pytest` is currently the only external Python dependency.

4. Run the package as a small example:

   ```sh
   PYTHONPATH=python/src python -m sari_rasa_data
   ```

   This prints a small deterministic JSON report built from a sample UMKM order, demonstrating `if __name__ == "__main__"` and package execution. It has no database, network, or filesystem side effects.

5. Run the Python tests:

   ```sh
   PYTHONPATH=python/src python -m pytest python/tests
   ```

   `PYTHONPATH=python/src` lets pytest import `sari_rasa_data` directly from `python/src` without adding packaging tooling at this early stage. This runs every test file under `python/tests` (currently `test_foundation.py`, `test_io_utils.py`, and `test_main.py`), not just one module.

6. Leave the virtual environment when finished:

   ```sh
   deactivate
   ```

Activating or leaving `.venv` has no effect on the Node.js backend, frontend, or SQLite database, and does not require restarting them. This Python workspace is unrelated to the Node `.env`/`.env.example` files described earlier in this runbook; `.venv` is a Python virtual environment directory, not an environment-variable file.

Phase 4A is ✅ **VERIFIED COMPLETE** after automated tests, deterministic package execution, the user-performed runtime smoke test, and independent final verification. Conceptual explanations are not a technical completion gate; they can be consolidated separately into Learning Notes using the implementation and commands documented here.

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
| Login returns success, but the UI appears logged out | Local HTTP backend was not started with exact `NODE_ENV=development`; the Secure cookie is not sent over HTTP | Check the environment in the backend terminal; inspect the login response and `/api/auth/me` request without exposing cookie values | Stop and restart the backend with `NODE_ENV=development` and a valid secret, then log in again |
| Authentication behaves inconsistently | `localhost` and `127.0.0.1` were mixed, backend state changed, or browser cookie state is stale | Confirm both documented URLs use `localhost`; verify health; inspect only the Sari Rasa site's cookie presence and request status | Return to the exact documented origins and retry login; remove only the local Sari Rasa session cookie if a stale cookie remains |
| Browser reports a CORS error | Frontend origin is not exactly `http://localhost:5500` | Read the address bar and the failed request's Origin header | Serve the repository root from the documented localhost port; arbitrary frontend ports are not supported by current CORS configuration |
| Backend cannot listen on port 3000 | Another process already owns the port | On systems with `lsof`, run `lsof -nP -iTCP:3000 -sTCP:LISTEN`; otherwise use the operating system's read-only port/process viewer | Identify the owning application and stop it through its normal shutdown procedure; do not change only backend `PORT`, because the frontend remains fixed to 3000 |
| Live Server cannot use port 5500 | Another process owns the required frontend port | Inspect Live Server output and use a read-only port check such as `lsof -nP -iTCP:5500 -sTCP:LISTEN` where available | Stop the known conflicting application safely, then start Live Server on 5500; selecting another port does not satisfy current CORS behavior |
| Backend reports a `SESSION_SECRET` startup error | Secret is missing, blank, or shorter than 16 characters | Review how variables were supplied to the current backend process; do not print or share the real value | Provide a new long random local value through the shell and restart the backend; never commit it |
| SQLite reports an open, path, or lock error | Path is unavailable, permissions are insufficient, or another process holds the file | Confirm the selected path and parent-directory permissions; identify running backend/database tools; preserve the file | Stop known processes through normal controls and retry. Do not delete the database as a lock-recovery shortcut |
| Tests reject `DATABASE_PATH` | A manually constructed test environment omitted an isolated path or points to the development DB or an alias | Run the packaged command without custom test environment variables; review the rejected path without opening the DB | Use `npm test` or the standalone packaged suite; do not weaken the guard or redirect it to `data/umkm.db` |
| Test backend cannot bind an ephemeral port | Local security policy or another environment restriction blocks loopback listeners | Read the exact `listen` error and confirm no normal backend is required by the test | Permit isolated local test listeners according to the machine's security policy, then rerun; do not rewrite tests to use the development server |

If a symptom persists, record the exact command, URL, HTTP status, and non-secret error text before changing files. Do not include session cookies, password values, or `SESSION_SECRET` in reports.

## Shutdown and cleanup

1. In the backend terminal, press `Ctrl+C` once and wait for the process to exit.
2. Stop VS Code Live Server through its normal **Go Live**/status-bar control.
3. Confirm the terminals have returned to their shell prompts before closing them.

Normal shutdown does not require deleting `data/umkm.db`, browser storage, or dependency files. The packaged backend tests close their servers and databases and remove their temporary directories automatically.

## Manual verification checklist

Use this concise clean-room checklist during Documentation Subphase D. It verifies the documentation journey rather than repeating the full Safari feature regression.

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

- [ ] `npm test` passes 56 tests.
- [ ] `npm run test:backend` passes 30 tests.
- [ ] `npm run test:frontend` passes 26 tests.
- [ ] Navigation among [README](../README.md), [Architecture](ARCHITECTURE.md), this runbook, and the [Roadmap](../ROADMAP.md) works.

## Known limitations

- The supported instructions target local development, not production deployment.
- The frontend/CORS origin is fixed to `http://localhost:5500`, and the frontend API URL is fixed to `http://localhost:3000`; although the backend listener supports `PORT`, changing it alone breaks browser integration.
- The repository has no supported admin-provisioning workflow or bundled admin account.
- The repository has no supported development-database reset, backup, or recovery workflow.
- Authentication and registration rate limits are stored in process memory and reset with the backend.
- A production deployment runbook has not been implemented.

# Production Deployment Architecture Contract

Status: **FE-A VERIFIED COMPLETE**

This document records the Project 1 production topology and deployment-selection contract. It is an architecture decision, not a deployment manifest. It selects no hosting vendor and implements no infrastructure.

## Decision summary

Project 1 should be deployed as a small, single-instance portfolio application. A trusted HTTPS edge exposes one public application origin, serves the source-controlled frontend assets, and routes browser API requests to one Node/Express process. Node is the only browser-facing application backend and calls one private FastAPI process. FastAPI owns the local E5 runtime/index and the Gemini provider adapter. The email adapter calls its configured provider from Node.

This posture matches the current SQLite database, process-local Node rate limits, process-local FastAPI admission semaphore, lazy in-process E5 model, and local generated index. Horizontal scaling is not an FE-A target. It requires explicit later design rather than adding replicas to the current topology.

```text
Public network

Customer browser
  |  HTTPS: HTML/CSS/JS and /api/*
  v
Trusted TLS edge / reverse proxy
  |-- source-controlled static frontend assets
  `-- private hop --> Node / Express (one process)
                         |-- canonical SQLite database (persistent volume)
                         |-- outbound HTTPS --> email provider
                         `-- private HTTP(S) --> FastAPI (one process)
                                                  |-- local CPU E5 runtime
                                                  |-- Phase 8 E5 index
                                                  |   (generated/rebuildable)
                                                  |-- protected Phase 7 vector data
                                                  `-- outbound HTTPS --> Gemini
```

The edge and services may share one machine or be separate platform services if the platform satisfies the same boundaries. `Browser -> Node -> FastAPI` is invariant: FastAPI must have no public browser route, public CORS role, or directly advertised URL.

## Authority and network boundaries

| Component | Exposure | Authority / communication |
| --- | --- | --- |
| Browser and static frontend | Public HTTPS | Presents the UI and calls only Node `/api/*`. It receives no service credentials. |
| Trusted TLS edge / reverse proxy | Public HTTPS | Terminates TLS, serves or routes static assets, and forwards application API traffic only to Node. It must sanitize/replace forwarding headers and use a known proxy hop. |
| Node / Express | Private behind the edge; logically public application API | Browser-facing backend, authentication/session boundary, canonical application authority, and canonical public-product projection authority. Calls FastAPI and the email provider. |
| FastAPI | Private/internal only | AI composition, local E5 retrieval/runtime, Gemini boundary, analytics, and model inference. Accepts service calls from Node, never browser calls. |
| Gemini | External provider over outbound HTTPS | Receives only the existing bounded provider request through FastAPI. It gains no application authority. |
| Email provider | External provider over outbound HTTPS | Receives password-reset delivery requests through the Node adapter. |
| SQLite and local artifacts | Filesystem only | Never exposed as network services or downloadable static content. |

The public AI assistant remains unauthenticated, read-only, and restricted to public menu data. It has no account, role, cart, order, transaction, payment, arbitrary database, filesystem, browser, or network authority. Node re-reads the public catalog and remains authoritative before every internal AI request.

## HTTPS, origins, cookies, and proxy contract

- Production sets `NODE_ENV=production`. The existing signed session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in that mode, so the customer path must be HTTPS end to end from the browser to the trusted TLS edge.
- One public origin now serves static assets and Node `/api/*` in production. FE-B made the frontend use its current HTTP(S) origin outside the explicit local Live Server development split; browser code never receives the private Python-service address.
- `FRONTEND_ORIGIN` must be the exact public HTTPS browser origin. Existing credentialed CORS and protected-mutation origin checks remain exact; do not use wildcard CORS.
- `APP_PUBLIC_ORIGIN` must be explicitly set to the trusted public HTTPS origin used in password-reset links. It must never be derived from `Host`, `Origin`, or other client headers.
- Production Express trusts exactly one proxy hop while development/test trusts none. The production Node listener must remain reachable only through the single trusted edge, which must remove client-supplied forwarding headers before setting its own. Unbounded `trust proxy=true` remains prohibited.
- The edge should redirect HTTP to HTTPS. Internal Node-to-FastAPI transport may use private HTTP only when confined to a trusted private network or loopback; otherwise it requires authenticated/encrypted platform networking appropriate to the selected platform.
- FastAPI must not be made public to avoid private-network configuration.

## Environment and secrets contract

Real `.env` files and credentials stay outside Git. Production configuration must come from runtime environment/secret management, with least-privilege provider credentials and no secret values in logs or frontend assets.

| Configuration | Production requirement |
| --- | --- |
| `NODE_ENV` | Exactly `production`, enabling secure-cookie behavior and production validation. |
| `SESSION_SECRET` | Required server secret; startup already rejects missing/blank values and values shorter than 16 characters. Use a much longer random value and preserve it across ordinary restarts or deployments unless intentional session invalidation is acceptable. |
| `FRONTEND_ORIGIN` | Exact public HTTPS browser origin. |
| `APP_PUBLIC_ORIGIN` | Explicit trusted public HTTPS reset-link origin. |
| `DATABASE_PATH` | Production requires an explicit absolute persistent-volume path so canonical data is not tied to an ephemeral release directory. |
| `DATABASE_BOOTSTRAP_ALLOWED` | Keep `false`/unset during normal production operation. Set exactly `true` only for a deliberate first bootstrap after confirming the configured path is the intended empty durable volume. |
| `PYTHON_SERVICE_URL` / `PYTHON_AI_SERVICE_URL` | Operator-controlled private FastAPI base address; never browser- or request-controlled. One consistent internal address should cover the deployed service contract unless FE-B demonstrates a need to separate it. |
| `PYTHON_AI_TIMEOUT_MS` and Python operation/provider timeouts | Preserve the existing ordered deadlines: Python work is bounded inside Node's outer deadline. Change only with measured justification. |
| `SARI_RASA_LLM_PROVIDER`, `SARI_RASA_LLM_MODEL`, `SARI_RASA_LLM_API_KEY`, `SARI_RASA_LLM_TIMEOUT_SECONDS` | FastAPI-only provider configuration. The API key is a secret; provider/model selection remains runtime configuration. |
| `EMAIL_DELIVERY_MODE`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Node-only email configuration. Current production startup requires enabled provider configuration; credentials remain secret and sender identity must be valid. |
| `SARI_RASA_*_DATASET_PATH` and model artifact paths | Trusted server-side paths only. They must point to provisioned compatible artifacts and never come from HTTP input. |
| `PORT` and service bind settings | Runtime configuration consistent with the edge and private-network contract. FastAPI binds only to a private interface/loopback. |

## Data classification and storage contract

### A. Canonical / persistent

- `data/umkm.db` (or the configured `DATABASE_PATH`) is the canonical application database for products, accounts, roles, sessions' revocation state, password-reset state, and persistent carts. It requires durable storage, exclusive operational ownership by the intended Node topology, verified backup, and tested restore. It is never a disposable seed/cache merely because a deliberate first bootstrap can create initial tables and seed products. Production refuses to create a missing database unless the operator explicitly enables the one-time bootstrap guard.

### B. Derived, generated, or rebuildable

- `python/data/sari_rasa_phase8_e5_vectors.db` is the dedicated generated Phase 8 index. It is rebuildable from the current Node-supplied public catalog plus the locally provisioned E5 model. It may use durable local storage to reduce cold rebuilds, but it is not canonical and must not be included as the only copy of application data. Existing one-attempt recovery may delete/rebuild only this artifact and its own SQLite sidecars.
- `python/data/sari_rasa_vectors.db` is Phase 7 derived vector data. It is non-canonical, but it is a protected database and is never an automatic Phase 8 recovery target. Provisioning or rebuilding it must use its explicit controlled Phase 7 procedure; deployment automation must not casually delete or alias it.
- Generated analytics/ML datasets and model artifacts under ignored paths are reproducible/provisioned runtime artifacts, not user-generated canonical records. FastAPI endpoints depend on compatible configured files, so a deployment must provision them deliberately even though they are rebuildable. They are not canonical-backup targets and must not be deleted merely because they look generated; their own controlled build/provisioning procedures remain authoritative.
- Model caches for `intfloat/multilingual-e5-base` are provisioned runtime dependencies. The application loads with `local_files_only=True`; production cannot assume a startup-time internet download.

### C. Source-controlled / static

- Application source, `index.html`, `style.css`, `script.js`, the canonical small analytics fixture `python/data/transactions.csv`, and the versioned Phase 7H evaluation dataset are release inputs. They are immutable per release rather than writable production state.

Canonical SQLite, Phase 7 vectors, and the Phase 8 index must use distinct paths. Static serving must never expose any database, model, dataset, `.env`, or secret path.

## Compute and lifecycle constraints

- Node requires Node.js 22 or newer and native support for the installed `better-sqlite3` dependency. One Node process owns the canonical SQLite connection and all current in-memory rate-limit buckets.
- FastAPI requires the recorded Python dependencies and CPU support sufficient for PyTorch/sentence-transformers. The Phase 8 profile is `intfloat/multilingual-e5-base`, E5 query/passage prefixes, V2 catalog text, hybrid retrieval, and runtime-validated 768-dimensional embeddings.
- E5 and the Phase 8 index initialize lazily on the first AI request rather than at import/startup. Cold readiness may therefore be `not_ready` until successful initialization. The model is loaded from a local cache only.
- Local Mac observation showed approximately **1.18 GiB coarse process RSS** during E5 initialization. This is sizing evidence only, not a universal minimum or production guarantee. A platform must leave meaningful headroom for Python, PyTorch, the index, concurrent work, Node, SQLite, and the operating environment; final sizing requires measurement on the chosen runtime.
- The FastAPI runtime and index lifecycle are process-local and serialized. Restarting FastAPI loses the in-memory model/runtime state and causes lazy reinitialization; the generated index may be reused only when its integrity, vector-space identity, and catalog fingerprints validate.
- Existing AI admission capacity is two operations per FastAPI process. Existing Node public-AI limits are 30 ingress attempts and 10 accepted requests per 60 seconds per observed IP; all are process-local and reset on restart.
- `/health` remains cheap liveness. `/ai/readiness` reports local runtime/index state and static provider configuration with no provider probe. It does not prove Gemini network reachability, credential validity, quota, model availability, or successful inference.

## Scaling and platform limitations

The approved Project 1 posture is one Node process and one FastAPI process, with one writable canonical SQLite database on persistent storage.

- Multiple Node processes would have independent rate-limit maps and independent `better-sqlite3` connections. SQLite can coordinate bounded file locking on a suitable local filesystem, but the present application has not established a multi-process write topology. Replicas could also multiply effective request limits. Do not scale Node horizontally without a new data, locking, rate-limit, and migration decision.
- Multiple FastAPI processes would each load a memory-heavy E5 model, own an independent two-operation admission semaphore, and manage independent in-memory runtime state. They could contend over the same generated index, whose lifecycle lock is process-local. Do not share that writable index across workers or add workers without a new lifecycle/storage design.
- Multiple application instances cannot safely be treated as interchangeable while sharing only local SQLite/index files. Network filesystems may have different SQLite locking/durability semantics and require explicit validation.
- Ephemeral-filesystem platforms are unsuitable for the canonical database unless they attach supported durable storage at `DATABASE_PATH`. Ephemeral storage is acceptable for the Phase 8 index only if cold rebuild time and model-cache provisioning are operationally acceptable; it never makes canonical data disposable.
- Process-local rate limits and admission are useful safeguards, not distributed guarantees. A single-instance deployment keeps their behavior understandable; restart resets remain a documented limitation.

## Containerization decision

Containerization is **optional and platform-dependent**, not justified as a mandatory Project 1 layer in FE-A. It could provide reproducible Node/Python/native-library/model-cache packaging or satisfy a later platform's runtime contract. It also adds image size, model provisioning, multi-process orchestration, writable-volume mapping, and native dependency complexity without solving SQLite durability or process-local scaling.

FE-D may add containers only if the selected platform or repeatable build evidence shows a concrete benefit. A platform with suitable native Node and Python runtimes, private networking, persistent storage, and controlled artifact provisioning can deploy this project without Docker.

## CI decision

A minimal CI quality gate is **justified for the final portfolio/deployment workflow**, because the repository already has backend, frontend, and Python regression suites and deployment changes can break cross-runtime contracts. FE-A approves CI in principle but does not add configuration; implementation belongs to FE-D after the build/runtime workflow is selected.

A useful minimum gate should:

1. use supported Node 22+ and the selected Python version;
2. install locked/declared dependencies without real secrets;
3. run backend and frontend suites against isolated temporary data;
4. run the deterministic Python suite with no Gemini or external-service calls;
5. run relevant static/documentation checks such as `git diff --check`;
6. fail before deployment on any required gate failure and never expose production credentials.

Large local-model downloads, live Gemini checks, real email delivery, browser/manual acceptance, production deployment, and destructive persistence tests do not belong in the default deterministic CI gate. Whether CI also deploys is a separate FE-D decision.

## Hosting-platform selection criteria

No vendor is selected by FE-A.

### MUST HAVE

- Node 22+ runtime compatibility, including `better-sqlite3` native installation/execution.
- A compatible Python runtime for FastAPI, PyTorch, sentence-transformers, scikit-learn, and the existing dependencies.
- Enough measurable memory and CPU for the local E5 model plus application headroom; validation must occur on the candidate runtime rather than treating the Mac observation as a guarantee.
- Durable, supported filesystem/storage for the canonical SQLite database across deploys and restarts.
- A private Node-to-FastAPI route; FastAPI must not be a public browser API.
- Public HTTPS with a stable origin, HTTP-to-HTTPS handling, and support for the existing secure-cookie/origin contract.
- Runtime secret management for session, Gemini, and email credentials, with stable secrets across normal deploys.
- A way to provision the E5 model cache and required generated analytics/model artifacts without depending on a live request to download them.
- Controlled process counts: one Node and one FastAPI worker for the approved posture.
- Explicit restart/deploy and volume-mount behavior that does not replace or erase canonical SQLite.
- Outbound HTTPS access to the configured Gemini and email providers.

### SHOULD HAVE

- A trusted reverse proxy/edge with documented forwarding-header behavior and a narrowly configurable Express proxy-trust contract.
- Separate health checks for Node liveness and FastAPI liveness/readiness without interpreting readiness as provider proof.
- Persistent or reusable storage for model cache and the Phase 8 index to reduce cold starts, while retaining rebuildability.
- Sufficient startup/request timeout control for lazy E5 initialization and existing ordered AI deadlines.
- Centralized, access-controlled logs that retain sanitized correlation-aware failures without secret or private-data leakage.
- Straightforward operator access to run the verified SQLite backup, verification, and offline restore commands against the durable volume.
- Predictable resource/cost controls and an idle/restart policy compatible with the portfolio demo's expected availability and cold-start tolerance.

### OPTIONAL

- Container/image deployment when selected-platform evidence justifies it.
- Minimal CI and deployment automation beyond the approved deterministic quality gate.
- A custom domain, preview environment, or persistent generated Phase 8 index.
- Separate static-asset hosting, provided it preserves the exact public origin/CORS/cookie contract and never exposes FastAPI.
- Platform-level request limiting or protective edge controls as defense in depth; these do not silently replace application contracts.

Free-tier eligibility, current pricing, and vendor feature claims must be checked only during later platform selection. FE-A makes none of those claims.

## Decisions deferred to later subphases

- FE-B is **VERIFIED COMPLETE**: it owns the implemented same-origin production frontend contract, explicit production startup/configuration validation, one-hop proxy trust, and configurable Node bind address.
- FE-C is **VERIFIED COMPLETE**: it establishes the guarded first-bootstrap contract, SQLite-native online backup and verification, conservative offline restore with rollback, retention guidance, and protected Phase 7/Phase 8 boundaries.
- FE-D owns vendor selection and only the manifests, containers, reverse proxy, build/start commands, and CI/deployment automation justified by the selected platform.
- FE-E through FE-I retain their roadmap scopes. No later subphase has started.

Historical provider incidents retain their existing conservative wording, and controlled AI benchmark results remain controlled evidence rather than universal accuracy or reliability claims.

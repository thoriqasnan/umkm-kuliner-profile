# Account & Admin Extension — Implementation Contract

Status: Phase 6-EXT-A through 6-EXT-H and Phase 6-EXT overall **VERIFIED COMPLETE**. Required automated checks, user-performed admin/recovery/accessibility acceptance, real Resend delivery, controlled provider failure, integrated session revocation, documentation reconciliation, secret hygiene, and independent final review passed.

This is the detailed source of truth for **Phase 6-EXT — Account & Admin Extension**, delivered after verified-complete Phase 6 and before Phase 7 AI Engineering. Phase 6-EXT-A froze the architecture and contracts below; B through G delivered and verified the admin, recovery, delivery, and integration surfaces; H reconciled documentation and completed the final quality gate. Historical contract wording below is preserved where it is explicitly framed as a frozen requirement or planned slice.

[Roadmap](../ROADMAP.md) owns sequencing and status. [Architecture](ARCHITECTURE.md) describes the existing system. README and RUNBOOK remain descriptions of supported implemented behavior; README’s historical “Phase 7 next” summary defers to the updated roadmap sequence.

## Existing foundation and scope

The documented foundation is vanilla HTML/CSS/JavaScript (`index.html`, `style.css`, `script.js`), Node/Express (`server.js`, `lib/`, `middleware/`), and SQLite via `better-sqlite3` (`db/database.js`). Registration normalizes email and creates a `user`; passwords use bcrypt cost 12. Signed HttpOnly cookies identify sessions. Protected requests load the current database user and check `token_version`; logout increments that version. There is no server-side session table. The supported local administrator-provisioning workflow is `npm run admin:provision -- --email <email>` for an existing account; it creates no default credential.

The extension will reuse that authentication/session system and only the existing roles **user** and **admin**. Authentication establishes identity; authorization determines allowed operations. Python, ML, and AI services have no account-management responsibility.

Approved scope:

- Admin-only **Users & Admins** navigation within the existing dashboard; list account identity/email, role, current-account marker, search, role filter, promotion and demotion, with desktop/mobile and failure states.
- Forgot Password / Password Recovery through email, a limited-life reset token, password replacement, and normal login afterward.

Excluded: account deletion, bans/suspensions, profile/email editing, bulk role operations, an audit-log platform, organization management, granular permissions, workspace RBAC, and additional roles (`super_admin`, `owner`, `moderator`, `staff`). No dashboard/auth redesign, new frontend framework, or production deployment is implied.

## Account architecture and contracts

```text
Account System
├── Authentication
│   ├── Register
│   ├── Login
│   ├── Logout
│   ├── Session
│   └── Forgot Password [PLANNED]
│       ├── Reset request
│       ├── Reset token
│       └── Password replacement
└── Authorization
    ├── user
    ├── admin
    └── Admin Management [PLANNED]
        ├── List accounts
        ├── Promote
        ├── Demote
        └── Minimum-one-admin invariant
```

Planned trust paths:

```text
Browser/UI role checks → UX visibility only
Server → require authenticated user → require admin
       → validate role-management business rules → safe database mutation

Browser → Node/Express authentication endpoint
        → password-reset business logic
        ├── SQLite / reset-token storage
        └── Resend email delivery adapter
```

All account-list and role-mutation endpoints must require backend authentication and admin authorization, including requests constructed outside the UI. Reuse current middleware and error conventions; never copy the public read-only analytics-route authorization behavior for account data. The browser must not select its acting identity or grant its own permissions.

The admin routes below are implemented by 6-EXT-B and the password-recovery routes by 6-EXT-D. The contracts remain recorded here as the implemented source of truth. Responses follow the repository convention: success uses `status: "success"`; errors use `status: "error"`, a safe `message`, optional validation `details`, and the stable `code` added for these new machine-actionable failures.

### Admin API

| Method and route | Auth / request | Success | Expected failures and security |
|---|---|---|---|
| `GET /api/admin/users?search=&role=&limit=&offset=` | `requireAuth`, then `requireAdmin`. `search`: optional normalized substring, maximum 100 characters; `role`: omitted, `user`, or `admin`; `limit`: integer 1–100, default 25; `offset`: non-negative integer, default 0. Reject repeated/unknown query keys. | `200 {status:"success", users:[{id,email,role,createdAt,isCurrent,isLastActiveAdmin,canChangeRole}], pagination:{limit,offset,total}}`. Sort by `id ASC`; `total` is after filters. | `400 VALIDATION_ERROR`; existing generic `401`; existing generic `403`; `500 INTERNAL_ERROR`. Parameterized SQL and escaped LIKE input are mandatory. Never return password hashes, token versions, or reset-token data. `isLastActiveAdmin` is computed from the unfiltered global admin population. |
| `PATCH /api/admin/users/:id/role` | `requireAuth`, then `requireAdmin`; JSON body must contain exactly `{role:"user"|"admin"}`. Target ID is a positive safe integer. Cookie-authenticated request must pass the CSRF/origin rule below. | `200 {status:"success", message:"Role pengguna berhasil diperbarui", user:{id,email,role,createdAt,isCurrent,isLastActiveAdmin,canChangeRole}}`. Repeating the current target role is an idempotent `200`. | `400 VALIDATION_ERROR`; `401`; `403`; `404 USER_NOT_FOUND`; `409 SELF_DEMOTION_NOT_ALLOWED`; `409 LAST_ADMIN_PROTECTED`; `409 ACTOR_NOT_ADMIN`; `503 DATABASE_BUSY`; `500`. The server ignores any actor/current-user value supplied by the client. |

Creating accounts, deleting/deactivating accounts, bulk changes, and roles other than `user`/`admin` are explicitly outside 6-EXT. “Promote” is the role PATCH from `user` to `admin`; “demote” is the same PATCH from `admin` to `user`. A current administrator may promote another account but may not demote themself, even if other admins exist. This avoids accidental loss of the currently operating privilege; another administrator must perform that demotion.

### Password-recovery API

| Method and route | Request / validation | Success | Expected failures and security |
|---|---|---|---|
| `POST /api/auth/forgot-password` | Public JSON containing exactly `{email}`. Reuse registration's simple email format, trimming/lowercasing via `normalizeEmail`; maximum 254 characters after trim. Apply limiter before account lookup. | Always `202 {status:"success", message:"Jika akun tersedia, instruksi reset password telah dikirim."}` for every syntactically valid email, including unknown accounts, provider failure, and a suppressed duplicate. | `400 VALIDATION_ERROR` only for malformed shape/email; generic `429 RATE_LIMITED` with `Retry-After`, never account-specific; `500` only for an account-independent service failure before the request can be safely accepted. Response shape and observable work must not disclose account existence. |
| `POST /api/auth/reset-password` | Public JSON containing exactly `{token,password}`. Token must match the base64url contract below. Password is not trimmed: non-empty, not whitespace-only, at least 8 JavaScript characters, and at most 72 UTF-8 bytes; reuse `hashPassword`. Apply limiter before token lookup. Confirmation is a frontend concern and is not sent. | `200 {status:"success", message:"Password berhasil direset. Silakan login kembali."}`. No cookie or session is minted. | `400 VALIDATION_ERROR` for request/password shape; `400 RESET_TOKEN_INVALID` for malformed, unknown, expired, consumed, or superseded tokens (same body); generic `429 RATE_LIMITED`; `503 DATABASE_BUSY`; `500`. All unusable-token cases are indistinguishable and never identify an account. |

There is deliberately no public token-introspection endpoint. The reset page may submit only when the user acts; it maps `RESET_TOKEN_INVALID` to the shared invalid/expired UI. All four new endpoints accept only `application/json`; body parser limits must remain bounded.

Last-admin metadata must reflect the full database admin population, never the currently filtered list or page. UI metadata is advisory; mutation-time checks are authoritative. Render email/account data as text, not HTML. Privileged cookie-authenticated mutations must retain existing cookie protections and have their cross-origin/CSRF protection reviewed and specified in A/B.

## Minimum-one-admin invariant

**“SariRasa must always retain at least one administrator.”**

No supported role-management operation may reduce the administrator count to zero. Frontend protections are UX only; the backend must reject unauthorized or invariant-breaking requests regardless of frontend bypass, stale state, or concurrent requests.

The database mutation must serialize the critical operation with `BEGIN IMMEDIATE`: acquire the SQLite write lock before re-reading the actor (`id`, `role`, `token_version`), target, and global `COUNT(*) WHERE role='admin'`; validate; update; read the canonical result; and commit. The actor's transaction-time `token_version` must still equal the version authenticated by `requireAuth`, so the middleware must expose it internally for this comparison without returning it publicly. Roll back every rejection/error. Configure and test a finite SQLite `busy_timeout`; exhausted contention maps to `503 DATABASE_BUSY` and no mutation. A count followed by an independent update, a browser count, or an in-process mutex is insufficient across connections/processes.

With two admins and simultaneous demotions, at most one demotion may commit; the next operation must see the committed state and reject either lost authorization or removal of the final admin. Lock contention must produce bounded safe handling without partial mutation. Automated verification must exercise competing database connections, rollback, direct API bypass, stale actor/session state, and the one-admin case. Every supported future role-writing path must preserve this rule.

The UI will not offer a normal self-demotion action. The backend rejects self-demotion explicitly, keeping current-account protection consistent even when multiple admins exist. Last-admin protection remains independently mandatory for all requests. Because account deactivation is out of scope, “active admin” in this phase means an existing `users` row whose current role is `admin`.

**Provisioning contract:** existing databases can have zero admins because registration always creates `user`. Phase B must add a separate, local operator command (not an HTTP route and not startup seeding) that accepts the target email from a required CLI argument, opens the configured database through the same safe path rules, and atomically promotes an already-registered account. It prints no credential/hash, is idempotent when the target is already admin, fails if the account is absent, and never creates a password or embeds a default credential. Local development: register the intended account normally, then run the command against the development database. Deployment: an authorized operator supplies `DATABASE_PATH` and the exact pre-created email through the deployment secret/config boundary, runs it once, and verifies the admin count before enabling traffic. Registration never reads an admin bootstrap variable, the first registrant is never auto-promoted, and there is no public bootstrap/recovery endpoint. A zero-admin database fails closed for admin APIs until this procedure succeeds.

## Data model and atomic reset lifecycle

The existing `users(id, email UNIQUE, password_hash, created_at, role, token_version)` remains authoritative. Phase D adds:

```sql
CREATE TABLE password_reset_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_digest BLOB NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX password_reset_tokens_user_id_idx
  ON password_reset_tokens(user_id);
CREATE INDEX password_reset_tokens_expires_at_idx
  ON password_reset_tokens(expires_at);
```

Timestamps are UTC RFC 3339 text generated by the server and compared consistently; tests inject a clock. The raw token is 32 bytes from Node `crypto.randomBytes(32)`, base64url without padding (256 bits). Store only `SHA-256(rawToken)` as the 32-byte `token_digest`; compare fixed-length digests using timing-safe comparison where application comparison occurs. Raw tokens exist only long enough to compose the delivery payload and are never persisted or logged. Tokens expire 30 minutes after creation.

For a known email, token creation runs in a write transaction that invalidates all prior unconsumed tokens for that user (`consumed_at = now`) and inserts one digest. Unknown-email requests perform equivalent non-secret work and return the same `202`. Provider delivery happens after commit through the adapter below. A provider failure is logged only as a redacted operational event and still returns `202`; the stored token remains usable if delivery actually occurred, otherwise a later request supersedes it. Do not retry by creating or emailing additional tokens inside the same request.

Reset completion hashes the candidate password before the short write transaction. Inside `BEGIN IMMEDIATE`, look up the digest and require `consumed_at IS NULL` and `expires_at > now`; then update `users.password_hash`, increment `users.token_version`, mark **all** unconsumed reset tokens for that user consumed, and commit. The token row update must be conditional and affect exactly one selected usable token before success. Thus two replays cannot both commit. Any failure rolls back password, token consumption, and revocation together. Expired/consumed rows are retained for 24 hours for safe replay classification, then opportunistically deleted; consumed/expired rows older than 24 hours may be deleted during token creation or an operator maintenance task.

Incrementing the existing `token_version` revokes every pre-reset signed cookie on its next request because `requireAuth` already compares the cookie version with the current database value. This deliberately matches logout's all-device revocation model and avoids a session table. Reset requests alone do not revoke sessions. The successful reset response should clear the calling browser's session cookie defensively, but security does not depend on browser deletion.

## CSRF and abuse protection

The current HttpOnly, `SameSite=Lax` cookie and fixed CORS allowlist are useful layers, but are not the complete contract for privileged mutations. Phase B must reject cookie-authenticated non-safe methods unless the request `Origin` exactly matches a configured `FRONTEND_ORIGIN`; a missing `Origin` is rejected for browser-facing admin mutations. CORS uses that same validated origin, never `*`, and production requires HTTPS. This repository-consistent origin check is the selected CSRF mechanism; no separate CSRF token is required while the frontend and API contract retain this single trusted origin. Public forgot/reset routes do not use session authority, but still accept JSON only and use the same origin policy for browser requests.

Reuse `checkLimit` through endpoint-specific middleware, while acknowledging its current single-process, restart-reset limitation. Frozen local/single-process limits are: forgot-password 5 requests per 15 minutes per `IP + normalized email`, plus 20 per hour per IP; reset-password 5 attempts per 15 minutes per IP plus 5 per 15 minutes per token digest prefix; admin role mutation 20 per 5 minutes per authenticated actor plus IP. Malformed values use dedicated per-IP buckets. Successful reset clears no limiter bucket. All `429` responses are generic and include `Retry-After`; forgot-password must not reveal which key was exhausted. A shared limiter store and trusted-proxy configuration are deployment prerequisites before multi-instance/public production, not a reason to weaken these limits.

## Email service boundary

Core reset logic depends on an injected adapter with `sendPasswordReset({to, resetUrl, expiresAt}) -> Promise<void>`. It receives only the normalized destination, fully composed URL, and expiry; it never receives a user row, password, digest, session, or provider credential. The provider adapter owns provider formatting/authentication and returns success or throws a typed internal delivery error. The route catches and redacts that error, records no recipient/token/full URL in logs, and preserves the generic `202` contract.

Compose the URL as `${APP_PUBLIC_ORIGIN}/?reset_token=${encodeURIComponent(rawToken)}` from the validated server configuration, never `Host`, `Origin`, request query, or a client redirect. `APP_PUBLIC_ORIGIN` and `FRONTEND_ORIGIN` are required absolute HTTP(S) origins without credentials/query/fragment; production requires HTTPS. Phase F adds `EMAIL_DELIVERY_MODE`, `RESEND_API_KEY`, `EMAIL_FROM`, and optional `EMAIL_FROM_NAME` behind the adapter. Development/tests use disabled or injected fake/capture adapters and never send real email. The reset UI must immediately remove the token from the visible URL/history after reading it into in-memory state, never persist it, load no third-party resources, and retain the existing `Referrer-Policy: no-referrer` defense.

## Admin Management UI/UX

Use **Users & Admins** as the navigation label and **Manage account access and administrator roles.** as supporting copy. Extend the existing SariRasa dashboard with white surfaces/cards, rounded corners, subtle borders, orange accent, dark readable type, muted support text, and generous whitespace. Preserve existing ID/EN translation conventions.

Desktop uses a semantic table-like management layout within existing surfaces: account identity, role/status, action; search and an All Roles / User / Admin filter above it. Mobile transforms each account into a card with initials/avatar, wrapping email, badges, and action/protection text. Joined date is optional: the documented `created_at` field supports considering it, but show it only after verifying the actual contract and data. Do not invent dates or require new profile data.

ADMIN uses orange emphasis; USER uses neutral styling. LAST ADMIN has an explicit protected/locked indicator. Color alone cannot communicate role/protection. Red is for appropriate privilege-removal danger styling, never an administrator badge.

The current account is marked `[ADMIN] [YOU]` with **Protected current account**, without a normal self-demotion action. When it is also the last admin, show all relevant badges, including LAST ADMIN, and the last-admin explanation.

Last-admin presentation:

- `[ADMIN] [LAST ADMIN]`, **Role protected**.
- **Add another administrator before removing this role.**
- Omit the removal action or show an accessible disabled **Remove Admin Access** control with persistent explanatory text; a disabled control or hover-only tooltip must never be the only explanation.
- On server rejection, show **Unable to Remove Admin Access**, **SariRasa must always have at least one administrator.**, and **Promote another user to admin before trying again.** Refresh canonical role/protection state.

Both changes require confirmation, not accidental one-click mutations:

| Dialog | Explanation | Actions |
|---|---|---|
| Promote to Admin? | `<email> will receive administrator access.` Explain that administrators can manage privileged SariRasa administration features, including product and account-role management. | Cancel; Promote to Admin |
| Remove Admin Access? | `<email> will lose administrator privileges. The account remains active as a regular user.` | Cancel; Remove Access (appropriate danger styling) |

While submitting, communicate progress and prevent duplicate submission. Keep failures actionable without implying success; after success reconcile from server state. An expired session or effective-role loss must clear privileged content/actions, close pending privileged dialogs, invalidate cached/in-flight work, and show the access-lost state. Revalidate with `/api/auth/me` when entering Users & Admins and on window focus after the page has been hidden; handle `401`/`403` on every request by clearing privileged UI. Refresh the canonical list after every successful mutation or `409`. A response from an older identity, filter, pagination request, or generation must not restore stale privileged UI.

| State | Approved copy / action |
|---|---|
| Loading | Loading accounts... |
| Loaded | Canonical server rows, pagination, current-user and protected-state metadata rendered; filters remain operable. |
| Empty / search has no result | No users found. / Try another email or change the selected role filter. |
| Service failure | Unable to load accounts. / We couldn't load user management right now. / Try Again |
| Unauthorized / access lost | Administrator access required. / Your account no longer has permission to manage users. |
| Validation error | Associate the field/query error with its control; preserve the user's safe input. |
| Operation pending | Disable only the active dialog/action, set `aria-busy`, announce progress, and prevent duplicates. |
| Operation success | Announce success and reconcile the row/protection metadata from the canonical response, then refresh the list. |
| Operation failure | Keep the dialog recoverable, show mapped safe copy, and refresh on conflict/stale state. |
| Protected last admin | Persistent LAST ADMIN label/explanation; no usable demotion action. |
| Current user | Persistent YOU/protected label; no self-demotion action. |

## Forgot Password / Password Recovery UI/UX

Approved flow:

```text
Login → Forgot password? → enter email → request password reset
      → generic confirmation → reset email → reset link
      → reset-password page → new password + confirmation
      → password updated → return to normal login
```

Keep **Forgot password?** a secondary text action near the password field, below it and above the primary Sign In action. Preserve the current login experience.

Forgot Password has one labeled email field, **Send Reset Link**, and **Back to Sign In**. Supporting copy: **Enter your email and we'll send you instructions to reset your password if an account exists.** No username, phone, security questions, or unnecessary identity data.

After submission, show **Check Your Email** with **If an account exists for that email, password reset instructions have been sent.** Explain that the link expires after a limited period and provide **Back to Login**. This is both a UX and security requirement: existing and nonexistent emails must receive substantially the same public status, body, screen, and timing behavior. Do not expose account existence through delivery outcomes or account-specific rate-limit messages. Format validation can identify malformed email without reporting whether an account exists. General service/network failures must use account-independent, retryable copy.

Reset Your Password contains **New Password**, **Confirm New Password**, visibility controls if consistent with current auth UI, inline password requirements, inline mismatch validation, and primary **Reset Password**. Reuse the application's approved password policy and existing server-side validator/hash helper; do not invent a separate policy or add excessive strength meters. Document the actual policy text during A after inspecting the implementation. The server remains responsible for password acceptance even if browser validation is bypassed.

After success show **Password Successfully Reset**, **Your password has been updated. You can now sign in using your new password.**, and primary **Sign In**. **Never automatically authenticate the user after reset.** Normal login and the existing session/cart lifecycle remain the entry path.

Invalid, expired, consumed, or otherwise unusable links share the human-readable **Reset Link Expired** state: **This password reset link is invalid or has expired.**, primary **Request New Reset Link**, secondary **Back to Sign In**. Do not expose raw HTTP/API errors or token internals. Validation/submission states must preserve accessible inline feedback and prevent duplicate submissions without trapping users.

The required frontend state machines are explicit. Forgot-password: `initial → submitting → generic success`; malformed-email validation returns to `initial` with an associated error; account-independent network/server failure offers retry. Reset-password: `initial → submitting → reset success`; local/server password validation returns to `initial` with requirements or mismatch feedback; `RESET_TOKEN_INVALID` becomes the shared invalid/expired state; network/server failure preserves safe password fields only for the current page lifetime and permits retry. Reloading never restores a token or password from storage. All async transitions use a generation/identity guard matching the existing stale-response patterns so older requests cannot overwrite newer auth/admin state.

## Password-reset security requirements

These are frozen acceptance requirements, not claims about current implementation:

- Generate the 256-bit, base64url, 30-minute token defined above; associate each with one account and server-enforced expiration.
- Store only its SHA-256 digest, never the reusable plaintext secret. Keep the raw secret only long enough to construct/deliver the email link, never in application logs, browser persistent storage, or API list responses.
- Validate tokens on the server; frontend link acceptance is never authorization. Invalid, expired, used, and malformed tokens fail safely.
- Consume the token and replace the bcrypt password hash atomically. Concurrent submissions of one token must yield at most one successful replacement; a failed transaction must not leave partially updated state. Invalidate reset tokens for that account after successful replacement.
- Use the existing approved password policy and secure hashing mechanism (documented bcrypt cost 12); never store plaintext passwords.
- Preserve generic request responses and substantially equivalent timing for registered/unregistered addresses. Email-delivery failures must not become an enumeration channel.
- Apply the frozen throttles above, with a shared store required before multi-instance/public production; avoid account lockout because reset requests never change credentials or sessions.
- Never log reset tokens, full secret-bearing reset URLs, passwords, credentials, or provider API secrets. Review application, proxy, provider, and browser telemetry boundaries. Reset pages must avoid token leakage through referrers and unrelated third-party resources.
- Generate links from `APP_PUBLIC_ORIGIN`, not untrusted Host headers or client redirects; require HTTPS in production and use the specified query-entry/in-memory cleanup behavior.
- Keep secrets/provider API credentials in environment configuration only; no secrets committed to Git. No environment files or configuration changes are part of this planning task.
- Session policy: successful reset revokes existing account sessions by incrementing the existing `token_version` within the password/token transaction. Reset requests alone must not revoke sessions. Do not mint a new authenticated cookie; direct the user to normal login.
- Email delivery will use a server-side provider adapter, with controlled failure handling. No production vendor is selected or integrated here. Delivery retries/resend policy must preserve expiration, single use, redaction, and generic public responses.

## Architecture security review

| Threat | Frozen control / verification obligation |
|---|---|
| Authorization bypass / privilege escalation | `requireAuth` + `requireAdmin`, transaction-time actor recheck, exact role allowlist, no client actor/mass assignment, direct-request tests. |
| Last-admin loss / races | `BEGIN IMMEDIATE`, global count after lock acquisition, self-demotion rejection, finite contention failure, two-connection concurrency tests. |
| Account enumeration | Same valid-email `202` body/status for known/unknown/provider failure/suppression; equivalent work, generic rate-limit copy, timing tests. |
| Token leakage | Digest-only DB, no logs/storage/third-party resources, trusted URL origin, no-referrer, immediate URL cleanup, secret redaction tests. |
| Replay / concurrent completion | One usable digest, conditional consumption and password/version/token updates in one write transaction, competing-connection tests. |
| Old sessions after reset | Atomic `token_version + 1`; replay an old cookie and require `401`. |
| CSRF | Exact configured-origin check on cookie mutations, JSON-only body, CORS allowlist, SameSite cookie; cross-origin/missing-origin tests. |
| Abuse | Layered frozen limits and `Retry-After`; deployment gate for shared storage/trusted proxy. |
| Credential/log leakage | No passwords, hashes, token versions, reset secrets, full URLs, recipients, or provider keys in responses/logs. |
| Unsafe initial admin | Explicit local operator promotion of an existing account; no default password, auto-promotion, startup seed, or public endpoint. |

## Approved conceptual wireframes

The following compact wireframes preserve approved references A–M: hierarchy, controls, states, action priority, and role communication. They are not pixel specifications. Derive dimensions, spacing, fonts, breakpoints, and colors from existing SariRasa HTML/CSS. Do not substantially change the UX without explicit approval. No gradients, glassmorphism, AI-themed purple, unrelated dashboard redesign, excessive animation, or new visual language.

```text
A. LOGIN                           B. FORGOT PASSWORD
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ SariRasa / Welcome Back      │    │ ← / Forgot Password?        │
│ Sign in to your account     │    │ Reset instructions if an    │
│ Email    [you@example.com]  │    │ account exists.             │
│ Password [••••••••   show]  │    │ Email [you@example.com]     │
│          Forgot password?   │    │ [Send Reset Link]           │
│ [Sign In]                   │    │ Back to Sign In             │
│ Don't have an account?      │    └─────────────────────────────┘
│ Register                    │
└─────────────────────────────┘

C. CHECK YOUR EMAIL                D. RESET PASSWORD
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ ✓ Check Your Email          │    │ SariRasa                    │
│ If an account exists for    │    │ Reset Your Password         │
│ that email, password reset  │    │ New Password [•••• show]   │
│ instructions have been sent.│    │ Password requirements...    │
│ Link expires after a        │    │ Confirm New Password        │
│ limited period of time.     │    │ [•••••••• show]             │
│ [Back to Login]             │    │ Inline mismatch/validation  │
└─────────────────────────────┘    │ [Reset Password]            │
                                   └─────────────────────────────┘
E. SUCCESS                         F. INVALID / EXPIRED LINK
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ ✓ Password Successfully     │    │ ! Reset Link Expired        │
│ Reset                       │    │ This password reset link    │
│ Your password has been      │    │ is invalid or has expired.  │
│ updated. You can now sign   │    │ [Request New Reset Link]    │
│ in using your new password. │    │ Back to Sign In             │
│ [Sign In]                   │    └─────────────────────────────┘
└─────────────────────────────┘

G. USERS & ADMINS — DESKTOP
┌───────────────────────────────────────────────────────────────────┐
│ USERS & ADMINS                                                    │
│ Manage account access and administrator roles.                    │
│ [Search users...]                           [All Roles ▼]         │
│ USER                         ROLE                  ACTION         │
│ TA thoriq@example.com        [ADMIN] [YOU]          Protected      │
│ BS budi@example.com          [USER]                 [Promote]      │
│ AN ani@example.com           [ADMIN]                [Manage ▾]     │
└───────────────────────────────────────────────────────────────────┘

H. PROMOTION                       I. DEMOTION
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ Promote to Admin?           │    │ Remove Admin Access?        │
│ budi@example.com will       │    │ ani@example.com will lose   │
│ receive administrator       │    │ administrator privileges.   │
│ access. Administrators can  │    │ Their account will remain   │
│ manage privileged SariRasa  │    │ active as a regular user.   │
│ administration features.    │    │ [Cancel] [Remove Access]    │
│ [Cancel] [Promote to Admin]  │    └─────────────────────────────┘
└─────────────────────────────┘

J. LAST ADMIN                      K. BACKEND REJECTION FALLBACK
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ TA thoriq@example.com       │    │ Unable to Remove Admin      │
│ [ADMIN] [LAST ADMIN]        │    │ Access                      │
│ Role protected              │    │ SariRasa must always have   │
│ Add another administrator   │    │ at least one administrator. │
│ before removing this role.  │    │ Promote another user to     │
│ [Remove Admin Access]       │    │ admin before trying again.  │
│ disabled + explanation      │    │ [Got It]                    │
└─────────────────────────────┘    └─────────────────────────────┘

L. MOBILE — separate account cards, never a squeezed desktop table
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ TA / thoriq@example.com     │    │ BS / budi@example.com       │
│ [ADMIN] [YOU]              │    │ [USER]                      │
│ Protected current account   │    │ [Promote to Admin]          │
└─────────────────────────────┘    └─────────────────────────────┘
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ AN / ani@example.com       │    │ TA / thoriq@example.com     │
│ [ADMIN]                     │    │ [ADMIN] [LAST ADMIN]        │
│ [Manage Admin Access]       │    │ Role protected              │
└─────────────────────────────┘    │ Add another administrator   │
                                   │ before removing this role.  │
                                   └─────────────────────────────┘

M. MANAGEMENT STATES — same page/card surface
Loading:      Users & Admins / Loading accounts...
No results:   No users found.
              Try another email or change the selected role filter.
Failure:      Unable to load accounts.
              We couldn't load user management right now. [Try Again]
Access lost:  Administrator access required.
              Your account no longer has permission to manage users.
```

## Accessibility and responsive acceptance

Future implementation must support keyboard navigation, visible focus, proper labels, validation/error associations, status/error announcements where appropriate, and adequate touch targets. Dialogs need accessible names/descriptions, controlled focus entry and return, keyboard cancellation, and safe action focus. Password visibility controls need clear accessible names/state. Disabled controls need accessible explanations that also work for keyboard and touch users.

Roles, protection, validation, and success cannot rely on color or icons alone. Account emails must wrap safely; desktop tables become mobile cards without unnecessary horizontal scrolling. Preserve logical reading/focus order and existing bilingual UI conventions. Real-browser keyboard, screen-reader, desktop/mobile, and error-recovery checks belong to integrated checkpoints C and G, not every helper change.

### Final password-visibility acceptance

Login, Register, Reset New Password, and Reset Confirm Password visibility controls passed manual functional, keyboard, narrow/mobile, and approximately 200% zoom/reflow acceptance. The reset controls operate independently, preserve their values, and return to hidden on auth-mode changes. Revision 1 made each toggle flush/full-height at the field's right edge; Revision 3 retained a visible proportional focus ring without oversized treatment.

Revision 2 investigated an occasional Safari + VoiceOver announcement containing “Closing.” Source inspection, deterministic tests, and manual retest confirmed native button semantics, `type="button"`, synchronized `aria-pressed`, bilingual dynamic names, no menu roles or `aria-haspopup`, unchanged closed navigation/`aria-expanded=false`, an open dialog, stable toggle focus, and no live/status mutation. The functionality and state are correct, so this is accepted as a non-blocking platform-specific announcement. Standards-compliant semantics must be preserved; no accessibility hack is required to force VoiceOver wording.

## Planned implementation slices

A through H are verified complete. The table retains each slice's original scope boundary while recording its final evidence disposition.

| Subphase | Goal | Scope boundary | Key acceptance criteria | Expected verification |
|---|---|---|---|---|
| 6-EXT-A — Architecture & Data Contracts | Freeze minimal contracts and prerequisites. | Design and implementation preparation only; no feature delivery in this slice. | Repository-inspected account payloads, error mapping, bounds, atomic role/token design, initial-admin procedure, actual password policy, link routing, session revocation, email boundary, throttling, and CSRF approach are frozen above. | VERIFIED COMPLETE: repository/contract review, threat-case walkthrough, and documentation diff/static checks; no browser checkpoint. |
| 6-EXT-B — Admin Backend & Business Rules | Deliver authorized listing and safe role changes. | Node/SQLite only; no management UI, deletion, or new roles. | Admin-only list/mutations; reject direct unauthorized/self/last-admin requests; competing connections cannot remove all admins; recheck actor authorization during mutation; safe minimal responses. | VERIFIED COMPLETE: 12 focused checks and 49-test backend regression pass; two child-process connections prove the invariant, real lock contention proves bounded redacted 503/no mutation, and three independent reviews found no remaining Medium/High issue. |
| 6-EXT-C — Admin Management UI/UX | Integrate Users & Admins in the dashboard. | Existing frontend/design system; no dashboard redesign. | Search/filter, desktop table/mobile cards, current/last-admin states, confirmations, retries, and access-loss/stale-response handling match approved references. | VERIFIED COMPLETE: automated coverage plus user-performed listing, mutation, protection, i18n, responsive, keyboard, zoom/reflow, hidden-page revalidation, duplicate-confirmation, and persistence acceptance passed. Pagination >25 and network/last-admin failure paths remain automated-covered. |
| 6-EXT-D — Password Reset Backend & Token Lifecycle | Deliver reset request and atomic replacement logic. | Node/SQLite and fake delivery boundary; no production vendor integration. | Secure hashed expiring tokens; generic request responses; throttling; single use under concurrency; approved hashing/policy; atomic session revocation; no auto-login or secret logs. | VERIFIED COMPLETE: isolated token/time/rate-limit tests, backend integration, concurrent replay and rollback tests, controlled fake delivery, and the final 72-test backend regression passed. |
| 6-EXT-E — Password Recovery UI/UX | Integrate login entry, request, confirmation, reset, success, and expired states. | Existing auth UI; no extra identity fields or vendor integration. | Approved controls/copy, inline requirements/match errors, secondary entry, generic confirmation, safe deep link, normal login after success. | VERIFIED COMPLETE: focused automated coverage and core user-performed recovery flow passed, including URL scrubbing, mismatch, success-to-Login transition, no auto-login, replay rejection, and old/new password behavior. |
| 6-EXT-F — Email Delivery Integration | Connect a reviewed delivery provider. | Finalize provider and adapter only; no broader deployment/platform. | Environment-only secrets, trusted link origin, limited-life template, redaction, controlled retry/failure behavior, no existence leakage, safe test mailbox. | VERIFIED COMPLETE: real Resend receipt/sender/subject/expiry/origin/reset flow passed; controlled invalid-credential acceptance kept startup and UI fail-safe and leaked no provider detail. |
| 6-EXT-G — Security, Integration & Manual Acceptance | Verify both complete feature groups. | Cumulative hardening/verification, not new product scope. | Unauthorized/bypass and concurrent demotions rejected; role loss clears UI; full email → reset → normal login flow; old password/session/token rejected; generic unknown-email behavior; desktop/mobile and assistive-technology acceptance; existing auth/cart/admin regressions pass. | VERIFIED COMPLETE: automated security/integration and core manual integration passed, including real email → reset → Login, rejected consumed token and old password, accepted new password, and old-session revocation after cross-browser reset. |
| 6-EXT-H — Documentation & Final Quality Gate | Record actual delivered behavior and evidence. | Documentation/status reconciliation and final review; no new features. | All open prerequisites resolved; B–G evidence recorded; README/RUNBOOK updated only for verified capabilities; final diff/scope checks; mark verified only after required acceptance. Phase 7 stays unstarted until separately begun. | VERIFIED COMPLETE: canonical startup documentation, full Node regression, diff/secret hygiene, status reconciliation, and independent read-only review passed. |

## Intentionally deferred implementation choices

- Resend is the selected Phase F provider behind the frozen adapter. Real-inbox and controlled failure acceptance passed with runtime-only local configuration; deployment still requires its own restricted key and verified sender/domain. No automatic retry/queue is added.
- A shared rate-limit store and exact trusted-proxy topology are deployment choices; they are mandatory before multi-instance/public production.
- Exact CSS values, breakpoint reuse, translated final copy, and accessible dialog mechanics are Phase C/E implementation details constrained by the states and acceptance rules above.
- SQLite migration mechanics must preserve existing databases and prove the frozen schema/transaction behavior; no migration runs in A.

Phase 6 and Phase 6-EXT-A through 6-EXT-H are **VERIFIED COMPLETE**. Phase 6-EXT overall is **VERIFIED COMPLETE**. Phase 7 remains **NOT STARTED**.

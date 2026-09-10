const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { createBackendHarness } = require('../helpers/backend-harness');
const { createCookieClient } = require('../helpers/cookie-client');
const { jsonRequest, login, register, USERS } = require('../helpers/fixtures');
const { clearLimitsForTests } = require('../../lib/rateLimiter');
const { digestToken } = require('../../lib/passwordRecovery');
const { hashPassword } = require('../../lib/password');

const execFileAsync = promisify(execFile);
const ORIGIN = { Origin: 'http://localhost:5500' };

async function forgot(client, email, headers = ORIGIN) {
  const response = await jsonRequest(client, '/api/auth/forgot-password', 'POST', { email }, headers);
  // Delivery is intentionally dispatched after the HTTP response finishes.
  // Let that dispatch callback start without awaiting the adapter's promise.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return response;
}

function reset(client, token, password, headers = ORIGIN) {
  return jsonRequest(client, '/api/auth/reset-password', 'POST', { token, password }, headers);
}

test('Phase 6-EXT-D password reset backend and token lifecycle', async (t) => {
  const deliveries = [];
  let now = new Date('2026-09-07T10:00:00.000Z');
  let randomByteRequest = null;
  const harness = await createBackendHarness({
    passwordResetNow: () => new Date(now),
    passwordResetRandomBytes(size) {
      randomByteRequest = size;
      return crypto.randomBytes(size);
    },
    passwordResetDelivery: {
      async sendPasswordReset(payload) { deliveries.push(payload); },
    },
  });
  t.after(() => harness.cleanup());
  const client = createCookieClient(harness.baseUrl);

  await t.test('schema and indexes are deterministic and preserve users', async () => {
    const table = harness.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='password_reset_tokens'").get();
    assert.match(table.sql, /token_digest BLOB NOT NULL UNIQUE/);
    assert.match(table.sql, /ON DELETE CASCADE/);
    const indexes = harness.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='password_reset_tokens'").all().map((row) => row.name);
    assert.ok(indexes.includes('password_reset_tokens_user_id_idx'));
    assert.ok(indexes.includes('password_reset_tokens_expires_at_idx'));
  });

  await t.test('forgot response is generic for registered, unknown, and delivery failure', async () => {
    clearLimitsForTests();
    assert.equal((await register(client, USERS.userA)).status, 201);
    const known = await forgot(client, USERS.userA.email);
    const unknown = await forgot(client, 'unknown@example.test');
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    const knownBody = await known.json();
    const unknownBody = await unknown.json();
    assert.deepEqual(knownBody, unknownBody);

    harness.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'hash')").run('failure@example.test');
    const original = require('../../server').app.locals.passwordResetDelivery;
    const originalConsoleError = console.error;
    const logged = [];
    let failedPayload;
    require('../../server').app.locals.passwordResetDelivery = {
      async sendPasswordReset(payload) {
        failedPayload = payload;
        throw Object.assign(new Error('provider secret response with re_live_api_key'), {
          category: 'token=https://attacker.example/leak',
        });
      },
    };
    console.error = (...values) => logged.push(values.join(' '));
    let failed;
    try {
      failed = await forgot(client, 'failure@example.test');
    } finally {
      console.error = originalConsoleError;
      require('../../server').app.locals.passwordResetDelivery = original;
    }
    assert.equal(failed.status, 202);
    assert.deepEqual(await failed.json(), unknownBody);
    const emittedLog = logged.join('\n');
    const failedToken = new URL(failedPayload.resetUrl).searchParams.get('reset_token');
    assert.match(emittedLog, /Pengiriman gagal: unknown/);
    for (const sensitive of [
      'failure@example.test', failedPayload.resetUrl, failedToken,
      'provider secret response', 're_live_api_key', 'attacker.example',
    ]) assert.equal(emittedLog.includes(sensitive), false);
    const failedTokenRow = harness.db.prepare(`
      SELECT consumed_at FROM password_reset_tokens
      WHERE user_id = (SELECT id FROM users WHERE email = ?)
      ORDER BY id DESC LIMIT 1
    `).get('failure@example.test');
    assert.equal(failedTokenRow.consumed_at, null);
  });

  await t.test('known-account response does not await a slow delivery adapter', async () => {
    clearLimitsForTests();
    const app = require('../../server').app;
    const original = app.locals.passwordResetDelivery;
    app.locals.passwordResetDelivery = { sendPasswordReset() { return new Promise(() => {}); } };
    const outcome = await Promise.race([
      forgot(client, USERS.userA.email).then((response) => response.status),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ]);
    app.locals.passwordResetDelivery = original;
    assert.equal(outcome, 202);
  });

  await t.test('known and unknown valid emails share a normalized response-time envelope', async () => {
    clearLimitsForTests();
    const measure = async (email) => {
      const started = Date.now();
      assert.equal((await jsonRequest(client, '/api/auth/forgot-password', 'POST', { email }, ORIGIN)).status, 202);
      return Date.now() - started;
    };
    const knownDurations = [];
    const unknownDurations = [];
    for (let index = 0; index < 3; index += 1) {
      knownDurations.push(await measure(USERS.userA.email));
      unknownDurations.push(await measure(`timing-unknown-${index}@example.test`));
    }
    const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;
    assert.ok(
      Math.abs(average(knownDurations) - average(unknownDurations)) < 200,
      `known=${knownDurations.join(',')} unknown=${unknownDurations.join(',')}`
    );
    assert.ok([...knownDurations, ...unknownDurations].every((duration) => duration >= 90));
  });

  await t.test('forgot validates exact JSON shape and trusted origin', async () => {
    clearLimitsForTests();
    assert.equal((await jsonRequest(client, '/api/auth/forgot-password', 'POST', { email: 'valid@example.test', extra: true }, ORIGIN)).status, 400);
    assert.equal((await forgot(client, 'valid@example.test', {})).status, 403);
    assert.equal((await forgot(client, 'valid@example.test', { Origin: 'https://evil.example' })).status, 403);
    const text = await client.request('/api/auth/forgot-password', { method: 'POST', headers: ORIGIN, body: '{}' });
    assert.equal(text.status, 400);
  });

  await t.test('token uses 32 random bytes; only digest is stored with 30-minute expiry', async () => {
    clearLimitsForTests();
    deliveries.length = 0;
    assert.equal((await forgot(client, USERS.userA.email)).status, 202);
    assert.equal(randomByteRequest, 32);
    const token = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const row = harness.db.prepare('SELECT token_digest, created_at, expires_at FROM password_reset_tokens ORDER BY id DESC LIMIT 1').get();
    assert.ok(Buffer.isBuffer(row.token_digest));
    assert.equal(row.token_digest.length, 32);
    assert.deepEqual(row.token_digest, digestToken(token));
    assert.equal(row.created_at, now.toISOString());
    assert.equal(row.expires_at, new Date(now.getTime() + 30 * 60 * 1000).toISOString());
    assert.equal(JSON.stringify(row).includes(token), false);
    assert.deepEqual(Object.keys(deliveries.at(-1)).sort(), ['expiresAt', 'resetUrl', 'to']);
  });

  await t.test('reset destination ignores request Host and remains the trusted configured origin', async () => {
    clearLimitsForTests();
    deliveries.length = 0;
    const response = await forgot(client, USERS.userA.email, {
      ...ORIGIN,
      Host: 'attacker.example',
      Referer: 'https://attacker.example/redirect',
    });
    assert.equal(response.status, 202);
    const resetUrl = new URL(deliveries.at(-1).resetUrl);
    assert.equal(resetUrl.origin, 'http://localhost:5500');
    assert.equal(resetUrl.pathname, '/');
    assert.deepEqual([...resetUrl.searchParams.keys()], ['reset_token']);
  });

  await t.test('new request supersedes the prior credential', async () => {
    clearLimitsForTests();
    deliveries.length = 0;
    await forgot(client, USERS.userA.email);
    const tokenA = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    await forgot(client, USERS.userA.email);
    const tokenB = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    assert.equal((await reset(client, tokenA, 'ReplacementPass123!')).status, 400);
    clearLimitsForTests();
    assert.equal((await reset(client, tokenB, 'ReplacementPass123!')).status, 200);
  });

  await t.test('malformed, unknown, expired, consumed tokens share one failure', async () => {
    const cases = [];
    clearLimitsForTests();
    cases.push(await reset(client, 'bad', 'AnotherPass123!'));
    clearLimitsForTests();
    cases.push(await reset(client, crypto.randomBytes(32).toString('base64url'), 'AnotherPass123!'));
    clearLimitsForTests();
    deliveries.length = 0;
    await forgot(client, USERS.userA.email);
    const expired = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    now = new Date(now.getTime() + 30 * 60 * 1000);
    cases.push(await reset(client, expired, 'AnotherPass123!'));
    const bodies = await Promise.all(cases.map((response) => response.json()));
    assert.ok(cases.every((response) => response.status === 400));
    assert.ok(bodies.every((body) => body.code === 'RESET_TOKEN_INVALID'));
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
  });

  await t.test('password validation and origin checks fail before mutation', async () => {
    clearLimitsForTests();
    const token = crypto.randomBytes(32).toString('base64url');
    assert.equal((await reset(client, token, 'short')).status, 400);
    assert.equal((await reset(client, token, 'ValidPass123!', {})).status, 403);
    assert.equal((await reset(client, token, 'ValidPass123!', { Origin: 'https://evil.example' })).status, 403);
  });

  await t.test('successful reset is one-time, revokes old session, and changes login credential', async () => {
    clearLimitsForTests();
    now = new Date('2026-09-07T12:00:00.000Z');
    const oldSession = createCookieClient(harness.baseUrl);
    assert.equal((await login(oldSession, { email: USERS.userA.email, password: 'ReplacementPass123!' })).status, 200);
    const copiedCookie = oldSession.getSessionCookie();
    assert.equal((await oldSession.request('/api/auth/me')).status, 200);
    deliveries.length = 0;
    await forgot(client, USERS.userA.email);
    const token = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    assert.equal((await reset(client, token, 'FinalPassword123!')).status, 200);
    assert.equal((await client.request('/api/auth/me')).status, 401);
    assert.equal((await oldSession.request('/api/auth/me')).status, 401);
    clearLimitsForTests();
    assert.equal((await reset(client, token, 'ReplayPassword123!')).status, 400);
    const replayedSession = createCookieClient(harness.baseUrl);
    replayedSession.setSessionCookie(copiedCookie);
    assert.equal((await replayedSession.request('/api/auth/me')).status, 401);
    assert.equal((await login(createCookieClient(harness.baseUrl), { email: USERS.userA.email, password: 'ReplacementPass123!' })).status, 401);
    assert.equal((await login(createCookieClient(harness.baseUrl), { email: USERS.userA.email, password: 'FinalPassword123!' })).status, 200);
  });

  await t.test('failed user update rolls back conditional consumption and password change', async () => {
    clearLimitsForTests();
    deliveries.length = 0;
    await forgot(client, USERS.userA.email);
    const token = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    const before = harness.db.prepare('SELECT password_hash, token_version FROM users WHERE email = ?').get(USERS.userA.email);
    harness.db.exec("CREATE TRIGGER fail_reset BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT, 'forced'); END");
    assert.equal((await reset(client, token, 'RollbackPass123!')).status, 500);
    harness.db.exec('DROP TRIGGER fail_reset');
    const after = harness.db.prepare('SELECT password_hash, token_version FROM users WHERE email = ?').get(USERS.userA.email);
    assert.deepEqual(after, before);
    assert.equal(harness.db.prepare('SELECT consumed_at FROM password_reset_tokens WHERE token_digest = ?').get(digestToken(token)).consumed_at, null);
  });

  await t.test('independent SQLite connections cannot both consume one token', async () => {
    clearLimitsForTests();
    deliveries.length = 0;
    await forgot(client, USERS.userA.email);
    const token = new URL(deliveries.at(-1).resetUrl).searchParams.get('reset_token');
    const worker = path.resolve(__dirname, '..', 'helpers', 'password-reset-worker.js');
    const hashA = await hashPassword('ConcurrentPassA123!');
    const hashB = await hashPassword('ConcurrentPassB123!');
    const readyA = path.join(harness.temporaryDirectory, 'reset-ready-a');
    const readyB = path.join(harness.temporaryDirectory, 'reset-ready-b');
    const release = path.join(harness.temporaryDirectory, 'reset-release');
    const args = (hash, ready) => [worker, harness.databasePath, digestToken(token).toString('hex'), hash, now.toISOString(), ready, release];
    const resultPromises = [
      execFileAsync(process.execPath, args(hashA, readyA)),
      execFileAsync(process.execPath, args(hashB, readyB)),
    ];
    const readinessDeadline = Date.now() + 3000;
    while ((!fs.existsSync(readyA) || !fs.existsSync(readyB)) && Date.now() < readinessDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(fs.existsSync(readyA) && fs.existsSync(readyB), 'both workers must reach the release barrier');
    fs.writeFileSync(release, 'go');
    const results = await Promise.all(resultPromises);
    const parsed = results.map(({ stdout }) => JSON.parse(stdout));
    assert.equal(parsed.filter((result) => result.status === 'success').length, 1);
    assert.equal(parsed.filter((result) => result.code === 'RESET_TOKEN_INVALID').length, 1);
    const finalCredential = harness.db.prepare(`
      SELECT u.password_hash, t.consumed_at
      FROM users u JOIN password_reset_tokens t ON t.user_id = u.id
      WHERE t.token_digest = ?
    `).get(digestToken(token));
    assert.ok([hashA, hashB].includes(finalCredential.password_hash));
    assert.notEqual(finalCredential.consumed_at, null);
  });

  await t.test('forgot and reset throttles are generic and include Retry-After', async () => {
    clearLimitsForTests();
    for (let index = 0; index < 5; index += 1) assert.equal((await forgot(client, 'limited@example.test')).status, 202);
    const forgotLimited = await forgot(client, 'limited@example.test');
    assert.equal(forgotLimited.status, 429);
    assert.equal((await forgotLimited.json()).code, 'RATE_LIMITED');
    assert.ok(forgotLimited.headers.get('retry-after'));

    clearLimitsForTests();
    const token = crypto.randomBytes(32).toString('base64url');
    for (let index = 0; index < 5; index += 1) await reset(client, token, 'LimitedPassword123!');
    const resetLimited = await reset(client, token, 'LimitedPassword123!');
    assert.equal(resetLimited.status, 429);
    assert.equal((await resetLimited.json()).code, 'RATE_LIMITED');
    assert.ok(resetLimited.headers.get('retry-after'));
  });

  await t.test('rotating malformed emails share the dedicated per-IP bucket', async () => {
    clearLimitsForTests();
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await forgot(client, `malformed-${index}`)).status, 400);
    }
    const limited = await forgot(client, 'another-malformed');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'RATE_LIMITED');
  });
});

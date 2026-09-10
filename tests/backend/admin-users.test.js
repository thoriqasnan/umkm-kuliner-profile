const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { createBackendHarness } = require('../helpers/backend-harness');
const { createCookieClient } = require('../helpers/cookie-client');
const { USERS, jsonRequest, registerAndLogin } = require('../helpers/fixtures');

const APPROVED_ORIGIN = 'http://localhost:5500';

function patchRole(client, userId, role, headers = {}) {
  return jsonRequest(client, `/api/admin/users/${userId}/role`, 'PATCH', { role }, { Origin: APPROVED_ORIGIN, ...headers });
}

function runRoleWorker(databasePath, actorId, targetId) {
  const workerPath = path.resolve(__dirname, '..', 'helpers', 'admin-role-worker.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, databasePath, String(actorId), String(targetId)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`role worker failed (${code}): ${stderr}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`role worker returned invalid JSON: ${stdout}\n${stderr}`, { cause: error }));
      }
    });
  });
}

function holdDatabaseWriteLock(databasePath, holdMs) {
  const workerPath = path.resolve(__dirname, '..', 'helpers', 'sqlite-lock-worker.js');
  const child = spawn(process.execPath, [workerPath, databasePath, String(holdMs)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => {
      if (chunk.toString().includes('READY')) resolve();
      else reject(new Error(`lock worker did not become ready: ${chunk}`));
    });
  });
  const closed = new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`lock worker failed (${code}): ${stderr}`)));
  });
  return { ready, closed };
}

test('Phase 6-EXT-B admin user API contracts and invariants', async (t) => {
  const harness = await createBackendHarness();
  try {
    const anonymous = createCookieClient(harness.baseUrl);
    const normalUser = createCookieClient(harness.baseUrl);
    const adminA = createCookieClient(harness.baseUrl);
    const adminB = createCookieClient(harness.baseUrl);
    const targetUser = createCookieClient(harness.baseUrl);
    const adminBCredentials = { email: 'admin-b@example.test', password: USERS.admin.password };
    const targetCredentials = { email: 'target_%@example.test', password: USERS.admin.password };

    await registerAndLogin(normalUser, USERS.userA);
    await registerAndLogin(adminA, USERS.admin);
    await registerAndLogin(adminB, adminBCredentials);
    await registerAndLogin(targetUser, targetCredentials);
    harness.db.prepare("UPDATE users SET role = 'admin' WHERE email IN (?, ?)").run(USERS.admin.email, adminBCredentials.email);

    const ids = Object.fromEntries(
      harness.db.prepare('SELECT email, id FROM users').all().map((row) => [row.email, row.id])
    );

    await t.test('listing enforces authentication and current database role', async () => {
      assert.equal((await anonymous.request('/api/admin/users')).status, 401);
      assert.equal((await normalUser.request('/api/admin/users')).status, 403);
      assert.equal((await adminA.request('/api/admin/users')).status, 200);

      harness.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(ids[adminBCredentials.email]);
      assert.equal((await adminB.request('/api/admin/users')).status, 403);
      harness.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ids[adminBCredentials.email]);
    });

    await t.test('listing returns bounded canonical data without sensitive fields', async () => {
      const response = await adminA.request('/api/admin/users?limit=2&offset=1');
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, 'success');
      assert.deepEqual(body.pagination, { limit: 2, offset: 1, total: 4 });
      assert.equal(body.users.length, 2);
      assert.deepEqual(Object.keys(body.users[0]).sort(), [
        'canChangeRole', 'createdAt', 'email', 'id', 'isCurrent', 'isLastActiveAdmin', 'role',
      ]);
      const serialized = JSON.stringify(body);
      for (const forbidden of ['password_hash', 'token_version', 'session', 'reset_token']) {
        assert.equal(serialized.includes(forbidden), false);
      }

      const filtered = await adminA.request('/api/admin/users?role=admin&search=ADMIN&limit=100&offset=0');
      assert.equal(filtered.status, 200);
      const filteredBody = await filtered.json();
      assert.equal(filteredBody.pagination.total, 2);
      assert.deepEqual(filteredBody.users.map((user) => user.id), [ids[USERS.admin.email], ids[adminBCredentials.email]]);

      const literalWildcard = await adminA.request('/api/admin/users?search=%5F%25');
      assert.equal(literalWildcard.status, 200);
      assert.deepEqual((await literalWildcard.json()).users.map((user) => user.email), [targetCredentials.email]);
    });

    await t.test('listing and mutation reject malformed, repeated, unknown, and mass-assigned input', async () => {
      for (const query of [
        '?limit=0', '?limit=101', '?limit=1.5', '?offset=-1', '?role=owner',
        '?search=x&search=y', '?unknown=x', `?search=${'x'.repeat(101)}`,
      ]) {
        const response = await adminA.request(`/api/admin/users${query}`);
        assert.equal(response.status, 400, query);
        assert.equal((await response.json()).code, 'VALIDATION_ERROR');
      }
      assert.equal((await patchRole(adminA, ids[targetCredentials.email], 'owner')).status, 400);
      assert.equal((await jsonRequest(adminA, `/api/admin/users/${ids[targetCredentials.email]}/role`, 'PATCH', {
        role: 'admin', actorId: ids[USERS.userA.email],
      }, { Origin: APPROVED_ORIGIN })).status, 400);
      for (const invalidId of ['not-an-id', '0x1', '1e0', '+1', '01']) {
        assert.equal((await patchRole(adminA, invalidId, 'admin')).status, 400);
      }
    });

    await t.test('role mutation enforces auth, authorization, origin, target, no-op, and self-demotion rules', async () => {
      assert.equal((await patchRole(anonymous, ids[targetCredentials.email], 'admin')).status, 401);
      assert.equal((await patchRole(normalUser, ids[targetCredentials.email], 'admin')).status, 403);
      const missingOrigin = await jsonRequest(adminA, `/api/admin/users/${ids[targetCredentials.email]}/role`, 'PATCH', { role: 'admin' });
      assert.equal(missingOrigin.status, 403);
      assert.equal((await missingOrigin.json()).code, 'CSRF_ORIGIN_INVALID');
      assert.equal((await patchRole(adminA, ids[targetCredentials.email], 'admin', { Origin: 'https://evil.example.test' })).status, 403);

      const unknown = await patchRole(adminA, 999999, 'admin');
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).code, 'USER_NOT_FOUND');

      const promoted = await patchRole(adminA, ids[targetCredentials.email], 'admin');
      assert.equal(promoted.status, 200);
      assert.equal((await promoted.json()).user.role, 'admin');
      assert.equal(harness.db.prepare('SELECT role FROM users WHERE id = ?').get(ids[targetCredentials.email]).role, 'admin');
      assert.equal((await targetUser.request('/api/admin/users')).status, 200);
      const noOp = await patchRole(adminA, ids[targetCredentials.email], 'admin');
      assert.equal(noOp.status, 200);

      const selfDemotion = await patchRole(adminA, ids[USERS.admin.email], 'user');
      assert.equal(selfDemotion.status, 409);
      assert.equal((await selfDemotion.json()).code, 'SELF_DEMOTION_NOT_ALLOWED');
    });

    await t.test('another admin may demote a target while preserving at least one admin', async () => {
      const response = await patchRole(adminA, ids[targetCredentials.email], 'user');
      assert.equal(response.status, 200);
      assert.equal(harness.db.prepare('SELECT role FROM users WHERE id = ?').get(ids[targetCredentials.email]).role, 'user');
      assert.equal((await targetUser.request('/api/admin/users')).status, 403);
      assert.equal((await patchRole(targetUser, ids[USERS.userA.email], 'admin')).status, 403);
      assert.ok(harness.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count >= 1);
    });

    await t.test('last remaining admin is rejected by the dedicated invariant contract', async () => {
      harness.db.prepare("UPDATE users SET role = 'user'").run();
      harness.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ids[USERS.admin.email]);
      const response = await patchRole(adminA, ids[USERS.admin.email], 'user');
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'LAST_ADMIN_PROTECTED');
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count, 1);
    });

    await t.test('transaction-time session mismatch rolls back without changing the target', () => {
      harness.db.prepare("UPDATE users SET role = 'admin', token_version = 0 WHERE id = ?").run(ids[USERS.admin.email]);
      harness.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(ids[targetCredentials.email]);
      const { changeAdminUserRole } = require('../../lib/adminUsers');
      assert.throws(
        () => changeAdminUserRole(harness.db, {
          actorId: ids[USERS.admin.email], actorTokenVersion: 99,
          targetId: ids[targetCredentials.email], role: 'admin',
        }),
        (error) => error.code === 'ACTOR_NOT_ADMIN'
      );
      assert.equal(harness.db.inTransaction, false);
      assert.equal(harness.db.prepare('SELECT role FROM users WHERE id = ?').get(ids[targetCredentials.email]).role, 'user');
    });

    await t.test('finite SQLite lock contention returns redacted 503 without mutation', async () => {
      harness.db.prepare("UPDATE users SET role = 'admin', token_version = 0 WHERE id = ?").run(ids[USERS.admin.email]);
      harness.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(ids[targetCredentials.email]);
      const lock = holdDatabaseWriteLock(harness.databasePath, 2500);
      await lock.ready;
      const response = await patchRole(adminA, ids[targetCredentials.email], 'admin');
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        status: 'error', code: 'DATABASE_BUSY', message: 'Database sedang sibuk. Coba lagi nanti.',
      });
      await lock.closed;
      assert.equal(harness.db.prepare('SELECT role FROM users WHERE id = ?').get(ids[targetCredentials.email]).role, 'user');
    });

    await t.test('local provisioning command promotes an existing account atomically and idempotently', () => {
      harness.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(ids[targetCredentials.email]);
      const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'provision-admin.js');
      const env = { ...process.env, NODE_ENV: 'test', DATABASE_PATH: harness.databasePath };
      const noArgument = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8' });
      assert.notEqual(noArgument.status, 0);
      assert.match(noArgument.stderr, /Penggunaan:/);
      const missing = spawnSync(process.execPath, [scriptPath, '--email', 'missing@example.test'], { env, encoding: 'utf8' });
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /belum terdaftar/);
      const promoted = spawnSync(process.execPath, [scriptPath, '--email', targetCredentials.email], { env, encoding: 'utf8' });
      assert.equal(promoted.status, 0, promoted.stderr);
      assert.match(promoted.stdout, /berhasil diprovision/);
      assert.equal(harness.db.prepare('SELECT role FROM users WHERE id = ?').get(ids[targetCredentials.email]).role, 'admin');
      const repeated = spawnSync(process.execPath, [scriptPath, '--email', targetCredentials.email], { env, encoding: 'utf8' });
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.match(repeated.stdout, /sudah administrator/);
      assert.doesNotMatch(`${promoted.stdout}${repeated.stdout}`, /password|hash|credential|secret/i);
    });

    await t.test('role mutation rate limit is actor-and-IP scoped and returns Retry-After', async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        assert.equal((await patchRole(targetUser, ids[targetCredentials.email], 'admin')).status, 200);
      }
      const limited = await patchRole(targetUser, ids[targetCredentials.email], 'admin');
      assert.equal(limited.status, 429);
      assert.match(limited.headers.get('retry-after'), /^\d+$/);
      assert.equal((await limited.json()).code, 'RATE_LIMITED');
    });

    await t.test('competing independent SQLite connections cannot demote both administrators', async () => {
      harness.db.prepare("UPDATE users SET role = 'user'").run();
      harness.db.prepare("UPDATE users SET role = 'admin', token_version = 0 WHERE id IN (?, ?)")
        .run(ids[USERS.admin.email], ids[adminBCredentials.email]);

      const results = await Promise.all([
        runRoleWorker(harness.databasePath, ids[USERS.admin.email], ids[adminBCredentials.email]),
        runRoleWorker(harness.databasePath, ids[adminBCredentials.email], ids[USERS.admin.email]),
      ]);
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.equal(results.filter((result) => result.status === 409 && result.code === 'ACTOR_NOT_ADMIN').length, 1);
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count, 1);
    });
  } finally {
    await harness.cleanup();
  }
});

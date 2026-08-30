const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { createBackendHarness, isPathInside } = require('../helpers/backend-harness');
const { createCookieClient } = require('../helpers/cookie-client');

const projectRoot = path.resolve(__dirname, '..', '..');
const developmentDatabasePath = path.join(projectRoot, 'data', 'umkm.db');

function fingerprint(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

test('isolated backend smoke: health, register, login, and auth restoration', async () => {
  const developmentBefore = fingerprint(developmentDatabasePath);
  const missingPathCheck = spawnSync(process.execPath, ['-e', "require('./db/database')"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'automated-test-secret-not-for-real-use',
      DATABASE_PATH: '',
    },
    encoding: 'utf8',
  });
  assert.notEqual(missingPathCheck.status, 0);
  assert.match(missingPathCheck.stderr, /DATABASE_PATH wajib di-set/);

  const developmentPathCheck = spawnSync(process.execPath, ['-e', "require('./db/database')"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_PATH: developmentDatabasePath,
    },
    encoding: 'utf8',
  });
  assert.notEqual(developmentPathCheck.status, 0);
  assert.match(developmentPathCheck.stderr, /tidak boleh mengarah ke database development/);
  assert.deepEqual(fingerprint(developmentDatabasePath), developmentBefore);

  const hardLinkDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'umkm-db-hardlink-test-'));
  try {
    const hardLinkPath = path.join(hardLinkDirectory, 'development-alias.sqlite');
    fs.linkSync(developmentDatabasePath, hardLinkPath);
    const hardLinkCheck = spawnSync(process.execPath, ['-e', "require('./db/database')"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_PATH: hardLinkPath,
      },
      encoding: 'utf8',
    });
    assert.notEqual(hardLinkCheck.status, 0);
    assert.match(hardLinkCheck.stderr, /tidak boleh mengarah ke database development/);
    assert.deepEqual(fingerprint(developmentDatabasePath), developmentBefore);
  } finally {
    fs.rmSync(hardLinkDirectory, { recursive: true, force: true });
  }

  const harness = await createBackendHarness();
  const temporaryDirectory = harness.temporaryDirectory;
  try {
    const { parseConfiguredPort } = require('../../server');
    assert.equal(parseConfiguredPort(undefined), 3000);
    assert.equal(parseConfiguredPort('1'), 1);
    assert.equal(parseConfiguredPort('65535'), 65535);
    for (const value of ['', '0', '65536', '-1', '1.5', 'abc', 3000]) {
      assert.throws(() => parseConfiguredPort(value), /PORT harus berupa angka bulat/);
    }

    assert.equal(path.isAbsolute(harness.databasePath), true);
    assert.equal(isPathInside(temporaryDirectory, harness.databasePath), true);
    assert.notEqual(harness.databasePath, developmentDatabasePath);

    const client = createCookieClient(harness.baseUrl);
    const health = await client.request('/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    const credentials = { email: 'smoke-user@example.test', password: 'TemporaryPass123!' };
    const register = await client.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    assert.equal(register.status, 201);

    const login = await client.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(login.headers.get('set-cookie'), /Secure/i);
    assert.match(login.headers.get('set-cookie'), /SameSite=Lax/i);
    assert.match(client.getSessionCookie(), /^session=/);

    const authMe = await client.request('/api/auth/me');
    assert.equal(authMe.status, 200);
    const authData = await authMe.json();
    assert.equal(authData.user.email, credentials.email);
    assert.equal(authData.user.role, 'user');
  } finally {
    await harness.cleanup();
  }

  assert.equal(fs.existsSync(temporaryDirectory), false);
  assert.deepEqual(fingerprint(developmentDatabasePath), developmentBefore);
});

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  CANONICAL_DEVELOPMENT_DB_PATH,
  DatabaseMaintenanceError,
  PHASE7_VECTOR_DB_PATH,
  PHASE8_INDEX_PATH,
  createCanonicalBackup,
  restoreCanonicalBackup,
  verifyCanonicalBackup,
} = require('../../lib/databaseMaintenance');

const projectRoot = path.resolve(__dirname, '..', '..');

function createCanonicalFixture(filePath, marker) {
  const database = new Database(filePath);
  database.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE cart_items (user_id INTEGER, product_id INTEGER);
    CREATE TABLE cart_merges (user_id INTEGER, merge_id TEXT);
    CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE fixture_marker (value TEXT NOT NULL);
  `);
  database.prepare('INSERT INTO fixture_marker (value) VALUES (?)').run(marker);
  database.close();
}

function marker(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return database.prepare('SELECT value FROM fixture_marker').pluck().get();
  } finally {
    database.close();
  }
}

function fingerprint(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function repositoryFingerprints() {
  return new Map([
    [CANONICAL_DEVELOPMENT_DB_PATH, fingerprint(CANONICAL_DEVELOPMENT_DB_PATH)],
    [PHASE7_VECTOR_DB_PATH, fingerprint(PHASE7_VECTOR_DB_PATH)],
    [PHASE8_INDEX_PATH, fingerprint(PHASE8_INDEX_PATH)],
  ]);
}

test('online backup is consistent, verified, non-overwriting, and leaves source unchanged', async () => {
  const repositoryBefore = repositoryFingerprints();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-backup-'));
  try {
    const source = path.join(directory, 'source.sqlite');
    const destination = path.join(directory, 'backup.sqlite');
    createCanonicalFixture(source, 'source-state');
    const sourceBefore = fingerprint(source);

    const result = await createCanonicalBackup({ source, destination });
    assert.equal(result.integrity, 'ok');
    assert.equal(marker(destination), 'source-state');
    assert.equal(fingerprint(source), sourceBefore);
    assert.deepEqual(verifyCanonicalBackup(destination).tables,
      ['cart_items', 'cart_merges', 'password_reset_tokens', 'products', 'users']);

    await assert.rejects(
      createCanonicalBackup({ source, destination }),
      (error) => error instanceof DatabaseMaintenanceError && /overwrite ditolak/.test(error.message),
    );
    await assert.rejects(
      createCanonicalBackup({ source, destination: source }),
      (error) => error instanceof DatabaseMaintenanceError && /harus berbeda/.test(error.message),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(repositoryFingerprints(), repositoryBefore);
});

test('verification rejects non-SQLite and incomplete-schema candidates', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-verify-'));
  try {
    const invalid = path.join(directory, 'invalid.sqlite');
    fs.writeFileSync(invalid, 'not a sqlite database');
    assert.throws(() => verifyCanonicalBackup(invalid), /valid|integritas/i);

    const incomplete = path.join(directory, 'incomplete.sqlite');
    const database = new Database(incomplete);
    database.exec('CREATE TABLE products (id INTEGER PRIMARY KEY)');
    database.close();
    assert.throws(() => verifyCanonicalBackup(incomplete), /Schema canonical tidak lengkap/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('offline restore verifies first, preserves rollback, and refuses live sidecars', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-restore-'));
  try {
    const source = path.join(directory, 'source.sqlite');
    const candidate = path.join(directory, 'candidate.sqlite');
    const target = path.join(directory, 'canonical.sqlite');
    const rollback = path.join(directory, 'canonical.before-restore.sqlite');
    createCanonicalFixture(source, 'restored-state');
    createCanonicalFixture(target, 'original-state');
    await createCanonicalBackup({ source, destination: candidate });

    const result = restoreCanonicalBackup({
      candidate, target, configuredDatabasePath: target, rollback,
    });
    assert.equal(result.integrity, 'ok');
    assert.equal(result.rollbackPath, rollback);
    assert.equal(marker(target), 'restored-state');
    assert.equal(marker(rollback), 'original-state');

    const secondTarget = path.join(directory, 'second-canonical.sqlite');
    const secondRollback = path.join(directory, 'second.rollback.sqlite');
    createCanonicalFixture(secondTarget, 'unchanged-state');
    fs.writeFileSync(`${secondTarget}-wal`, 'simulated-live-sidecar');
    assert.throws(() => restoreCanonicalBackup({
      candidate, target: secondTarget, configuredDatabasePath: secondTarget, rollback: secondRollback,
    }), /aplikasi benar-benar offline/);
    assert.equal(marker(secondTarget), 'unchanged-state');
    assert.equal(fs.existsSync(secondRollback), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid backup cannot replace an isolated canonical target', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-invalid-restore-'));
  try {
    const target = path.join(directory, 'canonical.sqlite');
    const invalid = path.join(directory, 'invalid.sqlite');
    const rollback = path.join(directory, 'rollback.sqlite');
    createCanonicalFixture(target, 'recoverable-state');
    fs.writeFileSync(invalid, 'invalid backup');
    const targetBefore = fingerprint(target);
    assert.throws(() => restoreCanonicalBackup({
      candidate: invalid, target, configuredDatabasePath: target, rollback,
    }), /valid|integritas/i);
    assert.equal(fingerprint(target), targetBefore);
    assert.equal(marker(target), 'recoverable-state');
    assert.equal(fs.existsSync(rollback), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('maintenance operations reject Phase-7 and Phase-8 protected targets without touching them', async () => {
  const protectedBefore = repositoryFingerprints();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-protection-'));
  try {
    const source = path.join(directory, 'source.sqlite');
    const destination = path.join(directory, 'backup.sqlite');
    const rollback = path.join(directory, 'rollback.sqlite');
    createCanonicalFixture(source, 'source');
    await assert.rejects(createCanonicalBackup({ source: PHASE7_VECTOR_DB_PATH, destination }), /dilindungi/);
    await assert.rejects(createCanonicalBackup({ source, destination: PHASE8_INDEX_PATH }), /dilindungi/);
    assert.throws(() => restoreCanonicalBackup({
      candidate: source,
      target: PHASE7_VECTOR_DB_PATH,
      configuredDatabasePath: PHASE7_VECTOR_DB_PATH,
      rollback,
    }), /dilindungi/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(repositoryFingerprints(), protectedBefore);
});

test('CLI requires explicit offline confirmation and verifies an isolated backup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-cli-'));
  try {
    const source = path.join(directory, 'source.sqlite');
    const backup = path.join(directory, 'backup.sqlite');
    createCanonicalFixture(source, 'cli-state');
    await createCanonicalBackup({ source, destination: backup });

    const verified = spawnSync(process.execPath, [
      'scripts/database-maintenance.js', 'verify', '--file', backup,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /Backup canonical valid/);

    const relativeRefused = spawnSync(process.execPath, [
      'scripts/database-maintenance.js', 'verify', '--file', 'relative.sqlite',
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(relativeRefused.status, 0);
    assert.match(relativeRefused.stderr, /path absolut/);

    const refused = spawnSync(process.execPath, [
      'scripts/database-maintenance.js', 'restore', '--backup', backup,
      '--rollback', path.join(directory, 'rollback.sqlite'),
    ], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: source }, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /--confirm-offline/);
    assert.equal(marker(source), 'cli-state');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('production database creation requires explicit first-bootstrap acknowledgement', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-db-bootstrap-'));
  try {
    const databasePath = path.join(directory, 'canonical.sqlite');
    const baseEnvironment = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: databasePath,
    };
    const refused = spawnSync(process.execPath, ['-e', "require('./db/database')"], {
      cwd: projectRoot, env: baseEnvironment, encoding: 'utf8',
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /DATABASE_BOOTSTRAP_ALLOWED=true/);
    assert.equal(fs.existsSync(databasePath), false);

    const allowed = spawnSync(process.execPath, ['-e', "require('./db/database').db.close()"], {
      cwd: projectRoot,
      env: { ...baseEnvironment, DATABASE_BOOTSTRAP_ALLOWED: 'true' },
      encoding: 'utf8',
    });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(verifyCanonicalBackup(databasePath).integrity, 'ok');

    const restart = spawnSync(process.execPath, ['-e', "require('./db/database').db.close()"], {
      cwd: projectRoot, env: baseEnvironment, encoding: 'utf8',
    });
    assert.equal(restart.status, 0, restart.stderr);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

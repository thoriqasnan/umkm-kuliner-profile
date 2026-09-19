const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  loadRuntimeConfig, parseConfiguredHost, parsePrivateServiceUrl, validateProductionDatabasePath,
} = require('../../lib/runtimeConfig');

const projectRoot = path.resolve(__dirname, '..', '..');

function productionEnvironment(databasePath) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: 'automated-production-test-secret-not-for-real-use',
    HOST: '127.0.0.1',
    FRONTEND_ORIGIN: 'https://portfolio.example',
    APP_PUBLIC_ORIGIN: 'https://portfolio.example',
    DATABASE_PATH: databasePath,
    DATABASE_BOOTSTRAP_ALLOWED: 'true',
    PYTHON_SERVICE_URL: 'http://private-fastapi.internal:8000',
    EMAIL_DELIVERY_MODE: 'resend',
    RESEND_API_KEY: 're_test_value_not-a-real-secret',
    EMAIL_FROM: 'noreply@example.test',
  };
}

test('production runtime contract requires explicit sanitized configuration', () => {
  const valid = productionEnvironment(path.join(os.tmpdir(), 'production-contract.sqlite'));
  const config = loadRuntimeConfig(valid);
  assert.equal(config.frontendOrigin, 'https://portfolio.example');
  assert.equal(config.appPublicOrigin, 'https://portfolio.example');
  assert.equal(config.pythonServiceUrl, 'http://private-fastapi.internal:8000/');
  assert.equal(config.pythonAiServiceUrl, config.pythonServiceUrl);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.trustProxy, 1);
  assert.doesNotThrow(() => validateProductionDatabasePath(valid));

  for (const name of ['HOST', 'FRONTEND_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PYTHON_SERVICE_URL']) {
    const invalid = { ...valid };
    delete invalid[name];
    assert.throws(() => loadRuntimeConfig(invalid), new RegExp(name));
  }
  assert.throws(() => loadRuntimeConfig({ ...valid, FRONTEND_ORIGIN: 'http://portfolio.example' }), /HTTPS/);
  assert.throws(
    () => loadRuntimeConfig({ ...valid, PYTHON_SERVICE_URL: 'http://user:secret@private-fastapi.internal:8000' }),
    (error) => /PYTHON_SERVICE_URL/.test(error.message) && !error.message.includes('secret'),
  );
  assert.throws(
    () => validateProductionDatabasePath({ ...valid, DATABASE_PATH: 'data/umkm.db' }), /path absolut/,
  );
});

test('host and private-service URL parsers retain safe development support', () => {
  assert.equal(parseConfiguredHost(undefined), '127.0.0.1');
  assert.equal(parseConfiguredHost('0.0.0.0'), '0.0.0.0');
  for (const value of ['', 'https://host', 'host/path', 'host name']) {
    assert.throws(() => parseConfiguredHost(value), /HOST/);
  }
  assert.equal(parsePrivateServiceUrl(undefined, 'PYTHON_SERVICE_URL'), 'http://127.0.0.1:8000/');
  assert.throws(() => parsePrivateServiceUrl('file:///tmp/service', 'PYTHON_SERVICE_URL'), /PYTHON_SERVICE_URL/);
});

test('production server uses one-hop proxy trust and redacts invalid private URL credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-production-config-'));
  try {
    const valid = productionEnvironment(path.join(directory, 'umkm.sqlite'));
    const success = spawnSync(process.execPath, ['-e', [
      "const { app } = require('./server')",
      "console.log('trust-proxy=' + app.get('trust proxy'))",
      "require('./db/database').db.close()",
    ].join(';')], { cwd: projectRoot, env: valid, encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /trust-proxy=1/);

    const secretValue = 'must-not-appear-in-error-output';
    const failure = spawnSync(process.execPath, ['-e', "require('./server')"], {
      cwd: projectRoot,
      env: { ...valid, PYTHON_SERVICE_URL: `http://user:${secretValue}@private-fastapi.internal:8000` },
      encoding: 'utf8',
    });
    assert.notEqual(failure.status, 0);
    assert.match(failure.stderr, /PYTHON_SERVICE_URL/);
    assert.equal(failure.stderr.includes(secretValue), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('.env.example documents supported production inputs without real secrets', () => {
  const example = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
  for (const name of [
    'NODE_ENV', 'HOST', 'PORT', 'FRONTEND_ORIGIN', 'APP_PUBLIC_ORIGIN', 'DATABASE_PATH',
    'DATABASE_BOOTSTRAP_ALLOWED',
    'PYTHON_SERVICE_URL', 'PYTHON_AI_SERVICE_URL', 'SESSION_SECRET', 'SARI_RASA_LLM_API_KEY',
    'EMAIL_DELIVERY_MODE', 'RESEND_API_KEY',
  ]) {
    assert.match(example, new RegExp(`(?:^|\\n)#? ?${name}=`), `${name} must be documented`);
  }
  assert.match(example, /^SESSION_SECRET=\s*$/m);
  assert.match(example, /^RESEND_API_KEY=\s*$/m);
  assert.match(example, /^SARI_RASA_LLM_API_KEY=\s*$/m);
});

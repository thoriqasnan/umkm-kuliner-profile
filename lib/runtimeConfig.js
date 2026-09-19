const path = require('node:path');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5500';
const DEFAULT_PYTHON_SERVICE_URL = 'http://127.0.0.1:8000';

function requiredProductionValue(environment, name) {
  const value = environment[name];
  if (environment.NODE_ENV === 'production' && (typeof value !== 'string' || !value.trim())) {
    throw new Error(`${name} wajib dikonfigurasi secara eksplisit pada production.`);
  }
  return value;
}

function parseConfiguredPort(value) {
  if (value === undefined) return DEFAULT_PORT;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('PORT harus berupa angka bulat antara 1 dan 65535.');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT harus berupa angka bulat antara 1 dan 65535.');
  }
  return port;
}

function parseConfiguredHost(value, { production = false } = {}) {
  if (production && (typeof value !== 'string' || !value.trim())) {
    throw new Error('HOST wajib dikonfigurasi secara eksplisit pada production.');
  }
  const configured = value === undefined ? DEFAULT_HOST : value;
  if (
    typeof configured !== 'string' || !configured.trim() || configured.length > 253 ||
    /[\s/\\\0]/.test(configured) || configured.includes('://')
  ) {
    throw new Error('HOST harus berupa alamat bind atau hostname tanpa protocol, path, atau whitespace.');
  }
  return configured;
}

function parseConfiguredOrigin(value, name = 'FRONTEND_ORIGIN', fallback = DEFAULT_FRONTEND_ORIGIN, {
  production = false,
} = {}) {
  if (production && (typeof value !== 'string' || !value.trim())) {
    throw new Error(`${name} wajib dikonfigurasi secara eksplisit pada production.`);
  }
  const configured = value === undefined ? fallback : value;
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`${name} harus berupa origin HTTP/HTTPS absolut yang valid.`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
    parsed.pathname !== '/' || parsed.search || parsed.hash
  ) {
    throw new Error(`${name} harus berupa origin HTTP/HTTPS absolut tanpa path, credentials, query, atau fragment.`);
  }
  if (production && parsed.protocol !== 'https:') {
    throw new Error(`${name} production wajib memakai HTTPS.`);
  }
  return parsed.origin;
}

function parsePrivateServiceUrl(value, name, { production = false, fallback = DEFAULT_PYTHON_SERVICE_URL } = {}) {
  if (production && (typeof value !== 'string' || !value.trim())) {
    throw new Error(`${name} wajib dikonfigurasi secara eksplisit pada production.`);
  }
  const configured = value === undefined ? fallback : value;
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`${name} harus berupa URL HTTP/HTTPS absolut yang valid.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} harus berupa URL HTTP/HTTPS tanpa credentials, query, atau fragment.`);
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/`;
  return parsed.toString();
}

function loadRuntimeConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const frontendOrigin = parseConfiguredOrigin(
    requiredProductionValue(environment, 'FRONTEND_ORIGIN'), 'FRONTEND_ORIGIN',
    DEFAULT_FRONTEND_ORIGIN, { production },
  );
  const appPublicOrigin = parseConfiguredOrigin(
    requiredProductionValue(environment, 'APP_PUBLIC_ORIGIN'), 'APP_PUBLIC_ORIGIN',
    frontendOrigin, { production },
  );
  const pythonServiceUrl = parsePrivateServiceUrl(
    requiredProductionValue(environment, 'PYTHON_SERVICE_URL'), 'PYTHON_SERVICE_URL', { production },
  );
  const pythonAiServiceUrl = environment.PYTHON_AI_SERVICE_URL === undefined
    ? pythonServiceUrl
    : parsePrivateServiceUrl(environment.PYTHON_AI_SERVICE_URL, 'PYTHON_AI_SERVICE_URL');

  return Object.freeze({
    production,
    port: parseConfiguredPort(environment.PORT),
    host: parseConfiguredHost(environment.HOST, { production }),
    frontendOrigin,
    appPublicOrigin,
    pythonServiceUrl,
    pythonAiServiceUrl,
    trustProxy: production ? 1 : false,
  });
}

function validateProductionDatabasePath(environment = process.env) {
  if (environment.NODE_ENV !== 'production') return;
  if (typeof environment.DATABASE_PATH !== 'string' || !environment.DATABASE_PATH.trim()) {
    throw new Error('DATABASE_PATH wajib dikonfigurasi secara eksplisit pada production.');
  }
  if (!path.isAbsolute(environment.DATABASE_PATH)) {
    throw new Error('DATABASE_PATH production harus berupa path absolut pada storage persisten.');
  }
}

module.exports = {
  DEFAULT_FRONTEND_ORIGIN, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_PYTHON_SERVICE_URL,
  loadRuntimeConfig, parseConfiguredHost, parseConfiguredOrigin, parseConfiguredPort,
  parsePrivateServiceUrl, validateProductionDatabasePath,
};

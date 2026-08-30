const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_SESSION_SECRET = 'automated-test-secret-not-for-real-use';

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function createBackendHarness() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-backend-test-'));
  const databasePath = path.join(temporaryDirectory, 'test.sqlite');
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    DATABASE_PATH: process.env.DATABASE_PATH,
    PORT: process.env.PORT,
  };
  let server = null;
  let db = null;

  try {
    if (!path.isAbsolute(databasePath) || !isPathInside(temporaryDirectory, databasePath)) {
      throw new Error('Path database test harus berada di dalam temporary directory milik harness.');
    }

    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    process.env.DATABASE_PATH = databasePath;
    delete process.env.PORT;

    const { app, startServer } = require('../../server');
    const databaseModule = require('../../db/database');
    db = databaseModule.db;

    if (databaseModule.DB_PATH !== databasePath || !isPathInside(temporaryDirectory, databaseModule.DB_PATH)) {
      throw new Error('Backend tidak memakai database sementara yang dipilih harness.');
    }

    server = startServer(0);
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Alamat server test tidak valid.');

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      databasePath,
      temporaryDirectory,
      db,
      async cleanup() {
        let cleanupError = null;
        if (server) {
          try {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
          } catch (error) {
            cleanupError = error;
          }
          server = null;
        }
        try {
          if (db && db.open) db.close();
        } catch (error) {
          cleanupError ||= error;
        }
        db = null;
        try {
          fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        } catch (error) {
          cleanupError ||= error;
        } finally {
          restoreEnvironment(previousEnvironment);
        }
        if (cleanupError) throw cleanupError;
      },
    };
  } catch (error) {
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    if (db && db.open) db.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment(previousEnvironment);
    throw error;
  }
}

function restoreEnvironment(previousEnvironment) {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

module.exports = { createBackendHarness, isPathInside };

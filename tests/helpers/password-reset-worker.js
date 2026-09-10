const Database = require('better-sqlite3');
const fs = require('node:fs');
const { resetPasswordAtomically } = require('../../lib/passwordRecovery');

const [databasePath, digestHex, passwordHash, now, readyPath, releasePath] = process.argv.slice(2);
const db = new Database(databasePath);
db.pragma('busy_timeout = 3000');
db.pragma('foreign_keys = ON');
try {
  if (readyPath && releasePath) {
    fs.writeFileSync(readyPath, 'ready');
    while (!fs.existsSync(releasePath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  resetPasswordAtomically(db, Buffer.from(digestHex, 'hex'), passwordHash, { now: new Date(now) });
  process.stdout.write(JSON.stringify({ status: 'success' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'error', code: error.code || 'INTERNAL_ERROR' }));
} finally {
  db.close();
}

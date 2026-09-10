const Database = require('better-sqlite3');
const { changeAdminUserRole } = require('../../lib/adminUsers');

const [databasePath, actorIdRaw, targetIdRaw] = process.argv.slice(2);
const db = new Database(databasePath);
db.pragma('busy_timeout = 3000');

try {
  const user = changeAdminUserRole(db, {
    actorId: Number(actorIdRaw),
    actorTokenVersion: 0,
    targetId: Number(targetIdRaw),
    role: 'user',
  });
  process.stdout.write(JSON.stringify({ status: 200, user }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: error.status || 500, code: error.code || 'INTERNAL_ERROR' }));
} finally {
  db.close();
}

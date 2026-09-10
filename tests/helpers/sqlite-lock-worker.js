const Database = require('better-sqlite3');

const [databasePath, holdMsRaw] = process.argv.slice(2);
const db = new Database(databasePath);
db.exec('BEGIN IMMEDIATE');
process.stdout.write('READY\n');

setTimeout(() => {
  if (db.inTransaction) db.exec('ROLLBACK');
  db.close();
}, Number(holdMsRaw));

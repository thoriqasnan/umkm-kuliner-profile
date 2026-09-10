const { provisionAdminByEmail } = require('../lib/adminUsers');
const { normalizeEmail } = require('../lib/user');

let db;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function readEmailArgument(argv) {
  if (argv.length !== 2 || argv[0] !== '--email') return null;
  return argv[1];
}

const rawEmail = readEmailArgument(process.argv.slice(2));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

try {
  if (typeof rawEmail !== 'string') {
    fail('Penggunaan: npm run admin:provision -- --email admin@example.com');
  } else {
    const email = normalizeEmail(rawEmail);
    if (email.length === 0 || email.length > 254 || !emailPattern.test(email)) {
      fail('Email target tidak valid.');
    } else {
      ({ db } = require('../db/database'));
      const result = provisionAdminByEmail(db, email);
      process.stdout.write(
        result.changed
          ? `Administrator berhasil diprovision (user id ${result.id}).\n`
          : `Akun tersebut sudah administrator (user id ${result.id}).\n`
      );
    }
  }
} catch (error) {
  if (error && error.code === 'USER_NOT_FOUND') fail('Akun target belum terdaftar.');
  else if (error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_BUSY_TIMEOUT')) fail('Database sedang sibuk. Coba lagi nanti.');
  else fail('Provisioning administrator gagal.');
} finally {
  if (db && db.open) db.close();
}

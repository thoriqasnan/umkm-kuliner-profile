#!/usr/bin/env node

const {
  DatabaseMaintenanceError, createCanonicalBackup, restoreCanonicalBackup, verifyCanonicalBackup,
} = require('../lib/databaseMaintenance');

function parseArguments(values) {
  const [command, ...rest] = values;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--confirm-offline') {
      options.confirmOffline = true;
      continue;
    }
    if (!token.startsWith('--') || index + 1 >= rest.length || rest[index + 1].startsWith('--')) {
      throw new DatabaseMaintenanceError(`Argument tidak valid: ${token || '(kosong)'}.`);
    }
    options[token.slice(2)] = rest[index + 1];
    index += 1;
  }
  return { command, options };
}

function requiredOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new DatabaseMaintenanceError(`--${name} wajib diisi.`);
  }
  return value;
}

async function main(values = process.argv.slice(2), environment = process.env) {
  const { command, options } = parseArguments(values);
  if (command === 'backup') {
    const result = await createCanonicalBackup({
      source: requiredOption(options, 'source'),
      destination: requiredOption(options, 'destination'),
    });
    console.log(`Backup canonical terverifikasi: ${result.path}`);
    return;
  }
  if (command === 'verify') {
    const result = verifyCanonicalBackup(requiredOption(options, 'file'));
    console.log(`Backup canonical valid: ${result.path}`);
    return;
  }
  if (command === 'restore') {
    if (!options.confirmOffline) {
      throw new DatabaseMaintenanceError('Restore memerlukan --confirm-offline setelah Node dihentikan.');
    }
    const target = requiredOption({ target: environment.DATABASE_PATH }, 'target');
    const result = restoreCanonicalBackup({
      candidate: requiredOption(options, 'backup'),
      target,
      configuredDatabasePath: target,
      rollback: requiredOption(options, 'rollback'),
    });
    console.log(`Restore canonical terverifikasi. Rollback copy: ${result.rollbackPath}`);
    return;
  }
  throw new DatabaseMaintenanceError('Gunakan command backup, verify, atau restore.');
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof DatabaseMaintenanceError
      ? error.message
      : 'Operasi database gagal tanpa detail sensitif.';
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments };

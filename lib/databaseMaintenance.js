const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const CANONICAL_DEVELOPMENT_DB_PATH = path.join(REPOSITORY_ROOT, 'data', 'umkm.db');
const PHASE7_VECTOR_DB_PATH = path.join(REPOSITORY_ROOT, 'python', 'data', 'sari_rasa_vectors.db');
const PHASE8_INDEX_PATH = path.join(REPOSITORY_ROOT, 'python', 'data', 'sari_rasa_phase8_e5_vectors.db');
const REQUIRED_CANONICAL_TABLES = Object.freeze([
  'cart_items', 'cart_merges', 'password_reset_tokens', 'products', 'users',
]);
const SQLITE_SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal']);

class DatabaseMaintenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseMaintenanceError';
  }
}

function requireAbsolutePath(value, name) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
    throw new DatabaseMaintenanceError(`${name} harus berupa path absolut.`);
  }
  return path.resolve(value);
}

function resolvedIdentity(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function pathsReferToSameFile(first, second) {
  const firstPath = resolvedIdentity(first);
  const secondPath = resolvedIdentity(second);
  if (firstPath === secondPath) return true;
  try {
    const firstStat = fs.statSync(first);
    const secondStat = fs.statSync(second);
    return firstStat.dev === secondStat.dev && firstStat.ino === secondStat.ino;
  } catch {
    return false;
  }
}

function assertDistinctPaths(entries) {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (pathsReferToSameFile(entries[left].path, entries[right].path)) {
        throw new DatabaseMaintenanceError(`${entries[left].name} dan ${entries[right].name} harus berbeda.`);
      }
    }
  }
}

function protectedArtifactBases() {
  return [PHASE7_VECTOR_DB_PATH, PHASE8_INDEX_PATH];
}

function assertNotProtectedArtifact(filePath, name) {
  for (const protectedPath of protectedArtifactBases()) {
    const candidates = [protectedPath, ...SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${protectedPath}${suffix}`)];
    if (candidates.some((candidate) => pathsReferToSameFile(filePath, candidate))) {
      throw new DatabaseMaintenanceError(`${name} tidak boleh menargetkan data vector/index yang dilindungi.`);
    }
  }
}

function assertExistingRegularFile(filePath, name) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new DatabaseMaintenanceError(`${name} tidak ditemukan.`);
  }
  if (!stat.isFile()) throw new DatabaseMaintenanceError(`${name} harus berupa file biasa.`);
}

function verifyCanonicalBackup(filePath) {
  const candidate = requireAbsolutePath(filePath, 'File database');
  assertNotProtectedArtifact(candidate, 'File database');
  assertExistingRegularFile(candidate, 'File database');

  let database;
  try {
    database = new Database(candidate, { readonly: true, fileMustExist: true });
    const integrityRows = database.pragma('integrity_check');
    if (
      !Array.isArray(integrityRows) || integrityRows.length !== 1 ||
      integrityRows[0].integrity_check !== 'ok'
    ) {
      throw new DatabaseMaintenanceError('Pemeriksaan integritas SQLite gagal.');
    }
    const tables = new Set(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map((row) => row.name));
    const missingTables = REQUIRED_CANONICAL_TABLES.filter((name) => !tables.has(name));
    if (missingTables.length) {
      throw new DatabaseMaintenanceError(`Schema canonical tidak lengkap: ${missingTables.join(', ')}.`);
    }
    return Object.freeze({ path: candidate, integrity: 'ok', tables: [...REQUIRED_CANONICAL_TABLES] });
  } catch (error) {
    if (error instanceof DatabaseMaintenanceError) throw error;
    throw new DatabaseMaintenanceError('File bukan backup SQLite canonical yang valid.');
  } finally {
    if (database?.open) database.close();
  }
}

async function createCanonicalBackup({ source, destination }) {
  const sourcePath = requireAbsolutePath(source, 'Source database');
  const destinationPath = requireAbsolutePath(destination, 'Destination backup');
  assertNotProtectedArtifact(sourcePath, 'Source database');
  assertNotProtectedArtifact(destinationPath, 'Destination backup');
  assertDistinctPaths([
    { name: 'Source database', path: sourcePath },
    { name: 'Destination backup', path: destinationPath },
  ]);
  assertExistingRegularFile(sourcePath, 'Source database');
  if (fs.existsSync(destinationPath)) {
    throw new DatabaseMaintenanceError('Destination backup sudah ada; overwrite ditolak.');
  }
  const destinationDirectory = path.dirname(destinationPath);
  if (!fs.existsSync(destinationDirectory) || !fs.statSync(destinationDirectory).isDirectory()) {
    throw new DatabaseMaintenanceError('Directory destination backup harus sudah ada.');
  }
  verifyCanonicalBackup(sourcePath);

  let destinationReserved = false;
  const sourceDatabase = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const destinationDescriptor = fs.openSync(destinationPath, 'wx', 0o600);
    fs.closeSync(destinationDescriptor);
    destinationReserved = true;
    await sourceDatabase.backup(destinationPath);
    return verifyCanonicalBackup(destinationPath);
  } catch (error) {
    if (destinationReserved && fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
    if (error instanceof DatabaseMaintenanceError) throw error;
    throw new DatabaseMaintenanceError('Backup SQLite gagal dibuat.');
  } finally {
    if (sourceDatabase.open) sourceDatabase.close();
  }
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertOfflineTarget(targetPath) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    if (fs.existsSync(`${targetPath}${suffix}`)) {
      throw new DatabaseMaintenanceError('Restore ditolak: SQLite sidecar masih ada; pastikan aplikasi benar-benar offline.');
    }
  }
}

function restoreCanonicalBackup({ candidate, target, configuredDatabasePath, rollback }) {
  const candidatePath = requireAbsolutePath(candidate, 'Candidate backup');
  const targetPath = requireAbsolutePath(target, 'Restore target');
  const configuredPath = requireAbsolutePath(configuredDatabasePath, 'Configured DATABASE_PATH');
  const rollbackPath = requireAbsolutePath(rollback, 'Rollback copy');
  for (const [name, filePath] of [
    ['Candidate backup', candidatePath], ['Restore target', targetPath], ['Rollback copy', rollbackPath],
  ]) assertNotProtectedArtifact(filePath, name);
  if (!pathsReferToSameFile(targetPath, configuredPath)) {
    throw new DatabaseMaintenanceError('Restore target harus sama dengan configured DATABASE_PATH.');
  }
  assertDistinctPaths([
    { name: 'Candidate backup', path: candidatePath },
    { name: 'Restore target', path: targetPath },
    { name: 'Rollback copy', path: rollbackPath },
  ]);
  assertExistingRegularFile(targetPath, 'Restore target');
  if (fs.existsSync(rollbackPath)) {
    throw new DatabaseMaintenanceError('Rollback copy sudah ada; overwrite ditolak.');
  }
  if (path.dirname(rollbackPath) !== path.dirname(targetPath)) {
    throw new DatabaseMaintenanceError('Rollback copy harus berada di directory yang sama dengan restore target.');
  }
  assertOfflineTarget(targetPath);
  verifyCanonicalBackup(candidatePath);
  verifyCanonicalBackup(targetPath);

  const stagingPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.restore-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  let originalMoved = false;
  let candidateInstalled = false;
  try {
    fs.copyFileSync(candidatePath, stagingPath, fs.constants.COPYFILE_EXCL);
    syncFile(stagingPath);
    verifyCanonicalBackup(stagingPath);
    fs.renameSync(targetPath, rollbackPath);
    originalMoved = true;
    fs.renameSync(stagingPath, targetPath);
    candidateInstalled = true;
    const verification = verifyCanonicalBackup(targetPath);
    return Object.freeze({ ...verification, rollbackPath });
  } catch (error) {
    if (candidateInstalled && fs.existsSync(targetPath)) {
      fs.renameSync(targetPath, stagingPath);
      candidateInstalled = false;
    }
    if (originalMoved && !fs.existsSync(targetPath) && fs.existsSync(rollbackPath)) {
      fs.renameSync(rollbackPath, targetPath);
      originalMoved = false;
    }
    if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
    if (error instanceof DatabaseMaintenanceError) throw error;
    throw new DatabaseMaintenanceError('Restore SQLite gagal; database awal dipertahankan atau dikembalikan.');
  }
}

module.exports = {
  CANONICAL_DEVELOPMENT_DB_PATH,
  DatabaseMaintenanceError,
  PHASE7_VECTOR_DB_PATH,
  PHASE8_INDEX_PATH,
  REQUIRED_CANONICAL_TABLES,
  createCanonicalBackup,
  restoreCanonicalBackup,
  verifyCanonicalBackup,
};

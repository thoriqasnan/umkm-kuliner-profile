const crypto = require('node:crypto');

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class PasswordResetError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function toTimestamp(value) {
  return new Date(value).toISOString();
}

function digestToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function parseToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== TOKEN_BYTES || decoded.toString('base64url') !== token) return null;
  return digestToken(token);
}

function cleanupOldTokens(db, now) {
  const cutoff = toTimestamp(now.getTime() - RETENTION_MS);
  db.prepare(`
    DELETE FROM password_reset_tokens
    WHERE (consumed_at IS NOT NULL AND consumed_at < @cutoff)
       OR (expires_at < @cutoff)
  `).run({ cutoff });
}

function createResetCredential(db, userId, options = {}) {
  const now = options.now || new Date();
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const randomValue = randomBytes(TOKEN_BYTES);
  if (!Buffer.isBuffer(randomValue) || randomValue.length !== TOKEN_BYTES) {
    throw new Error('Password-reset RNG harus menghasilkan tepat 32 byte.');
  }
  const rawToken = randomValue.toString('base64url');
  const digest = digestToken(rawToken);
  const createdAt = toTimestamp(now);
  const expiresAt = toTimestamp(now.getTime() + TOKEN_TTL_MS);

  db.exec('BEGIN IMMEDIATE');
  try {
    cleanupOldTokens(db, now);
    db.prepare(`UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`)
      .run(createdAt, userId);
    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_digest, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, digest, expiresAt, createdAt);
    db.exec('COMMIT');
    return { rawToken, expiresAt };
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function performEquivalentUnknownAccountWork(options = {}) {
  const randomBytes = options.randomBytes || crypto.randomBytes;
  return digestToken(randomBytes(TOKEN_BYTES).toString('base64url'));
}

function acceptUnknownAccountRequest(db, options = {}) {
  const now = options.now || new Date();
  const digest = performEquivalentUnknownAccountWork(options);
  db.exec('BEGIN IMMEDIATE');
  try {
    cleanupOldTokens(db, now);
    db.prepare('SELECT length(?) AS digest_length').get(digest);
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function resetPasswordAtomically(db, tokenDigest, passwordHash, options = {}) {
  const now = options.now || new Date();
  const timestamp = toTimestamp(now);
  db.exec('BEGIN IMMEDIATE');
  try {
    const credential = db.prepare(`
      SELECT id, user_id FROM password_reset_tokens
      WHERE token_digest = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(tokenDigest, timestamp);
    if (!credential) throw new PasswordResetError('RESET_TOKEN_INVALID');

    const consumed = db.prepare(`
      UPDATE password_reset_tokens SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(timestamp, credential.id, timestamp);
    if (consumed.changes !== 1) throw new PasswordResetError('RESET_TOKEN_INVALID');

    const userUpdate = db.prepare(`
      UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?
    `).run(passwordHash, credential.user_id);
    if (userUpdate.changes !== 1) throw new Error('Reset credential references a missing user');

    db.prepare(`UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`)
      .run(timestamp, credential.user_id);
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  PasswordResetError,
  TOKEN_BYTES,
  TOKEN_TTL_MS,
  acceptUnknownAccountRequest,
  createResetCredential,
  digestToken,
  parseToken,
  performEquivalentUnknownAccountWork,
  resetPasswordAtomically,
};

const ALLOWED_ROLES = new Set(['user', 'admin']);

class AdminUserError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AdminUserError';
    this.status = status;
    this.code = code;
  }
}

function mapAdminUser(row, actorId, adminCount) {
  const isCurrent = row.id === actorId;
  const isLastActiveAdmin = row.role === 'admin' && adminCount === 1;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    isCurrent,
    isLastActiveAdmin,
    canChangeRole: !isCurrent && !isLastActiveAdmin,
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function listAdminUsers(db, actorId, { search, role, limit, offset }) {
  const where = [];
  const parameters = { limit, offset };

  if (search !== undefined) {
    where.push("email LIKE @search ESCAPE '\\' COLLATE NOCASE");
    parameters.search = `%${escapeLike(search)}%`;
  }
  if (role !== undefined) {
    where.push('role = @role');
    parameters.role = role;
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users${whereSql}`).get(parameters).count;
  const rows = db.prepare(
    `SELECT id, email, role, created_at FROM users${whereSql} ORDER BY id ASC LIMIT @limit OFFSET @offset`
  ).all(parameters);

  return {
    users: rows.map((row) => mapAdminUser(row, actorId, adminCount)),
    pagination: { limit, offset, total },
  };
}

function changeAdminUserRole(db, { actorId, actorTokenVersion, targetId, role }) {
  if (!ALLOWED_ROLES.has(role)) {
    throw new AdminUserError(400, 'VALIDATION_ERROR', 'Validasi gagal');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const actor = db.prepare('SELECT id, role, token_version FROM users WHERE id = ?').get(actorId);
    if (!actor || actor.role !== 'admin' || actor.token_version !== actorTokenVersion) {
      throw new AdminUserError(409, 'ACTOR_NOT_ADMIN', 'Otorisasi administrator telah berubah');
    }

    const target = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(targetId);
    if (!target) {
      throw new AdminUserError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan');
    }

    if (target.role === role) {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
      db.exec('COMMIT');
      return mapAdminUser(target, actorId, adminCount);
    }

    if (target.role === 'admin' && role === 'user') {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
      if (adminCount <= 1) {
        throw new AdminUserError(409, 'LAST_ADMIN_PROTECTED', 'Sistem harus memiliki minimal satu administrator aktif');
      }
      if (target.id === actorId) {
        throw new AdminUserError(409, 'SELF_DEMOTION_NOT_ALLOWED', 'Administrator tidak dapat menurunkan role akun sendiri');
      }
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
    const updated = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(targetId);
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
    db.exec('COMMIT');
    return mapAdminUser(updated, actorId, adminCount);
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function provisionAdminByEmail(db, email) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const user = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
    if (!user) throw new AdminUserError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan');
    if (user.role !== 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    db.exec('COMMIT');
    return { id: user.id, changed: user.role !== 'admin' };
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  ALLOWED_ROLES,
  AdminUserError,
  changeAdminUserRole,
  listAdminUsers,
  provisionAdminByEmail,
};

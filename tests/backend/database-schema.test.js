const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createBackendHarness } = require('../helpers/backend-harness');

const projectRoot = path.resolve(__dirname, '..', '..');
const secret = 'automated-test-secret-not-for-real-use';

function startDatabaseInChild(databasePath) {
  return spawnSync(process.execPath, ['-e', "require('./db/database').db.close()"], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: secret, DATABASE_PATH: databasePath },
    encoding: 'utf8',
  });
}

test('fresh database schema, constraints, cascades, and lifecycle', async (t) => {
  const harness = await createBackendHarness();
  try {
    const db = harness.db;
    await t.test('creates expected tables with foreign keys enabled', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
      for (const name of ['products', 'users', 'cart_items', 'cart_merges']) assert.equal(tables.includes(name), true);
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    });

    await t.test('exposes meaningful primary keys, foreign keys, and merge metadata column', () => {
      const cartColumns = db.pragma('table_info(cart_items)');
      assert.deepEqual(cartColumns.filter((column) => column.pk).map((column) => column.name), ['user_id', 'product_id']);
      assert.deepEqual(db.pragma('table_info(products)').filter((column) => column.pk).map((column) => column.name), ['id']);
      assert.deepEqual(db.pragma('table_info(users)').filter((column) => column.pk).map((column) => column.name), ['id']);
      const mergeColumns = db.pragma('table_info(cart_merges)');
      assert.deepEqual(mergeColumns.filter((column) => column.pk).map((column) => column.name), ['user_id', 'merge_id']);
      assert.equal(mergeColumns.some((column) => column.name === 'skipped_product_ids' && column.notnull === 1), true);
      const foreignKeys = db.pragma('foreign_key_list(cart_items)');
      assert.equal(foreignKeys.some((key) => key.table === 'users' && key.on_delete === 'CASCADE'), true);
      assert.equal(foreignKeys.some((key) => key.table === 'products' && key.on_delete === 'CASCADE'), true);
      const mergeForeignKeys = db.pragma('foreign_key_list(cart_merges)');
      assert.equal(mergeForeignKeys.some((key) => key.table === 'users' && key.on_delete === 'CASCADE'), true);
    });

    await t.test('database enforces cart quantity/note constraints and cascades product/user deletion', () => {
      db.prepare("INSERT INTO users (email, password_hash) VALUES ('schema@example.test', 'hash')").run();
      const userId = db.prepare("SELECT id FROM users WHERE email = 'schema@example.test'").get().id;
      const insertCartItem = db.prepare('INSERT INTO cart_items (user_id, product_id, quantity, note) VALUES (?, ?, ?, ?)');
      assert.throws(() => insertCartItem.run(userId, 1, 0, ''));
      assert.throws(() => insertCartItem.run(userId, 1, 100, ''));
      assert.throws(() => insertCartItem.run(userId, 1, 1.5, ''));
      assert.throws(() => insertCartItem.run(userId, 1, 1, 'x'.repeat(201)));
      insertCartItem.run(userId, 1, 1, '');
      insertCartItem.run(userId, 2, 99, 'x'.repeat(200));
      db.prepare("INSERT INTO cart_merges (user_id, merge_id) VALUES (?, '30000000-0000-4000-8000-000000000001')").run(userId);
      db.prepare('DELETE FROM products WHERE id = 1').run();
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cart_items WHERE product_id = 1').get().count, 0);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cart_items').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cart_merges').get().count, 0);
    });
  } finally {
    await harness.cleanup();
  }
});

test('startup evolves supported cart_merges schema and preserves existing data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umkm-schema-evolution-'));
  const databasePath = path.join(directory, 'legacy.sqlite');
  try {
    const db = new Database(databasePath);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE products (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price INTEGER NOT NULL, category TEXT NOT NULL, image_src TEXT NOT NULL, image_srcset TEXT, image_sizes TEXT, image_alt TEXT NOT NULL, image_width INTEGER NOT NULL, image_height INTEGER NOT NULL, description_id TEXT NOT NULL DEFAULT '', description_en TEXT NOT NULL DEFAULT '');
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, role TEXT NOT NULL DEFAULT 'user', token_version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE cart_merges (user_id INTEGER NOT NULL, merge_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, merge_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
      INSERT INTO products (id, slug, name, price, category, image_src, image_srcset, image_sizes, image_alt, image_width, image_height, description_id, description_en) VALUES (50, 'custom', 'Custom', 1, 'custom-category', 'x', NULL, NULL, 'x', 1, 1, 'Admin custom ID', 'Admin custom EN');
      INSERT INTO users (email, password_hash) VALUES ('preserved@example.test', 'hash');
    `);
    db.close();
    const first = startDatabaseInChild(databasePath);
    assert.equal(first.status, 0, first.stderr);
    const second = startDatabaseInChild(databasePath);
    assert.equal(second.status, 0, second.stderr);
    const reopened = new Database(databasePath);
    assert.equal(reopened.pragma('table_info(cart_merges)').some((column) => column.name === 'skipped_product_ids'), true);
    assert.deepEqual(reopened.prepare("SELECT description_id, description_en FROM products WHERE slug = 'custom'").get(), { description_id: 'Admin custom ID', description_en: 'Admin custom EN' });
    assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM products').get().count, 1);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM users WHERE email = 'preserved@example.test'").get().count, 1);
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('actual index.html provides every element required by script.js getElementById calls', () => {
  const requiredIds = [...script.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  assert.ok(requiredIds.length > 0, 'script.js should expose literal DOM ID dependencies');

  for (const id of new Set(requiredIds)) {
    const occurrences = html.match(new RegExp(`\\bid=["']${escapeRegex(id)}["']`, 'g')) || [];
    assert.equal(occurrences.length, 1, `index.html must contain exactly one #${id} required by script.js`);
  }
});

test('actual HTML provides required singleton/class controls and loads production script.js', () => {
  for (const className of ['navbar-right', 'carousel', 'filter-btn', 'lang-btn']) {
    assert.match(html, new RegExp(`class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["']`));
  }
  assert.match(html, /<script\s+src=["']script\.js["']><\/script>/);
});

test('frontend API paths have corresponding backend routes and stable HTTP methods', () => {
  const server = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const contracts = [
    ['post', '/api/auth/register', '/api/auth/register'],
    ['post', '/api/auth/login', '/api/auth/login'],
    ['get', '/api/auth/me', '/api/auth/me'],
    ['post', '/api/auth/logout', '/api/auth/logout'],
    ['get', '/api/products', '/api/products'],
    ['post', '/api/products', '/api/products'],
    ['put', '/api/products/:id', '/api/products/${editingProductId}'],
    ['delete', '/api/products/:id', '/api/products/${productId}'],
    ['get', '/api/cart', '/api/cart'],
    ['post', '/api/cart/merge', '/api/cart/merge'],
    ['put', '/api/cart/items/:productId', '/api/cart/items/${productId}'],
    ['delete', '/api/cart/items/:productId', '/api/cart/items/${productId}'],
  ];

  for (const [method, backendPath, frontendPath] of contracts) {
    assert.match(server, new RegExp(`app\\.${method}\\(["']${escapeRegex(backendPath)}["']`));
    assert.ok(script.includes(frontendPath), `script.js must call ${frontendPath}`);
  }

  assert.match(script, /credentials:\s*["']include["']/);
  assert.match(script, /method:\s*["']PUT["']/);
  assert.match(script, /method:\s*["']DELETE["']/);
  assert.match(script, /method:\s*["']POST["']/);
});

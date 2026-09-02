const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { createBackendHarness } = require('../helpers/backend-harness');
const { createCookieClient } = require('../helpers/cookie-client');
const { USERS, product, jsonRequest, register, login, registerAndLogin } = require('../helpers/fixtures');

const projectRoot = path.resolve(__dirname, '..', '..');

test('authentication, sessions, and product API contracts', async (t) => {
  const harness = await createBackendHarness();
  try {
    const anonymous = createCookieClient(harness.baseUrl);
    const user = createCookieClient(harness.baseUrl);
    const admin = createCookieClient(harness.baseUrl);

    await t.test('registration normalizes email, rejects duplicates/invalid data, and ignores admin self-assignment', async () => {
      const response = await register(user, { email: '  User-A@Example.Test ', password: USERS.userA.password }, { role: 'admin' });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).user.email, USERS.userA.email);
      const row = harness.db.prepare('SELECT email, role FROM users WHERE email = ?').get(USERS.userA.email);
      assert.deepEqual(row, { email: USERS.userA.email, role: 'user' });
      assert.equal((await register(anonymous, USERS.userA)).status, 409);
      assert.equal((await register(anonymous, { email: 'not-an-email', password: 'short' })).status, 400);
    });

    await t.test('development login sets an HTTP-usable signed cookie and auth state uses current database role', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      assert.equal((await login(user, { ...USERS.userA, password: 'WrongPass123!' })).status, 401);
      const response = await login(user, USERS.userA);
      assert.equal(response.status, 200);
      const setCookie = response.headers.get('set-cookie');
      assert.match(setCookie, /^session=[^;]+/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.doesNotMatch(setCookie, /(?:^|;\s*)Secure(?:;|$)/i);
      assert.equal((await anonymous.request('/api/auth/me')).status, 401);
      anonymous.setSessionCookie('session=invalid.signature');
      assert.equal((await anonymous.request('/api/auth/me')).status, 401);
      assert.equal((await user.request('/api/auth/me')).status, 200);
      harness.db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(USERS.userA.email);
      const me = await user.request('/api/auth/me');
      assert.equal((await me.json()).user.role, 'admin');
      harness.db.prepare("UPDATE users SET role = 'user' WHERE email = ?").run(USERS.userA.email);
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    await t.test('production login cookie remains Secure, HttpOnly, and SameSite=Lax', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const response = await login(user, USERS.userA);
        assert.equal(response.status, 200);
        const setCookie = response.headers.get('set-cookie');
        assert.match(setCookie, /(?:^|;\s*)Secure(?:;|$)/i);
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    });

    await t.test('logout increments token_version and rejects a copied pre-logout cookie', async () => {
      const copied = user.getSessionCookie();
      const before = harness.db.prepare('SELECT token_version FROM users WHERE email = ?').get(USERS.userA.email).token_version;
      assert.equal((await user.request('/api/auth/logout', { method: 'POST' })).status, 200);
      const after = harness.db.prepare('SELECT token_version FROM users WHERE email = ?').get(USERS.userA.email).token_version;
      assert.equal(after, before + 1);
      const replay = createCookieClient(harness.baseUrl);
      replay.setSessionCookie(copied);
      assert.equal((await replay.request('/api/auth/me')).status, 401);
    });

    await t.test('public product reads expose seeded shape and ID outcomes', async () => {
      const list = await anonymous.request('/api/products');
      assert.equal(list.status, 200);
      const products = await list.json();
      assert.equal(products.length, 11);
      assert.equal(products.some((item) => item.slug === 'nasigoreng'), true);
      assert.deepEqual(Object.keys(products[0]).sort(), ['category', 'description', 'id', 'image', 'name', 'price', 'slug']);
      assert.equal((await anonymous.request('/api/products/1')).status, 200);
      assert.equal((await anonymous.request('/api/products/nope')).status, 400);
      assert.equal((await anonymous.request('/api/products/99999')).status, 404);
    });

    await t.test('CORS permits the configured frontend with credentials and does not permit an unapproved origin', async () => {
      const allowed = await anonymous.request('/api/health', { headers: { Origin: 'http://localhost:5500' } });
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5500');
      assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
      const unapproved = await anonymous.request('/api/health', { headers: { Origin: 'https://unapproved.example.test' } });
      assert.notEqual(unapproved.headers.get('access-control-allow-origin'), 'https://unapproved.example.test');
    });

    await t.test('product mutations enforce authentication and current admin role', async () => {
      const payload = product();
      assert.equal((await jsonRequest(anonymous, '/api/products', 'POST', payload)).status, 401);
      await login(user, USERS.userA);
      assert.equal((await jsonRequest(user, '/api/products', 'POST', payload)).status, 403);
      await registerAndLogin(admin, USERS.admin);
      harness.db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(USERS.admin.email);
      const createdResponse = await jsonRequest(admin, '/api/products', 'POST', payload);
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()).product;
      assert.equal(harness.db.prepare('SELECT name FROM products WHERE id = ?').get(created.id).name, payload.name);
      const updatedPayload = product({ slug: 'regression-product-updated', name: 'Updated Regression Product', price: 0 });
      assert.equal((await jsonRequest(admin, `/api/products/${created.id}`, 'PUT', updatedPayload)).status, 200);
      assert.equal(harness.db.prepare('SELECT name, price FROM products WHERE id = ?').get(created.id).price, 0);
      assert.equal((await admin.request(`/api/products/${created.id}`, { method: 'DELETE' })).status, 204);
      assert.equal(harness.db.prepare('SELECT 1 FROM products WHERE id = ?').get(created.id), undefined);
    });

    await t.test('product validation rejects important invalid boundaries and malformed bodies', async () => {
      const cases = [
        product({ slug: '' }),
        product({ slug: 'bad-category', category: '' }),
        product({ slug: 'bad-price', price: '12000' }),
        product({ slug: 'bad-width', image: { src: 'x', alt: 'x', width: 0, height: 10 } }),
      ];
      for (const value of cases) assert.equal((await jsonRequest(admin, '/api/products', 'POST', value)).status, 400);
      assert.equal((await jsonRequest(admin, '/api/products', 'POST', product({ slug: 'nasigoreng' }))).status, 409);
      const malformed = await admin.request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(malformed.status, 400);
      const oversized = await jsonRequest(admin, '/api/products', 'POST', product({ slug: 'oversized', name: 'x'.repeat(110000) }));
      assert.equal(oversized.status, 413);
    });

    await t.test('anonymous and normal users cannot update or delete products', async () => {
      assert.equal((await jsonRequest(anonymous, '/api/products/1', 'PUT', product())).status, 401);
      assert.equal((await anonymous.request('/api/products/1', { method: 'DELETE' })).status, 401);
      assert.equal((await jsonRequest(user, '/api/products/1', 'PUT', product())).status, 403);
      assert.equal((await user.request('/api/products/1', { method: 'DELETE' })).status, 403);
    });

    await t.test('login rate limiting returns 429 and Retry-After without wall-clock assertions', async () => {
      const credentials = { email: 'rate-limit-target@example.test', password: 'WrongPass123!' };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.equal((await login(anonymous, credentials)).status, 401);
      }
      const limited = await login(anonymous, credentials);
      assert.equal(limited.status, 429);
      assert.match(limited.headers.get('retry-after'), /^\d+$/);
    });
  } finally {
    await harness.cleanup();
  }
});

test('SESSION_SECRET initialization is fail-loud when missing or short', () => {
  for (const secret of ['', 'too-short']) {
    const result = spawnSync(process.execPath, ['-e', "require('./lib/session')"], {
      cwd: projectRoot,
      env: { ...process.env, SESSION_SECRET: secret },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SESSION_SECRET/);
  }
});

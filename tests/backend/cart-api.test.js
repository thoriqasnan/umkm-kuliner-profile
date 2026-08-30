const assert = require('node:assert/strict');
const test = require('node:test');
const { createBackendHarness } = require('../helpers/backend-harness');
const { createCookieClient } = require('../helpers/cookie-client');
const { USERS, jsonRequest, registerAndLogin } = require('../helpers/fixtures');

test('authenticated cart API validation and ownership contracts', async (t) => {
  const harness = await createBackendHarness();
  try {
    const anonymous = createCookieClient(harness.baseUrl);
    const userA = createCookieClient(harness.baseUrl);
    const userB = createCookieClient(harness.baseUrl);

    await t.test('all cart routes reject anonymous requests', async () => {
      const requests = [
        anonymous.request('/api/cart'),
        jsonRequest(anonymous, '/api/cart/items/1', 'PUT', { quantity: 1, note: '' }),
        anonymous.request('/api/cart/items/1', { method: 'DELETE' }),
        anonymous.request('/api/cart', { method: 'DELETE' }),
        jsonRequest(anonymous, '/api/cart/merge', 'POST', { mergeId: '10000000-0000-4000-8000-000000000001', items: [] }),
      ];
      for (const response of await Promise.all(requests)) assert.equal(response.status, 401);
    });

    await registerAndLogin(userA, USERS.userA);
    await registerAndLogin(userB, USERS.userB);

    await t.test('new cart is empty; PUT creates/updates canonical persisted state', async () => {
      assert.deepEqual((await (await userA.request('/api/cart')).json()).items, []);
      assert.equal((await jsonRequest(userA, '/api/cart/items/1', 'PUT', { quantity: 1, note: '' })).status, 200);
      assert.equal((await jsonRequest(userA, '/api/cart/items/1', 'PUT', { quantity: 99, note: 'updated' })).status, 200);
      const item = (await (await userA.request('/api/cart')).json()).items[0];
      assert.equal(item.productId, 1);
      assert.equal(item.quantity, 99);
      assert.equal(item.note, 'updated');
      assert.deepEqual(harness.db.prepare('SELECT quantity, note FROM cart_items').get(), { quantity: 99, note: 'updated' });
    });

    await t.test('quantity, note, and product ID boundaries are enforced', async () => {
      for (const quantity of [0, 100, 1.5, '1', undefined, null]) {
        const response = await jsonRequest(userA, '/api/cart/items/2', 'PUT', { quantity, note: '' });
        assert.equal(response.status, 400);
      }
      assert.equal((await jsonRequest(userA, '/api/cart/items/2', 'PUT', { quantity: 1, note: 'x'.repeat(200) })).status, 200);
      assert.equal((await jsonRequest(userA, '/api/cart/items/2', 'PUT', { quantity: 1, note: 'x'.repeat(201) })).status, 400);
      assert.equal((await jsonRequest(userA, '/api/cart/items/2', 'PUT', { quantity: 1, note: 4 })).status, 400);
      assert.equal((await jsonRequest(userA, '/api/cart/items/bad', 'PUT', { quantity: 1, note: '' })).status, 400);
      assert.equal((await jsonRequest(userA, '/api/cart/items/99999', 'PUT', { quantity: 1, note: '' })).status, 404);
    });

    await t.test('users only read, mutate, delete, and clear their own cart', async () => {
      await jsonRequest(userB, '/api/cart/items/3', 'PUT', { quantity: 4, note: 'B only' });
      await jsonRequest(userA, '/api/cart/items/3', 'PUT', { quantity: 8, note: 'A only' });
      assert.deepEqual((await (await userB.request('/api/cart')).json()).items.map((item) => item.productId), [3]);
      const aItem = (await (await userA.request('/api/cart')).json()).items.find((item) => item.productId === 3);
      assert.deepEqual([aItem.quantity, aItem.note], [8, 'A only']);
      const bItem = (await (await userB.request('/api/cart')).json()).items[0];
      assert.deepEqual([bItem.quantity, bItem.note], [4, 'B only']);
      assert.equal((await userA.request('/api/cart/items/3', { method: 'DELETE' })).status, 204);
      assert.equal((await (await userB.request('/api/cart')).json()).items[0].note, 'B only');
      assert.equal((await userA.request('/api/cart', { method: 'DELETE' })).status, 204);
      assert.deepEqual((await (await userA.request('/api/cart')).json()).items, []);
      assert.equal((await (await userB.request('/api/cart')).json()).items.length, 1);
      assert.equal((await userB.request('/api/cart/items/3', { method: 'DELETE' })).status, 204);
      assert.deepEqual((await (await userB.request('/api/cart')).json()).items, []);
    });

    await t.test('deleted products cannot be carted and product deletion cascades cart rows', async () => {
      await jsonRequest(userA, '/api/cart/items/4', 'PUT', { quantity: 2, note: '' });
      harness.db.prepare('DELETE FROM products WHERE id = 4').run();
      assert.equal(harness.db.prepare('SELECT 1 FROM cart_items WHERE product_id = 4').get(), undefined);
      assert.equal((await jsonRequest(userA, '/api/cart/items/4', 'PUT', { quantity: 1, note: '' })).status, 404);
    });
  } finally {
    await harness.cleanup();
  }
});

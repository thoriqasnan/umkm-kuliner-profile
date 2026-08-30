const assert = require('node:assert/strict');
const test = require('node:test');
const { createBackendHarness } = require('../helpers/backend-harness');
const { createCookieClient } = require('../helpers/cookie-client');
const { USERS, jsonRequest, registerAndLogin } = require('../helpers/fixtures');

const mergeIds = {
  empty: '20000000-0000-4000-8000-000000000001',
  main: '20000000-0000-4000-8000-000000000002',
  shared: '20000000-0000-4000-8000-000000000003',
};

test('guest-to-authenticated cart merge contract', async (t) => {
  const harness = await createBackendHarness();
  try {
    const userA = createCookieClient(harness.baseUrl);
    const userB = createCookieClient(harness.baseUrl);
    await registerAndLogin(userA, USERS.userA);
    await registerAndLogin(userB, USERS.userB);

    await t.test('empty merge succeeds', async () => {
      const response = await jsonRequest(userA, '/api/cart/merge', 'POST', { mergeId: mergeIds.empty, items: [] });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).alreadyMerged, false);
    });

    await t.test('new/overlapping items merge, clamp at 99, and apply note rules', async () => {
      await jsonRequest(userA, '/api/cart/items/1', 'PUT', { quantity: 90, note: 'server note' });
      await jsonRequest(userA, '/api/cart/items/2', 'PUT', { quantity: 2, note: 'preserve me' });
      const response = await jsonRequest(userA, '/api/cart/merge', 'POST', {
        mergeId: mergeIds.main,
        items: [
          { productId: 1, quantity: 20, note: 'guest wins' },
          { productId: 2, quantity: 3, note: '' },
          { productId: 3, quantity: 4, note: 'new item' },
          { productId: 99999, quantity: 1, note: '' },
        ],
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.alreadyMerged, false);
      assert.deepEqual(body.skippedProductIds, [99999]);
      const byId = Object.fromEntries(body.items.map((item) => [item.productId, item]));
      assert.deepEqual([byId[1].quantity, byId[1].note], [99, 'guest wins']);
      assert.deepEqual([byId[2].quantity, byId[2].note], [5, 'preserve me']);
      assert.deepEqual([byId[3].quantity, byId[3].note], [4, 'new item']);
    });

    await t.test('same user retry is immutable and does not reapply changes', async () => {
      harness.db.prepare('DELETE FROM products WHERE id = 1').run();
      const response = await jsonRequest(userA, '/api/cart/merge', 'POST', {
        mergeId: mergeIds.main,
        items: [{ productId: 2, quantity: 50, note: 'must not apply' }],
      });
      const body = await response.json();
      assert.equal(body.alreadyMerged, true);
      assert.deepEqual(body.skippedProductIds, [99999]);
      const item = body.items.find((candidate) => candidate.productId === 2);
      assert.deepEqual([item.quantity, item.note], [5, 'preserve me']);
    });

    await t.test('same merge ID is independent across users', async () => {
      for (const client of [userA, userB]) {
        const response = await jsonRequest(client, '/api/cart/merge', 'POST', {
          mergeId: mergeIds.shared,
          items: [{ productId: 5, quantity: 1, note: '' }],
        });
        assert.equal((await response.json()).alreadyMerged, false);
      }
      assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM cart_merges WHERE merge_id = ?').get(mergeIds.shared).count, 2);
    });

    await t.test('merge validation rejects invalid UUID, duplicates, malformed items, and over-limit size', async () => {
      const invalidBodies = [
        { mergeId: 'invalid', items: [] },
        { mergeId: '20000000-0000-4000-8000-000000000010', items: [{ productId: 2, quantity: 1, note: '' }, { productId: 2, quantity: 1, note: '' }] },
        { mergeId: '20000000-0000-4000-8000-000000000011', items: [{ productId: '2', quantity: 1, note: '' }] },
        { mergeId: '20000000-0000-4000-8000-000000000012', items: Array.from({ length: 101 }, (_, i) => ({ productId: i + 1, quantity: 1, note: '' })) },
      ];
      for (const body of invalidBodies) assert.equal((await jsonRequest(userA, '/api/cart/merge', 'POST', body)).status, 400);
    });

    await t.test('validation failures create neither receipt nor partial cart changes', async () => {
      const beforeMerges = harness.db.prepare('SELECT COUNT(*) AS count FROM cart_merges').get().count;
      const beforeItems = harness.db.prepare('SELECT COUNT(*) AS count FROM cart_items').get().count;
      await jsonRequest(userA, '/api/cart/merge', 'POST', {
        mergeId: '20000000-0000-4000-8000-000000000020',
        items: [{ productId: 6, quantity: 1, note: '' }, { productId: 6, quantity: 2, note: '' }],
      });
      assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM cart_merges').get().count, beforeMerges);
      assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM cart_items').get().count, beforeItems);
    });
  } finally {
    await harness.cleanup();
  }
});

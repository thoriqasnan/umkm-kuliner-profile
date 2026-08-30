const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness, response, deferred, settle, FIXED_UUID } = require('../helpers/frontend-vm-harness');

const CART_KEY = 'umkm-cart:v1';
const MERGE_KEY = 'umkm-cart-merge:v1';
const user = { id: 7, email: 'user-a@example.test', role: 'user' };
const product = { id: 1, slug: 'one', name: 'One', price: 100, category: 'makanan', image: { src: 'x', alt: 'x', width: 1, height: 1 }, description: { id: '', en: '' } };

test('existing authenticated startup fetches server cart without replaying guest merge', async () => {
  const harness = await createFrontendHarness({
    products: [product], authUser: user,
    authenticatedCart: [{ productId: 1, quantity: 4, note: 'server' }],
    storage: { [CART_KEY]: JSON.stringify({ items: [{ productId: 1, quantity: 2, note: 'guest' }] }) },
  });
  assert.equal(harness.probe.state().authority, 'authenticated');
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 4, note: 'server' }]);
  assert.equal(harness.calls.some((call) => call.url.endsWith('/api/cart/merge')), false);
});

test('explicit login locks mutations, persists stable merge intent, and adopts canonical cart', async () => {
  const harness = await createFrontendHarness({
    products: [product],
    storage: { [CART_KEY]: JSON.stringify({ items: [{ productId: 1, quantity: 2, note: 'guest' }] }) },
  });
  let mergeBody;
  harness.addRoute('/api/auth/login', async () => response(200, { status: 'success' }));
  const verification = deferred();
  harness.addRoute('/api/auth/me', () => verification.promise);
  harness.addRoute('/api/cart/merge', async (_url, options) => {
    mergeBody = JSON.parse(options.body);
    return response(200, { status: 'success', alreadyMerged: false, skippedProductIds: [], items: [{ productId: 1, quantity: 5, note: 'merged' }] });
  });
  harness.probe.elements.authEmailInput.value = 'USER-A@EXAMPLE.TEST';
  harness.probe.elements.authPasswordInput.value = 'TemporaryPass123!';
  const submission = harness.probe.elements.authForm.dispatch('submit');
  await settle(8);
  assert.equal(harness.probe.state().authority, 'auth-transition');
  harness.probe.changeCartQuantity(1, 1);
  assert.equal(harness.probe.state().items[0].quantity, 2);
  const durableIntent = JSON.parse(harness.storage.getItem(MERGE_KEY));
  assert.equal(durableIntent.mergeId, FIXED_UUID);
  assert.deepEqual(durableIntent.items, [{ productId: 1, quantity: 2, note: 'guest' }]);
  verification.resolve(response(200, { status: 'success', user }));
  await submission;
  assert.deepEqual(mergeBody, { mergeId: FIXED_UUID, items: [{ productId: 1, quantity: 2, note: 'guest' }] });
  assert.equal(harness.probe.state().authority, 'authenticated');
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 5, note: 'merged' }]);
  assert.equal(harness.storage.getItem(CART_KEY), null);
  assert.equal(harness.storage.getItem(MERGE_KEY), null);
  const mergeCall = harness.calls.find((call) => call.url.endsWith('/api/cart/merge'));
  assert.equal(mergeCall.options.credentials, 'include');
});

test('bound pending merge retries with stable identity and is not claimed by another account', async () => {
  const pending = { kind: 'bound', userId: user.id, mergeId: FIXED_UUID, items: [{ productId: 1, quantity: 2, note: 'retry' }] };
  const retry = await createFrontendHarness({
    products: [product], authUser: user,
    storage: { [CART_KEY]: JSON.stringify({ items: pending.items }), [MERGE_KEY]: JSON.stringify(pending) },
    mergeResponse: { status: 'success', alreadyMerged: true, skippedProductIds: [], items: [{ productId: 1, quantity: 6, note: 'canonical' }] },
  });
  const retryCall = retry.calls.find((call) => call.url.endsWith('/api/cart/merge'));
  assert.deepEqual(JSON.parse(retryCall.options.body), { mergeId: FIXED_UUID, items: pending.items });
  assert.equal(retry.storage.getItem(MERGE_KEY), null);

  const otherUser = { id: 99, email: 'other@example.test', role: 'user' };
  const other = await createFrontendHarness({
    products: [product], authUser: otherUser, authenticatedCart: [],
    storage: { [CART_KEY]: JSON.stringify({ items: pending.items }), [MERGE_KEY]: JSON.stringify(pending) },
  });
  assert.equal(other.calls.some((call) => call.url.endsWith('/api/cart/merge')), false);
  assert.equal(other.storage.getItem(MERGE_KEY), JSON.stringify(pending));
  assert.notEqual(other.storage.getItem(CART_KEY), null);
});

test('storage write failure retains guest durability while allowing safe same-page verified recovery', async () => {
  const storedGuest = JSON.stringify({ items: [{ productId: 1, quantity: 2, note: 'guest' }] });
  const harness = await createFrontendHarness({ products: [product], storage: { [CART_KEY]: storedGuest } });
  harness.storage.setFailure(true);
  harness.addRoute('/api/auth/login', async () => response(200, {}));
  harness.addRoute('/api/auth/me', async () => response(200, { user }));
  harness.addRoute('/api/cart/merge', async () => response(200, { status: 'success', alreadyMerged: false, skippedProductIds: [], items: [{ productId: 1, quantity: 3, note: 'server' }] }));
  harness.probe.elements.authEmailInput.value = user.email;
  harness.probe.elements.authPasswordInput.value = 'TemporaryPass123!';
  await harness.probe.elements.authForm.dispatch('submit');
  assert.equal(harness.storage.getItem(CART_KEY), storedGuest);
  assert.equal(harness.storage.getItem(MERGE_KEY), null);
  assert.equal(harness.probe.state().authority, 'authenticated');
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 3, note: 'server' }]);
});

test('non-durable merge intent stays locked and retains guest recovery state when verification/merge fails', async () => {
  const storedGuest = JSON.stringify({ items: [{ productId: 1, quantity: 2, note: 'guest' }] });
  const harness = await createFrontendHarness({ products: [product], storage: { [CART_KEY]: storedGuest } });
  harness.storage.setFailure(true);
  const verification = deferred();
  harness.addRoute('/api/auth/login', async () => response(200, {}));
  harness.addRoute('/api/auth/me', () => verification.promise);
  harness.addRoute('/api/cart/merge', async () => response(500, {}));
  harness.probe.elements.authEmailInput.value = user.email;
  harness.probe.elements.authPasswordInput.value = 'TemporaryPass123!';
  const submission = harness.probe.elements.authForm.dispatch('submit');
  await settle(8);
  assert.equal(harness.probe.state().authority, 'auth-transition');
  harness.probe.changeCartQuantity(1, 1);
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 2, note: 'guest' }]);
  assert.equal(harness.storage.getItem(CART_KEY), storedGuest);
  assert.equal(harness.storage.getItem(MERGE_KEY), null);
  verification.resolve(response(200, { user }));
  await submission;
  const mergeCall = harness.calls.find((call) => call.url.endsWith('/api/cart/merge'));
  assert.deepEqual(JSON.parse(mergeCall.options.body), { mergeId: FIXED_UUID, items: [{ productId: 1, quantity: 2, note: 'guest' }] });
  assert.equal(harness.probe.state().authority, 'indeterminate');
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 2, note: 'guest' }]);
  assert.equal(harness.storage.getItem(CART_KEY), storedGuest);
});

test('late auth response cannot overwrite a newer anonymous authority result', async () => {
  const harness = await createFrontendHarness({ products: [product] });
  const oldRequest = deferred();
  const newRequest = deferred();
  let count = 0;
  harness.addRoute('/api/auth/me', () => (++count === 1 ? oldRequest.promise : newRequest.promise));
  const oldCheck = harness.probe.checkAuthState();
  const newCheck = harness.probe.checkAuthState();
  newRequest.resolve(response(401, {}));
  await newCheck;
  oldRequest.resolve(response(200, { user }));
  await oldCheck;
  await settle();
  assert.equal(harness.probe.state().authority, 'guest');
  assert.equal(harness.probe.state().currentUser, null);
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness, response, deferred, settle } = require('../helpers/frontend-vm-harness');

const user = { id: 8, email: 'writer@example.test', role: 'user' };
const product = { id: 1, slug: 'one', name: 'One', price: 100, category: 'makanan', image: { src: 'x', alt: 'x', width: 1, height: 1 }, description: { id: '', en: '' } };

async function authenticatedHarness() {
  const harness = await createFrontendHarness({ products: [product] });
  harness.probe.setUser(user);
  harness.probe.setAuthority('authenticated', user.id);
  harness.probe.replaceItems([{ productId: 1, quantity: 1, note: '' }]);
  return harness;
}

test('same-product writes serialize and coalesce to final intended quantity', async () => {
  const harness = await authenticatedHarness();
  const first = deferred();
  let writes = 0;
  harness.addRoute('/api/cart/items/1', async () => (++writes === 1 ? first.promise : response(200, { status: 'success' })));
  harness.probe.changeCartQuantity(1, 1);
  harness.probe.changeCartQuantity(1, 1);
  harness.probe.changeCartQuantity(1, 1);
  assert.equal(harness.calls.filter((call) => call.url.endsWith('/api/cart/items/1')).length, 1);
  first.resolve(response(200, { status: 'success' }));
  await settle(20);
  const calls = harness.calls.filter((call) => call.url.endsWith('/api/cart/items/1'));
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { quantity: 4, note: '' });
  assert.equal(calls.every((call) => call.options.credentials === 'include' && call.options.method === 'PUT'), true);
  assert.equal(harness.probe.state().unsynced, false);
});

test('note debounce persists only the final value and blur flushes deterministically', async () => {
  const harness = await authenticatedHarness();
  harness.addRoute('/api/cart/items/1', async () => response(200, { status: 'success' }));
  harness.probe.renderCartPanel();
  const note = harness.probe.elements.cartPanelList.querySelector('.cart-panel-item-note');
  note.value = 'first'; await note.dispatch('input');
  harness.timers.advance(300);
  note.value = 'final'; await note.dispatch('input');
  harness.timers.advance(449);
  assert.equal(harness.calls.filter((call) => call.url.endsWith('/api/cart/items/1')).length, 0);
  await note.dispatch('blur');
  await settle(12);
  const calls = harness.calls.filter((call) => call.url.endsWith('/api/cart/items/1'));
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { quantity: 1, note: 'final' });
});

test('debounce timer and zero-quantity deletion use the authenticated request contract', async () => {
  const harness = await authenticatedHarness();
  harness.addRoute('/api/cart/items/1', async () => response(204));
  harness.probe.renderCartPanel();
  const note = harness.probe.elements.cartPanelList.querySelector('.cart-panel-item-note');
  note.value = 'timer final'; await note.dispatch('input');
  harness.timers.advance(450);
  await settle(12);
  let calls = harness.calls.filter((call) => call.url.endsWith('/api/cart/items/1'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PUT');
  harness.probe.changeCartQuantity(1, -1);
  await settle(12);
  calls = harness.calls.filter((call) => call.url.endsWith('/api/cart/items/1'));
  assert.equal(calls.at(-1).options.method, 'DELETE');
  assert.equal(calls.at(-1).options.credentials, 'include');
});

test('failed write reconciles from canonical server cart and prevents false checkout success while unsafe', async () => {
  const harness = await authenticatedHarness();
  const failure = deferred();
  harness.addRoute('/api/cart/items/1', () => failure.promise);
  harness.addRoute((url, options) => url.endsWith('/api/cart') && !options.method, async () => response(200, { status: 'success', items: [{ productId: 1, quantity: 2, note: 'canonical' }] }));
  harness.probe.changeCartQuantity(1, 1);
  assert.equal(harness.probe.elements.cartCheckoutBtn.disabled, true);
  await harness.probe.elements.cartCheckoutBtn.dispatch('click');
  assert.equal(harness.opened.length, 0);
  failure.resolve(response(500, {}));
  await settle(20);
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 2, note: 'canonical' }]);
  assert.equal(harness.probe.state().authority, 'authenticated');
  assert.equal(harness.probe.state().unsynced, false);
  assert.equal(harness.probe.elements.cartCheckoutBtn.disabled, false);
});

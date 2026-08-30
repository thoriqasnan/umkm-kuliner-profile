const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness, response, deferred, settle } = require('../helpers/frontend-vm-harness');

const user = { id: 9, email: 'logout@example.test', role: 'user' };
const product = { id: 1, slug: 'one', name: 'One', price: 100, category: 'makanan', image: { src: 'x', alt: 'x', width: 1, height: 1 }, description: { id: '', en: '' } };
const CART_KEY = 'umkm-cart:v1';

async function setup() {
  const harness = await createFrontendHarness({ products: [product] });
  harness.probe.setUser(user);
  harness.probe.setAuthority('authenticated', user.id);
  harness.probe.replaceItems([{ productId: 1, quantity: 2, note: '' }]);
  return harness;
}

test('logout flushes/drains pending notes then clears authority without copying account cart to guest', async () => {
  const harness = await setup();
  harness.addRoute('/api/cart/items/1', async () => response(200, { status: 'success' }));
  harness.addRoute('/api/auth/logout', async () => response(200, { status: 'success' }));
  harness.addRoute('/api/auth/me', async () => response(401, {}));
  harness.addRoute('/api/products', async () => response(200, [product]));
  harness.probe.renderCartPanel();
  const note = harness.probe.elements.cartPanelList.querySelector('.cart-panel-item-note');
  note.value = 'flush before logout'; await note.dispatch('input');
  await harness.probe.handleLogout();
  const writeIndex = harness.calls.findIndex((call) => call.url.endsWith('/api/cart/items/1'));
  const logoutIndex = harness.calls.findIndex((call) => call.url.endsWith('/api/auth/logout'));
  assert.equal(writeIndex >= 0 && logoutIndex > writeIndex, true);
  assert.equal(harness.probe.state().authority, 'guest');
  assert.deepEqual(harness.probe.state().items, []);
  assert.equal(harness.storage.getItem(CART_KEY), null);
});

test('failed drain aborts logout and never turns account state into guest state', async () => {
  const harness = await setup();
  harness.addRoute('/api/cart/items/1', async () => response(500, {}));
  harness.addRoute((url, options) => url.endsWith('/api/cart') && !options.method, async () => { throw new Error('recovery unavailable'); });
  harness.probe.renderCartPanel();
  const note = harness.probe.elements.cartPanelList.querySelector('.cart-panel-item-note');
  note.value = 'cannot persist'; await note.dispatch('input');
  await harness.probe.handleLogout();
  await settle(20);
  assert.equal(harness.calls.some((call) => call.url.endsWith('/api/auth/logout')), false);
  assert.notEqual(harness.probe.state().authority, 'guest');
  assert.equal(harness.probe.state().currentUser.id, user.id);
  assert.equal(harness.storage.getItem(CART_KEY), null);
});

test('late User A cart response cannot leak into a newer guest context', async () => {
  const harness = await setup();
  const oldCart = deferred();
  harness.addRoute((url) => url.endsWith('/api/cart'), () => oldCart.promise);
  const activation = harness.probe.activateAuthenticatedCart(user);
  harness.probe.setUser(null);
  harness.probe.activateGuestCart([]);
  oldCart.resolve(response(200, { status: 'success', items: [{ productId: 1, quantity: 8, note: 'User A' }] }));
  await activation;
  assert.equal(harness.probe.state().authority, 'guest');
  assert.deepEqual(harness.probe.state().items, []);
});

test('late User A cart response cannot overwrite newer User B canonical state', async () => {
  const harness = await setup();
  const userB = { id: 10, email: 'user-b@example.test', role: 'user' };
  const cartA = deferred();
  const cartB = deferred();
  let fetchCount = 0;
  harness.addRoute((url) => url.endsWith('/api/cart'), () => (++fetchCount === 1 ? cartA.promise : cartB.promise));
  const activationA = harness.probe.activateAuthenticatedCart(user);
  harness.probe.setUser(userB);
  harness.probe.setAuthority('authenticated', userB.id);
  const activationB = harness.probe.activateAuthenticatedCart(userB);
  cartB.resolve(response(200, { status: 'success', items: [{ productId: 1, quantity: 3, note: 'User B' }] }));
  await activationB;
  cartA.resolve(response(200, { status: 'success', items: [{ productId: 1, quantity: 8, note: 'User A' }] }));
  await activationA;
  assert.equal(harness.probe.state().authority, 'authenticated');
  assert.equal(harness.probe.state().userId, userB.id);
  assert.equal(harness.probe.state().currentUser.id, userB.id);
  assert.deepEqual(harness.probe.state().items, [{ productId: 1, quantity: 3, note: 'User B' }]);
});

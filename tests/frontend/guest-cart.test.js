const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness } = require('../helpers/frontend-vm-harness');

const CART_KEY = 'umkm-cart:v1';
const products = [
  { id: 1, slug: 'first', name: 'Current First', price: 10000, category: 'makanan', image: { src: '1.jpg', alt: 'First', width: 1, height: 1 }, description: { id: 'Satu', en: 'One' } },
  { id: 2, slug: 'second', name: 'Current Second', price: 5000, category: 'minuman', image: { src: '2.jpg', alt: 'Second', width: 1, height: 1 }, description: { id: 'Dua', en: 'Two' } },
];

test('guest cart starts empty and safely sanitizes stored state', async () => {
  const empty = await createFrontendHarness({ products });
  assert.deepEqual(empty.probe.state().items, []);

  const malformed = await createFrontendHarness({ storage: { [CART_KEY]: '{' }, products });
  assert.deepEqual(malformed.probe.state().items, []);
  assert.equal(malformed.storage.getItem(CART_KEY), '{"items":[]}');

  const mixed = await createFrontendHarness({
    products,
    storage: { [CART_KEY]: JSON.stringify({ items: [
      { productId: 1, quantity: 2, note: 'valid', name: 'stale' },
      { productId: -1, quantity: 2, note: '' },
      { productId: 2, quantity: 100, note: '' },
    ] }) },
  });
  assert.deepEqual(mixed.probe.state().items, [{ productId: 1, quantity: 2, note: 'valid' }]);
  assert.deepEqual(JSON.parse(mixed.storage.getItem(CART_KEY)), { items: [{ productId: 1, quantity: 2, note: 'valid' }] });
});

test('guest mutations are model-authoritative and persist only canonical fields', async () => {
  const harness = await createFrontendHarness({ products });
  harness.probe.changeCartQuantity(2, 1);
  harness.probe.changeCartQuantity(1, 1);
  harness.probe.changeCartQuantity(1, 1);
  harness.probe.renderCartPanel();
  const firstItem = harness.probe.elements.cartPanelList.querySelector('[data-product-id="1"]');
  const note = firstItem.querySelector('.cart-panel-item-note');
  note.value = 'fresh note';
  await note.dispatch('input');
  assert.deepEqual(harness.probe.state().items, [
    { productId: 2, quantity: 1, note: '' },
    { productId: 1, quantity: 2, note: 'fresh note' },
  ]);
  const persisted = JSON.parse(harness.storage.getItem(CART_KEY));
  assert.deepEqual(persisted.items, harness.probe.state().items);
  assert.deepEqual(Object.keys(persisted.items[0]).sort(), ['note', 'productId', 'quantity']);
  harness.probe.changeCartQuantity(2, -1);
  assert.equal(harness.probe.state().items.some((item) => item.productId === 2), false);
  harness.probe.changeCartQuantity(1, -1);
  harness.probe.changeCartQuantity(1, -1);
  assert.deepEqual(harness.probe.state().items, []);
  assert.deepEqual(JSON.parse(harness.storage.getItem(CART_KEY)), { items: [] });
});

test('dormant product IDs survive menu absence and become visible when product returns', async () => {
  const harness = await createFrontendHarness({
    products: [products[0]],
    storage: { [CART_KEY]: JSON.stringify({ items: [{ productId: 2, quantity: 3, note: 'dormant' }] }) },
  });
  assert.deepEqual(harness.probe.state().items, [{ productId: 2, quantity: 3, note: 'dormant' }]);
  assert.equal(harness.probe.elements.cartCountEl.textContent, 0);
  harness.probe.setProducts(products);
  assert.equal(harness.probe.elements.cartCountEl.textContent, 3);
});

test('checkout uses current product metadata and never stale guest metadata', async () => {
  const harness = await createFrontendHarness({
    products,
    storage: { [CART_KEY]: JSON.stringify({ items: [{ productId: 1, quantity: 2, note: 'no *stars*', name: 'Stale Name', price: 1 }] }) },
  });
  const message = harness.probe.buildOrderMessage();
  assert.match(message, /Current First x2/);
  assert.match(message, /Rp20\.000/);
  assert.doesNotMatch(message, /Stale Name/);
  await harness.probe.elements.cartCheckoutBtn.dispatch('click');
  assert.equal(harness.opened.length, 1);
  assert.equal(harness.opened[0][1], '_blank');
  assert.equal(harness.opened[0][2], 'noopener');
});

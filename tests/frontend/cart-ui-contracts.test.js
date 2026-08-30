const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness } = require('../helpers/frontend-vm-harness');

const products = [
  { id: 1, slug: 'food', name: 'Food', price: 10000, category: 'makanan', image: { src: '1', alt: 'Food', width: 1, height: 1 }, description: { id: 'Makanan', en: 'Food desc' } },
  { id: 2, slug: 'drink', name: 'Drink', price: 5000, category: 'minuman', image: { src: '2', alt: 'Drink', width: 1, height: 1 }, description: { id: 'Minuman', en: 'Drink desc' } },
];

test('menu renders current products; filtering and cart summary follow model state', async () => {
  const harness = await createFrontendHarness({ products });
  const cards = harness.document.querySelectorAll('.menu-card');
  assert.equal(cards.length, 2);
  harness.probe.changeCartQuantity(1, 1);
  harness.probe.changeCartQuantity(2, 2);
  assert.equal(harness.probe.elements.cartCountEl.textContent, 3);
  assert.match(harness.probe.elements.cartTotalEl.textContent, /20\.000/);
  const foodFilter = harness.document.querySelectorAll('.filter-btn').find((button) => button.dataset.filter === 'makanan');
  await foodFilter.dispatch('click');
  assert.equal(cards.find((card) => Number(card.dataset.productId) === 1).classList.contains('hide'), false);
  assert.equal(cards.find((card) => Number(card.dataset.productId) === 2).classList.contains('hide'), true);
});

test('cart panel reflects current metadata/note and removes deleted model items', async () => {
  const harness = await createFrontendHarness({ products });
  harness.probe.changeCartQuantity(1, 1);
  harness.probe.renderCartPanel();
  let item = harness.probe.elements.cartPanelList.querySelector('[data-product-id="1"]');
  assert.equal(item.querySelector('.cart-panel-item-name').textContent, 'Food');
  const note = item.querySelector('.cart-panel-item-note');
  note.value = 'note'; await note.dispatch('input');
  assert.equal(harness.probe.state().items[0].note, 'note');
  harness.probe.changeCartQuantity(1, -1);
  harness.probe.renderCartPanel();
  item = harness.probe.elements.cartPanelList.querySelector('[data-product-id="1"]');
  assert.equal(item, null);
});

test('language, auth, and admin visibility update through production behavior', async () => {
  const harness = await createFrontendHarness({ products });
  harness.probe.applyLanguage('en');
  assert.equal(harness.document.documentElement.lang, 'en');
  assert.equal(harness.document.querySelector('.menu-card-desc').textContent, 'Food desc');
  harness.probe.setUser({ id: 1, email: 'admin@example.test', role: 'admin' });
  assert.equal(harness.probe.elements.authLoginBtn.classList.contains('hide'), true);
  assert.equal(harness.probe.elements.authAccount.classList.contains('hide'), false);
  assert.equal(harness.probe.elements.adminMenuActions.classList.contains('hide'), false);
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, false);
  harness.probe.setUser(null);
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, true);
});

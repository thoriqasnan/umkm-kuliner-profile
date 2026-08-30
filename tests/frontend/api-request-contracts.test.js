const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness, response } = require('../helpers/frontend-vm-harness');

const product = {
  id: 1, slug: 'existing', name: 'Existing', price: 10000, category: 'makanan',
  image: { src: 'existing.jpg', alt: 'Existing', width: 700, height: 467 },
  description: { id: 'Ada', en: 'Existing' },
};

test('registration request uses the production route, method, credentials, and body', async () => {
  const harness = await createFrontendHarness({ products: [product] });
  let registrationCall;
  harness.addRoute('/api/auth/register', async (_url, _options, call) => {
    registrationCall = call;
    return response(201, { status: 'success' });
  });
  harness.probe.setAuthMode('register');
  harness.probe.elements.authEmailInput.value = ' new@example.test ';
  harness.probe.elements.authPasswordInput.value = 'TemporaryPass123!';
  await harness.probe.elements.authForm.dispatch('submit');
  assert.equal(registrationCall.url, 'http://localhost:3000/api/auth/register');
  assert.equal(registrationCall.options.method, 'POST');
  assert.equal(registrationCall.options.credentials, 'include');
  assert.equal(registrationCall.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(registrationCall.options.body), { email: 'new@example.test', password: 'TemporaryPass123!' });
});

test('admin create, update, and delete use their production request contracts', async () => {
  const harness = await createFrontendHarness({ products: [product] });
  harness.probe.setUser({ id: 1, email: 'admin@example.test', role: 'admin' });
  harness.probe.setProducts([product]);
  const mutationCalls = [];
  harness.addRoute((url) => url.includes('/api/products'), async (_url, options, call) => {
    if (options.method) mutationCalls.push(call);
    if (options.method === 'POST') return response(201, { product });
    if (options.method === 'PUT') return response(200, { product });
    if (options.method === 'DELETE') return response(204);
    return response(200, [product]);
  });

  const fields = harness.probe.elements;
  harness.probe.openProductDialog('create');
  fields.productSlugInput.value = 'created';
  fields.productNameInput.value = 'Created Product';
  fields.productDescriptionIdInput.value = 'Deskripsi';
  fields.productDescriptionEnInput.value = 'Description';
  fields.productPriceInput.value = '12.500';
  fields.productCategoryInput.value = 'makanan';
  fields.productImageSrcInput.value = 'created.jpg';
  fields.productImageAltInput.value = 'Created';
  fields.productImageWidthInput.value = '700';
  fields.productImageHeightInput.value = '467';
  fields.productImageSrcsetInput.value = '';
  fields.productImageSizesInput.value = '';
  await fields.productForm.dispatch('submit');
  const create = mutationCalls[0];
  assert.equal(create.url, 'http://localhost:3000/api/products');
  assert.equal(create.options.method, 'POST');
  assert.equal(create.options.credentials, 'include');
  const createBody = JSON.parse(create.options.body);
  assert.deepEqual({ slug: createBody.slug, price: createBody.price, category: createBody.category }, { slug: 'created', price: 12500, category: 'makanan' });
  assert.deepEqual(createBody.description, { id: 'Deskripsi', en: 'Description' });

  harness.probe.setProducts([product]);
  harness.probe.openProductDialog('edit', product.id);
  fields.productNameInput.value = 'Updated Product';
  await fields.productForm.dispatch('submit');
  const update = mutationCalls[1];
  assert.equal(update.url, 'http://localhost:3000/api/products/1');
  assert.equal(update.options.method, 'PUT');
  assert.equal(update.options.credentials, 'include');
  assert.equal(JSON.parse(update.options.body).name, 'Updated Product');

  const deleteButton = harness.document.createElement('button');
  await harness.probe.handleDeleteProduct(product.id, deleteButton);
  const deletion = mutationCalls[2];
  assert.equal(deletion.url, 'http://localhost:3000/api/products/1');
  assert.equal(deletion.options.method, 'DELETE');
  assert.equal(deletion.options.credentials, 'include');
  assert.equal(deletion.options.body, undefined);
});

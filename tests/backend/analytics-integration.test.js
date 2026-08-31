const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createBackendHarness } = require('../helpers/backend-harness');

const SUMMARY = {
  total_revenue: 745000,
  unique_orders: 20,
  total_quantity: 53,
  average_order_value: 37250.0,
};
const PRODUCTS = {
  products: [
    { product_name: 'Es Teh', total_quantity: 9, total_revenue: 45000 },
    { product_name: 'Nasi Goreng', total_quantity: 6, total_revenue: 108000 },
  ],
};
const CATEGORIES = {
  categories: [
    { category: 'Camilan', total_revenue: 120000 },
    { category: 'Makanan', total_revenue: 504000 },
    { category: 'Minuman', total_revenue: 121000 },
  ],
};

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Alamat mock upstream tidak valid.');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('Node analytics gateway validates FastAPI responses and controls upstream failures', async () => {
  const requestedPaths = [];
  let mode = 'success';
  const upstream = http.createServer((req, res) => {
    requestedPaths.push(req.url);

    if (mode === 'timeout') return;
    if (mode === 'body-timeout') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      return res.write('{"total_revenue":');
    }
    if (mode === 'upstream-error') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: '/private/python/path: internal failure' }));
    }
    if (mode === 'invalid-json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{not-json');
    }
    if (mode === 'invalid-contract') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const invalidBody = {
        '/analytics/summary': { total_revenue: 'not-a-number' },
        '/analytics/products': { products: [{ product_name: 'Es Teh', total_quantity: 'nine', total_revenue: 45000 }] },
        '/analytics/categories': { categories: [{ category: '', total_revenue: 120000 }] },
      }[req.url];
      return res.end(JSON.stringify(invalidBody));
    }
    if (mode === 'extra-fields') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const extraBody = {
        '/analytics/summary': { ...SUMMARY, internal_debug: 'must not pass through' },
        '/analytics/products': {
          products: [{ ...PRODUCTS.products[0], internal_debug: 'must not pass through' }],
        },
        '/analytics/categories': {
          categories: [{ ...CATEGORIES.categories[0], internal_debug: 'must not pass through' }],
        },
      }[req.url];
      return res.end(JSON.stringify(extraBody));
    }

    const body = {
      '/analytics/summary': SUMMARY,
      '/analytics/products': PRODUCTS,
      '/analytics/categories': CATEGORIES,
    }[req.url];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { detail: 'not found' }));
  });

  const upstreamUrl = await listen(upstream);
  const harness = await createBackendHarness({ pythonServiceUrl: `${upstreamUrl}/` });

  async function request(pathname) {
    return fetch(`${harness.baseUrl}${pathname}`);
  }

  async function assertControlledFailure(response, status, message) {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { status: 'error', message });
  }

  try {
    assert.deepEqual(await (await request('/api/analytics/summary')).json(), SUMMARY);
    assert.deepEqual(await (await request('/api/analytics/products')).json(), PRODUCTS);
    assert.deepEqual(await (await request('/api/analytics/categories')).json(), CATEGORIES);
    assert.deepEqual(requestedPaths.slice(0, 3), [
      '/analytics/summary',
      '/analytics/products',
      '/analytics/categories',
    ]);

    mode = 'upstream-error';
    const upstreamError = await request('/api/analytics/summary');
    await assertControlledFailure(upstreamError, 502, 'Layanan analitik tidak tersedia');
    assert.doesNotMatch(JSON.stringify(await (await request('/api/health')).json()), /private|python/i);

    mode = 'invalid-json';
    await assertControlledFailure(
      await request('/api/analytics/summary'),
      502,
      'Layanan analitik tidak tersedia'
    );

    mode = 'invalid-contract';
    for (const endpoint of ['summary', 'products', 'categories']) {
      await assertControlledFailure(
        await request(`/api/analytics/${endpoint}`),
        502,
        'Layanan analitik tidak tersedia'
      );
    }

    mode = 'extra-fields';
    for (const endpoint of ['summary', 'products', 'categories']) {
      await assertControlledFailure(
        await request(`/api/analytics/${endpoint}`),
        502,
        'Layanan analitik tidak tersedia'
      );
    }

    mode = 'timeout';
    await assertControlledFailure(
      await request('/api/analytics/summary'),
      504,
      'Layanan analitik tidak merespons tepat waktu'
    );

    mode = 'body-timeout';
    await assertControlledFailure(
      await request('/api/analytics/summary'),
      504,
      'Layanan analitik tidak merespons tepat waktu'
    );
    assert.equal((await (await request('/api/health')).json()).status, 'ok');

    const unavailableServer = http.createServer();
    const unavailableUrl = await listen(unavailableServer);
    await close(unavailableServer);
    process.env.PYTHON_SERVICE_URL = unavailableUrl;
    await assertControlledFailure(
      await request('/api/analytics/summary'),
      502,
      'Layanan analitik tidak tersedia'
    );
    assert.equal((await (await request('/api/health')).json()).status, 'ok');
  } finally {
    process.env.PYTHON_SERVICE_URL = upstreamUrl;
    await harness.cleanup();
    await close(upstream);
  }
});

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createBackendHarness } = require('../helpers/backend-harness');
const { isSalesTrendResponse } = require('../../lib/pythonAnalyticsClient');

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
const SALES_TREND = {
  available_period: { min_available_date: '2026-07-01', max_available_date: '2026-07-15' },
  start_date: '2026-07-01', end_date: '2026-07-02',
  summary: { total_revenue: 105000, unique_orders: 3, total_quantity: 8, average_order_value: 35000 },
  daily_sales: [
    { date: '2026-07-01', total_revenue: 68000, unique_orders: 2, total_quantity: 5 },
    { date: '2026-07-02', total_revenue: 37000, unique_orders: 1, total_quantity: 3 },
  ],
  high_day: { date: '2026-07-01', total_revenue: 68000 },
  low_day: { date: '2026-07-02', total_revenue: 37000 },
};

test('sales trend validator rejects inconsistent AOV, empty totals, and excessive point counts', () => {
  assert.equal(isSalesTrendResponse(SALES_TREND), true);
  assert.equal(isSalesTrendResponse({ ...SALES_TREND, summary: { ...SALES_TREND.summary, average_order_value: 1 } }), false);
  assert.equal(isSalesTrendResponse({ ...SALES_TREND, daily_sales: [] , high_day: null, low_day: null }), false);
  assert.equal(isSalesTrendResponse({ ...SALES_TREND, daily_sales: Array.from({ length: 3661 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`, total_revenue: 0, unique_orders: 0, total_quantity: 0 })) }), false);
});

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
    const pathname = new URL(req.url, 'http://upstream').pathname;

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
    if (mode === 'upstream-range-error') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: '/private/python/path must stay hidden' }));
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
        '/analytics/sales-trend': { ...SALES_TREND, daily_sales: [...SALES_TREND.daily_sales].reverse() },
      }[pathname];
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
        '/analytics/sales-trend': { ...SALES_TREND, internal_debug: true },
      }[pathname];
      return res.end(JSON.stringify(extraBody));
    }

    const body = {
      '/analytics/summary': SUMMARY,
      '/analytics/products': PRODUCTS,
      '/analytics/categories': CATEGORIES,
      '/analytics/sales-trend': SALES_TREND,
    }[pathname];
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
    assert.deepEqual(await (await request('/api/analytics/sales-trend?start_date=2026-07-01&end_date=2026-07-02')).json(), SALES_TREND);
    assert.deepEqual(requestedPaths.slice(0, 4), [
      '/analytics/summary',
      '/analytics/products',
      '/analytics/categories',
      '/analytics/sales-trend?start_date=2026-07-01&end_date=2026-07-02',
    ]);

    for (const endpoint of ['summary', 'products', 'categories', 'sales-trend']) {
      const response = await request(`/api/analytics/${endpoint}?start_date=2026-07-01&end_date=2026-07-02`);
      assert.equal(response.status, 200);
    }
    assert.deepEqual(requestedPaths.slice(4, 8), [
      '/analytics/summary?start_date=2026-07-01&end_date=2026-07-02',
      '/analytics/products?start_date=2026-07-01&end_date=2026-07-02',
      '/analytics/categories?start_date=2026-07-01&end_date=2026-07-02',
      '/analytics/sales-trend?start_date=2026-07-01&end_date=2026-07-02',
    ]);

    const requestCount = requestedPaths.length;
    assert.equal((await request('/api/analytics/sales-trend?start_date=bad&end_date=2026-07-02')).status, 400);
    assert.equal((await request('/api/analytics/sales-trend?start_date=2026-07-03&end_date=2026-07-02')).status, 400);
    assert.equal((await request('/api/analytics/sales-trend?upstream_url=http://evil.test')).status, 400);
    assert.equal((await request('/api/analytics/products?path=analytics%2Fsummary')).status, 400);
    assert.equal((await request('/api/analytics/summary?start_date=2026-07-01&start_date=2026-07-02')).status, 400);
    assert.equal(requestedPaths.length, requestCount);

    mode = 'upstream-error';
    const upstreamError = await request('/api/analytics/summary');
    await assertControlledFailure(upstreamError, 502, 'Layanan analitik tidak tersedia');
    assert.doesNotMatch(JSON.stringify(await (await request('/api/health')).json()), /private|python/i);

    mode = 'upstream-range-error';
    await assertControlledFailure(
      await request('/api/analytics/products?start_date=2026-07-01&end_date=2026-07-02'),
      400,
      'Rentang tanggal tidak valid'
    );

    mode = 'invalid-json';
    await assertControlledFailure(
      await request('/api/analytics/summary'),
      502,
      'Layanan analitik tidak tersedia'
    );

    mode = 'invalid-contract';
    for (const endpoint of ['summary', 'products', 'categories', 'sales-trend']) {
      await assertControlledFailure(
        await request(`/api/analytics/${endpoint}`),
        502,
        'Layanan analitik tidak tersedia'
      );
    }

    mode = 'extra-fields';
    for (const endpoint of ['summary', 'products', 'categories', 'sales-trend']) {
      await assertControlledFailure(
        await request(`/api/analytics/${endpoint}`),
        502,
        'Layanan analitik tidak tersedia'
      );
    }

    mode = 'timeout';
    await assertControlledFailure(
      await request('/api/analytics/sales-trend'),
      504,
      'Layanan analitik tidak merespons tepat waktu'
    );

    mode = 'body-timeout';
    await assertControlledFailure(
      await request('/api/analytics/sales-trend'),
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

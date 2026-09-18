const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createBackendHarness } = require('../helpers/backend-harness');
const { isValidCorrelationId } = require('../../lib/aiContracts');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

test('public route uses the real Node-to-FastAPI HTTP contract and maps canonical sources', async () => {
  let observed;
  const upstream = http.createServer(async (request, response) => {
    observed = {
      method: request.method,
      url: request.url,
      accept: request.headers.accept,
      contentType: request.headers['content-type'],
      body: await readJson(request),
    };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      answer: 'Try Soto Ayam Kampung.',
      language: 'en',
      insufficient_information: false,
      limitations: [],
      sources: [{ source_id: 'menu:1', product_id: 3 }],
    }));
  });
  await listen(upstream);
  const address = upstream.address();
  const harness = await createBackendHarness({
    pythonAiServiceUrl: `http://127.0.0.1:${address.port}`,
  });

  try {
    const result = await fetch(`${harness.baseUrl}/api/ai/menu-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Recommend a soupy dish.', language: 'id' }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      status: 'success',
      answer: 'Try Soto Ayam Kampung.',
      language: 'en',
      insufficientInformation: false,
      limitations: [],
      sources: [{ productId: 3, slug: 'sotoayam', name: 'Soto Ayam Kampung' }],
    });

    assert.equal(observed.method, 'POST');
    assert.equal(observed.url, '/ai/menu-assistant');
    assert.equal(observed.accept, 'application/json');
    assert.equal(observed.contentType, 'application/json');
    assert.equal(observed.body.message, 'Recommend a soupy dish.');
    assert.equal(observed.body.language, 'id');
    assert.equal(isValidCorrelationId(observed.body.correlation_id), true);
    assert.deepEqual(Object.keys(observed.body).sort(), [
      'catalog', 'correlation_id', 'language', 'message',
    ]);
    assert.equal(observed.body.catalog.length, 11);
    assert.deepEqual(observed.body.catalog.map((item) => item.product_id),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(Object.keys(observed.body.catalog[0]), [
      'product_id', 'slug', 'name', 'category', 'price_rupiah',
      'description_id', 'description_en',
    ]);
  } finally {
    await harness.cleanup();
    await close(upstream);
  }
});

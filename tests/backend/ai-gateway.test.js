const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createBackendHarness } = require('../helpers/backend-harness');
const { clearLimitsForTests } = require('../../lib/rateLimiter');
const { isValidCorrelationId } = require('../../lib/aiContracts');

let harness;
let calls;
let implementation;

test.before(async () => {
  harness = await createBackendHarness({
    pythonAiClient: async (request, options) => {
      calls.push({ request, options });
      return implementation ? implementation(request, options) : grounded(request.language);
    },
  });
});

test.beforeEach(() => {
  calls = [];
  implementation = null;
  clearLimitsForTests();
});

test.after(async () => harness?.cleanup());

test('server startup and module import make no FastAPI request', () => {
  assert.deepEqual(calls, []);
});

function grounded(language = 'id', sources = [{ source_id: 'menu:1', product_id: 1 }]) {
  return { answer: language === 'id' ? 'Silakan coba menu ini.' : 'Try this menu.', language,
    insufficient_information: false, limitations: [], sources };
}

function post(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/ai/menu-assistant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('public gateway accepts unauthenticated ID/EN and maps trusted sources', async () => {
  implementation = (request) => grounded(request.language, [
    { source_id: 'menu:1', product_id: 1 }, { source_id: 'menu:2', product_id: 2 },
  ]);
  const { baseUrl } = harness;
    for (const language of ['id', 'en']) {
      const response = await post(baseUrl, { message: '  menu segar  ', language });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['answer', 'insufficientInformation', 'language', 'limitations', 'sources', 'status']);
      assert.equal(body.language, language);
      assert.deepEqual(body.sources.map((source) => Object.keys(source)), [
        ['productId', 'slug', 'name'], ['productId', 'slug', 'name'],
      ]);
    }
    assert.equal(calls[0].request.message, 'menu segar');
    assert.ok(isValidCorrelationId(calls[0].request.correlation_id));
    assert.notEqual(calls[0].request.correlation_id, calls[1].request.correlation_id);
});

test('browser request rejects malformed and authority-injection fields before upstream', async () => {
  const { baseUrl } = harness;
    const invalid = [
      { message: '', language: 'id' }, { message: 'x'.repeat(1001), language: 'id' },
      { message: 'ok', language: 'fr' }, { message: 'ok', language: 'id', correlation_id: crypto.randomUUID() },
      { message: 'ok', language: 'id', catalog: [] }, { message: 'ok', language: 'id', model: 'gemini' },
      { message: 'ok', language: 'id', tools: [] }, { message: 'ok', language: 'id', session_id: 1 },
    ];
    for (const value of invalid) {
      const response = await post(baseUrl, value);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { status: 'error', code: 'invalid_request' });
    }
    assert.equal(calls.length, 0);
});

test('trusted catalog is exact, ordered, current, read-only, and carries no session state', async () => {
  const { baseUrl, db } = harness;
    db.prepare("UPDATE products SET name = ? WHERE id = 2").run('Current Name');
    const before = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    const response = await post(baseUrl, { message: 'menu', language: 'id' }, {
      Cookie: 'session=private-value', 'X-Test-Admin': 'yes',
    });
    assert.equal(response.status, 200);
    const request = calls[0].request;
    assert.deepEqual(request.catalog.map((item) => item.product_id), [...request.catalog.map((item) => item.product_id)].sort((a, b) => a - b));
    assert.equal(request.catalog.find((item) => item.product_id === 2).name, 'Current Name');
    for (const item of request.catalog) {
      assert.deepEqual(Object.keys(item), ['product_id', 'slug', 'name', 'category', 'price_rupiah', 'description_id', 'description_en']);
    }
    assert.deepEqual(Object.keys(request).sort(), ['catalog', 'correlation_id', 'language', 'message']);
    const forbiddenKeys = new Set(['cookie', 'session', 'account', 'admin', 'cart', 'order', 'password', 'image_src']);
    const inspectKeys = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.equal(forbiddenKeys.has(key.toLowerCase()), false);
        inspectKeys(child);
      }
    };
    inspectKeys(request);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, before);
});

test('insufficiency stays HTTP 200', async () => {
  implementation = (request) => ({ answer: 'Informasi belum cukup.', language: request.language,
    insufficient_information: true, limitations: ['Bahan tidak tercantum.'], sources: [] });
  const { baseUrl } = harness;
    const response = await post(baseUrl, { message: 'bebas alergen?', language: 'id' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).insufficientInformation, true);
});

test('gateway preserves a supported response language independent of interface fallback', async () => {
  implementation = () => grounded('id');
  const response = await post(harness.baseUrl, {
    message: 'Rekomendasikan makanan berkuah.', language: 'en',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).language, 'id');
});

test('gateway fails closed on malformed or fabricated upstream success', async () => {
  const cases = [
    (r) => ({ ...grounded(r.language), extra: true }),
    (r) => ({ ...grounded(r.language), sources: [{ source_id: 'bad', product_id: 1 }] }),
    (r) => grounded(r.language, [{ source_id: 'menu:1', product_id: 999 }]),
    (r) => grounded(r.language, [{ source_id: 'menu:1', product_id: 1 }, { source_id: 'menu:2', product_id: 1 }]),
    (r) => ({ ...grounded(r.language), insufficient_information: true, limitations: [], sources: [] }),
  ];
  for (const value of cases) {
      implementation = value;
      const { baseUrl } = harness;
      const response = await post(baseUrl, { message: 'menu', language: 'id' });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { status: 'error', code: 'invalid_upstream_response' });
  }
});

test('stable sanitized upstream errors are mapped and unrelated routes remain available', async () => {
  const mappings = [
    ['invalid_request', 400], ['ai_runtime_unavailable', 502], ['upstream_timeout', 504],
    ['upstream_unavailable', 502], ['unknown private traceback', 500],
  ];
  for (const [code, status] of mappings) {
        implementation = async () => { const error = new Error('/private/provider/key'); error.code = code; throw error; };
        const { baseUrl } = harness;
        const response = await post(baseUrl, { message: 'menu', language: 'id' });
        assert.equal(response.status, status);
        const text = await response.text();
        assert.doesNotMatch(text, /private|provider|traceback|key/i);
  }
});

test('gateway failure log carries canonical correlation and excludes request or raw error detail', async () => {
  const lines = [];
  const original = console.error;
  console.error = (...values) => lines.push(values.join(' '));
  try {
    implementation = async () => {
      const error = new Error('raw-provider-key-and-stack');
      error.code = 'ai_runtime_unavailable';
      throw error;
    };
    const response = await post(harness.baseUrl, {
      message: 'DO NOT LOG user-secret-prompt', language: 'id',
    });
    assert.equal(response.status, 502);
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[ai_request_failure\] correlation_id=[0-9a-f-]{36} subsystem=node\.gateway category=ai_runtime_unavailable elapsed_ms=\d+$/);
  assert.match(lines[0], new RegExp(calls[0].request.correlation_id));
  assert.doesNotMatch(lines[0], /user-secret|raw-provider|stack|key/i);
});

test('dedicated rate limit returns stable 429 without affecting products', async () => {
  const { baseUrl } = harness;
    for (let index = 0; index < 10; index += 1) assert.equal((await post(baseUrl, { message: 'menu', language: 'id' })).status, 200);
    const limited = await post(baseUrl, { message: 'menu', language: 'id' });
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { status: 'error', code: 'rate_limited' });
    assert.equal(calls.length, 10);
    assert.equal((await fetch(`${baseUrl}/api/products`)).status, 200);
});

test('AI route has isolated 4 KiB payload and malformed JSON mapping', async () => {
  const { baseUrl } = harness;
    for (const body of ['{', JSON.stringify({ message: 'x'.repeat(5000), language: 'id' })]) {
      const response = await post(baseUrl, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { status: 'error', code: 'invalid_request' });
    }
    assert.equal(calls.length, 0);
});

test('pre-parser ingress bucket bounds malformed traffic with coherent retry metadata', async () => {
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await post(harness.baseUrl, '{')).status, 400);
  }
  const limited = await post(harness.baseUrl, '{');
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after'), /^\d+$/);
  assert.deepEqual(await limited.json(), { status: 'error', code: 'rate_limited' });
  assert.equal(calls.length, 0);
  assert.equal((await fetch(`${harness.baseUrl}/api/products`)).status, 200);
});

test('pre-parser ingress bucket also bounds oversized traffic', async () => {
  const oversized = JSON.stringify({ message: 'x'.repeat(5000), language: 'id' });
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await post(harness.baseUrl, oversized)).status, 400);
  }
  const limited = await post(harness.baseUrl, oversized);
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after'), /^\d+$/);
  assert.equal(calls.length, 0);
});

test('client connection disconnect aborts the in-flight upstream signal', async () => {
  let resolveAborted;
  let resolveStarted;
  const aborted = new Promise((resolve) => { resolveAborted = resolve; });
  const started = new Promise((resolve) => { resolveStarted = resolve; });
  implementation = (_request, { signal }) => new Promise((resolve) => {
    resolveStarted();
    signal.addEventListener('abort', () => { resolveAborted(); resolve(grounded()); }, { once: true });
  });
  const url = new URL('/api/ai/menu-assistant', harness.baseUrl);
  const request = http.request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  });
  request.on('error', () => {});
  request.end(JSON.stringify({ message: 'menu', language: 'id' }));
  await started;
  request.destroy();
  await Promise.race([
    aborted,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('disconnect was not propagated')), 1000)),
  ]);
});

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_AI_TIMEOUT_MS, DEFAULT_PYTHON_OPERATION_TIMEOUT_SECONDS, MAX_AI_TIMEOUT_MS,
  MAX_AI_UPSTREAM_BODY_BYTES,
  MIN_TIMEOUT_MARGIN_MS, PythonAiError, aiServiceBaseUrl, aiTimeoutMs,
  pythonOperationTimeoutMs, requestMenuAssistant, validateTimeoutOrdering,
} = require('../../lib/pythonAiClient');

const request = { message: 'menu', language: 'id', correlation_id: '90fd2d75-90e7-4eed-bc0a-0f908c34b1d1', catalog: [] };
const valid = { answer: 'Menu.', language: 'id', insufficient_information: false,
  limitations: [], sources: [{ source_id: 'menu:1', product_id: 1 }] };

test('Node outer deadline keeps a deliberate margin above the complete Python operation', () => {
  assert.equal(DEFAULT_AI_TIMEOUT_MS, 15000);
  assert.equal(DEFAULT_PYTHON_OPERATION_TIMEOUT_SECONDS, 12);
  assert.equal(MIN_TIMEOUT_MARGIN_MS, 1000);
  assert.equal(MAX_AI_TIMEOUT_MS, 65000);
  assert.equal(aiTimeoutMs(undefined), 15000);
  assert.equal(pythonOperationTimeoutMs(undefined), 12000);
  assert.throws(() => aiTimeoutMs('4999'), (error) => error.code === 'upstream_unavailable');
  assert.throws(() => aiTimeoutMs('15000', 14500), (error) => error.code === 'upstream_unavailable');
  assert.equal(validateTimeoutOrdering(15000, 14000), 15000);
  assert.equal(validateTimeoutOrdering(65000, 60000), 65000);
  assert.throws(() => aiServiceBaseUrl('file:///tmp/x'), PythonAiError);
});

test('client posts only JSON request and strictly validates JSON success', async () => {
  let observed;
  const result = await requestMenuAssistant(request, {
    baseUrl: 'http://127.0.0.1:9999/internal/', timeoutMs: 15000,
    fetchImpl: async (url, options) => { observed = { url: String(url), options }; return new Response(JSON.stringify(valid), { status: 200, headers: { 'Content-Type': 'application/json' } }); },
  });
  assert.equal(observed.url, 'http://127.0.0.1:9999/internal/ai/menu-assistant');
  assert.deepEqual(JSON.parse(observed.options.body), request);
  assert.equal(observed.options.headers.Cookie, undefined);
  assert.deepEqual(result, valid);
});

test('client sanitizes status, malformed JSON, non-JSON, and unavailable failures', async () => {
  const cases = [
    [async () => new Response('{}', { status: 400 }), 'invalid_request'],
    [async () => new Response(JSON.stringify({ detail: 'ai_runtime_unavailable' }), { status: 503 }), 'ai_runtime_unavailable'],
    [async () => new Response('{}', { status: 504 }), 'upstream_timeout'],
    [async () => new Response('private failure', { status: 418 }), 'upstream_unavailable'],
    [async () => new Response('{', { status: 200 }), 'invalid_upstream_response'],
    [async () => new Response('<html>private</html>', { status: 200 }), 'invalid_upstream_response'],
    [async () => { throw new Error('connect ECONNREFUSED private'); }, 'upstream_unavailable'],
  ];
  for (const [fetchImpl, code] of cases) {
    await assert.rejects(requestMenuAssistant(request, { baseUrl: 'http://127.0.0.1:9999', timeoutMs: 15000, fetchImpl }),
      (error) => error instanceof PythonAiError && error.code === code && error.message === code);
  }
});

test('client rejects declared and streamed oversized upstream bodies before contract parsing', async () => {
  const oversized = 'x'.repeat(MAX_AI_UPSTREAM_BODY_BYTES + 1);
  const cases = [
    async () => new Response(oversized, { status: 200, headers: { 'Content-Length': String(oversized.length) } }),
    async () => new Response(oversized, { status: 200 }),
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(
      requestMenuAssistant(request, { baseUrl: 'http://127.0.0.1:9999', timeoutMs: 15000, fetchImpl }),
      (error) => error instanceof PythonAiError && error.code === 'invalid_upstream_response'
    );
  }
});

test('client rejects a non-streaming response instead of buffering it without a bound', async () => {
  const response = { ok: true, status: 200, headers: new Headers(), body: null,
    text: async () => JSON.stringify(valid) };
  await assert.rejects(
    requestMenuAssistant(request, { baseUrl: 'http://127.0.0.1:9999', timeoutMs: 15000,
      fetchImpl: async () => response }),
    (error) => error instanceof PythonAiError && error.code === 'invalid_upstream_response'
  );
});

test('caller abort cancels fetch without an unhandled rejection', async () => {
  const controller = new AbortController();
  const pending = requestMenuAssistant(request, {
    baseUrl: 'http://127.0.0.1:9999', timeoutMs: 15000,
    signal: controller.signal,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('private abort')), { once: true })),
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'upstream_unavailable');
});

test('outer deadline aborts fetch and maps to upstream_timeout', async () => {
  let cleared = false;
  await assert.rejects(requestMenuAssistant(request, {
    baseUrl: 'http://127.0.0.1:9999', timeoutMs: 15000,
    setTimeoutImpl: (callback) => { queueMicrotask(callback); return 1; },
    clearTimeoutImpl: () => { cleared = true; },
    fetchImpl: (_url, options) => new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('raw timeout')), { once: true })),
  }), (error) => error.code === 'upstream_timeout');
  assert.equal(cleared, true);
});

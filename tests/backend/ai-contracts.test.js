const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AI_ERROR_HTTP_STATUS,
  AI_TIMEOUT_OWNERSHIP,
  AiContractError,
  aiErrorHttpStatus,
  buildInternalAiRequest,
  createCorrelationId,
  isValidCorrelationId,
  publicAiError,
  toPublicAiResponse,
  validateBrowserAiRequest,
  validateInternalAiResponse,
  validatePublicCatalog,
} = require('../../lib/aiContracts');

function item(overrides = {}) {
  return {
    product_id: 6,
    slug: 'es-jeruk-peras',
    name: 'Es Jeruk Peras',
    category: 'minuman',
    price_rupiah: 8000,
    description_id: 'Jeruk peras asli.',
    description_en: 'Fresh squeezed orange.',
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    answer: 'Es Jeruk Peras tersedia.',
    language: 'id',
    insufficient_information: false,
    limitations: [],
    sources: [{ source_id: 'menu:1', product_id: 6 }],
    ...overrides,
  };
}

test('browser request accepts ID and EN and trims surrounding whitespace', () => {
  assert.deepEqual(validateBrowserAiRequest({ message: '  Ada minuman?  ', language: 'id' }),
    { message: 'Ada minuman?', language: 'id' });
  assert.deepEqual(validateBrowserAiRequest({ message: 'Warm food?', language: 'en' }),
    { message: 'Warm food?', language: 'en' });
});

test('browser request rejects empty, excessive, wrong-language, wrong-type, and extra fields', () => {
  const invalid = [
    { message: '   ', language: 'id' },
    { message: 'x'.repeat(1001), language: 'id' },
    { message: 'menu', language: 'fr' },
    { message: 1, language: 'id' },
    { message: 'menu', language: 'id', model: 'attacker-choice' },
    { message: 'menu', language: 'id', catalog: [] },
  ];
  for (const value of invalid) assert.throws(() => validateBrowserAiRequest(value), AiContractError);
});

test('catalog contract is strict, deterministic, unique, and allowlisted', () => {
  const first = item();
  const second = item({ product_id: 2, slug: 'soto-ayam', name: 'Soto Ayam' });
  assert.deepEqual(validatePublicCatalog([first, second]).map((value) => value.product_id), [2, 6]);
  const invalid = [
    { ...first, private_role: 'admin' },
    (({ name, ...rest }) => rest)(first),
    { ...first, product_id: 0 },
    { ...first, description_id: ' ' },
    { ...first, description_en: 1 },
    { ...first, price_rupiah: -1 },
    { ...first, price_rupiah: 8.5 },
  ];
  for (const value of invalid) assert.throws(() => validatePublicCatalog([value]), AiContractError);
  assert.throws(() => validatePublicCatalog([first, { ...first }]), AiContractError);
});

test('Node owns UUIDv4 correlation IDs and builds exact internal requests', () => {
  const correlationId = createCorrelationId();
  assert.equal(isValidCorrelationId(correlationId), true);
  const built = buildInternalAiRequest({ message: ' Menu? ', language: 'en' }, [item()], correlationId);
  assert.deepEqual(Object.keys(built), ['message', 'language', 'correlation_id', 'catalog']);
  assert.equal(built.message, 'Menu?');
  assert.equal(built.correlation_id, correlationId);
  assert.throws(() => buildInternalAiRequest(
    { message: 'Menu?', language: 'en', correlation_id: correlationId }, [item()], correlationId
  ), AiContractError);
  assert.throws(() => buildInternalAiRequest({ message: 'Menu?', language: 'en' }, [item()], 'user-1'), AiContractError);
});

test('internal response accepts either supported per-message language and enforces grounding semantics', () => {
  assert.deepEqual(validateInternalAiResponse(response(), 'id').sources,
    [{ source_id: 'menu:1', product_id: 6 }]);
  const insufficient = response({
    answer: 'Informasi bahan tidak tersedia.',
    insufficient_information: true,
    limitations: ['Informasi bahan tidak tersedia.'],
    sources: [],
  });
  assert.equal(validateInternalAiResponse(insufficient, 'id').insufficient_information, true);
  const invalid = [
    response({ language: 'fr' }),
    response({ sources: [{ source_id: 'menu:9', product_id: 6 }] }),
    response({ sources: [{ source_id: 'menu:1', product_id: 6 }, { source_id: 'menu:1', product_id: 7 }] }),
    response({ confidence: 0.9 }),
    response({ sources: [] }),
    response({ insufficient_information: true, sources: [], limitations: [] }),
    response({ insufficient_information: true, limitations: ['missing'] }),
    response({ answer: 'x'.repeat(4001) }),
    response({ limitations: ['x'.repeat(257)] }),
    response({ limitations: Array(11).fill('bounded') }),
    response({ sources: Array.from({ length: 6 }, (_, index) => ({ source_id: `menu:${index + 1}`, product_id: index + 1 })) }),
  ];
  for (const value of invalid) assert.throws(
    () => validateInternalAiResponse(value, 'id'),
    (error) => error.code === 'invalid_upstream_response'
  );
  assert.equal(validateInternalAiResponse(response({ language: 'en' }), 'id').language, 'en');
});

test('public response maps only canonical catalog identity and camelCase semantics', () => {
  const result = toPublicAiResponse(response(), [item()], 'id');
  assert.deepEqual(result, {
    status: 'success',
    answer: 'Es Jeruk Peras tersedia.',
    language: 'id',
    insufficientInformation: false,
    limitations: [],
    sources: [{ productId: 6, slug: 'es-jeruk-peras', name: 'Es Jeruk Peras' }],
  });
  assert.equal(JSON.stringify(result).includes('source_id'), false);
  assert.throws(() => toPublicAiResponse(response(), [item({ product_id: 7 })], 'id'),
    (error) => error.code === 'invalid_upstream_response');
});

test('error and timeout contracts are deterministic and never include raw error text', () => {
  assert.deepEqual(AI_ERROR_HTTP_STATUS, {
    invalid_request: 400, rate_limited: 429, upstream_timeout: 504,
    upstream_unavailable: 502, invalid_upstream_response: 502,
    ai_runtime_unavailable: 502, internal_error: 500,
  });
  assert.equal(aiErrorHttpStatus('provider said /private/key'), 500);
  assert.deepEqual(publicAiError('provider said /private/key'), { status: 'error', code: 'internal_error' });
  assert.equal(JSON.stringify(publicAiError('upstream_unavailable')).includes('private'), false);
  assert.equal(AI_TIMEOUT_OWNERSHIP.ordering,
    'python_inner_timeout_must_be_shorter_than_node_outer_deadline');
});

test('contract import does not register an Express route', () => {
  assert.equal(Object.keys(require.cache).some((path) => path.endsWith('/server.js')), false);
});

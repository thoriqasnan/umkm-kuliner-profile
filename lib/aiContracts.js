const { randomUUID } = require('node:crypto');

const MAX_AI_MESSAGE_LENGTH = 1000;
const MAX_AI_ANSWER_LENGTH = 4000;
const MAX_AI_LIMITATION_LENGTH = 256;
const MAX_AI_LIMITATIONS = 10;
const MAX_AI_SOURCES = 5;
const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INTERNAL_SOURCE_PATTERN = /^menu:[1-5]$/;

const AI_ERROR_HTTP_STATUS = Object.freeze({
  invalid_request: 400,
  rate_limited: 429,
  upstream_timeout: 504,
  upstream_unavailable: 502,
  invalid_upstream_response: 502,
  ai_runtime_unavailable: 502,
  internal_error: 500,
});

const AI_TIMEOUT_OWNERSHIP = Object.freeze({
  browser: 'may_abort_or_supersede',
  node: 'owns_outer_service_deadline_and_disconnect_abort',
  python: 'owns_inner_runtime_and_provider_timeouts',
  ordering: 'python_inner_timeout_must_be_shorter_than_node_outer_deadline',
});

class AiContractError extends Error {
  constructor(code = 'invalid_request') {
    super(code);
    this.name = 'AiContractError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  return isPlainObject(value) && Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function nonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function codePointLength(value) {
  return Array.from(value).length;
}

function validateBrowserAiRequest(value) {
  if (!hasExactKeys(value, ['message', 'language'])) throw new AiContractError();
  if (typeof value.message !== 'string') throw new AiContractError();
  const message = value.message.trim();
  if (!message || message.length > MAX_AI_MESSAGE_LENGTH) throw new AiContractError();
  if (value.language !== 'id' && value.language !== 'en') throw new AiContractError();
  return Object.freeze({ message, language: value.language });
}

function validatePublicCatalogItem(value) {
  const keys = [
    'product_id', 'slug', 'name', 'category', 'price_rupiah',
    'description_id', 'description_en',
  ];
  if (!hasExactKeys(value, keys) || !Number.isInteger(value.product_id) || value.product_id <= 0 ||
      !SLUG_PATTERN.test(value.slug) || !nonBlankString(value.name) ||
      !nonBlankString(value.category) || !Number.isInteger(value.price_rupiah) ||
      value.price_rupiah < 0 || !nonBlankString(value.description_id) ||
      !nonBlankString(value.description_en)) {
    throw new AiContractError();
  }
  return Object.freeze({
    product_id: value.product_id,
    slug: value.slug,
    name: value.name.trim(),
    category: value.category.trim(),
    price_rupiah: value.price_rupiah,
    description_id: value.description_id.trim(),
    description_en: value.description_en.trim(),
  });
}

function validatePublicCatalog(value) {
  if (!Array.isArray(value) || value.length === 0) throw new AiContractError();
  const catalog = value.map(validatePublicCatalogItem).sort((a, b) =>
    a.product_id - b.product_id || a.slug.localeCompare(b.slug)
  );
  if (new Set(catalog.map((item) => item.product_id)).size !== catalog.length ||
      new Set(catalog.map((item) => item.slug)).size !== catalog.length) {
    throw new AiContractError();
  }
  return Object.freeze(catalog);
}

function createCorrelationId() {
  return randomUUID();
}

function isValidCorrelationId(value) {
  return typeof value === 'string' && value.length === 36 && CORRELATION_ID_PATTERN.test(value);
}

function buildInternalAiRequest(browserRequest, catalog, correlationId = createCorrelationId()) {
  const request = validateBrowserAiRequest(browserRequest);
  const trustedCatalog = validatePublicCatalog(catalog);
  if (!isValidCorrelationId(correlationId)) throw new AiContractError();
  return Object.freeze({
    message: request.message,
    language: request.language,
    correlation_id: correlationId,
    catalog: trustedCatalog,
  });
}

function validateInternalAiResponse(value) {
  const keys = ['answer', 'language', 'insufficient_information', 'limitations', 'sources'];
  if (!hasExactKeys(value, keys) || !nonBlankString(value.answer) ||
      codePointLength(value.answer.trim()) > MAX_AI_ANSWER_LENGTH ||
      (value.language !== 'id' && value.language !== 'en') ||
      typeof value.insufficient_information !== 'boolean' ||
      !Array.isArray(value.limitations) || value.limitations.length > MAX_AI_LIMITATIONS ||
      value.limitations.some((item) => !nonBlankString(item) || codePointLength(item.trim()) > MAX_AI_LIMITATION_LENGTH) ||
      !Array.isArray(value.sources) || value.sources.length > MAX_AI_SOURCES) {
    throw new AiContractError('invalid_upstream_response');
  }
  const sources = value.sources.map((source) => {
    if (!hasExactKeys(source, ['source_id', 'product_id']) ||
        !INTERNAL_SOURCE_PATTERN.test(source.source_id) ||
        !Number.isInteger(source.product_id) || source.product_id <= 0) {
      throw new AiContractError('invalid_upstream_response');
    }
    return Object.freeze({ source_id: source.source_id, product_id: source.product_id });
  });
  if (new Set(sources.map((source) => source.source_id)).size !== sources.length ||
      new Set(sources.map((source) => source.product_id)).size !== sources.length ||
      (value.insufficient_information && sources.length !== 0) ||
      (value.insufficient_information && value.limitations.length === 0) ||
      (!value.insufficient_information && sources.length === 0)) {
    throw new AiContractError('invalid_upstream_response');
  }
  return Object.freeze({
    answer: value.answer.trim(),
    language: value.language,
    insufficient_information: value.insufficient_information,
    limitations: Object.freeze(value.limitations.map((item) => item.trim())),
    sources: Object.freeze(sources),
  });
}

function toPublicAiResponse(internalResponse, catalog) {
  const result = validateInternalAiResponse(internalResponse);
  const canonicalCatalog = validatePublicCatalog(catalog);
  const byId = new Map(canonicalCatalog.map((item) => [item.product_id, item]));
  const sources = result.sources.map(({ product_id: productId }) => {
    const item = byId.get(productId);
    if (!item) throw new AiContractError('invalid_upstream_response');
    return Object.freeze({ productId, slug: item.slug, name: item.name });
  });
  return Object.freeze({
    status: 'success',
    answer: result.answer,
    language: result.language,
    insufficientInformation: result.insufficient_information,
    limitations: result.limitations,
    sources: Object.freeze(sources),
  });
}

function aiErrorHttpStatus(code) {
  return AI_ERROR_HTTP_STATUS[code] || AI_ERROR_HTTP_STATUS.internal_error;
}

function publicAiError(code) {
  const safeCode = Object.hasOwn(AI_ERROR_HTTP_STATUS, code) ? code : 'internal_error';
  return Object.freeze({ status: 'error', code: safeCode });
}

module.exports = {
  AI_ERROR_HTTP_STATUS,
  AI_TIMEOUT_OWNERSHIP,
  AiContractError,
  MAX_AI_ANSWER_LENGTH,
  MAX_AI_LIMITATION_LENGTH,
  MAX_AI_LIMITATIONS,
  MAX_AI_MESSAGE_LENGTH,
  MAX_AI_SOURCES,
  aiErrorHttpStatus,
  buildInternalAiRequest,
  createCorrelationId,
  isValidCorrelationId,
  publicAiError,
  toPublicAiResponse,
  validateBrowserAiRequest,
  validateInternalAiResponse,
  validatePublicCatalog,
  validatePublicCatalogItem,
};

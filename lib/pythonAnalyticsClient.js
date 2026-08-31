const DEFAULT_PYTHON_SERVICE_URL = 'http://127.0.0.1:8000';
const PYTHON_SERVICE_TIMEOUT_MS = 3000;

class PythonAnalyticsError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PythonAnalyticsError';
    this.code = code;
  }
}

function pythonServiceBaseUrl() {
  const configured = process.env.PYTHON_SERVICE_URL || DEFAULT_PYTHON_SERVICE_URL;
  let url;

  try {
    url = new URL(configured);
  } catch {
    throw new PythonAnalyticsError('PYTHON_SERVICE_UNAVAILABLE');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new PythonAnalyticsError('PYTHON_SERVICE_UNAVAILABLE');
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isSummaryResponse(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object' &&
    hasExactKeys(value, ['average_order_value', 'total_quantity', 'total_revenue', 'unique_orders']) &&
    isNonNegativeNumber(value.total_revenue) &&
    isNonNegativeInteger(value.unique_orders) &&
    isNonNegativeInteger(value.total_quantity) &&
    isNonNegativeNumber(value.average_order_value);
}

function isProductsResponse(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object' &&
    hasExactKeys(value, ['products']) &&
    Array.isArray(value.products) && value.products.every((product) =>
      product !== null && !Array.isArray(product) && typeof product === 'object' &&
      hasExactKeys(product, ['product_name', 'total_quantity', 'total_revenue']) &&
      isNonEmptyString(product.product_name) &&
      isNonNegativeInteger(product.total_quantity) &&
      isNonNegativeNumber(product.total_revenue)
    );
}

function isCategoriesResponse(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object' &&
    hasExactKeys(value, ['categories']) &&
    Array.isArray(value.categories) && value.categories.every((category) =>
      category !== null && !Array.isArray(category) && typeof category === 'object' &&
      hasExactKeys(category, ['category', 'total_revenue']) &&
      isNonEmptyString(category.category) &&
      isNonNegativeNumber(category.total_revenue)
    );
}

async function requestAnalytics(pathname, validate) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PYTHON_SERVICE_TIMEOUT_MS);

  try {
    let response;
    try {
      response = await fetch(new URL(pathname, pythonServiceBaseUrl()), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      throw new PythonAnalyticsError(
        timedOut ? 'PYTHON_SERVICE_TIMEOUT' : 'PYTHON_SERVICE_UNAVAILABLE'
      );
    }

    if (!response.ok) {
      throw new PythonAnalyticsError('PYTHON_SERVICE_UNAVAILABLE');
    }

    let value;
    try {
      value = await response.json();
    } catch {
      throw new PythonAnalyticsError(
        timedOut ? 'PYTHON_SERVICE_TIMEOUT' : 'PYTHON_SERVICE_UNAVAILABLE'
      );
    }

    if (!validate(value)) {
      throw new PythonAnalyticsError('PYTHON_SERVICE_UNAVAILABLE');
    }

    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function getAnalyticsSummary() {
  return requestAnalytics('analytics/summary', isSummaryResponse);
}

function getProductsAnalytics() {
  return requestAnalytics('analytics/products', isProductsResponse);
}

function getCategoriesAnalytics() {
  return requestAnalytics('analytics/categories', isCategoriesResponse);
}

module.exports = {
  DEFAULT_PYTHON_SERVICE_URL,
  PYTHON_SERVICE_TIMEOUT_MS,
  PythonAnalyticsError,
  getAnalyticsSummary,
  getProductsAnalytics,
  getCategoriesAnalytics,
};

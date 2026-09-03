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

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

function isSalesTrendResponse(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object' ||
      !hasExactKeys(value, ['available_period', 'daily_sales', 'end_date', 'high_day', 'low_day', 'start_date', 'summary']) ||
      !isIsoDate(value.start_date) || !isIsoDate(value.end_date) || value.start_date > value.end_date) return false;
  const period = value.available_period;
  if (period === null || Array.isArray(period) || typeof period !== 'object' ||
      !hasExactKeys(period, ['max_available_date', 'min_available_date']) ||
      !isIsoDate(period.min_available_date) || !isIsoDate(period.max_available_date) ||
      period.min_available_date > value.start_date || value.end_date > period.max_available_date) return false;
  const summary = value.summary;
  if (summary === null || Array.isArray(summary) || typeof summary !== 'object' ||
      !hasExactKeys(summary, ['average_order_value', 'total_quantity', 'total_revenue', 'unique_orders']) ||
      !isNonNegativeNumber(summary.total_revenue) || !isNonNegativeInteger(summary.unique_orders) ||
      !isNonNegativeInteger(summary.total_quantity) || !isNonNegativeNumber(summary.average_order_value) ||
      !Array.isArray(value.daily_sales) || value.daily_sales.length > 3660) return false;
  const expectedAov = summary.unique_orders === 0 ? 0 : summary.total_revenue / summary.unique_orders;
  if (Math.abs(summary.average_order_value - expectedAov) > 1e-9) return false;
  let previousDate = '';
  let revenueSum = 0;
  let quantitySum = 0;
  for (const point of value.daily_sales) {
    if (point === null || Array.isArray(point) || typeof point !== 'object' ||
        !hasExactKeys(point, ['date', 'total_quantity', 'total_revenue', 'unique_orders']) ||
        !isIsoDate(point.date) || point.date < value.start_date || point.date > value.end_date ||
        point.date <= previousDate || !isNonNegativeNumber(point.total_revenue) ||
        !isNonNegativeInteger(point.unique_orders) || !isNonNegativeInteger(point.total_quantity)) return false;
    previousDate = point.date;
    revenueSum += point.total_revenue;
    quantitySum += point.total_quantity;
  }
  if (revenueSum !== summary.total_revenue || quantitySum !== summary.total_quantity) return false;
  const isDay = (day) => day !== null && !Array.isArray(day) && typeof day === 'object' &&
    hasExactKeys(day, ['date', 'total_revenue']) && isIsoDate(day.date) && isNonNegativeNumber(day.total_revenue);
  if (value.daily_sales.length === 0) {
    return value.high_day === null && value.low_day === null && summary.total_revenue === 0 && summary.unique_orders === 0 && summary.total_quantity === 0 && summary.average_order_value === 0;
  }
  if (!isDay(value.high_day) || !isDay(value.low_day)) return false;
  const high = value.daily_sales.reduce((best, point) => point.total_revenue > best.total_revenue ? point : best);
  const low = value.daily_sales.reduce((best, point) => point.total_revenue < best.total_revenue ? point : best);
  return value.high_day.date === high.date && value.high_day.total_revenue === high.total_revenue &&
    value.low_day.date === low.date && value.low_day.total_revenue === low.total_revenue;
}

function isNextDayForecastResponse(value) {
  if (value === null || Array.isArray(value) || typeof value !== 'object' ||
      !hasExactKeys(value, ['forecast_date', 'historical_context', 'model', 'predicted_quantity']) ||
      !isIsoDate(value.forecast_date) ||
      !isNonNegativeNumber(value.predicted_quantity)) {
    return false;
  }
  const context = value.historical_context;
  if (context === null || Array.isArray(context) || typeof context !== 'object' ||
      !hasExactKeys(context, ['data_through', 'trailing_28_day_average', 'trailing_7_day_average', 'vs_28_day_average_percent', 'vs_7_day_average_percent']) ||
      !isIsoDate(context.data_through) || !isNonNegativeNumber(context.trailing_7_day_average) ||
      !isNonNegativeNumber(context.trailing_28_day_average) ||
      !(context.vs_7_day_average_percent === null || (typeof context.vs_7_day_average_percent === 'number' && Number.isFinite(context.vs_7_day_average_percent))) ||
      !(context.vs_28_day_average_percent === null || (typeof context.vs_28_day_average_percent === 'number' && Number.isFinite(context.vs_28_day_average_percent))) ||
      (context.vs_7_day_average_percent === null) !== (context.trailing_7_day_average === 0) ||
      (context.vs_28_day_average_percent === null) !== (context.trailing_28_day_average === 0)) return false;
  const cutoff = new Date(`${context.data_through}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  if (cutoff.toISOString().slice(0, 10) !== value.forecast_date) return false;
  const model = value.model;
  return model !== null && !Array.isArray(model) && typeof model === 'object' &&
    hasExactKeys(model, ['artifact_version', 'family', 'forecast_horizon_days']) &&
    model.family === 'hist_gradient_boosting' &&
    model.artifact_version === '1.0' &&
    model.forecast_horizon_days === 1;
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

    if (response.status === 400) {
      throw new PythonAnalyticsError('INVALID_ANALYTICS_RANGE');
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

function analyticsRangePath(pathname, { startDate, endDate } = {}) {
  const query = new URLSearchParams();
  if (startDate !== undefined) query.set('start_date', startDate);
  if (endDate !== undefined) query.set('end_date', endDate);
  return query.size ? `${pathname}?${query.toString()}` : pathname;
}

function getAnalyticsSummary(range) {
  return requestAnalytics(analyticsRangePath('analytics/summary', range), isSummaryResponse);
}

function getProductsAnalytics(range) {
  return requestAnalytics(analyticsRangePath('analytics/products', range), isProductsResponse);
}

function getCategoriesAnalytics(range) {
  return requestAnalytics(analyticsRangePath('analytics/categories', range), isCategoriesResponse);
}

function getSalesTrendAnalytics({ startDate, endDate } = {}) {
  return requestAnalytics(analyticsRangePath('analytics/sales-trend', { startDate, endDate }), isSalesTrendResponse);
}

function getNextDayForecast() {
  return requestAnalytics('analytics/forecast/next-day', isNextDayForecastResponse);
}

module.exports = {
  DEFAULT_PYTHON_SERVICE_URL,
  PYTHON_SERVICE_TIMEOUT_MS,
  PythonAnalyticsError,
  getAnalyticsSummary,
  getProductsAnalytics,
  getCategoriesAnalytics,
  getSalesTrendAnalytics,
  getNextDayForecast,
  isNextDayForecastResponse,
  isSalesTrendResponse,
  analyticsRangePath,
};

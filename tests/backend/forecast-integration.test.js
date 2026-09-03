const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createBackendHarness } = require('../helpers/backend-harness');
const { isNextDayForecastResponse } = require('../../lib/pythonAnalyticsClient');

const FORECAST = {
  forecast_date: '2026-01-01',
  predicted_quantity: 86.47720009609498,
  historical_context: {
    data_through: '2025-12-31',
    trailing_7_day_average: 80.5,
    trailing_28_day_average: 78.25,
    vs_7_day_average_percent: 7.424,
    vs_28_day_average_percent: 10.514,
  },
  model: {
    family: 'hist_gradient_boosting',
    artifact_version: '1.0',
    forecast_horizon_days: 1,
  },
};

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('forecast contract validator rejects every malformed contract class', () => {
  assert.equal(isNextDayForecastResponse(FORECAST), true);
  const invalid = [
    {},
    { ...FORECAST, forecast_date: undefined },
    { ...FORECAST, forecast_date: '2026-1-01' },
    { ...FORECAST, forecast_date: '2026-02-30' },
    { ...FORECAST, predicted_quantity: undefined },
    { ...FORECAST, predicted_quantity: '86.4' },
    { ...FORECAST, predicted_quantity: NaN },
    { ...FORECAST, predicted_quantity: Infinity },
    { ...FORECAST, predicted_quantity: -1 },
    { ...FORECAST, historical_context: undefined },
    { ...FORECAST, historical_context: [] },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, data_through: '2025-02-30' } },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, data_through: '2025-12-30' } },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, trailing_7_day_average: -1 } },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, trailing_28_day_average: Infinity } },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, vs_7_day_average_percent: '7.4' } },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, vs_28_day_average_percent: NaN } },
    { ...FORECAST, historical_context: { ...FORECAST.historical_context, internals: true } },
    { ...FORECAST, model: undefined },
    { ...FORECAST, model: [] },
    { ...FORECAST, model: { ...FORECAST.model, family: '' } },
    { ...FORECAST, model: { ...FORECAST.model, family: 'ridge' } },
    { ...FORECAST, model: { ...FORECAST.model, artifact_version: '' } },
    { ...FORECAST, model: { ...FORECAST.model, artifact_version: '2.0' } },
    { ...FORECAST, model: { ...FORECAST.model, forecast_horizon_days: 2 } },
    { ...FORECAST, debug: '/private/model.joblib' },
    { ...FORECAST, model: { ...FORECAST.model, internals: true } },
  ];
  for (const value of invalid) assert.equal(isNextDayForecastResponse(value), false);
  assert.equal(isNextDayForecastResponse({
    ...FORECAST,
    historical_context: {
      ...FORECAST.historical_context,
      trailing_7_day_average: 0,
      vs_7_day_average_percent: null,
    },
  }), true);
});

test('Node forecast gateway validates upstream, bounds failures, and rejects client overrides', async () => {
  const requests = [];
  let mode = 'success';
  const upstream = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.url === '/analytics/summary' && mode === 'success') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        total_revenue: 745000,
        unique_orders: 20,
        total_quantity: 53,
        average_order_value: 37250,
      }));
    }
    if (mode === 'timeout') return;
    if (mode === 'body-timeout') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      return res.write('{"forecast_date":');
    }
    if (mode === 'error-503' || mode === 'error-500') {
      res.writeHead(mode === 'error-503' ? 503 : 500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: '/private/python/models/secret.joblib' }));
    }
    if (mode === 'invalid-json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{broken');
    }
    const body = mode === 'invalid-contract'
      ? { ...FORECAST, predicted_quantity: '86.4' }
      : FORECAST;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  const upstreamUrl = await listen(upstream);
  const harness = await createBackendHarness({ pythonServiceUrl: upstreamUrl });
  const request = (pathname, options) => fetch(`${harness.baseUrl}${pathname}`, options);
  const assertFailure = async (response, status, message) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.deepEqual(body, { status: 'error', message });
    assert.doesNotMatch(JSON.stringify(body), /private|python|joblib/i);
  };

  try {
    const success = await request('/api/analytics/forecast/next-day');
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), FORECAST);
    assert.equal(typeof FORECAST.predicted_quantity, 'number');
    assert.deepEqual(requests[0], { method: 'GET', url: '/analytics/forecast/next-day' });

    const beforeOverrides = requests.length;
    for (const query of [
      'python_url=http://evil.test',
      'artifact_path=/tmp/evil.joblib',
      'dataset_path=/tmp/evil.csv',
      'model=ridge',
      'path=/analytics/summary',
    ]) {
      const rejected = await request(`/api/analytics/forecast/next-day?${query}`);
      assert.equal(rejected.status, 400);
    }
    assert.equal(requests.length, beforeOverrides);

    for (const errorMode of ['error-503', 'error-500', 'invalid-json', 'invalid-contract']) {
      mode = errorMode;
      await assertFailure(await request('/api/analytics/forecast/next-day'), 502, 'Layanan prediksi tidak tersedia');
    }

    mode = 'timeout';
    await assertFailure(await request('/api/analytics/forecast/next-day'), 504, 'Layanan prediksi tidak merespons tepat waktu');
    mode = 'body-timeout';
    await assertFailure(await request('/api/analytics/forecast/next-day'), 504, 'Layanan prediksi tidak merespons tepat waktu');

    mode = 'success';
    const unauthenticatedForecast = await request('/api/analytics/forecast/next-day');
    const unauthenticatedAnalytics = await request('/api/analytics/summary');
    assert.equal(unauthenticatedForecast.status, 200);
    assert.equal(unauthenticatedAnalytics.status, 200);

    const unavailable = http.createServer();
    const unavailableUrl = await listen(unavailable);
    await close(unavailable);
    process.env.PYTHON_SERVICE_URL = unavailableUrl;
    await assertFailure(await request('/api/analytics/forecast/next-day'), 502, 'Layanan prediksi tidak tersedia');
  } finally {
    process.env.PYTHON_SERVICE_URL = upstreamUrl;
    await harness.cleanup();
    await close(upstream);
  }
});

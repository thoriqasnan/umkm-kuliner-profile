const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createBackendHarness } = require('../helpers/backend-harness');
const { isModelComparisonResponse } = require('../../lib/pythonAnalyticsClient');

const COMPARISON = {
  evaluation: {
    start_date: '2026-06-01',
    end_date: '2026-09-01',
    dataset_identity: 'sari_rasa_ml_synthetic_transactions_v2',
    metric_unit: 'next_day_total_quantity',
  },
  models: [
    { name: 'Phase 5 HistGradientBoosting', type: 'hist_gradient_boosting', role: 'production', mae: 135.5097, rmse: 177.6172 },
    { name: 'Phase 6 MLP', type: 'mlp_10_16_1_relu', role: 'experimental', mae: 147.2643, rmse: 193.5776 },
    { name: 'Previous-week baseline', type: 'previous_week', role: 'benchmark', mae: 178.3333, rmse: 228.5035 },
  ],
  experimental_inference: {
    forecast_date: '2026-09-02',
    predicted_quantity: 2460.5,
    data_through: '2026-09-01',
    model_family: 'experimental_mlp',
    artifact_version: '1.0',
    role: 'experimental',
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

test('model comparison validator enforces roles, metrics, and experimental inference', () => {
  assert.equal(isModelComparisonResponse(COMPARISON), true);
  const invalid = [
    {},
    { ...COMPARISON, models: COMPARISON.models.slice(0, 2) },
    { ...COMPARISON, models: COMPARISON.models.map((model, index) => index === 1 ? { ...model, role: 'production' } : model) },
    { ...COMPARISON, models: COMPARISON.models.map((model, index) => index === 0 ? { ...model, mae: -1 } : model) },
    { ...COMPARISON, evaluation: { ...COMPARISON.evaluation, start_date: '2026-99-01' } },
    { ...COMPARISON, experimental_inference: { ...COMPARISON.experimental_inference, model_family: 'hist_gradient_boosting' } },
    { ...COMPARISON, experimental_inference: { ...COMPARISON.experimental_inference, forecast_date: '2026-09-03' } },
    { ...COMPARISON, internal_path: '/private/model.pt' },
  ];
  for (const value of invalid) assert.equal(isModelComparisonResponse(value), false);
});

test('Node model comparison proxy validates upstream and bounds failures', async () => {
  const requests = [];
  let mode = 'success';
  const upstream = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (mode === 'timeout') return;
    if (mode === 'error') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: '/private/python/models/secret.pt' }));
    }
    const body = mode === 'invalid'
      ? { ...COMPARISON, models: COMPARISON.models.map((model, index) => index === 1 ? { ...model, role: 'production' } : model) }
      : COMPARISON;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  const upstreamUrl = await listen(upstream);
  const harness = await createBackendHarness({ pythonServiceUrl: upstreamUrl });
  const request = (pathname) => fetch(`${harness.baseUrl}${pathname}`);
  const assertFailure = async (response, status, message) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.deepEqual(body, { status: 'error', message });
    assert.doesNotMatch(JSON.stringify(body), /private|python|\.pt/i);
  };

  try {
    const success = await request('/api/analytics/forecast/model-comparison');
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), COMPARISON);
    assert.deepEqual(requests[0], { method: 'GET', url: '/analytics/forecast/model-comparison' });

    const beforeQuery = requests.length;
    const rejected = await request('/api/analytics/forecast/model-comparison?artifact_path=/tmp/evil.pt');
    assert.equal(rejected.status, 400);
    assert.equal(requests.length, beforeQuery);

    mode = 'error';
    await assertFailure(await request('/api/analytics/forecast/model-comparison'), 502, 'Layanan perbandingan model tidak tersedia');
    mode = 'invalid';
    await assertFailure(await request('/api/analytics/forecast/model-comparison'), 502, 'Layanan perbandingan model tidak tersedia');
    mode = 'timeout';
    await assertFailure(await request('/api/analytics/forecast/model-comparison'), 504, 'Layanan perbandingan model tidak merespons tepat waktu');
  } finally {
    await harness.cleanup();
    await close(upstream);
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createFrontendHarness, response } = require('../helpers/frontend-vm-harness');

const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const COMPARISON = {
  evaluation: { start_date: '2026-06-01', end_date: '2026-09-01', dataset_identity: 'sari_rasa_ml_synthetic_transactions_v2', metric_unit: 'next_day_total_quantity' },
  models: [
    { name: 'Phase 5 HistGradientBoosting', type: 'hist_gradient_boosting', role: 'production', mae: 135.5097, rmse: 177.6172 },
    { name: 'Phase 6 MLP', type: 'mlp_10_16_1_relu', role: 'experimental', mae: 147.2643, rmse: 193.5776 },
    { name: 'Previous-week baseline', type: 'previous_week', role: 'benchmark', mae: 178.3333, rmse: 228.5035 },
  ],
  experimental_inference: { forecast_date: '2026-09-02', predicted_quantity: 2198.4, data_through: '2026-09-01', model_family: 'experimental_mlp', artifact_version: '1.0', role: 'experimental' },
};

test('comparison renders three roles, metrics, conclusion, period, and secondary inference', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN);
  harness.addRoute('/api/analytics/forecast/model-comparison', async () => response(200, COMPARISON));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;

  assert.equal(el.adminModelComparisonContent.hidden, false);
  assert.equal(el.adminModelHgbRole.textContent, 'PRODUCTION');
  assert.equal(el.adminModelMlpRole.textContent, 'EXPERIMENTAL');
  assert.equal(el.adminModelBaselineRole.textContent, 'BENCHMARK');
  assert.equal(el.adminModelHgbMae.textContent, '135,51 unit');
  assert.equal(el.adminModelHgbRmse.textContent, '177,62 unit');
  assert.equal(el.adminModelMlpMae.textContent, '147,26 unit');
  assert.equal(el.adminModelMlpRmse.textContent, '193,58 unit');
  assert.equal(el.adminModelBaselineMae.textContent, '178,33 unit');
  assert.equal(el.adminModelBaselineRmse.textContent, '228,50 unit');
  assert.match(el.adminModelMlpDifference.textContent, /\+8,67% MAE vs HGB/);
  assert.match(el.adminModelConclusion.textContent, /HGB.*production/);
  assert.match(el.adminModelTestPeriod.textContent, /1 Jun 2026.*1 Sep 2026/);
  assert.match(el.adminModelInference.textContent, /2\.198 unit.*2 Sep 2026/);

  harness.probe.applyLanguage('en'); harness.probe.renderModelComparison(COMPARISON);
  assert.equal(el.adminModelHgbMae.textContent, '135.51 units');
  assert.equal(el.adminModelMlpDifference.textContent, '+8.67% MAE vs HGB');
  assert.equal(el.adminModelConclusion.textContent, 'HGB achieved the lowest test error and remains the production forecasting model.');
});

test('comparison loading, invalid response, service error, and retry are isolated', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  assert.equal(harness.probe.elements.adminModelComparisonStatus.hidden, false);
  let calls = 0;
  harness.addRoute('/api/analytics/forecast/model-comparison', async () => {
    calls += 1;
    if (calls === 1) return response(200, { ...COMPARISON, models: COMPARISON.models.slice(0, 2) });
    if (calls === 2) return response(502, {});
    return response(200, COMPARISON);
  });
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  assert.equal(harness.probe.elements.adminModelComparisonError.hidden, false);
  assert.equal(harness.probe.state().analytics.modelComparisonStatus, 'error');
  await harness.probe.elements.adminModelComparisonRetry.dispatch('click'); await harness.settle(20);
  assert.equal(harness.probe.elements.adminModelComparisonError.hidden, false);
  await harness.probe.elements.adminModelComparisonRetry.dispatch('click'); await harness.settle(20);
  assert.equal(harness.probe.elements.adminModelComparisonContent.hidden, false);
  assert.equal(calls, 3);
});

test('comparison is independent of date filtering and existing forecast DOM remains intact', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  let calls = 0;
  harness.addRoute('/api/analytics/forecast/model-comparison', async () => { calls += 1; return response(200, COMPARISON); });
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(10);
  assert.equal(calls, 1);

  const html = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
  const forecastStart = html.indexOf('<section class="admin-analytics-panel admin-forecast"');
  const comparisonStart = html.indexOf('<section class="admin-analytics-panel admin-model-comparison"');
  const productStart = html.indexOf('<div class="admin-analytics-panels">');
  assert.ok(forecastStart >= 0 && forecastStart < comparisonStart && comparisonStart < productStart);
  assert.match(html, /id="adminForecastQuantity"/);
  assert.match(html, /class="admin-model-comparison-grid"/);
  assert.match(html, /<section[^>]*admin-model-comparison[^>]*aria-labelledby="adminModelComparisonTitle"/);
  assert.match(html, /<details[^>]*class="admin-model-about"[^>]*>\s*<summary[^>]*data-i18n="admin\.modelAbout"/);
  assert.equal((html.slice(comparisonStart, productStart).match(/<article class="admin-model-card/g) || []).length, 3);
  assert.doesNotMatch(html.slice(comparisonStart, productStart), /<table/i);
  const style = fs.readFileSync(path.resolve(__dirname, '..', '..', 'style.css'), 'utf8');
  assert.match(style, /\.admin-model-comparison-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*\.admin-model-comparison-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

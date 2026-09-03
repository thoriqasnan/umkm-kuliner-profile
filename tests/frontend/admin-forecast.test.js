const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness, response } = require('../helpers/frontend-vm-harness');

const ADMIN = { id: 1, email: 'admin@example.test', role: 'admin' };
const FORECAST = { forecast_date: '2026-09-02', predicted_quantity: 2217.219, historical_context: { data_through: '2026-09-01', trailing_7_day_average: 2100.4, trailing_28_day_average: 2250.2, vs_7_day_average_percent: 5.56, vs_28_day_average_percent: -1.47 }, model: { family: 'hist_gradient_boosting', artifact_version: '1.0', forecast_horizon_days: 1 } };
const TREND = { available_period: { min_available_date: '2026-07-01', max_available_date: '2026-07-02' }, start_date: '2026-07-01', end_date: '2026-07-02', summary: { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }, daily_sales: [], high_day: null, low_day: null };

test('forecast renders localized quantity, historical context, provenance, and comparison wording', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  harness.addRoute('/api/analytics/forecast/next-day', async () => response(200, FORECAST));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(10);
  const el = harness.probe.elements;
  assert.equal(el.adminForecastContent.hidden, false);
  assert.equal(el.adminForecastQuantity.textContent, '≈ 2.217 unit');
  assert.equal(el.adminForecast7Average.textContent, 'Rata-rata 2.100,4 unit');
  assert.match(el.adminForecast7Comparison.textContent, /5,6% di atas rata-rata/);
  assert.match(el.adminForecast28Comparison.textContent, /1,5% di bawah rata-rata/);
  assert.match(el.adminForecastDataThrough.textContent, /1 Sep 2026/);
  harness.probe.applyLanguage('en'); harness.probe.renderForecast(FORECAST); await harness.settle();
  assert.equal(el.adminForecastQuantity.textContent, '≈ 2,217 units');
  assert.match(el.adminForecast7Comparison.textContent, /5.6% above average/);
});

test('near-zero and null comparisons use explicit neutral wording', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  harness.probe.renderForecast({ ...FORECAST, historical_context: { ...FORECAST.historical_context, vs_7_day_average_percent: 0.04, trailing_28_day_average: 0, vs_28_day_average_percent: null } });
  assert.equal(harness.probe.elements.adminForecast7Comparison.textContent, 'Mendekati rata-rata');
  assert.equal(harness.probe.elements.adminForecast28Comparison.textContent, 'Perbandingan tidak tersedia');
});

test('forecast error is isolated and retry requests only forecast', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  let calls = 0;
  harness.addRoute('/api/analytics/forecast/next-day', async () => { calls += 1; return calls === 1 ? response(502, {}) : response(200, FORECAST); });
  harness.probe.ensureAnalyticsLoaded(); await harness.settle();
  assert.equal(harness.probe.elements.adminForecastError.hidden, false);
  assert.equal(harness.probe.elements.adminForecastRetry.tagName, 'BUTTON');
  await harness.probe.elements.adminForecastRetry.dispatch('click'); await harness.settle(10);
  assert.equal(calls, 2);
  assert.equal(harness.probe.elements.adminForecastContent.hidden, false);
});

test('successful forecast is reused and stale response after identity change is discarded', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  let calls = 0;
  harness.addRoute('/api/analytics/forecast/next-day', async () => { calls += 1; return response(200, FORECAST); });
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(); harness.probe.ensureAnalyticsLoaded(); await harness.settle();
  assert.equal(calls, 1, 'successful forecast is cached for the auth lifecycle');
  harness.probe.setUser({ id: 2, email: 'other@example.test', role: 'admin' });
  harness.probe.ensureAnalyticsLoaded(); await harness.settle();
  assert.equal(calls, 2, 'a different effective admin gets a fresh forecast lifecycle');

  const staleHarness = await createFrontendHarness({ products: [] }); staleHarness.probe.setUser(ADMIN);
  const pending = staleHarness.deferred();
  staleHarness.addRoute('/api/analytics/forecast/next-day', async () => pending.promise);
  staleHarness.probe.ensureAnalyticsLoaded(); staleHarness.probe.setUser(null);
  pending.resolve(response(200, { ...FORECAST, predicted_quantity: 9999 }));
  await staleHarness.settle(10);
  assert.equal(staleHarness.probe.elements.adminForecastContent.hidden, true);
});

test('global date Apply does not refetch or reload a successful forecast', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN);
  let forecastCalls = 0;
  harness.addRoute('/api/analytics/forecast/next-day', async () => { forecastCalls += 1; return response(200, FORECAST); });
  harness.addRoute((url) => url.includes('/api/analytics/sales-trend'), async () => response(200, TREND));
  harness.addRoute((url) => url.includes('/api/analytics/summary'), async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute((url) => url.includes('/api/analytics/products'), async () => response(200, { products: [] }));
  harness.addRoute((url) => url.includes('/api/analytics/categories'), async () => response(200, { categories: [] }));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(10);
  harness.probe.elements.adminSalesTrendStart.value = '2026-07-01';
  harness.probe.elements.adminSalesTrendEnd.value = '2026-07-02';
  await harness.probe.elements.adminSalesTrendForm.dispatch('submit'); await harness.settle(10);
  assert.equal(forecastCalls, 1);
  assert.equal(harness.probe.elements.adminForecastContent.hidden, false);
});

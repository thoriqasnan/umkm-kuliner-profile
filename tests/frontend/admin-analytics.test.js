const assert = require('node:assert/strict');
const test = require('node:test');
const { createFrontendHarness, response } = require('../helpers/frontend-vm-harness');

const ADMIN_USER = { id: 1, email: 'admin@example.test', role: 'admin' };
const TREND = { available_period: { min_available_date: '2026-07-01', max_available_date: '2026-07-15' }, start_date: '2026-07-01', end_date: '2026-07-02', summary: { total_revenue: 105000, unique_orders: 3, total_quantity: 8, average_order_value: 35000 }, daily_sales: [{ date: '2026-07-01', total_revenue: 68000, unique_orders: 2, total_quantity: 5 }, { date: '2026-07-02', total_revenue: 37000, unique_orders: 1, total_quantity: 3 }], high_day: { date: '2026-07-01', total_revenue: 68000 }, low_day: { date: '2026-07-02', total_revenue: 37000 } };
const FORECAST = { forecast_date: '2026-09-02', predicted_quantity: 2217.219, historical_context: { data_through: '2026-09-01', trailing_7_day_average: 2100.4, trailing_28_day_average: 2250.2, vs_7_day_average_percent: 5.56, vs_28_day_average_percent: -1.47 }, model: { family: 'hist_gradient_boosting', artifact_version: '1.0', forecast_horizon_days: 1 } };
const MODEL_COMPARISON = { evaluation: { start_date: '2026-06-01', end_date: '2026-09-01', dataset_identity: 'sari_rasa_ml_synthetic_transactions_v2', metric_unit: 'next_day_total_quantity' }, models: [{ name: 'Phase 5 HistGradientBoosting', type: 'hist_gradient_boosting', role: 'production', mae: 135.5097, rmse: 177.6172 }, { name: 'Phase 6 MLP', type: 'mlp_10_16_1_relu', role: 'experimental', mae: 147.2643, rmse: 193.5776 }, { name: 'Previous-week baseline', type: 'previous_week', role: 'benchmark', mae: 178.3333, rmse: 228.5035 }], experimental_inference: { forecast_date: '2026-09-02', predicted_quantity: 2198.4, data_through: '2026-09-01', model_family: 'experimental_mlp', artifact_version: '1.0', role: 'experimental' } };

test('opening Analytics as admin fetches six Node analytics routes, never FastAPI', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  const seenUrls = [];
  harness.addRoute('/api/analytics/summary', async (url) => {
    seenUrls.push(url);
    return response(200, { total_revenue: 745000, unique_orders: 20, total_quantity: 53, average_order_value: 37250 });
  });
  harness.addRoute('/api/analytics/products', async (url) => {
    seenUrls.push(url);
    return response(200, { products: [{ product_name: 'Es Teh', total_quantity: 9, total_revenue: 45000 }] });
  });
  harness.addRoute('/api/analytics/categories', async (url) => {
    seenUrls.push(url);
    return response(200, { categories: [{ category: 'Minuman', total_revenue: 45000 }] });
  });
  harness.addRoute('/api/analytics/sales-trend', async (url) => { seenUrls.push(url); return response(200, TREND); });
  harness.addRoute('/api/analytics/forecast/next-day', async (url) => { seenUrls.push(url); return response(200, FORECAST); });
  harness.addRoute('/api/analytics/forecast/model-comparison', async (url) => { seenUrls.push(url); return response(200, MODEL_COMPARISON); });

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  assert.equal(seenUrls.length, 6);
  for (const url of seenUrls) {
    assert.ok(url.startsWith('http://localhost:3000/api/analytics/'), `unexpected analytics URL: ${url}`);
    assert.doesNotMatch(url, /8000/);
    assert.doesNotMatch(url, /fastapi/i);
  }

  const fields = harness.probe.elements;
  assert.equal(fields.adminAnalyticsRevenue.textContent, 'Rp 745.000');
  assert.equal(fields.adminAnalyticsOrders.textContent, '20');
  assert.equal(fields.adminAnalyticsQuantity.textContent, '53');
  assert.equal(fields.adminAnalyticsAOV.textContent, 'Rp 37.250');
  assert.equal(fields.adminAnalyticsStatus.classList.contains('hide'), true);

  assert.equal(fields.adminAnalyticsProductBody.children.length, 1);
  const [nameCell, qtyCell, revenueCell] = fields.adminAnalyticsProductBody.children[0].children;
  assert.equal(nameCell.textContent, 'Es Teh');
  assert.equal(qtyCell.textContent, '9');
  assert.equal(revenueCell.textContent, 'Rp 45.000');

  const categoryList = fields.adminAnalyticsCategoryChart.children[0];
  assert.equal(categoryList.tagName, 'UL');
  const [categoryMeta] = categoryList.children[0].children;
  const [categoryName, categoryValue] = categoryMeta.children;
  assert.equal(categoryName.textContent, 'Minuman');
  assert.equal(categoryValue.textContent, 'Rp 45.000');
  assert.equal(fields.adminSalesTrendRevenue.textContent, 'Rp 105.000');
  assert.equal(fields.adminSalesTrendChart.children[0].tagName, 'SVG');
  assert.equal(fields.adminSalesTrendTableBody.children.length, 2);
});

test('one applied range updates KPI, Trend, Products, and Category bars with identical queries', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  let trendCalls = 0;
  harness.addRoute((url) => url.includes('/api/analytics/sales-trend'), async (url) => {
    trendCalls += 1;
    return response(200, url.includes('start_date=2026-07-02') ? { ...TREND, start_date: '2026-07-02', end_date: '2026-07-02', summary: { total_revenue: 37000, unique_orders: 1, total_quantity: 3, average_order_value: 37000 }, daily_sales: [TREND.daily_sales[1]], high_day: { date: '2026-07-02', total_revenue: 37000 }, low_day: { date: '2026-07-02', total_revenue: 37000 } } : TREND);
  });
  harness.addRoute((url) => url.includes('/api/analytics/summary'), async (url) => response(200, url.includes('start_date=2026-07-02') ? { total_revenue: 37000, unique_orders: 1, total_quantity: 3, average_order_value: 37000 } : { total_revenue: 745000, unique_orders: 20, total_quantity: 53, average_order_value: 37250 }));
  harness.addRoute((url) => url.includes('/api/analytics/products'), async (url) => response(200, { products: url.includes('start_date=2026-07-02') ? [{ product_name: 'Es Teh', total_quantity: 3, total_revenue: 15000 }] : [] }));
  harness.addRoute((url) => url.includes('/api/analytics/categories'), async (url) => response(200, { categories: url.includes('start_date=2026-07-02') ? [{ category: 'Minuman', total_revenue: 15000 }] : [{ category: 'Camilan', total_revenue: 120000 }, { category: 'Makanan', total_revenue: 504000 }] }));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const beforeApplyCalls = harness.calls.length;
  harness.probe.elements.adminSalesTrendStart.value = '2026-07-02'; harness.probe.elements.adminSalesTrendEnd.value = '2026-07-02';
  await harness.probe.elements.adminSalesTrendForm.dispatch('submit'); await harness.settle(20);
  assert.equal(harness.probe.elements.adminSalesTrendRevenue.textContent, 'Rp 37.000');
  const singleDayPath = harness.probe.elements.adminSalesTrendChart.children[0].children.find((child) => child.classList.contains('admin-sales-chart-line'));
  assert.match(singleDayPath.getAttribute('d'), /\bL\b/, 'single-day trend renders a visible marker-free segment');
  assert.equal(harness.probe.elements.adminAnalyticsRevenue.textContent, 'Rp 37.000');
  assert.equal(harness.probe.elements.adminAnalyticsProductBody.children[0].children[0].textContent, 'Es Teh');
  const categoryList = harness.probe.elements.adminAnalyticsCategoryChart.children[0];
  assert.equal(categoryList.children[0].children[0].children[0].textContent, 'Minuman');
  assert.equal(categoryList.children[0].children[1].children[0].style.width, '100%');
  const appliedUrls = harness.calls.slice(beforeApplyCalls).map((call) => call.url);
  assert.equal(appliedUrls.filter((url) => url.includes('start_date=2026-07-02&end_date=2026-07-02')).length, 4);
  await harness.probe.elements.adminSalesTrendForm.dispatch('submit'); await harness.settle(10);
  assert.equal(trendCalls, 2, 'initial plus selected range; repeated range uses cache');
});

test('trend failure and invalid range remain isolated from a successful category visualization', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [{ category: 'Minuman', total_revenue: 121000 }] }));
  harness.addRoute('/api/analytics/sales-trend', async () => response(502, {}));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  assert.match(harness.probe.elements.adminSalesTrendStatus.className, /error/);
  assert.equal(harness.probe.elements.adminAnalyticsCategoryChart.children[0].children[0].children[0].children[0].textContent, 'Minuman');
  const count = harness.calls.length;
  harness.probe.elements.adminSalesTrendStart.value = '2026-07-03'; harness.probe.elements.adminSalesTrendEnd.value = '2026-07-02';
  await harness.probe.elements.adminSalesTrendForm.dispatch('submit');
  assert.equal(harness.calls.length, count);
});

test('in-bound empty trend renders zero metrics without a fake line and exposes daily details accessibly', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, { available_period: { min_available_date: '2026-08-01', max_available_date: '2026-08-02' }, start_date: '2026-08-01', end_date: '2026-08-02', summary: { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }, daily_sales: [], high_day: null, low_day: null }));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  assert.equal(harness.probe.elements.adminSalesTrendRevenue.textContent, 'Rp 0');
  assert.equal(harness.probe.elements.adminSalesTrendChart.children.length, 0);
  assert.equal(harness.probe.elements.adminSalesTrendTableBody.children.length, 0);
  assert.match(harness.probe.elements.adminSalesTrendStatus.className, /empty/);
});

test('late trend response after logout is discarded', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  const pending = harness.deferred();
  harness.addRoute('/api/analytics/sales-trend', async () => pending.promise);
  harness.probe.ensureAnalyticsLoaded();
  harness.probe.setUser(null);
  pending.resolve(response(200, TREND)); await harness.settle(20);
  assert.equal(harness.probe.elements.adminSalesTrendRevenue.textContent, '—');
  assert.equal(harness.probe.elements.adminSalesTrendChart.children.length, 0);
});

test('category failure does not break Sales Trend, and point detail works with focus and blur', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, TREND));
  harness.addRoute('/api/analytics/categories', async () => response(502, {}));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  assert.equal(harness.probe.elements.adminSalesTrendRevenue.textContent, 'Rp 105.000');
  assert.match(harness.probe.elements.adminAnalyticsCategoriesStatus.className, /error/);
  const svg = harness.probe.elements.adminSalesTrendChart.children[0];
  const overlay = svg.children.find((child) => child.classList.contains('admin-sales-chart-hit-area'));
  assert.equal(svg.children.filter((child) => child.tagName === 'CIRCLE').length, 1, 'only the hidden active marker exists');
  assert.equal(overlay.getAttribute('tabindex'), '0');
  await overlay.dispatch('focus');
  assert.match(harness.probe.elements.adminSalesTrendTooltip.textContent, /Rp 68\.000/);
  assert.equal(harness.probe.elements.adminSalesTrendTooltip.classList.contains('hide'), false);
  await overlay.dispatch('blur');
  assert.equal(harness.probe.elements.adminSalesTrendTooltip.classList.contains('hide'), true);
});

test('a failed replacement range clears prior metrics and chart instead of mislabeling stale data', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute((url) => url.includes('/api/analytics/sales-trend'), async (url) => url.includes('start_date=2026-07-03') ? response(502, {}) : response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  assert.equal(harness.probe.elements.adminSalesTrendRevenue.textContent, 'Rp 105.000');
  harness.probe.elements.adminSalesTrendStart.value = '2026-07-03'; harness.probe.elements.adminSalesTrendEnd.value = '2026-07-04';
  await harness.probe.elements.adminSalesTrendForm.dispatch('submit'); await harness.settle(20);
  assert.equal(harness.probe.elements.adminSalesTrendRevenue.textContent, '—');
  assert.equal(harness.probe.elements.adminSalesTrendChart.children.length, 0);
  assert.match(harness.probe.elements.adminSalesTrendStatus.className, /error/);
});

test('bounded custom calendar opens, jumps directly by year/month, changes draft only, and enforces dataset limits', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  const boundedTrend = { ...TREND, available_period: { min_available_date: '2024-03-15', max_available_date: '2026-08-31' } };
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, boundedTrend));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  assert.match(el.adminAnalyticsAvailablePeriod.textContent, /2024/);
  await el.startCalendarTrigger.dispatch('click');
  assert.equal(el.startCalendarPopover.hidden, false);
  assert.deepEqual(el.startCalendarYear.children.map((option) => option.value), ['2024', '2025', '2026']);
  el.startCalendarYear.value = '2024'; await el.startCalendarYear.dispatch('change');
  el.startCalendarMonth.value = '2'; await el.startCalendarMonth.dispatch('change');
  assert.equal(el.startCalendarPrev.disabled, true);
  const beforeMinimum = el.startCalendarGrid.children.find((day) => day.dataset.date === '2024-03-14');
  const boundary = el.startCalendarGrid.children.find((day) => day.dataset.date === '2024-03-15');
  assert.equal(beforeMinimum.disabled, true); assert.equal(boundary.disabled, false);
  const appliedBefore = harness.probe.state().analytics.appliedStart;
  await boundary.dispatch('click');
  assert.equal(el.adminSalesTrendStart.value, '2024-03-15');
  assert.equal(harness.probe.state().analytics.appliedStart, appliedBefore, 'calendar selection changes draft only');
  el.adminSalesTrendStart.value = '2024-03-14';
  const requestCount = harness.calls.length; await el.adminSalesTrendForm.dispatch('submit');
  assert.equal(harness.calls.length, requestCount, 'programmatic out-of-bound draft is rejected');
  el.startCalendarYear.value = '2026'; await el.startCalendarYear.dispatch('change');
  el.startCalendarMonth.value = '7'; await el.startCalendarMonth.dispatch('change');
  assert.equal(el.startCalendarNext.disabled, true);
  await harness.document.querySelectorAll('.lang-btn').find((button) => button.dataset.lang === 'en').dispatch('click');
  assert.match(el.adminAnalyticsAvailablePeriod.textContent, /Data available/);
});

test('marker-free chart follows nearest pointer point and clamps tooltip inside chart', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const svg = harness.probe.elements.adminSalesTrendChart.children[0];
  const circles = svg.children.filter((child) => child.tagName === 'CIRCLE');
  assert.equal(circles.length, 1); assert.equal(circles[0].getAttribute('hidden'), '');
  const overlay = svg.children.find((child) => child.classList.contains('admin-sales-chart-hit-area'));
  await overlay.dispatch('pointermove', { clientX: 795 });
  assert.equal(circles[0].getAttribute('hidden'), null);
  assert.match(harness.probe.elements.adminSalesTrendTooltip.textContent, /Rp 37\.000/);
  assert.ok(Number.parseFloat(harness.probe.elements.adminSalesTrendTooltip.style.left) <= 602);
  assert.equal(harness.probe.elements.adminSalesTrendChart.classList.contains('is-entering'), true);
});

test('range replacement resets an active marker until a valid new-range point is selected', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  const replacement = { ...TREND, start_date: '2026-07-02', end_date: '2026-07-02', summary: { total_revenue: 37000, unique_orders: 1, total_quantity: 3, average_order_value: 37000 }, daily_sales: [TREND.daily_sales[1]], high_day: { date: '2026-07-02', total_revenue: 37000 }, low_day: { date: '2026-07-02', total_revenue: 37000 } };
  harness.addRoute((url) => url.includes('/api/analytics/sales-trend'), async (url) => response(200, url.includes('start_date=') ? replacement : TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  let svg = harness.probe.elements.adminSalesTrendChart.children[0];
  let marker = svg.children.find((child) => child.tagName === 'CIRCLE');
  let overlay = svg.children.find((child) => child.classList.contains('admin-sales-chart-hit-area'));
  await overlay.dispatch('pointermove', { clientX: 795 });
  assert.equal(marker.classList.contains('is-hidden'), false);
  assert.notEqual(marker.getAttribute('cx'), null);

  harness.probe.elements.adminSalesTrendStart.value = '2026-07-02';
  harness.probe.elements.adminSalesTrendEnd.value = '2026-07-02';
  await harness.probe.elements.adminSalesTrendForm.dispatch('submit'); await harness.settle(20);
  svg = harness.probe.elements.adminSalesTrendChart.children[0];
  marker = svg.children.find((child) => child.tagName === 'CIRCLE');
  overlay = svg.children.find((child) => child.classList.contains('admin-sales-chart-hit-area'));
  assert.equal(marker.classList.contains('is-hidden'), true);
  assert.equal(marker.getAttribute('hidden'), '');
  assert.equal(marker.getAttribute('cx'), null, 'inactive replacement marker has no stale/origin coordinate');
  assert.equal(marker.getAttribute('cy'), null, 'inactive replacement marker has no stale/origin coordinate');
  assert.equal(harness.probe.elements.adminSalesTrendTooltip.classList.contains('hide'), true);
  assert.equal(harness.probe.elements.adminSalesTrendTooltip.textContent, '');

  await overlay.dispatch('pointermove', { clientX: 400 });
  assert.equal(marker.classList.contains('is-hidden'), false);
  assert.ok(Number(marker.getAttribute('cx')) > 0);
  assert.ok(Number(marker.getAttribute('cy')) > 0);
});

test('calendar uses viewport-safe placement, internal scrolling, and recalculates on resize', async () => {
  const harness = await createFrontendHarness({ products: [], viewportWidth: 375, viewportHeight: 420 }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 330, bottom: 370, width: 335, height: 40 };
  el.startCalendarPopover.rect = { left: 0, right: 320, top: 0, bottom: 360, width: 320, height: 360 };
  el.startCalendarPopover.scrollHeight = 360;
  await el.startCalendarTrigger.dispatch('click');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), true);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) >= 12);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.left) >= 12);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.maxHeight) <= 310);

  harness.context.window.innerHeight = 800;
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 100, bottom: 140, width: 335, height: 40 };
  await harness.context.window.dispatch('resize');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), false);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) >= 148);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.left) + 320 <= 375 - 12);
});

test('calendar placement treats the visible fixed cart bar as unusable space below', async () => {
  const harness = await createFrontendHarness({ products: [], viewportWidth: 375, viewportHeight: 812 }); harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  const cartBar = harness.document.getElementById('cartBar');
  el.startCalendarPopover.rect = { left: 0, right: 320, top: 0, bottom: 360, width: 320, height: 360 };
  el.startCalendarPopover.scrollHeight = 360;
  cartBar.rect = { left: 0, right: 375, top: 662, bottom: 812, width: 375, height: 150 };

  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 380, bottom: 420, width: 335, height: 40 };
  await el.startCalendarTrigger.dispatch('click');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), true, 'intermediate trigger flips above instead of entering cart-obscured space');
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) + Number.parseFloat(el.startCalendarPopover.style.maxHeight) <= 380 - 8);

  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 270, bottom: 310, width: 335, height: 40 };
  await harness.context.window.dispatch('resize');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), false, 'larger usable side wins when neither side fits');
  assert.equal(Number.parseFloat(el.startCalendarPopover.style.maxHeight), 332);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) + Number.parseFloat(el.startCalendarPopover.style.maxHeight) <= 650);

  cartBar.rect = { left: 0, right: 375, top: 812, bottom: 812, width: 375, height: 0 };
  harness.context.window.innerHeight = 900;
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 100, bottom: 140, width: 335, height: 40 };
  await harness.context.window.dispatch('resize');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), false, 'without an obstruction a fully fitting picker opens below');
});

test('constrained above placement clamps to the visual viewport top and remains inside its usable bottom', async () => {
  const harness = await createFrontendHarness({
    products: [], viewportWidth: 375, viewportHeight: 812,
    visualViewport: { offsetLeft: 0, offsetTop: 50, width: 375, height: 400 },
  });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  const cartBar = harness.document.getElementById('cartBar');
  cartBar.rect = { left: 0, right: 375, top: 360, bottom: 450, width: 375, height: 90 };
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 240, bottom: 280, width: 335, height: 40 };
  el.startCalendarPopover.rect = { left: 0, right: 320, top: 0, bottom: 360, width: 320, height: 360 };
  el.startCalendarPopover.scrollHeight = 360;

  await el.startCalendarTrigger.dispatch('click');
  const top = Number.parseFloat(el.startCalendarPopover.style.top);
  const maxHeight = Number.parseFloat(el.startCalendarPopover.style.maxHeight);
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), true);
  assert.equal(top, 62, 'visual viewport offset plus safe margin clamps the top');
  assert.equal(maxHeight, 170, 'above placement is constrained to actual usable space');
  assert.ok(top + maxHeight <= 348, 'outer border-box remains above the cart obstruction');

  harness.context.window.visualViewport.offsetTop = 0;
  harness.context.window.visualViewport.height = 700;
  cartBar.rect = { left: 0, right: 375, top: 600, bottom: 700, width: 375, height: 100 };
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 100, bottom: 140, width: 335, height: 40 };
  await harness.context.window.visualViewport.dispatch('resize');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), false);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) >= 12);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) + Number.parseFloat(el.startCalendarPopover.style.maxHeight) <= 588);
});

test('sticky application header and cart bar define the usable calendar region', async () => {
  const harness = await createFrontendHarness({
    products: [], viewportWidth: 375, viewportHeight: 812,
    visualViewport: { offsetLeft: 0, offsetTop: 50, width: 375, height: 400 },
  });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/sales-trend', async () => response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  const navbar = harness.document.getElementById('navbar');
  const cartBar = harness.document.getElementById('cartBar');
  navbar.className = 'navbar';
  navbar.rect = { left: 0, right: 375, top: 50, bottom: 122, width: 375, height: 72 };
  cartBar.rect = { left: 0, right: 375, top: 360, bottom: 450, width: 375, height: 90 };
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 240, bottom: 280, width: 335, height: 40 };
  el.startCalendarPopover.rect = { left: 0, right: 320, top: 0, bottom: 360, width: 320, height: 360 };
  el.startCalendarPopover.scrollHeight = 360;

  await el.startCalendarTrigger.dispatch('click');
  let top = Number.parseFloat(el.startCalendarPopover.style.top);
  let maxHeight = Number.parseFloat(el.startCalendarPopover.style.maxHeight);
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), true);
  assert.equal(top, 130, 'popover starts below the measured sticky navbar plus gap');
  assert.equal(maxHeight, 102, 'constrained above space ends at the trigger gap');
  assert.ok(top >= navbar.rect.bottom + 8);
  assert.ok(top + maxHeight <= cartBar.rect.top - 12);

  harness.context.window.visualViewport.offsetTop = 0;
  harness.context.window.visualViewport.height = 500;
  navbar.rect = { left: 0, right: 375, top: 0, bottom: 90, width: 375, height: 90 };
  cartBar.rect = { left: 0, right: 375, top: 420, bottom: 500, width: 375, height: 80 };
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 260, bottom: 300, width: 335, height: 40 };
  await harness.context.window.visualViewport.dispatch('resize');
  top = Number.parseFloat(el.startCalendarPopover.style.top);
  maxHeight = Number.parseFloat(el.startCalendarPopover.style.maxHeight);
  assert.equal(top, 98, 'short desktop-style geometry recalculates from changed header height');
  assert.ok(top + maxHeight <= 408, 'bottom obstruction remains respected after resize');

  navbar.rect = { left: 0, right: 375, top: 0, bottom: 0, width: 375, height: 0 };
  cartBar.rect = { left: 0, right: 375, top: 500, bottom: 500, width: 375, height: 0 };
  el.startCalendarTrigger.rect = { left: 20, right: 355, top: 60, bottom: 100, width: 335, height: 40 };
  await harness.context.window.visualViewport.dispatch('resize');
  assert.equal(el.startCalendarPopover.classList.contains('opens-above'), false);
  assert.ok(Number.parseFloat(el.startCalendarPopover.style.top) >= 108);
});

test('overlapping global Apply requests cannot let an older range overwrite the newer period', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  const pending = { summary: harness.deferred(), products: harness.deferred(), categories: harness.deferred(), 'sales-trend': harness.deferred() };
  const bodyFor = (endpoint, range) => {
    if (endpoint === 'summary') return range === 'b' ? { total_revenue: 68000, unique_orders: 2, total_quantity: 5, average_order_value: 34000 } : { total_revenue: 1, unique_orders: 1, total_quantity: 1, average_order_value: 1 };
    if (endpoint === 'products') return { products: [{ product_name: range === 'b' ? 'Range B' : 'Range A', total_quantity: 1, total_revenue: range === 'b' ? 68000 : 1 }] };
    if (endpoint === 'categories') return { categories: [{ category: range === 'b' ? 'Range B' : 'Range A', total_revenue: range === 'b' ? 68000 : 1 }] };
    return range === 'b' ? { ...TREND, start_date: '2026-07-01', end_date: '2026-07-01', summary: { total_revenue: 68000, unique_orders: 2, total_quantity: 5, average_order_value: 34000 }, daily_sales: [TREND.daily_sales[0]], high_day: { date: '2026-07-01', total_revenue: 68000 }, low_day: { date: '2026-07-01', total_revenue: 68000 } } : TREND;
  };
  harness.addRoute((url) => url.includes('/api/analytics/'), async (url) => {
    const endpoint = url.match(/analytics\/(summary|products|categories|sales-trend)/)[1];
    if (!url.includes('start_date=')) return response(200, endpoint === 'sales-trend' ? TREND : bodyFor(endpoint, 'b'));
    if (url.includes('start_date=2026-07-03')) return pending[endpoint].promise;
    return response(200, bodyFor(endpoint, 'b'));
  });
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  el.adminSalesTrendStart.value = '2026-07-03'; el.adminSalesTrendEnd.value = '2026-07-04'; await el.adminSalesTrendForm.dispatch('submit');
  el.adminSalesTrendStart.value = '2026-07-01'; el.adminSalesTrendEnd.value = '2026-07-01'; await el.adminSalesTrendForm.dispatch('submit'); await harness.settle(20);
  for (const endpoint of Object.keys(pending)) pending[endpoint].resolve(response(200, bodyFor(endpoint, 'a')));
  await harness.settle(20);
  assert.equal(el.adminAnalyticsRevenue.textContent, 'Rp 68.000');
  assert.equal(el.adminAnalyticsProductBody.children[0].children[0].textContent, 'Range B');
  assert.equal(el.adminAnalyticsCategoryChart.children[0].children[0].children[0].children[0].textContent, 'Range B');
  assert.equal(el.adminSalesTrendRevenue.textContent, 'Rp 68.000');
});

test('an in-flight applied response never overwrites a newer uncommitted calendar draft', async () => {
  const harness = await createFrontendHarness({ products: [] }); harness.probe.setUser(ADMIN_USER);
  const pending = harness.deferred();
  harness.addRoute((url) => url.includes('/api/analytics/sales-trend'), async (url) => url.includes('start_date=2026-07-03') ? pending.promise : response(200, TREND));
  harness.probe.ensureAnalyticsLoaded(); await harness.settle(20);
  const el = harness.probe.elements;
  el.adminSalesTrendStart.value = '2026-07-03'; el.adminSalesTrendEnd.value = '2026-07-04'; await el.adminSalesTrendForm.dispatch('submit');
  el.adminSalesTrendStart.value = '2026-07-05'; el.adminSalesTrendEnd.value = '2026-07-06';
  pending.resolve(response(200, { ...TREND, start_date: '2026-07-03', end_date: '2026-07-04', summary: { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }, daily_sales: [], high_day: null, low_day: null }));
  await harness.settle(20);
  assert.equal(el.adminSalesTrendStart.value, '2026-07-05');
  assert.equal(el.adminSalesTrendEnd.value, '2026-07-06');
});

test('a failed summary request does not prevent products/categories from rendering (partial-failure isolation)', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(502, { status: 'error', message: 'upstream down' }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [{ product_name: 'Nasi Goreng', total_quantity: 6, total_revenue: 108000 }] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [{ category: 'Makanan', total_revenue: 108000 }] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const fields = harness.probe.elements;
  assert.equal(fields.adminAnalyticsRevenue.textContent, '—');
  assert.match(fields.adminAnalyticsStatus.className, /\berror\b/);
  assert.equal(fields.adminAnalyticsStatus.getAttribute('role'), 'alert');
  assert.equal(fields.adminAnalyticsStatus.getAttribute('aria-live'), 'assertive');

  assert.equal(fields.adminAnalyticsProductBody.children.length, 1);
  assert.equal(fields.adminAnalyticsProductsStatus.classList.contains('hide'), true);
  assert.equal(fields.adminAnalyticsCategoryChart.children.length, 1);
  assert.equal(fields.adminAnalyticsCategoriesStatus.classList.contains('hide'), true);
});

test('a failed products request does not prevent summary/categories from rendering', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute('/api/analytics/products', async () => response(504, { status: 'error', message: 'timeout' }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const fields = harness.probe.elements;
  assert.equal(fields.adminAnalyticsRevenue.textContent, 'Rp 0');
  assert.equal(fields.adminAnalyticsStatus.classList.contains('hide'), true);

  assert.match(fields.adminAnalyticsProductsStatus.className, /\berror\b/);
  assert.equal(fields.adminAnalyticsProductBody.children.length, 0);

  assert.equal(fields.adminAnalyticsCategoryChart.children.length, 0);
  assert.match(fields.adminAnalyticsCategoriesStatus.className, /\bempty\b/);
});

test('an empty (but valid) products array renders a distinct empty state, not an error', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const fields = harness.probe.elements;
  assert.equal(fields.adminAnalyticsProductBody.children.length, 0);
  assert.match(fields.adminAnalyticsProductsStatus.className, /\bempty\b/);
  assert.notEqual(fields.adminAnalyticsProductsStatus.getAttribute('role'), 'alert');
  assert.equal(fields.adminAnalyticsProductsStatus.getAttribute('aria-live'), 'polite');

  assert.equal(fields.adminAnalyticsCategoryChart.children.length, 0);
  assert.match(fields.adminAnalyticsCategoriesStatus.className, /\bempty\b/);
});

test('a hidden (successful) status region always carries a polite, non-alert live-region state', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 1000, unique_orders: 1, total_quantity: 1, average_order_value: 1000 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [{ product_name: 'Es Teh', total_quantity: 1, total_revenue: 1000 }] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [{ category: 'Minuman', total_revenue: 1000 }] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  for (const status of [
    harness.probe.elements.adminAnalyticsStatus,
    harness.probe.elements.adminAnalyticsProductsStatus,
    harness.probe.elements.adminAnalyticsCategoriesStatus,
  ]) {
    assert.equal(status.classList.contains('hide'), true);
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
  }
});

test('a malformed analytics response is treated as an error, never rendered as NaN/undefined', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 'lots', unique_orders: 20 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [{ product_name: '', total_quantity: -1, total_revenue: 1 }] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { notCategories: [] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const fields = harness.probe.elements;
  assert.equal(fields.adminAnalyticsRevenue.textContent, '—');
  assert.doesNotMatch(fields.adminAnalyticsRevenue.textContent, /NaN|undefined/);
  assert.match(fields.adminAnalyticsStatus.className, /\berror\b/);

  assert.equal(fields.adminAnalyticsProductBody.children.length, 0);
  assert.match(fields.adminAnalyticsProductsStatus.className, /\berror\b/);

  assert.equal(fields.adminAnalyticsCategoryChart.children.length, 0);
  assert.match(fields.adminAnalyticsCategoriesStatus.className, /\berror\b/);
});

test('a succeeded section is not refetched on renavigate, but a failed section retries', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  let summaryCalls = 0;
  let productsCalls = 0;
  let categoriesCalls = 0;
  harness.addRoute('/api/analytics/summary', async () => {
    summaryCalls += 1;
    return response(200, { total_revenue: 1000, unique_orders: 1, total_quantity: 1, average_order_value: 1000 });
  });
  harness.addRoute('/api/analytics/products', async () => {
    productsCalls += 1;
    return productsCalls === 1 ? response(502, { status: 'error' }) : response(200, { products: [] });
  });
  harness.addRoute('/api/analytics/categories', async () => {
    categoriesCalls += 1;
    return response(200, { categories: [{ category: 'Makanan', total_revenue: 1000 }] });
  });

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);
  assert.equal(summaryCalls, 1);
  assert.equal(productsCalls, 1);
  assert.equal(categoriesCalls, 1);

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);
  assert.equal(summaryCalls, 1, 'summary already succeeded - must not refetch');
  assert.equal(categoriesCalls, 1, 'categories already succeeded - must not refetch');
  assert.equal(productsCalls, 2, 'previously failed products section should retry on next open');
  assert.equal(harness.probe.elements.adminAnalyticsProductsStatus.classList.contains('hide'), false);
  assert.match(harness.probe.elements.adminAnalyticsProductsStatus.className, /\bempty\b/);
});

test('a slow analytics response arriving after logout is discarded, not rendered', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  const pendingSummary = harness.deferred();
  harness.addRoute('/api/analytics/summary', async () => pendingSummary.promise);
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(5);

  harness.probe.setUser(null);
  pendingSummary.resolve(response(200, { total_revenue: 999000, unique_orders: 9, total_quantity: 9, average_order_value: 111000 }));
  await harness.settle(20);

  assert.equal(harness.probe.elements.adminAnalyticsRevenue.textContent, '—');
  assert.equal(harness.probe.elements.adminAnalyticsStatus.classList.contains('hide'), true);
});

test('categories render as accessible proportional bars with correct widths', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [
    { category: 'Makanan', total_revenue: 200000 },
    { category: 'Minuman', total_revenue: 50000 },
  ] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const list = harness.probe.elements.adminAnalyticsCategoryChart.children[0];
  assert.equal(list.tagName, 'UL');
  assert.equal(list.children.length, 2);

  const [firstItem, secondItem] = list.children;
  const [firstMeta, firstTrack] = firstItem.children;
  const [firstName, firstValue] = firstMeta.children;
  assert.equal(firstName.textContent, 'Makanan');
  assert.equal(firstValue.textContent, 'Rp 200.000');
  assert.equal(firstTrack.getAttribute('aria-hidden'), 'true');
  const firstFill = firstTrack.children[0];
  assert.equal(firstFill.style.width, '100%');
  assert.equal(firstFill.dataset.barPercent, '100');

  const [secondMeta, secondTrack] = secondItem.children;
  const [secondName, secondValue] = secondMeta.children;
  assert.equal(secondName.textContent, 'Minuman');
  assert.equal(secondValue.textContent, 'Rp 50.000');
  const secondFill = secondTrack.children[0];
  assert.equal(secondFill.style.width, '25%');
  assert.equal(secondFill.dataset.barPercent, '25');
});

test('all-zero category revenue renders bars at 0% without NaN/Infinity', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [
    { category: 'Makanan', total_revenue: 0 },
    { category: 'Minuman', total_revenue: 0 },
  ] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const list = harness.probe.elements.adminAnalyticsCategoryChart.children[0];
  assert.equal(list.children.length, 2);
  for (const item of list.children) {
    const [, track] = item.children;
    const fill = track.children[0];
    assert.equal(fill.style.width, '0%');
    assert.doesNotMatch(fill.style.width, /NaN|Infinity/);
    assert.equal(fill.dataset.barPercent, '0');
  }
});

test('product table preserves API order and formatting after visual polish', async () => {
  const harness = await createFrontendHarness({ products: [] });
  harness.probe.setUser(ADMIN_USER);
  harness.addRoute('/api/analytics/summary', async () => response(200, { total_revenue: 0, unique_orders: 0, total_quantity: 0, average_order_value: 0 }));
  harness.addRoute('/api/analytics/products', async () => response(200, { products: [
    { product_name: 'Nasi Goreng', total_quantity: 12, total_revenue: 240000 },
    { product_name: 'Es Teh', total_quantity: 30, total_revenue: 90000 },
  ] }));
  harness.addRoute('/api/analytics/categories', async () => response(200, { categories: [] }));

  harness.probe.ensureAnalyticsLoaded();
  await harness.settle(20);

  const body = harness.probe.elements.adminAnalyticsProductBody;
  assert.equal(body.children.length, 2);
  const [row1, row2] = body.children;
  assert.equal(row1.children[0].textContent, 'Nasi Goreng');
  assert.equal(row1.children[1].textContent, '12');
  assert.equal(row1.children[2].textContent, 'Rp 240.000');
  assert.equal(row2.children[0].textContent, 'Es Teh');
  assert.equal(row2.children[1].textContent, '30');
  assert.equal(row2.children[2].textContent, 'Rp 90.000');
});

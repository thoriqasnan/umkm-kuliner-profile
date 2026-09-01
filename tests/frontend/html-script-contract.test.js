const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
const style = fs.readFileSync(path.join(projectRoot, 'style.css'), 'utf8');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('actual index.html provides every element required by script.js getElementById calls', () => {
  const requiredIds = [...script.matchAll(/document\.getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  assert.ok(requiredIds.length > 0, 'script.js should expose literal DOM ID dependencies');

  for (const id of new Set(requiredIds)) {
    const occurrences = html.match(new RegExp(`\\bid=["']${escapeRegex(id)}["']`, 'g')) || [];
    assert.equal(occurrences.length, 1, `index.html must contain exactly one #${id} required by script.js`);
  }
});

test('actual HTML provides required singleton/class controls and loads production script.js', () => {
  for (const className of ['navbar-right', 'carousel', 'filter-btn', 'lang-btn']) {
    assert.match(html, new RegExp(`class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["']`));
  }
  assert.match(html, /<script\s+src=["']script\.js["']><\/script>/);
});

test('frontend API paths have corresponding backend routes and stable HTTP methods', () => {
  const server = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const contracts = [
    ['post', '/api/auth/register', '/api/auth/register'],
    ['post', '/api/auth/login', '/api/auth/login'],
    ['get', '/api/auth/me', '/api/auth/me'],
    ['post', '/api/auth/logout', '/api/auth/logout'],
    ['get', '/api/products', '/api/products'],
    ['post', '/api/products', '/api/products'],
    ['put', '/api/products/:id', '/api/products/${editingProductId}'],
    ['delete', '/api/products/:id', '/api/products/${productId}'],
    ['get', '/api/cart', '/api/cart'],
    ['post', '/api/cart/merge', '/api/cart/merge'],
    ['put', '/api/cart/items/:productId', '/api/cart/items/${productId}'],
    ['delete', '/api/cart/items/:productId', '/api/cart/items/${productId}'],
    ['get', '/api/analytics/sales-trend', '/api/analytics/sales-trend'],
  ];

  for (const [method, backendPath, frontendPath] of contracts) {
    assert.match(server, new RegExp(`app\\.${method}\\(["']${escapeRegex(backendPath)}["']`));
    assert.ok(script.includes(frontendPath), `script.js must call ${frontendPath}`);
  }

  assert.match(script, /credentials:\s*["']include["']/);
  assert.match(script, /method:\s*["']PUT["']/);
  assert.match(script, /method:\s*["']DELETE["']/);
  assert.match(script, /method:\s*["']POST["']/);
});

test('Sales Trend is additive, accessible, responsive, localized, and keeps one category panel', () => {
  assert.match(html, /<section[^>]*class=["'][^"']*admin-sales-trend[^"']*["'][^>]*aria-labelledby=["']adminSalesTrendTitle["']/);
  assert.match(html, /class="analytics-date-trigger" id="adminSalesTrendStartTrigger"[^>]*aria-expanded="false"/);
  assert.match(html, /class="analytics-date-trigger" id="adminSalesTrendEndTrigger"[^>]*aria-expanded="false"/);
  assert.match(html, /id="adminSalesTrendStartMonth"[\s\S]*id="adminSalesTrendStartYear"[\s\S]*id="adminSalesTrendStartGrid" role="grid"/);
  assert.match(html, /id="adminAnalyticsAvailablePeriod"/);
  assert.match(html, /id="adminSalesTrendTable"/);
  assert.equal((html.match(/data-i18n="admin\.analyticsCategoryTitle"/g) || []).length, 1);
  assert.match(style, /\.admin-sales-chart svg[\s\S]*width:\s*100%/);
  assert.match(style, /@media \(max-width:\s*768px\)[\s\S]*\.admin-sales-trend-form/);
  assert.match(style, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*admin-sales-chart/);
  assert.match(script, /"admin\.salesTrendTitle": "Tren Penjualan"/);
  assert.match(script, /"admin\.salesTrendTitle": "Sales Trend"/);
  assert.doesNotMatch(`${html}\n${script}`, /Data will populate once API integration ships|Data akan tersedia setelah integrasi API/);
  assert.doesNotMatch(`${html}\n${script}`, /\+12\.7%|Recharts|shadcn|tailwind/i);
  assert.doesNotMatch(`${html}\n${script}`, /2026-07-01|2026-07-15/);
});

test('adminAnalytics section exposes a semantic product performance table and an Analitik nav link', () => {
  assert.match(html, /<section[^>]*\bid=["']adminAnalytics["'][^>]*>/);
  assert.match(
    html,
    /<table[^>]*class=["'][^"']*\badmin-analytics-table\b[^"']*["'][^>]*>[\s\S]*?<caption[\s\S]*?<\/caption>[\s\S]*?<thead>[\s\S]*?<\/thead>[\s\S]*?<tbody[^>]*\bid=["']adminAnalyticsProductBody["'][^>]*>[\s\S]*?<\/tbody>[\s\S]*?<\/table>/
  );
  assert.match(
    html,
    /<a[^>]*class=["']admin-nav-link["'][^>]*data-admin-destination=["']analytics["'][^>]*data-i18n=["']admin\.analyticsNav["']/
  );
});

test('adminAnalytics has no direct FastAPI reference in the frontend', () => {
  assert.doesNotMatch(script, /8000/);
  assert.doesNotMatch(script, /fastapi/i);
});

test('the scrollable product-table wrapper is keyboard-focusable and accessibly named (Phase 4G-4)', () => {
  assert.match(html, /<h4[^>]*\bid=["']adminAnalyticsProductPerfHeading["'][^>]*>/);
  assert.match(
    html,
    /<div[^>]*class=["']admin-analytics-table-wrap["'][^>]*\btabindex=["']0["'][^>]*\brole=["']region["'][^>]*\baria-labelledby=["']adminAnalyticsProductPerfHeading["'][^>]*>/
  );
  assert.match(style, /\.admin-analytics-table-wrap:focus-visible/);
});

test('the three analytics status regions no longer hardcode a static aria-live in markup (JS sets it per state)', () => {
  for (const id of ['adminAnalyticsStatus', 'adminAnalyticsProductsStatus', 'adminAnalyticsCategoriesStatus']) {
    const tagMatch = html.match(new RegExp(`<p[^>]*\\bid=["']${id}["'][^>]*>`));
    assert.ok(tagMatch, `expected a <p id="${id}"> element`);
    assert.doesNotMatch(tagMatch[0], /aria-live=/, `${id} should not hardcode aria-live in HTML`);
  }
  assert.match(script, /el\.setAttribute\("aria-live", isError \? "assertive" : "polite"\)/);
});

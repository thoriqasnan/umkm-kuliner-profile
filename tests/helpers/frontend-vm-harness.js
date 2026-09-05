const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'script.js');
const FIXED_UUID = '40000000-0000-4000-8000-000000000001';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); this.sync(); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); this.sync(); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    this.sync();
    return enabled;
  }
  replaceFrom(value) { this.values = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
  sync() { this.element._className = Array.from(this.values).join(' '); }
}

class FakeElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.selected = false;
    this.offsetWidth = 190;
    this.offsetHeight = 64;
    this.scrollHeight = 64;
    this.rect = null;
    this.isConnected = true;
    this._className = '';
    this._innerHTML = '';
  }
  set className(value) { this._className = String(value); this.classList.replaceFrom(value); }
  get className() { return this._className; }
  set innerHTML(value) { this._innerHTML = String(value); this.children.forEach((child) => { child.parentNode = null; child.isConnected = false; }); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  get firstChild() { return this.children[0] || null; }
  get hash() { return this.attributes.get('href') || ''; }
  set href(value) { this.attributes.set('href', String(value)); }
  get href() { return this.attributes.get('href') || ''; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { node.parentNode = this; node.isConnected = true; this.children.push(node); return node; }
  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
    node.parentNode = this;
    node.isConnected = true;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
    this.isConnected = false;
  }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'id') this.id = text;
    if (name === 'class') this.className = text;
    if (name.startsWith('data-')) this.dataset[dataName(name)] = text;
  }
  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name.startsWith('data-')) return this.dataset[dataName(name)] === undefined ? null : String(this.dataset[dataName(name)]);
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[dataName(name)]; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async dispatch(type, values = {}) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, ...values };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    return event;
  }
  querySelectorAll(selector) { return queryTree(this.children, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  reset() { this.value = ''; }
  getBoundingClientRect() { return this.rect || { left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300 }; }
}

function dataName(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function queryTree(roots, selector) {
  const all = [];
  const visit = (node) => { all.push(node); node.children.forEach(visit); };
  roots.forEach(visit);
  return selector.split(',').flatMap((part) => all.filter((element) => matchesSelector(element, part.trim()))).filter((element, index, array) => array.indexOf(element) === index);
}

function matchesSelector(element, selector) {
  const pieces = selector.split(/\s+/);
  const last = pieces.pop();
  if (!matchesSimple(element, last)) return false;
  let ancestor = element.parentNode;
  while (pieces.length) {
    const wanted = pieces.pop();
    while (ancestor && !matchesSimple(ancestor, wanted)) ancestor = ancestor.parentNode;
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

function matchesSimple(element, selector) {
  const tag = selector.match(/^[a-z]+/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  for (const className of selector.match(/\.([\w-]+)/g) || []) if (!element.classList.contains(className.slice(1))) return false;
  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;
  for (const match of selector.matchAll(/\[([^\]=*]+)(\*=|=)?["']?([^\]"']*)["']?\]/g)) {
    const [, name, operator, expected] = match;
    const actual = element.getAttribute(name);
    if (!operator && actual === null) return false;
    if (operator === '=' && actual !== expected) return false;
    if (operator === '*=' && !String(actual || '').includes(expected)) return false;
  }
  return true;
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement('html', this);
    this.documentElement.lang = 'id';
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
    this.activeElement = null;
    this.listeners = new Map();
    this.byId = new Map();
  }
  createElement(tag) { return new FakeElement(tag, this); }
  createElementNS(namespace, tag) { return new FakeElement(tag, this); }
  getElementById(id) {
    if (!this.byId.has(id)) {
      const element = new FakeElement(elementTag(id), this);
      element.id = id;
      element.setAttribute('id', id);
      this.byId.set(id, element);
      this.body.appendChild(element);
    }
    return this.byId.get(id);
  }
  querySelectorAll(selector) { return queryTree([this.documentElement], selector); }
  querySelector(selector) {
    if (selector === '.navbar-right' || selector === '.carousel') {
      const key = selector.slice(1);
      let found = this.querySelectorAll(selector)[0] || null;
      if (!found) { found = this.createElement('div'); found.className = key; this.body.appendChild(found); }
      return found;
    }
    return this.querySelectorAll(selector)[0] || null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async dispatch(type, values = {}) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, ...values };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    return event;
  }
}

function elementTag(id) {
  if (/Dialog|Panel/.test(id)) return 'dialog';
  if (/Form$/.test(id)) return 'form';
  if (/Input$/.test(id)) return 'input';
  if (/Btn$|Button|Trigger$|Prev$|Next$|Retry$/.test(id)) return 'button';
  if (/Month$|Year$/.test(id)) return 'select';
  if (/List|Grid|Track|Dots/.test(id)) return 'ul';
  return 'div';
}

function createStorage(initial = {}, failWrites = false) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (failWrites) throw new Error('Storage unavailable'); values.set(String(key), String(value)); },
    removeItem(key) { if (failWrites) throw new Error('Storage unavailable'); values.delete(key); },
    clear() { if (failWrites) throw new Error('Storage unavailable'); values.clear(); },
    dump() { return Object.fromEntries(values); },
    setFailure(value) { failWrites = value; },
  };
}

function createTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(callback, delay = 0) { const id = nextId++; tasks.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = Array.from(tasks.entries()).filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        tasks.delete(due[0]); now = due[1].at; due[1].callback();
      }
      now = target;
    },
    pending: () => tasks.size,
  };
}

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function createFrontendHarness(options = {}) {
  const document = new FakeDocument();
  for (const category of ['semua', 'makanan', 'minuman', 'snack']) {
    const button = document.createElement('button');
    button.className = 'filter-btn';
    button.setAttribute('data-filter', category);
    document.body.appendChild(button);
  }
  for (const language of ['id', 'en']) {
    const button = document.createElement('button');
    button.className = 'lang-btn';
    button.dataset.lang = language;
    document.body.appendChild(button);
  }
  const storage = createStorage(options.storage, options.failStorageWrites);
  const timers = createTimers();
  const calls = [];
  const routes = [];
  const opened = [];

  const addRoute = (matcher, handler) => routes.unshift({ matcher, handler });
  const fetch = async (url, request = {}) => {
    const call = { url: String(url), options: { ...request } };
    calls.push(call);
    const route = routes.find(({ matcher }) => typeof matcher === 'string' ? call.url.endsWith(matcher) : matcher(call.url, request, call));
    if (route) return route.handler(call.url, request, call);
    if (call.url.endsWith('/api/products')) return response(200, options.products || []);
    if (call.url.endsWith('/api/auth/me')) return options.authUser
      ? response(200, { status: 'success', user: options.authUser })
      : response(401, { status: 'error' });
    if (call.url.endsWith('/api/cart/merge') && options.mergeResponse) return response(200, options.mergeResponse);
    if (call.url.endsWith('/api/cart')) return response(200, { status: 'success', items: options.authenticatedCart || [] });
    throw new Error(`Unexpected fetch: ${call.url}`);
  };

  const windowListeners = new Map();
  const visualViewportListeners = new Map();
  const visualViewport = options.visualViewport ? {
    ...options.visualViewport,
    addEventListener(type, listener) { if (!visualViewportListeners.has(type)) visualViewportListeners.set(type, []); visualViewportListeners.get(type).push(listener); },
    async dispatch(type) { for (const listener of visualViewportListeners.get(type) || []) await listener({ type }); },
  } : null;
  const window = {
    document,
    innerWidth: options.viewportWidth || 1024,
    innerHeight: options.viewportHeight || 768,
    visualViewport,
    location: { hash: '' },
    matchMedia: () => ({ matches: true }),
    addEventListener(type, listener) { if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(listener); },
    async dispatch(type) { for (const listener of windowListeners.get(type) || []) await listener({ type }); },
    open(...args) { opened.push(args); return null; },
    scrollTo() {},
  };
  const context = {
    window, document, localStorage: storage, fetch,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: () => 1, clearInterval() {},
    queueMicrotask,
    requestAnimationFrame: (callback) => callback(),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    Headers, URL, URLSearchParams, TextEncoder, Uint8Array,
    crypto: { randomUUID: () => FIXED_UUID, getRandomValues: (array) => array.fill(1) },
    console: options.console || { log() {}, error() {}, warn() {} },
    confirm: () => true,
  };
  context.globalThis = context;
  window.window = window;
  Object.assign(window, context);

  const probeSource = `
;globalThis.__frontendProbe = {
  state: () => ({
    authority: cartAuthority, epoch: cartEpoch, userId: authenticatedCartUserId,
    unsynced: cartHasUnsyncedChanges, currentUser: currentUser ? {...currentUser} : null,
    items: serializeCartItems(cartItems), products: Array.from(productsById.values()),
    analytics: analyticsState ? {min:analyticsState.minAvailableDate,max:analyticsState.maxAvailableDate,appliedStart:analyticsState.appliedStartDate,appliedEnd:analyticsState.appliedEndDate,forecastStatus:analyticsState.forecast.status,modelComparisonStatus:analyticsState.modelComparison.status} : null,
    writes: Array.from(cartWriteStates, ([productId, value]) => ({productId, version:value.version, persistedVersion:value.persistedVersion, running:value.running, failed:value.failed, hasTimer:!!value.timer}))
  }),
  setProducts(products) { productsById = new Map(products.map(product => [product.id, product])); productsLoadState = products.length ? 'success' : 'empty'; updateCartSummary(); },
  setUser(user) { currentUser = user; renderAuthUI(); },
  setAuthority: setCartAuthority, replaceItems: replaceCartItems, activateGuestCart,
  activateAuthenticatedCart, checkAuthState, changeCartQuantity, buildOrderMessage,
  renderCartPanel, scheduleAuthenticatedCartWrite, flushAuthenticatedCartWrite,
  drainAuthenticatedCartWritesForLogout, handleLogout, applyLanguage, loadMenu,
  setAuthMode, openProductDialog, handleDeleteProduct,
  readGuestCartSnapshot, readPendingCartMerge, writePendingCartMerge,
  ensureAnalyticsLoaded, loadSalesTrend, fetchSalesTrend, validateSalesTrend, renderSalesTrend, loadForecast, fetchForecast, renderForecast, formatForecastComparison, loadModelComparison, fetchModelComparison, renderModelComparison, isModelComparisonResponse, renderCalendar, positionCalendar,
  elements: {cartCheckoutBtn, cartCountEl, cartTotalEl, cartStatus, cartPanel, cartPanelList, authForm, authEmailInput, authPasswordInput, authLoginBtn, authAccount, adminMenuActions, adminDashboardEntry, authStatus,
    productDialog, productForm, productSlugInput, productNameInput, productDescriptionIdInput, productDescriptionEnInput, productPriceInput, productCategoryInput, productImageSrcInput, productImageAltInput, productImageWidthInput, productImageHeightInput, productImageSrcsetInput, productImageSizesInput, productSubmitBtn, menuStatus,
    adminAnalyticsRevenue: adminAnalyticsRevenueEl, adminAnalyticsOrders: adminAnalyticsOrdersEl, adminAnalyticsQuantity: adminAnalyticsQuantityEl, adminAnalyticsAOV: adminAnalyticsAOVEl,
    adminAnalyticsProductBody: adminAnalyticsProductBodyEl, adminAnalyticsCategoryChart: adminAnalyticsCategoryChartEl,
    adminAnalyticsStatus: adminAnalyticsStatusEl, adminAnalyticsProductsStatus: adminAnalyticsProductsStatusEl, adminAnalyticsCategoriesStatus: adminAnalyticsCategoriesStatusEl,
    adminSalesTrendForm: adminSalesTrendFormEl, adminSalesTrendStart: adminSalesTrendStartEl, adminSalesTrendEnd: adminSalesTrendEndEl,
    adminSalesTrendStatus: adminSalesTrendStatusEl, adminSalesTrendRevenue: adminSalesTrendRevenueEl,
    adminSalesTrendChart: adminSalesTrendChartEl, adminSalesTrendTooltip: adminSalesTrendTooltipEl, adminSalesTrendTableBody: adminSalesTrendTableBodyEl,
    adminAnalyticsAvailablePeriod: adminAnalyticsAvailablePeriodEl, adminAnalyticsAppliedPeriod: adminAnalyticsAppliedPeriodEl,
    adminForecastStatus: adminForecastStatusEl, adminForecastContent: adminForecastContentEl, adminForecastError: adminForecastErrorEl, adminForecastRetry: adminForecastRetryEl,
    adminForecastQuantity: adminForecastQuantityEl, adminForecastDate: adminForecastDateEl, adminForecast7Average: adminForecast7AverageEl, adminForecast28Average: adminForecast28AverageEl,
    adminForecast7Comparison: adminForecast7ComparisonEl, adminForecast28Comparison: adminForecast28ComparisonEl, adminForecastDataThrough: adminForecastDataThroughEl, adminForecastDateContext: adminForecastDateContextEl,
    adminModelComparisonStatus: adminModelComparisonStatusEl, adminModelComparisonContent: adminModelComparisonContentEl, adminModelComparisonError: adminModelComparisonErrorEl, adminModelComparisonRetry: adminModelComparisonRetryEl,
    adminModelHgbMae: adminModelHgbMaeEl, adminModelHgbRmse: adminModelHgbRmseEl, adminModelMlpMae: adminModelMlpMaeEl, adminModelMlpRmse: adminModelMlpRmseEl,
    adminModelBaselineMae: adminModelBaselineMaeEl, adminModelBaselineRmse: adminModelBaselineRmseEl, adminModelMlpDifference: adminModelMlpDifferenceEl, adminModelTestPeriod: adminModelTestPeriodEl, adminModelInference: adminModelInferenceEl,
    adminModelHgbRole: adminModelHgbRoleEl, adminModelMlpRole: adminModelMlpRoleEl, adminModelBaselineRole: adminModelBaselineRoleEl, adminModelConclusion: adminModelConclusionEl,
    startCalendarTrigger: startCalendar.trigger, startCalendarPopover: startCalendar.calendar, startCalendarMonth: startCalendar.month, startCalendarYear: startCalendar.year, startCalendarPrev: startCalendar.prev, startCalendarNext: startCalendar.next, startCalendarGrid: startCalendar.grid,
    endCalendarTrigger: endCalendar.trigger, endCalendarPopover: endCalendar.calendar, endCalendarMonth: endCalendar.month, endCalendarYear: endCalendar.year, endCalendarPrev: endCalendar.prev, endCalendarNext: endCalendar.next, endCalendarGrid: endCalendar.grid}
};`;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SCRIPT_PATH, 'utf8') + probeSource, context, { filename: SCRIPT_PATH });
  await settle(30);

  const rawProbe = context.__frontendProbe;
  const probe = { ...rawProbe, state: () => JSON.parse(JSON.stringify(rawProbe.state())) };
  return { context, probe, document, storage, timers, calls, opened, addRoute, response, deferred, settle };
}

async function settle(turns = 8) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

module.exports = { createFrontendHarness, response, deferred, settle, FIXED_UUID };

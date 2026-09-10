const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFrontendHarness, deferred, settle } = require('../helpers/frontend-vm-harness');

const VALID_TOKEN = 'A'.repeat(43);

function recoveryCalls(harness, suffix) {
  return harness.calls.filter((call) => call.url.endsWith(suffix));
}

test('password visibility controls are independent, bilingual, keyboard-operable, and request-free', async () => {
  const harness = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}` });
  const {
    authPasswordInput, authPasswordVisibilityBtn,
    authConfirmPasswordInput, authConfirmPasswordVisibilityBtn,
  } = harness.probe.elements;
  authPasswordInput.value = 'Replacement123!';
  authConfirmPasswordInput.value = 'Replacement123!';
  const callsBefore = harness.calls.length;

  assert.equal(authPasswordInput.getAttribute('type'), 'password');
  assert.equal(authConfirmPasswordInput.getAttribute('type'), 'password');
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  assert.match(html, /<button type="button" id="authPasswordVisibilityBtn"/);
  assert.match(html, /<button type="button" id="authConfirmPasswordVisibilityBtn"/);
  assert.equal(authPasswordVisibilityBtn.tagName, 'BUTTON');
  assert.equal(authConfirmPasswordVisibilityBtn.tagName, 'BUTTON');
  assert.equal(authPasswordVisibilityBtn.getAttribute('role'), null);
  assert.equal(authConfirmPasswordVisibilityBtn.getAttribute('role'), null);
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-haspopup'), null);
  assert.equal(authConfirmPasswordVisibilityBtn.getAttribute('aria-haspopup'), null);
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(authConfirmPasswordVisibilityBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-label'), 'Tampilkan kata sandi');
  assert.equal(authConfirmPasswordVisibilityBtn.getAttribute('aria-label'), 'Tampilkan kata sandi');

  await authPasswordVisibilityBtn.dispatch('click', { detail: 0 });
  assert.equal(authPasswordInput.getAttribute('type'), 'text');
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-label'), 'Sembunyikan kata sandi');
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(authPasswordInput.value, 'Replacement123!');
  assert.equal(authConfirmPasswordInput.getAttribute('type'), 'password');

  await authConfirmPasswordVisibilityBtn.dispatch('click', { detail: 0 });
  assert.equal(authConfirmPasswordInput.getAttribute('type'), 'text');
  assert.equal(authConfirmPasswordInput.value, 'Replacement123!');
  await authPasswordVisibilityBtn.dispatch('click', { detail: 0 });
  assert.equal(authPasswordInput.getAttribute('type'), 'password');
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-label'), 'Tampilkan kata sandi');

  harness.probe.applyLanguage('en');
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-label'), 'Show password');
  assert.equal(authConfirmPasswordVisibilityBtn.getAttribute('aria-label'), 'Hide password');
  assert.equal(harness.calls.length, callsBefore);
});

test('opening login and toggling password leave mobile navigation closed without status side effects', async () => {
  const harness = await createFrontendHarness();
  const navMenu = harness.document.getElementById('navMenu');
  const hamburger = harness.document.getElementById('hamburger');
  const { authDialog, authFormMessage, authPasswordInput, authPasswordVisibilityBtn } = harness.probe.elements;
  navMenu.classList.add('active');
  hamburger.classList.add('active');
  hamburger.setAttribute('aria-expanded', 'true');

  await harness.probe.elements.authLoginBtn.dispatch('click');

  assert.equal(navMenu.classList.contains('active'), false);
  assert.equal(hamburger.classList.contains('active'), false);
  assert.equal(hamburger.getAttribute('aria-expanded'), 'false');
  assert.equal(authDialog.open, true);

  const statusBefore = authFormMessage.textContent;
  await authPasswordVisibilityBtn.dispatch('click');
  await harness.document.dispatch('click', { target: authPasswordVisibilityBtn });

  assert.equal(authPasswordInput.getAttribute('type'), 'text');
  assert.equal(authPasswordVisibilityBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(navMenu.classList.contains('active'), false);
  assert.equal(hamburger.getAttribute('aria-expanded'), 'false');
  assert.equal(authDialog.open, true);
  assert.equal(authFormMessage.textContent, statusBefore);
});

test('login, register, forgot, and reset mode changes restore password visibility to hidden', async () => {
  const harness = await createFrontendHarness();
  const { authPasswordInput, authPasswordVisibilityBtn, authConfirmPasswordInput, authConfirmPasswordVisibilityBtn } = harness.probe.elements;

  for (const mode of ['login', 'register', 'forgot', 'reset', 'login']) {
    await authPasswordVisibilityBtn.dispatch('click');
    await authConfirmPasswordVisibilityBtn.dispatch('click');
    assert.equal(authPasswordInput.getAttribute('type'), 'text');
    assert.equal(authConfirmPasswordInput.getAttribute('type'), 'text');
    harness.probe.setAuthMode(mode);
    assert.equal(authPasswordInput.getAttribute('type'), 'password');
    assert.equal(authConfirmPasswordInput.getAttribute('type'), 'password');
    assert.equal(authPasswordVisibilityBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(authConfirmPasswordVisibilityBtn.getAttribute('aria-pressed'), 'false');
  }
});

test('forgot-password entry is visible from login and renders a bilingual recovery form', async () => {
  const harness = await createFrontendHarness();
  const { authLoginBtn, authForgotPasswordBtn, authEmailInput, authPasswordInput, authSubmitBtn } = harness.probe.elements;
  await authLoginBtn.dispatch('click');
  assert.equal(authForgotPasswordBtn.classList.contains('hide'), false);
  await authForgotPasswordBtn.dispatch('click');
  assert.equal(harness.probe.recovery().mode, 'forgot');
  assert.equal(authEmailInput.disabled, false);
  assert.equal(authPasswordInput.required, false);
  assert.equal(authSubmitBtn.textContent, 'Kirim Instruksi Reset');
  harness.probe.applyLanguage('en');
  harness.probe.setAuthMode('forgot');
  assert.equal(authSubmitBtn.textContent, 'Send Reset Instructions');
});

test('forgot-password validates email, prevents duplicate submission, and keeps success generic', async () => {
  const harness = await createFrontendHarness();
  const { authLoginBtn, authForgotPasswordBtn, authForm, authEmailInput, authSubmitBtn, authFormMessage } = harness.probe.elements;
  await authLoginBtn.dispatch('click');
  await authForgotPasswordBtn.dispatch('click');
  authEmailInput.value = 'not-an-email';
  await authForm.dispatch('submit');
  assert.match(authFormMessage.textContent, /valid/i);
  assert.equal(recoveryCalls(harness, '/api/auth/forgot-password').length, 0);

  const pending = deferred();
  harness.addRoute('/api/auth/forgot-password', () => pending.promise);
  authEmailInput.value = 'unknown@example.test';
  const first = authForm.dispatch('submit');
  await settle();
  assert.equal(authSubmitBtn.disabled, true);
  await authForm.dispatch('submit');
  assert.equal(recoveryCalls(harness, '/api/auth/forgot-password').length, 1);
  pending.resolve(harness.response(202, { status: 'success', message: 'account-neutral' }));
  await first;
  assert.equal(authFormMessage.textContent, 'Jika akun tersedia, instruksi reset password telah dikirim.');
  assert.equal(authSubmitBtn.classList.contains('hide'), true);
  assert.deepEqual(JSON.parse(recoveryCalls(harness, '/api/auth/forgot-password')[0].options.body), { email: 'unknown@example.test' });
});

test('forgot-password maps rate-limit and network failures without losing the email', async () => {
  const limited = await createFrontendHarness();
  limited.addRoute('/api/auth/forgot-password', () => limited.response(429, { code: 'RATE_LIMITED' }));
  await limited.probe.elements.authLoginBtn.dispatch('click');
  await limited.probe.elements.authForgotPasswordBtn.dispatch('click');
  limited.probe.elements.authEmailInput.value = 'person@example.test';
  await limited.probe.elements.authForm.dispatch('submit');
  assert.match(limited.probe.elements.authFormMessage.textContent, /Terlalu banyak/);
  assert.equal(limited.probe.elements.authEmailInput.value, 'person@example.test');

  const offline = await createFrontendHarness();
  offline.addRoute('/api/auth/forgot-password', () => Promise.reject(new Error('offline')));
  await offline.probe.elements.authLoginBtn.dispatch('click');
  await offline.probe.elements.authForgotPasswordBtn.dispatch('click');
  offline.probe.elements.authEmailInput.value = 'person@example.test';
  await offline.probe.elements.authForm.dispatch('submit');
  assert.match(offline.probe.elements.authFormMessage.textContent, /terhubung/);
  assert.equal(offline.probe.elements.authEmailInput.value, 'person@example.test');
});

test('valid reset URL is parsed once, removed from history, and never persisted or rendered', async () => {
  const harness = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}` });
  assert.equal(harness.probe.recovery().mode, 'reset');
  assert.equal(harness.probe.recovery().hasToken, true);
  assert.equal(harness.historyCalls.length, 1);
  assert.equal(harness.historyCalls[0][2], '/');
  assert.equal(JSON.stringify(harness.storage.dump()).includes(VALID_TOKEN), false);
  assert.equal(JSON.stringify(harness.sessionStorage.dump()).includes(VALID_TOKEN), false);
  assert.equal(harness.document.body.textContent.includes(VALID_TOKEN), false);
  assert.equal(harness.probe.elements.authFormMessage.textContent.includes(VALID_TOKEN), false);
});

test('ordinary URL stays in login while missing and malformed reset credentials render the shared invalid state', async () => {
  const missing = await createFrontendHarness();
  assert.equal(missing.probe.recovery().mode, 'login');
  assert.equal(missing.probe.recovery().hasToken, false);

  const empty = await createFrontendHarness({ search: '?reset_token=' });
  assert.equal(empty.probe.recovery().mode, 'reset');
  assert.match(empty.probe.elements.authFormMessage.textContent, /tidak valid/);

  const malformed = await createFrontendHarness({ search: '?reset_token=not-valid' });
  assert.equal(malformed.probe.recovery().mode, 'reset');
  assert.equal(malformed.probe.recovery().hasToken, false);
  assert.match(malformed.probe.elements.authFormMessage.textContent, /tidak valid/);
  assert.equal(malformed.probe.elements.authSubmitBtn.classList.contains('hide'), true);

  const duplicate = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}&reset_token=${'B'.repeat(43)}` });
  assert.equal(duplicate.probe.recovery().hasToken, false);
  assert.match(duplicate.probe.elements.authFormMessage.textContent, /tidak valid/);
});

test('reset validates empty, weak, oversized, and mismatched passwords client-side', async () => {
  const harness = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}` });
  const { authForm, authPasswordInput, authConfirmPasswordInput, authFormMessage } = harness.probe.elements;
  await authForm.dispatch('submit');
  assert.match(authFormMessage.textContent, /Masukkan/);
  authPasswordInput.value = 'short'; authConfirmPasswordInput.value = 'short';
  await authForm.dispatch('submit');
  assert.match(authFormMessage.textContent, /minimal 8/);
  authPasswordInput.value = 'Password123!'; authConfirmPasswordInput.value = 'Password123?';
  await authForm.dispatch('submit');
  assert.match(authFormMessage.textContent, /tidak cocok/);
  assert.equal(recoveryCalls(harness, '/api/auth/reset-password').length, 0);
});

test('valid reset sends only token and password, then opens login with success guidance and creates no session', async () => {
  const harness = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}`, authUser: { id: 7, email: 'old@example.test', role: 'user' } });
  const pending = deferred();
  harness.addRoute('/api/auth/reset-password', () => pending.promise);
  const { authForm, authPasswordInput, authConfirmPasswordInput, authSubmitBtn, authFormMessage } = harness.probe.elements;
  authPasswordInput.value = 'Replacement123!';
  authConfirmPasswordInput.value = 'Replacement123!';
  const first = authForm.dispatch('submit');
  await settle();
  await authForm.dispatch('submit');
  assert.equal(recoveryCalls(harness, '/api/auth/reset-password').length, 1);
  const body = JSON.parse(recoveryCalls(harness, '/api/auth/reset-password')[0].options.body);
  assert.deepEqual(body, { token: VALID_TOKEN, password: 'Replacement123!' });
  assert.equal(Object.hasOwn(body, 'email'), false);
  assert.equal(Object.hasOwn(body, 'userId'), false);
  pending.resolve(harness.response(200, { status: 'success' }));
  await first;
  assert.equal(authPasswordInput.value, '');
  assert.equal(authConfirmPasswordInput.value, '');
  assert.equal(authPasswordInput.getAttribute('type'), 'password');
  assert.equal(authConfirmPasswordInput.getAttribute('type'), 'password');
  assert.equal(harness.probe.recovery().hasToken, false);
  assert.equal(harness.probe.recovery().mode, 'login');
  assert.equal(harness.probe.state().currentUser, null);
  assert.equal(harness.probe.elements.authDialog.open, true);
  assert.equal(authSubmitBtn.classList.contains('hide'), false);
  assert.equal(harness.probe.elements.authEmailInput.disabled, false);
  assert.equal(authPasswordInput.disabled, false);
  assert.match(authFormMessage.textContent, /login kembali/);
  assert.equal(authFormMessage.classList.contains('success'), true);
  assert.equal(harness.document.activeElement, harness.probe.elements.authEmailInput);
  assert.equal(recoveryCalls(harness, '/api/auth/login').length, 0);
});

test('reset safely maps backend rejection, invalid/used/expired token, busy, rate-limit, server, and network errors', async (t) => {
  const cases = [
    [400, { code: 'VALIDATION_ERROR' }, /minimal 8/],
    [400, { code: 'RESET_TOKEN_INVALID' }, /tidak valid/],
    [429, { code: 'RATE_LIMITED' }, /Terlalu banyak/],
    [503, { code: 'DATABASE_BUSY' }, /sibuk/],
    [500, { code: 'INTERNAL_ERROR' }, /tidak dapat diproses/],
  ];
  for (const [status, body, expected] of cases) {
    await t.test(`${status} ${body.code}`, async () => {
      const harness = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}` });
      harness.addRoute('/api/auth/reset-password', () => harness.response(status, body));
      harness.probe.elements.authPasswordInput.value = 'Replacement123!';
      harness.probe.elements.authConfirmPasswordInput.value = 'Replacement123!';
      await harness.probe.elements.authForm.dispatch('submit');
      assert.match(harness.probe.elements.authFormMessage.textContent, expected);
    });
  }
  const offline = await createFrontendHarness({ search: `?reset_token=${VALID_TOKEN}` });
  offline.addRoute('/api/auth/reset-password', () => Promise.reject(new Error('offline')));
  offline.probe.elements.authPasswordInput.value = 'Replacement123!';
  offline.probe.elements.authConfirmPasswordInput.value = 'Replacement123!';
  await offline.probe.elements.authForm.dispatch('submit');
  assert.match(offline.probe.elements.authFormMessage.textContent, /terhubung/);
});

test('late recovery response after navigating back to login cannot overwrite the new state', async () => {
  const harness = await createFrontendHarness();
  const pending = deferred();
  harness.addRoute('/api/auth/forgot-password', () => pending.promise);
  await harness.probe.elements.authLoginBtn.dispatch('click');
  await harness.probe.elements.authForgotPasswordBtn.dispatch('click');
  harness.probe.elements.authEmailInput.value = 'person@example.test';
  const request = harness.probe.elements.authForm.dispatch('submit');
  await settle();
  await harness.probe.elements.authBackToLoginBtn.dispatch('click');
  pending.resolve(harness.response(202, { status: 'success' }));
  await request;
  assert.equal(harness.probe.recovery().mode, 'login');
  assert.equal(harness.probe.elements.authFormMessage.textContent, '');
});

test('closing during a pending recovery request does not lock a reopened auth flow', async () => {
  const harness = await createFrontendHarness();
  const pending = deferred();
  harness.addRoute('/api/auth/forgot-password', () => pending.promise);
  await harness.probe.elements.authLoginBtn.dispatch('click');
  await harness.probe.elements.authForgotPasswordBtn.dispatch('click');
  harness.probe.elements.authEmailInput.value = 'person@example.test';
  const oldRequest = harness.probe.elements.authForm.dispatch('submit');
  await settle();
  assert.equal(harness.probe.elements.authFormMessage.getAttribute('role'), 'status');
  assert.equal(harness.probe.elements.authFormMessage.getAttribute('aria-live'), 'polite');
  await harness.probe.elements.authDialogCloseBtn.dispatch('click');
  await harness.probe.elements.authLoginBtn.dispatch('click');
  assert.equal(harness.probe.elements.authSubmitBtn.disabled, false);
  assert.equal(harness.probe.recovery().pending, false);
  pending.resolve(harness.response(202, { status: 'success' }));
  await oldRequest;
  assert.equal(harness.probe.recovery().mode, 'login');
  assert.equal(harness.probe.elements.authSubmitBtn.disabled, false);
});

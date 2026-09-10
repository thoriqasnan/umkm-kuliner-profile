const test = require('node:test');
const assert = require('node:assert/strict');
const { createFrontendHarness, settle } = require('../helpers/frontend-vm-harness');

const ADMIN = { id: 41, email: 'admin@example.test', role: 'admin' };
const USER = { ...ADMIN, role: 'user' };

test('admin-operation 403 clears privileged UI and resyncs authoritative role', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.addRoute('/api/auth/me', () => harness.response(200, { status: 'success', user: USER }));
  harness.probe.setUser(ADMIN);
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, false);

  let displayedKey = null;
  assert.equal(harness.probe.handleAdminAuthError(
    harness.response(403, { code: 'FORBIDDEN' }),
    (message, key) => { displayedKey = key; },
  ), true);
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, true);
  assert.equal(displayedKey, 'admin.permissionDenied');
  await settle(20);
  assert.equal(harness.probe.state().currentUser.role, 'user');
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, true);
  assert.equal(harness.probe.elements.adminMenuActions.classList.contains('hide'), true);
});

test('returning after the page was hidden revalidates auth and removes stale admin state', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.addRoute('/api/auth/me', () => harness.response(200, { status: 'success', user: USER }));
  harness.probe.setUser(ADMIN);
  const before = harness.calls.filter((call) => call.url.endsWith('/api/auth/me')).length;

  harness.document.visibilityState = 'hidden';
  await harness.document.dispatch('visibilitychange');
  harness.document.visibilityState = 'visible';
  await harness.context.window.dispatch('focus');
  await settle(20);

  const after = harness.calls.filter((call) => call.url.endsWith('/api/auth/me')).length;
  assert.equal(after, before + 1);
  assert.equal(harness.probe.state().currentUser.role, 'user');
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, true);
});

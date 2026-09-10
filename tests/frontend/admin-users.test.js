const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFrontendHarness, response } = require('../helpers/frontend-vm-harness');

const ADMIN = { id: 1, email: 'owner@example.test', role: 'admin' };
const owner = { id: 1, email: ADMIN.email, role: 'admin', createdAt: '2026-01-01', isCurrent: true, isLastActiveAdmin: false, canChangeRole: false };
const member = { id: 2, email: 'member@example.test', role: 'user', createdAt: '2026-01-02', isCurrent: false, isLastActiveAdmin: false, canChangeRole: true };
const listing = (users, offset = 0, total = users.length) => ({ status: 'success', users, pagination: { limit: 25, offset, total } });

test('admin navigation and accessible Users & Admins surface are present', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  assert.match(html, /href="#adminUsers"[^>]+data-admin-destination="users"/);
  assert.match(html, /id="adminUsers"[^>]+aria-labelledby="adminUsersTitle"/);
  assert.match(html, /id="adminUsersStatus"[^>]+aria-live="polite"/);
  assert.match(html, /id="adminRoleDialog"[^>]+aria-labelledby="adminRoleDialogTitle"[^>]+aria-describedby="adminRoleDialogDescription"/);
});

test('listing renders success, protected current account, empty, and network error states', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing([owner, member])));
  await harness.probe.loadAdminUsers({ offset: 0 });
  assert.equal(harness.probe.elements.adminUsersBody.children.length, 2);
  const ownerButton = harness.probe.elements.adminUsersBody.children[0].children[2].children[0];
  const memberButton = harness.probe.elements.adminUsersBody.children[1].children[2].children[0];
  assert.equal(ownerButton.classList.contains('admin-users-role-btn--demote'), true);
  assert.equal(memberButton.classList.contains('admin-users-role-btn--promote'), true);
  assert.equal(ownerButton.disabled, true);
  assert.match(harness.probe.elements.adminUsersBody.children[0].children[2].children[1].textContent, /tidak dapat diturunkan/);

  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing([], 0, 0)));
  await harness.probe.loadAdminUsers({ offset: 0 });
  assert.equal(harness.probe.state().adminUsers.status, 'empty');
  assert.match(harness.probe.elements.adminUsersStatus.textContent, /Tidak ada akun/);

  harness.addRoute((url) => url.includes('/api/admin/users?'), () => { throw new TypeError('offline'); });
  await harness.probe.loadAdminUsers({ offset: 0 });
  assert.equal(harness.probe.state().adminUsers.status, 'error');
  assert.match(harness.probe.elements.adminUsersStatus.textContent, /terhubung/);
});

test('search, role filter, reset, and pagination build canonical server queries', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  harness.addRoute((url) => url.includes('/api/admin/users?'), (url) => response(200, listing([member], Number(new URL(url).searchParams.get('offset')), 60)));
  const el = harness.probe.elements;
  el.adminUsersSearchInput.value = '  member@example.test  ';
  el.adminUsersRoleFilter.value = 'user';
  await el.adminUsersSearchForm.dispatch('submit'); await harness.settle(10);
  let query = new URL(harness.calls.at(-1).url).searchParams;
  assert.equal(query.get('search'), 'member@example.test');
  assert.equal(query.get('role'), 'user');
  assert.equal(query.get('offset'), '0');
  await el.adminUsersNextBtn.dispatch('click'); await harness.settle(10);
  query = new URL(harness.calls.at(-1).url).searchParams;
  assert.equal(query.get('offset'), '25');
  await el.adminUsersResetBtn.dispatch('click'); await harness.settle(10);
  query = new URL(harness.calls.at(-1).url).searchParams;
  assert.equal(query.has('search'), false);
  assert.equal(query.has('role'), false);
  assert.equal(query.get('offset'), '0');
});

test('a stale listing cannot overwrite a newer search result', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  const first = harness.deferred();
  harness.addRoute((url) => url.includes('/api/admin/users?'), (url) => url.includes('search=new') ? response(200, listing([member])) : first.promise);
  const oldLoad = harness.probe.loadAdminUsers({ offset: 0 });
  harness.probe.elements.adminUsersSearchInput.value = 'new';
  await harness.probe.elements.adminUsersSearchForm.dispatch('submit'); await harness.settle(10);
  first.resolve(response(200, listing([owner]))); await oldLoad;
  assert.equal(harness.probe.state().adminUsers.users[0].id, member.id);
});

test('promotion requires confirmation, prevents duplicate submit, and reconciles from server', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  let listCount = 0;
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing(listCount++ ? [{ ...member, role: 'admin' }] : [member])));
  await harness.probe.loadAdminUsers({ offset: 0 });
  const rowButton = harness.probe.elements.adminUsersBody.children[0].children[2].children[0];
  await rowButton.dispatch('click');
  assert.equal(harness.probe.elements.adminRoleDialog.open, true);
  const pending = harness.deferred();
  harness.addRoute((url, request) => url.endsWith('/api/admin/users/2/role') && request.method === 'PATCH', () => pending.promise);
  const first = harness.probe.confirmAdminRoleChange();
  const second = harness.probe.confirmAdminRoleChange();
  assert.equal(harness.calls.filter((call) => call.url.endsWith('/api/admin/users/2/role')).length, 1);
  pending.resolve(response(200, { status: 'success', user: { ...member, role: 'admin' } }));
  await Promise.all([first, second]);
  assert.equal(harness.probe.state().adminUsers.users[0].role, 'admin');
  assert.match(harness.probe.elements.adminUsersStatus.textContent, /berhasil/);
});

test('last-admin rejection keeps the old role and authorization loss clears privileged users UI', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  const otherAdmin = { ...member, role: 'admin' };
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing([otherAdmin])));
  await harness.probe.loadAdminUsers({ offset: 0 });
  await harness.probe.elements.adminUsersBody.children[0].children[2].children[0].dispatch('click');
  harness.addRoute('/api/admin/users/2/role', () => response(409, { status: 'error', code: 'LAST_ADMIN_PROTECTED' }));
  await harness.probe.confirmAdminRoleChange();
  assert.equal(harness.probe.state().adminUsers.users[0].role, 'admin');
  assert.equal(harness.probe.elements.adminRoleDialog.open, false);
  assert.match(harness.probe.elements.adminUsersStatus.textContent, /terakhir/);

  harness.addRoute('/api/auth/me', () => response(200, { status: 'success', user: { ...ADMIN, role: 'user' } }));
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(403, { code: 'FORBIDDEN' }));
  await harness.probe.loadAdminUsers({ offset: 0 }); await harness.settle(20);
  assert.equal(harness.probe.elements.adminUsersResults.hidden, true);
  assert.equal(harness.probe.elements.adminDashboardEntry.hidden, true);
  assert.equal(harness.probe.state().currentUser.role, 'user');
});

test('trusted current-user identity protects self-demotion even if listing flags are inconsistent', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  const inconsistent = { ...owner, isCurrent: false, canChangeRole: true };
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing([inconsistent])));
  await harness.probe.loadAdminUsers({ offset: 0 });
  const actionCell = harness.probe.elements.adminUsersBody.children[0].children[2];
  assert.equal(actionCell.children[0].disabled, true);
  assert.match(actionCell.children[1].textContent, /tidak dapat diturunkan/);
});

test('hash activation loads users and a late JSON body cannot restore UI after logout', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(null);
  harness.context.window.location.hash = '#adminUsers';
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing([member])));
  harness.probe.setUser(ADMIN);
  await harness.settle(20);
  assert.equal(harness.probe.state().adminUsers.users[0].id, member.id);

  const body = harness.deferred();
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => ({ ok: true, status: 200, json: () => body.promise }));
  const pending = harness.probe.loadAdminUsers({ offset: 0 });
  await harness.settle(4);
  harness.probe.setUser(null);
  body.resolve(listing([owner]));
  await pending;
  assert.equal(harness.probe.elements.adminUsersResults.hidden, true);
  assert.equal(harness.probe.state().adminUsers.users.length, 0);
});

test('language switch re-renders dynamic role controls in English', async () => {
  const harness = await createFrontendHarness({ authUser: ADMIN });
  harness.probe.setUser(ADMIN);
  harness.addRoute((url) => url.includes('/api/admin/users?'), () => response(200, listing([member])));
  await harness.probe.loadAdminUsers({ offset: 0 });
  harness.probe.applyLanguage('en');
  harness.probe.renderAdminUsers();
  assert.equal(harness.probe.elements.adminUsersBody.children[0].children[1].textContent, 'User');
  assert.equal(harness.probe.elements.adminUsersBody.children[0].children[2].children[0].textContent, 'Promote to admin');
});

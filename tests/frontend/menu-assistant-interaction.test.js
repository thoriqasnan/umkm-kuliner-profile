const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createFrontendHarness } = require('../helpers/frontend-vm-harness');

const script = fs.readFileSync(path.resolve(__dirname, '..', '..', 'script.js'), 'utf8');

function success(language = 'id', overrides = {}) {
  return {
    status: 'success',
    answer: language === 'id' ? 'Coba Soto Ayam Kampung.' : 'Try Soto Ayam Kampung.',
    language,
    insufficientInformation: false,
    limitations: [],
    sources: [{ productId: 3, slug: 'sotoayam', name: 'Soto Ayam Kampung' }],
    ...overrides,
  };
}

function aiCalls(harness) {
  return harness.calls.filter((call) => call.url.endsWith('/api/ai/menu-assistant'));
}

test('send state trims input and enforces the 1000-character boundary', async () => {
  const harness = await createFrontendHarness();
  const { menuAssistantInput: input, menuAssistantSendBtn: send } = harness.probe.elements;
  assert.equal(send.disabled, true);
  input.value = '  menu  ';
  await input.dispatch('input');
  assert.equal(send.disabled, false);
  input.value = ' '.repeat(10);
  await input.dispatch('input');
  assert.equal(send.disabled, true);
  input.value = 'x'.repeat(1000);
  await input.dispatch('input');
  assert.equal(send.disabled, false);
  input.value = 'x'.repeat(1001);
  await input.dispatch('input');
  assert.equal(send.disabled, true);
  assert.equal(await harness.probe.submitMenuAssistantMessage(input.value), false);
  assert.equal(aiCalls(harness).length, 0);
});

test('Enter submits exact standalone Node payload; Shift+Enter and IME composition do not', async () => {
  const harness = await createFrontendHarness();
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('id')));
  const input = harness.probe.elements.menuAssistantInput;
  input.value = '  Menu berkuah  ';
  await input.dispatch('keydown', { key: 'Enter', shiftKey: true, isComposing: false });
  await input.dispatch('keydown', { key: 'Enter', shiftKey: false, isComposing: true });
  assert.equal(aiCalls(harness).length, 0);
  await input.dispatch('keydown', { key: 'Enter', shiftKey: false, isComposing: false });
  await harness.settle();
  const call = aiCalls(harness)[0];
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.options.body), { message: 'Menu berkuah', language: 'id' });
  assert.equal(Object.hasOwn(JSON.parse(call.options.body), 'cart'), false);
  assert.equal(Object.hasOwn(call.options, 'credentials'), false);
});

test('loading renders immediately, disables duplicate submission, and clears on completion', async () => {
  const harness = await createFrontendHarness();
  const pending = harness.deferred();
  harness.addRoute('/api/ai/menu-assistant', () => pending.promise);
  const request = harness.probe.submitMenuAssistantMessage('Menu segar');
  assert.equal(harness.probe.assistant().view, 'loading');
  assert.equal(harness.probe.elements.menuAssistantLoading.hidden, false);
  assert.equal(harness.probe.elements.menuAssistantSendBtn.disabled, true);
  assert.equal(harness.probe.elements.menuAssistantConversation.querySelector('[data-author="user"]').textContent, 'Menu segar');
  assert.equal(await harness.probe.submitMenuAssistantMessage('Duplikat'), false);
  assert.equal(aiCalls(harness).length, 1);
  pending.resolve(harness.response(200, success('id')));
  await request;
  assert.equal(harness.probe.assistant().view, 'success');
  assert.equal(harness.probe.elements.menuAssistantLoading.hidden, true);
  assert.equal(harness.probe.elements.menuAssistantSendBtn.disabled, true, 'empty composer remains disabled');
});

test('a single localized status announces loading and response readiness without moving focus', async () => {
  const harness = await createFrontendHarness();
  const pending = harness.deferred();
  harness.addRoute('/api/ai/menu-assistant', () => pending.promise);
  const input = harness.probe.elements.menuAssistantInput;
  const announcement = harness.document.getElementById('menuAssistantAnnouncement');
  input.focus();
  const request = harness.probe.submitMenuAssistantMessage('Soto');
  assert.equal(announcement.textContent, 'Sedang mencari menu...');
  assert.equal(harness.document.activeElement, input);
  pending.resolve(harness.response(200, success('id')));
  await request;
  assert.equal(announcement.textContent, 'Jawaban asisten tersedia.');
  assert.deepEqual(announcement.textContentWrites.slice(-3), [
    'Sedang mencari menu...',
    '',
    'Jawaban asisten tersedia.',
  ]);
  assert.equal(announcement.textContentWrites.includes('Coba Soto Ayam Kampung.'), false);
  assert.equal(harness.document.activeElement, input);

  harness.probe.applyLanguage('en');
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('en')));
  await harness.probe.submitMenuAssistantMessage('Drink');
  assert.equal(announcement.textContent, 'The assistant response is available.');
});

test('language is captured per request and a later language switch does not rewrite the answer', async () => {
  const harness = await createFrontendHarness();
  const pending = harness.deferred();
  harness.addRoute('/api/ai/menu-assistant', () => pending.promise);
  const request = harness.probe.submitMenuAssistantMessage('Minuman');
  harness.probe.applyLanguage('en');
  pending.resolve(harness.response(200, success('id', { answer: 'Jawaban tetap Indonesia.' })));
  await request;
  assert.deepEqual(JSON.parse(aiCalls(harness)[0].options.body), { message: 'Minuman', language: 'id' });
  assert.equal(harness.probe.elements.menuAssistantConversation.querySelector('[data-author="assistant"]').textContent, 'Jawaban tetap Indonesia.');
  assert.equal(harness.probe.elements.menuAssistantConversation.querySelector('[data-author="assistant"]').getAttribute('aria-label'), 'Assistant: Jawaban tetap Indonesia.');
  assert.equal(harness.probe.elements.menuAssistantConversation.querySelector('.menu-assistant-meta-title').textContent, 'Menu sources');
  assert.equal(harness.probe.elements.menuAssistantConversation.querySelector('.menu-assistant-source-chip').getAttribute('aria-label'), 'View Soto Ayam Kampung on the menu');
  assert.equal(harness.document.getElementById('menuAssistantAnnouncement').textContent, 'The assistant response is available.');
});

test('response language is per-message while panel chrome follows website language', async () => {
  const harness = await createFrontendHarness();
  const responses = [
    success('id', { answer: 'Coba Soto Ayam Kampung.' }),
    success('en', { answer: 'Try Soto Ayam Kampung.' }),
    success('id', { answer: 'Soto tetap cocok.' }),
  ];
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, responses.shift()));
  harness.probe.applyLanguage('en');
  await harness.probe.submitMenuAssistantMessage('Rekomendasikan makanan berkuah.');
  await harness.probe.submitMenuAssistantMessage('Recommend a soupy dish.');
  await harness.probe.submitMenuAssistantMessage('Rekomendasikan soto.');
  const conversation = harness.probe.elements.menuAssistantConversation;
  assert.deepEqual(
    conversation.querySelectorAll('[data-author="assistant"]').map((element) => element.textContent),
    ['Coba Soto Ayam Kampung.', 'Try Soto Ayam Kampung.', 'Soto tetap cocok.'],
  );
  assert.deepEqual(aiCalls(harness).map((call) => JSON.parse(call.options.body).language), ['en', 'en', 'en']);
  assert.equal(conversation.querySelector('.menu-assistant-meta-title').textContent, 'Menu sources');
  harness.probe.applyLanguage('id');
  assert.deepEqual(
    conversation.querySelectorAll('[data-author="assistant"]').map((element) => element.textContent),
    ['Coba Soto Ayam Kampung.', 'Try Soto Ayam Kampung.', 'Soto tetap cocok.'],
  );
  assert.equal(conversation.querySelector('.menu-assistant-meta-title').textContent, 'Sumber menu');
});

test('user and model content render as text while friendly sources omit internal identifiers', async () => {
  const harness = await createFrontendHarness();
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('id', {
    answer: '<img src=x onerror=alert(1)>\nAman',
    sources: [{ productId: 3, slug: 'sotoayam', name: '<b>Soto</b>' }],
  })));
  await harness.probe.submitMenuAssistantMessage('<script>alert(1)</script>');
  const conversation = harness.probe.elements.menuAssistantConversation;
  assert.equal(conversation.querySelector('[data-author="user"]').textContent, '<script>alert(1)</script>');
  assert.equal(conversation.querySelector('[data-author="assistant"]').textContent, '<img src=x onerror=alert(1)>\nAman');
  assert.equal(conversation.querySelector('.menu-assistant-source-chip').textContent, '<b>Soto</b>');
  assert.equal(conversation.querySelector('img'), null);
  assert.doesNotMatch(conversation.querySelector('.menu-assistant-source-chip').textContent, /menu:|source_id/);
  const assistantRenderer = script.slice(script.indexOf('function createAssistantTextElement'), script.indexOf('function openMenuAssistant'));
  assert.doesNotMatch(assistantRenderer, /innerHTML\s*=/);
});

test('source activation closes, scrolls, highlights, and focuses a temporary destination heading', async () => {
  const product = { id: 3, slug: 'sotoayam', name: 'Soto Ayam Kampung', category: 'makanan', price: 25000,
    description: { id: 'Kuah', en: 'Soup' }, image: { src: '/soto.jpg', alt: 'Soto', width: 700, height: 467 } };
  const harness = await createFrontendHarness({ products: [product] });
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('id')));
  await harness.probe.loadMenu();
  const card = harness.document.querySelector('.menu-card');
  const destination = card.querySelector('h3') || card;
  assert.equal(String(card.dataset.productId), '3');
  assert.equal(card.dataset.productSlug, 'sotoayam');
  harness.probe.elements.menuAssistantDialog.showModal();
  await harness.probe.submitMenuAssistantMessage('Soto');
  await harness.probe.elements.menuAssistantConversation.querySelector('.menu-assistant-source-chip').dispatch('click');
  assert.equal(harness.probe.elements.menuAssistantDialog.open, false);
  assert.equal(card.scrollIntoViewCalls.length, 1);
  assert.equal(card.scrollIntoViewCalls[0].behavior, 'auto');
  assert.equal(card.style.transition, 'none');
  assert.equal(card.classList.contains('is-assistant-highlighted'), true);
  assert.equal(harness.document.activeElement, destination);
  assert.equal(destination.getAttribute('tabindex'), '-1');
  assert.match(script, /restoreFocusOnClose = false;[\s\S]*menuAssistantDialog\.close\(\)/);
  assert.match(script, /if \(shouldRestoreFocus\) \{[\s\S]*menuAssistantLauncher\.focus\(\)/);
  assert.match(script, /destination\.addEventListener\("blur"[\s\S]*destination\.removeAttribute\("tabindex"\)/);
  harness.timers.advance(2400);
  assert.equal(card.classList.contains('is-assistant-highlighted'), false);
  assert.equal(card.style.transition, '');
  assert.doesNotThrow(() => harness.probe.navigateToAssistantSource({ productId: 999, slug: 'missing', name: 'Missing' }));
});

test('insufficient information and limitations are valid results without fabricated sources', async () => {
  const harness = await createFrontendHarness();
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('id', {
    answer: 'Informasi alergi belum tersedia.', insufficientInformation: true,
    limitations: ['Komposisi rinci tidak tercantum.'], sources: [],
  })));
  await harness.probe.submitMenuAssistantMessage('Aman untuk alergi?');
  const conversation = harness.probe.elements.menuAssistantConversation;
  assert.equal(harness.probe.assistant().view, 'insufficient');
  assert.match(conversation.querySelector('.menu-assistant-notice').textContent, /belum cukup/i);
  assert.equal(conversation.querySelector('.menu-assistant-limitations li').textContent, 'Komposisi rinci tidak tercantum.');
  assert.equal(conversation.querySelector('.menu-assistant-source-chip'), null);
  assert.equal(harness.document.getElementById('menuAssistantAnnouncement').textContent, 'Jawaban asisten tersedia dengan keterbatasan informasi.');
});

test('messages identify their localized speaker and sources form a labelled navigation group', async () => {
  const harness = await createFrontendHarness();
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('id')));
  await harness.probe.submitMenuAssistantMessage('Soto');
  const conversation = harness.probe.elements.menuAssistantConversation;
  assert.equal(conversation.querySelector('[data-author="user"]').getAttribute('aria-label'), 'Anda: Soto');
  assert.equal(conversation.querySelector('[data-author="assistant"]').getAttribute('aria-label'), 'Asisten: Coba Soto Ayam Kampung.');
  const sources = conversation.querySelector('.menu-assistant-sources');
  const title = sources.firstChild;
  assert.equal(sources.getAttribute('aria-labelledby'), title.id);
  assert.equal(title.textContent, 'Sumber menu');
  assert.equal(sources.querySelector('.menu-assistant-source-chip').getAttribute('aria-label'), 'Lihat Soto Ayam Kampung di menu');
});

for (const [label, status, code, expected] of [
  ['rate limit', 429, 'rate_limited', /Tunggu sebentar/i],
  ['timeout', 504, 'upstream_timeout', /terlalu lama/i],
  ['runtime unavailable', 502, 'ai_runtime_unavailable', /tidak tersedia/i],
  ['internal error', 500, 'internal_error', /belum dapat dimuat/i],
]) {
  test(`${label} maps to localized safe UI without raw details`, async () => {
    const harness = await createFrontendHarness();
    harness.addRoute('/api/ai/menu-assistant', () => harness.response(status, { status: 'error', code, detail: 'private stack provider key' }));
    await harness.probe.submitMenuAssistantMessage('Menu');
    const error = harness.probe.elements.menuAssistantConversation.querySelector('.menu-assistant-error');
    assert.match(error.textContent, expected);
    assert.doesNotMatch(error.textContent, /private|stack|provider|key/i);
    assert.equal(harness.probe.elements.menuAssistantInput.value, 'Menu');
    assert.equal(harness.probe.elements.menuAssistantSendBtn.disabled, false);
    assert.equal(harness.document.getElementById('menuAssistantAnnouncement').textContent, error.textContent);
  });
}

test('malformed success fails closed regardless of its supported response language', async () => {
  const harness = await createFrontendHarness();
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, { answer: '<unsafe>', language: 'en' }));
  await harness.probe.submitMenuAssistantMessage('Menu');
  const conversation = harness.probe.elements.menuAssistantConversation;
  assert.equal(harness.probe.assistant().view, 'error');
  assert.match(conversation.querySelector('.menu-assistant-error').textContent, /jawaban yang valid/i);
  assert.equal(conversation.querySelector('[data-author="assistant"]'), null);
});

test('closing preserves an in-flight request and reopening shows the completed page-session exchange', async () => {
  const harness = await createFrontendHarness();
  const pending = harness.deferred();
  harness.addRoute('/api/ai/menu-assistant', () => pending.promise);
  const launcher = harness.document.getElementById('menuAssistantLauncher');
  await launcher.dispatch('click');
  const request = harness.probe.submitMenuAssistantMessage('Soto');
  harness.probe.elements.menuAssistantDialog.close();
  await harness.probe.elements.menuAssistantDialog.dispatch('close');
  assert.equal(harness.probe.assistant().active, true);
  pending.resolve(harness.response(200, success('id')));
  await request;
  await launcher.dispatch('click');
  assert.equal(harness.probe.elements.menuAssistantConversation.querySelector('[data-author="assistant"]').textContent, 'Coba Soto Ayam Kampung.');
  assert.equal((launcher.listeners.get('click') || []).length, 1);
});

test('localized suggestion chips use the same real request path', async () => {
  const harness = await createFrontendHarness();
  harness.probe.applyLanguage('en');
  harness.addRoute('/api/ai/menu-assistant', () => harness.response(200, success('en')));
  const suggestion = harness.document.querySelector('[data-suggestion="soupy"]');
  await suggestion.dispatch('click');
  await harness.settle();
  assert.deepEqual(JSON.parse(aiCalls(harness)[0].options.body), {
    message: 'Recommend some soupy dishes.', language: 'en',
  });
});

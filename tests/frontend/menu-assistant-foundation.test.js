const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFrontendHarness } = require('../helpers/frontend-vm-harness');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

test('assistant and back-to-top share an accessible responsive floating foundation', () => {
  assert.match(html, /id="floatingControls"[\s\S]*id="backToTopBtn"[\s\S]*id="menuAssistantLauncher"/);
  assert.equal((html.match(/id="floatingControls"/g) || []).length, 1);
  assert.equal((html.match(/id="menuAssistantLauncher"/g) || []).length, 1);
  assert.match(html, /id="menuAssistantLauncher"[^>]*aria-haspopup="dialog"[^>]*data-i18n-aria="assistant\.open"/);
  assert.match(html, /id="menuAssistantDialog"[^>]*aria-labelledby="menuAssistantTitle"/);
  assert.match(css, /\.floating-controls\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.menu-assistant-dialog\s*\{[\s\S]*width:\s*min\(390px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.menu-assistant-launcher-label\s*\{\s*display:\s*none/);
  assert.match(css, /\.back-to-top-btn\s*\{\s*flex-basis:\s*50px;\s*width:\s*50px;\s*height:\s*50px;/);
  assert.match(css, /\.menu-assistant-launcher\s*\{\s*width:\s*50px;\s*min-height:\s*50px;/);
  assert.match(script, /Math\.max\(cartClearance, footerClearance\)/);
});

test('assistant sizing is bounded for dynamic, safe-area, narrow, and short viewports', () => {
  assert.match(css, /\.menu-assistant-dialog\s*\{[\s\S]*width:\s*min\(390px, calc\(100vw[\s\S]*width:\s*min\(390px, calc\(100dvw/);
  assert.match(css, /--assistant-inline-end:\s*max\(var\(--assistant-edge\), env\(safe-area-inset-right\)\)/);
  assert.match(css, /\.menu-assistant-dialog\s*\{[\s\S]*height:\s*min\(600px, calc\(100vh[\s\S]*height:\s*min\(600px, calc\(100dvh/);
  assert.match(css, /--assistant-bottom:[^;]*--floating-cart-clearance[^;]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*--assistant-inline-start:\s*max\(12px, env\(safe-area-inset-left\)\)[\s\S]*--assistant-inline-end:\s*max\(12px, env\(safe-area-inset-right\)\)/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*height:\s*calc\(100vh[\s\S]*height:\s*calc\(100dvh/);
});

test('long localized assistant content has wrapping and shrink guards', () => {
  assert.match(css, /\.menu-assistant-header > div\s*\{\s*min-width:\s*0/);
  assert.match(css, /\.menu-assistant-header h2[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.menu-assistant-suggestion[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.menu-assistant-message[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.menu-assistant-source-chip[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.menu-assistant-composer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
});

test('the shared wrapper has narrow floating and Maps-docked contracts at the existing breakpoint', () => {
  assert.match(html, /class="kontak-map"[\s\S]*id="floatingControls"[\s\S]*<\/section>[\s\S]*<footer/);
  assert.match(html, /class="kontak-map"[\s\S]*id="floatingControlsDock"[\s\S]*id="floatingControls"/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.floating-controls\s*\{[\s\S]*position:\s*fixed;[\s\S]*flex-direction:\s*column;/);
  assert.match(css, /\.floating-controls\.is-docked\s*\{[\s\S]*position:\s*static;[\s\S]*flex-direction:\s*row;/);
  assert.match(css, /\.floating-controls\s*\{[\s\S]*position:\s*fixed;[\s\S]*flex-direction:\s*column;/);
  assert.match(css, /\.back-to-top-btn\s*\{\s*flex-basis:\s*50px;\s*width:\s*50px;\s*height:\s*50px;/);
  assert.match(css, /\.menu-assistant-launcher\s*\{\s*width:\s*50px;\s*min-height:\s*50px;/);
});

test('a compact non-interactive shell preserves dock geometry during the handoff', () => {
  assert.match(html, /class="floating-controls-slot">\s*<div class="floating-controls" id="floatingControls"/);
  assert.doesNotMatch(html, /class="floating-controls-slot"[^>]*(?:role|tabindex|aria-label|id)=/);
  assert.match(css, /\.floating-controls-slot\s*\{[\s\S]*min-block-size:\s*50px;/);
  assert.match(css, /\.floating-controls\.is-flipping\s*\{[\s\S]*will-change:\s*transform/);
  assert.doesNotMatch(script, /(?:window\.)?scrollY/);
});

test('float and dock use a measured, cancellable FLIP positional transition', () => {
  assert.match(script, /const firstRect = floatingControls\.getBoundingClientRect\(\)/);
  assert.match(script, /const lastRect = floatingControls\.getBoundingClientRect\(\)/);
  assert.match(script, /const deltaX = firstRect\.left - lastRect\.left/);
  assert.match(script, /const deltaY = firstRect\.top - lastRect\.top/);
  assert.match(script, /floatingControls\.animate\(\[[\s\S]*translate\([\s\S]*duration:\s*200[\s\S]*cubic-bezier/);
  assert.match(script, /floatingControlsFlipAnimation\.cancel\(\)/);
  assert.match(script, /reconcileFloatingControlsBreakpoint[\s\S]*clearFloatingControlsFlip\(\)/);
  assert.match(script, /reducedFloatingControlsMotionQuery\.matches/);
  assert.doesNotMatch(script, /floatingControls\.style\.(?:top|right|bottom|left)\s*=/);
  assert.doesNotMatch(css, /\.floating-controls\.is-transitioning/);
});

test('the real cart surface occludes only the travelling wrapper while dialogs retain top-layer semantics', () => {
  assert.match(css, /\.cart-bar\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*90;[\s\S]*background-color:/);
  assert.match(css, /\.floating-controls\.is-flipping\s*\{[\s\S]*z-index:\s*89;/);
  assert.match(script, /menuAssistantDialog\.showModal\(\)/);
  assert.match(script, /cartPanel\.showModal\(\)/);
  assert.doesNotMatch(script, /is-flipping[\s\S]{0,160}(?:hidden|opacity|visibility)/);
  assert.doesNotMatch(css, /\.cart-bar[^}]*pointer-events:\s*none/);
});

test('Maps observer toggles the same wrapper between narrow floating and docked modes', async () => {
  const harness = await createFrontendHarness();
  const wrapper = harness.document.getElementById('floatingControls');
  const dock = harness.document.getElementById('floatingControlsDock');
  const dockObserver = harness.intersectionObservers.find((observer) => observer.targets.has(dock));

  assert.equal(wrapper.classList.contains('is-docked'), false);
  dockObserver.trigger(dock, true, { boundingClientRect: { top: 500 } });
  assert.equal(wrapper.classList.contains('is-docked'), true);
  dockObserver.trigger(dock, false, { boundingClientRect: { top: -20 } });
  assert.equal(wrapper.classList.contains('is-docked'), true, 'stays docked after passing Maps toward the footer');
  dockObserver.trigger(dock, false, { boundingClientRect: { top: 700 } });
  assert.equal(wrapper.classList.contains('is-docked'), false, 'returns to floating when scrolling back above Maps');
});

test('idle content, bilingual strings, and inert future presentation hooks exist', () => {
  for (const hook of ['conversation', 'sources', 'insufficient', 'loading', 'error']) {
    assert.match(html, new RegExp(`data-assistant-region="${hook}"[^>]*hidden`));
  }
  assert.equal((html.match(/class="menu-assistant-suggestion"/g) || []).length, 3);
  assert.match(script, /"assistant\.welcomeTitle": "Halo!/);
  assert.match(script, /"assistant\.welcomeTitle": "Hello!/);
  assert.doesNotMatch(html + script, /menu:6|source_id|vector score|embedding|Gemini|E5/);
});

test('one restrained polite status announces assistant state without making history live', () => {
  assert.doesNotMatch(html, /data-assistant-region="conversation"[^>]*aria-live/);
  assert.doesNotMatch(html, /data-assistant-region="loading"[^>]*(?:role="status"|aria-live)/);
  assert.doesNotMatch(html, /data-assistant-region="error"[^>]*(?:role="alert"|aria-live)/);
  assert.match(html, /id="menuAssistantAnnouncement"[^>]*class="visually-hidden"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.equal((html.match(/id="menuAssistantAnnouncement"/g) || []).length, 1);
});

test('decorative icons stay silent and visible loading text does not rely on animation', () => {
  assert.match(html, /id="menuAssistantLauncher"[\s\S]*?<span aria-hidden="true">&#10022;<\/span>/);
  assert.match(html, /class="menu-assistant-mark" aria-hidden="true"/);
  assert.match(html, /class="menu-assistant-welcome-mark" aria-hidden="true"/);
  assert.match(html, /data-assistant-region="loading"[^>]*data-i18n="assistant\.loading">Sedang mencari menu/);
  assert.doesNotMatch(css, /\.menu-assistant-(?:status|loading)[^{]*\{[^}]*animation:/);
});

test('assistant touch targets and non-color state cues remain robust', () => {
  assert.match(css, /\.menu-assistant-close, \.menu-assistant-send\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(css, /\.menu-assistant-suggestion\s*\{[^}]*max-width:\s*100%;[^}]*min-height:\s*44px/);
  assert.match(css, /\.menu-assistant-source-chip\s*\{[^}]*max-width:\s*100%;[^}]*min-height:\s*44px/);
  assert.match(css, /\.menu-assistant-send:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  assert.match(css, /\.menu-assistant-notice, \.menu-assistant-status, \.menu-assistant-error\s*\{[^}]*border:/);
});

test('new screen-reader strings are localized without technical details', () => {
  assert.match(script, /"assistant\.responseReady": "Jawaban asisten tersedia\."/);
  assert.match(script, /"assistant\.responseReady": "The assistant response is available\."/);
  assert.match(script, /"assistant\.insufficientReady": "Jawaban asisten tersedia dengan keterbatasan informasi\."/);
  assert.match(script, /"assistant\.insufficientReady": "The assistant response is available with an information limitation\."/);
  assert.match(script, /"assistant\.userMessage": "Anda: \{message\}"/);
  assert.match(script, /"assistant\.userMessage": "You: \{message\}"/);
  assert.match(script, /"assistant\.assistantMessage": "Asisten: \{message\}"/);
  assert.match(script, /"assistant\.assistantMessage": "Assistant: \{message\}"/);
  const assistantMarkupAndCode = html.slice(html.indexOf('id="menuAssistantDialog"')) +
    script.slice(script.indexOf('const menuAssistantLauncher'), script.indexOf('// Dua percobaan sebelumnya'));
  assert.doesNotMatch(assistantMarkupAndCode, /source_id|vector score|correlation|Gemini|E5|HTTP status/i);
});

test('native modal and semantic controls expose coherent localized keyboard contracts', () => {
  const launcherMarkup = html.match(/<button[^>]*id="menuAssistantLauncher"[^>]*>/)?.[0] || '';
  assert.match(launcherMarkup, /type="button"/);
  assert.match(launcherMarkup, /aria-controls="menuAssistantDialog"/);
  assert.match(launcherMarkup, /aria-expanded="false"/);
  assert.match(launcherMarkup, /data-i18n-aria="assistant\.open"/);
  assert.match(html, /<dialog[^>]*id="menuAssistantDialog"[^>]*aria-labelledby="menuAssistantTitle"[^>]*aria-describedby="menuAssistantSubtitle"/);
  const closeMarkup = html.match(/<button[^>]*id="menuAssistantCloseBtn"[^>]*>/)?.[0] || '';
  assert.match(closeMarkup, /type="button"/);
  assert.match(closeMarkup, /data-i18n-aria="assistant\.close"/);
  assert.match(html, /<textarea[^>]*id="menuAssistantInput"[^>]*data-i18n-placeholder="assistant\.placeholder"/);
  const sendMarkup = html.match(/<button[^>]*id="menuAssistantSendBtn"[^>]*>/)?.[0] || '';
  assert.match(sendMarkup, /type="submit"/);
  assert.match(sendMarkup, /data-i18n-aria="assistant\.send"/);
  assert.equal((html.match(/<button[^>]*class="menu-assistant-suggestion"/g) || []).length, 3);
  assert.doesNotMatch(html + script, /tabindex="?[1-9]/i);
  assert.match(script, /menuAssistantDialog\.showModal\(\)/);
  assert.doesNotMatch(script, /(?:trapFocus|focusTrap|keydown[^\n]*Tab)/i);
});

test('assistant controls share visible focus treatment without clipping source-chip rings', () => {
  for (const selector of ['menu-assistant-launcher', 'menu-assistant-close', 'menu-assistant-suggestion', 'menu-assistant-source-chip', 'menu-assistant-send']) {
    assert.match(css, new RegExp(`\\.${selector}:focus-visible`));
  }
  assert.match(css, /\.menu-assistant-composer textarea:focus-visible/);
  assert.match(css, /\.menu-assistant-source-list\s*\{[^}]*margin:\s*-3px;[^}]*padding:\s*3px/);
});

test('launcher opens, close and Escape close, focus returns, and accepted floating state remains stable', async () => {
  const harness = await createFrontendHarness();
  const launcher = harness.document.getElementById('menuAssistantLauncher');
  const dialog = harness.document.getElementById('menuAssistantDialog');
  const close = harness.document.getElementById('menuAssistantCloseBtn');
  const input = harness.document.getElementById('menuAssistantInput');
  const floatingControls = harness.document.getElementById('floatingControls');
  const backToTop = harness.document.getElementById('backToTopBtn');
  const hero = harness.document.getElementById('beranda');
  const heroObserver = harness.intersectionObservers.find((observer) => observer.targets.has(hero));

  launcher.focus();
  heroObserver.trigger(hero, false);
  assert.equal(backToTop.classList.contains('is-visible'), true);
  await launcher.dispatch('click');
  harness.timers.advance(0);
  assert.equal(dialog.open, true);
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(floatingControls.classList.contains('is-assistant-open'), true);
  assert.equal(launcher.hidden, false);
  assert.equal(backToTop.classList.contains('is-visible'), true, 'scroll visibility state is retained while temporarily suppressed');
  assert.equal(harness.document.activeElement, input);

  await close.dispatch('click');
  assert.equal(dialog.open, false);
  await dialog.dispatch('close');
  assert.equal(floatingControls.classList.contains('is-assistant-open'), false);
  assert.equal(backToTop.classList.contains('is-visible'), true, 'closing restores the existing scroll-driven state');
  assert.equal(harness.document.activeElement, launcher);

  await launcher.dispatch('click');
  await dialog.dispatch('cancel');
  assert.equal(dialog.open, false);
});

test('narrow pointer opening avoids eager virtual keyboard while keyboard opening focuses composer', async () => {
  const pointerHarness = await createFrontendHarness({ narrowViewport: true });
  const pointerLauncher = pointerHarness.document.getElementById('menuAssistantLauncher');
  await pointerLauncher.dispatch('click', { detail: 1 });
  pointerHarness.timers.advance(0);
  assert.equal(pointerHarness.document.activeElement, pointerHarness.document.getElementById('menuAssistantCloseBtn'));

  const keyboardHarness = await createFrontendHarness({ narrowViewport: true });
  const keyboardLauncher = keyboardHarness.document.getElementById('menuAssistantLauncher');
  await keyboardLauncher.dispatch('click', { detail: 0 });
  keyboardHarness.timers.advance(0);
  assert.equal(keyboardHarness.document.activeElement, keyboardHarness.document.getElementById('menuAssistantInput'));
});

test('rendered cart and footer boundaries drive the shared safe clearance', async () => {
  const harness = await createFrontendHarness({ viewportHeight: 800 });
  const floatingControls = harness.document.getElementById('floatingControls');
  const cartBar = harness.document.getElementById('cartBar');
  const footer = harness.document.getElementById('siteFooter');
  const footerObserver = harness.intersectionObservers.find((observer) => observer.targets.has(footer));

  cartBar.rect = { top: 650, bottom: 800, height: 150, left: 0, right: 375, width: 375 };
  footer.rect = { top: 560, bottom: 760, height: 200, left: 0, right: 375, width: 375 };
  footerObserver.trigger(footer, true);
  assert.equal(floatingControls.style.getPropertyValue('--floating-safe-clearance'), '240px');

  footerObserver.trigger(footer, false);
  assert.equal(floatingControls.style.getPropertyValue('--floating-safe-clearance'), '150px');
});

test('resize, orientation, and visual viewport changes refresh measured clearance', () => {
  assert.match(script, /window\.addEventListener\("resize", handleFloatingControlsResize\)/);
  assert.match(script, /window\.addEventListener\("orientationchange", handleFloatingControlsResize\)/);
  assert.match(script, /window\.visualViewport\.addEventListener\("resize", handleFloatingControlsResize\)/);
  assert.match(script, /window\.visualViewport\.addEventListener\("scroll", updateFloatingClearance\)/);
  assert.match(script, /handleFloatingControlsResize[\s\S]*reconcileFloatingControlsBreakpoint\(\)[\s\S]*updateFloatingClearance\(\)/);
});

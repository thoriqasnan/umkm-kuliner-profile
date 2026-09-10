const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EmailDeliveryError,
  RESEND_ENDPOINT,
  createPasswordResetDeliveryFromEnv,
  safeDeliveryFailureCategory,
} = require('../../lib/passwordResetDelivery');

const VALID_ENV = {
  NODE_ENV: 'production',
  EMAIL_DELIVERY_MODE: 'resend',
  RESEND_API_KEY: 're_test_value_not_a_real_secret',
  EMAIL_FROM: 'noreply@example.test',
  EMAIL_FROM_NAME: 'Sari Rasa',
};

test('Phase 6-EXT-F Resend delivery configuration and adapter', async (t) => {
  await t.test('production requires explicit provider and complete valid configuration', () => {
    assert.throws(() => createPasswordResetDeliveryFromEnv({ NODE_ENV: 'production' }), /EMAIL_DELIVERY_MODE/);
    assert.throws(() => createPasswordResetDeliveryFromEnv({ ...VALID_ENV, RESEND_API_KEY: '' }), /RESEND_API_KEY/);
    assert.throws(() => createPasswordResetDeliveryFromEnv({ ...VALID_ENV, EMAIL_FROM: 'bad sender' }), /EMAIL_FROM/);
    assert.throws(() => createPasswordResetDeliveryFromEnv({ ...VALID_ENV, EMAIL_FROM_NAME: 'bad\r\nname' }), /EMAIL_FROM_NAME/);
    assert.throws(() => createPasswordResetDeliveryFromEnv({ ...VALID_ENV, EMAIL_DELIVERY_MODE: 'disabled' }), /tidak diizinkan/);
  });

  await t.test('development disabled mode fails observably without network access', async () => {
    const delivery = createPasswordResetDeliveryFromEnv({ NODE_ENV: 'development' });
    await assert.rejects(
      delivery.sendPasswordReset({}),
      (error) => error instanceof EmailDeliveryError && error.category === 'disabled',
    );
  });

  await t.test('provider receives professional text and HTML', async () => {
    const calls = [];
    const delivery = createPasswordResetDeliveryFromEnv(VALID_ENV, {
      async fetchImplementation(url, options) {
        calls.push({ url, options });
        return { ok: true, status: 200 };
      },
    });
    const resetUrl = 'https://app.example.test/?reset_token=temporary-token';
    await delivery.sendPasswordReset({ to: 'user@example.test', resetUrl, expiresAt: 'ignored' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, RESEND_ENDPOINT);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${VALID_ENV.RESEND_API_KEY}`);
    const payload = JSON.parse(calls[0].options.body);
    assert.deepEqual(payload.to, ['user@example.test']);
    assert.equal(payload.from, 'Sari Rasa <noreply@example.test>');
    assert.match(payload.text, /30 menit/);
    assert.match(payload.text, /abaikan email ini/);
    assert.ok(payload.text.includes(resetUrl));
    assert.match(payload.html, /30 menit/);
    assert.equal(JSON.stringify(payload).includes('ignored'), false);
  });

  await t.test('provider failures are classified without response body or secret leakage', async () => {
    for (const [status, category] of [[400, 'rejected'], [401, 'configuration'], [429, 'rate_limited'], [500, 'unavailable']]) {
      const delivery = createPasswordResetDeliveryFromEnv(VALID_ENV, {
        fetchImplementation: async () => ({ ok: false, status, text: async () => 'provider secret response' }),
      });
      await assert.rejects(delivery.sendPasswordReset({ to: 'user@example.test', resetUrl: 'https://app.example.test/' }), (error) => {
        assert.equal(error.category, category);
        assert.equal(error.message.includes('provider secret response'), false);
        assert.equal(error.message.includes(VALID_ENV.RESEND_API_KEY), false);
        return true;
      });
    }
  });

  await t.test('network and timeout failures are redacted', async () => {
    for (const [failure, category] of [[new Error('socket payload'), 'network'], [Object.assign(new Error('late'), { name: 'TimeoutError' }), 'timeout']]) {
      const delivery = createPasswordResetDeliveryFromEnv(VALID_ENV, {
        fetchImplementation: async () => { throw failure; },
      });
      await assert.rejects(delivery.sendPasswordReset({ to: 'user@example.test', resetUrl: 'https://app.example.test/' }), (error) => {
        assert.equal(error.category, category);
        assert.equal(error.message.includes(failure.message), false);
        return true;
      });
    }
  });

  await t.test('operator logging accepts only allowlisted operational categories', () => {
    assert.equal(safeDeliveryFailureCategory(new EmailDeliveryError('rate_limited')), 'rate_limited');
    assert.equal(safeDeliveryFailureCategory({ category: 'token=https://secret.example/reset' }), 'unknown');
    assert.equal(safeDeliveryFailureCategory(new Error('provider payload')), 'unknown');
  });
});

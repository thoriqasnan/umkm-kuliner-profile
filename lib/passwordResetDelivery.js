const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DELIVERY_TIMEOUT_MS = 10_000;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SAFE_FAILURE_CATEGORIES = new Set([
  'configuration', 'disabled', 'network', 'rate_limited', 'rejected', 'timeout', 'unavailable',
]);

class EmailDeliveryError extends Error {
  constructor(category) {
    super(`Password reset email delivery failed: ${category}`);
    this.name = 'EmailDeliveryError';
    this.category = category;
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} wajib dikonfigurasi untuk EMAIL_DELIVERY_MODE=resend.`);
  }
  return value.trim();
}

function validateSenderEmail(value) {
  const email = requiredString(value, 'EMAIL_FROM');
  if (email.length > 254 || !EMAIL_PATTERN.test(email) || /[\r\n]/.test(email)) {
    throw new Error('EMAIL_FROM harus berupa alamat email pengirim yang valid.');
  }
  return email;
}

function validateSenderName(value) {
  const name = value === undefined ? 'Sari Rasa' : value.trim();
  if (!name || name.length > 100 || /[\r\n<>]/.test(name)) {
    throw new Error('EMAIL_FROM_NAME harus 1-100 karakter tanpa karakter header/angle bracket.');
  }
  return name;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function createResetEmailContent(resetUrl) {
  const safeUrl = escapeHtml(resetUrl);
  return {
    subject: 'Reset password akun Sari Rasa',
    text: [
      'Kami menerima permintaan untuk mereset password akun Sari Rasa Anda.',
      '',
      `Buka tautan berikut untuk membuat password baru: ${resetUrl}`,
      '',
      'Tautan ini berlaku selama 30 menit.',
      'Jika Anda tidak meminta reset password, abaikan email ini.',
    ].join('\n'),
    html: [
      '<p>Kami menerima permintaan untuk mereset password akun Sari Rasa Anda.</p>',
      `<p><a href="${safeUrl}">Buat password baru</a></p>`,
      '<p>Tautan ini berlaku selama 30 menit.</p>',
      '<p>Jika Anda tidak meminta reset password, abaikan email ini.</p>',
    ].join(''),
  };
}

function createDisabledDelivery() {
  return {
    async sendPasswordReset() {
      throw new EmailDeliveryError('disabled');
    },
  };
}

function createResendDelivery(config, options = {}) {
  const fetchImplementation = options.fetchImplementation || globalThis.fetch;
  if (typeof fetchImplementation !== 'function') throw new Error('Runtime fetch tidak tersedia.');

  return {
    async sendPasswordReset({ to, resetUrl }) {
      const content = createResetEmailContent(resetUrl);
      let response;
      try {
        response = await fetchImplementation(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${config.fromName} <${config.fromEmail}>`,
            to: [to],
            subject: content.subject,
            text: content.text,
            html: content.html,
          }),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
      } catch (error) {
        throw new EmailDeliveryError(error?.name === 'TimeoutError' ? 'timeout' : 'network');
      }

      if (response.ok) return;
      if (response.status === 429) throw new EmailDeliveryError('rate_limited');
      if (response.status === 401 || response.status === 403) throw new EmailDeliveryError('configuration');
      if (response.status >= 400 && response.status < 500) throw new EmailDeliveryError('rejected');
      throw new EmailDeliveryError('unavailable');
    },
  };
}

function createPasswordResetDeliveryFromEnv(environment = process.env, options = {}) {
  const defaultMode = environment.NODE_ENV === 'production' ? undefined : 'disabled';
  const mode = environment.EMAIL_DELIVERY_MODE === undefined
    ? defaultMode
    : environment.EMAIL_DELIVERY_MODE.trim().toLowerCase();
  if (mode === 'disabled') {
    if (environment.NODE_ENV === 'production') {
      throw new Error('EMAIL_DELIVERY_MODE=disabled tidak diizinkan pada production.');
    }
    return createDisabledDelivery();
  }
  if (mode !== 'resend') {
    throw new Error('EMAIL_DELIVERY_MODE wajib bernilai resend pada production, atau disabled untuk development/test.');
  }
  const apiKey = requiredString(environment.RESEND_API_KEY, 'RESEND_API_KEY');
  const fromEmail = validateSenderEmail(environment.EMAIL_FROM);
  const fromName = validateSenderName(environment.EMAIL_FROM_NAME);
  return createResendDelivery({ apiKey, fromEmail, fromName }, options);
}

function safeDeliveryFailureCategory(error) {
  return SAFE_FAILURE_CATEGORIES.has(error?.category) ? error.category : 'unknown';
}

module.exports = {
  DELIVERY_TIMEOUT_MS,
  EmailDeliveryError,
  RESEND_ENDPOINT,
  createPasswordResetDeliveryFromEnv,
  createResetEmailContent,
  createResendDelivery,
  safeDeliveryFailureCategory,
};

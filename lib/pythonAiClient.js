const { AiContractError, validateInternalAiResponse } = require('./aiContracts');

const DEFAULT_AI_SERVICE_URL = 'http://127.0.0.1:8000';
const DEFAULT_AI_TIMEOUT_MS = 15000;
const MIN_AI_TIMEOUT_MS = 5000;
const MAX_AI_TIMEOUT_MS = 65000;
const DEFAULT_PYTHON_OPERATION_TIMEOUT_SECONDS = 12;
const MIN_TIMEOUT_MARGIN_MS = 1000;
const MAX_AI_UPSTREAM_BODY_BYTES = 32 * 1024;

class PythonAiError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PythonAiError';
    this.code = code;
  }
}

async function readBoundedJson(response) {
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined &&
      (!/^\d+$/.test(declared) || Number(declared) > MAX_AI_UPSTREAM_BODY_BYTES)) {
    throw new PythonAiError('invalid_upstream_response');
  }
  if (!response.body?.getReader) {
    throw new PythonAiError('invalid_upstream_response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_AI_UPSTREAM_BODY_BYTES) {
        await reader.cancel();
        throw new PythonAiError('invalid_upstream_response');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PythonAiError('invalid_upstream_response'); }
}

function aiServiceBaseUrl(value = process.env.PYTHON_AI_SERVICE_URL || process.env.PYTHON_SERVICE_URL || DEFAULT_AI_SERVICE_URL) {
  let url;
  try { url = new URL(value); } catch { throw new PythonAiError('upstream_unavailable'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new PythonAiError('upstream_unavailable');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

function pythonOperationTimeoutMs(value) {
  const configured = value === undefined || value === '' ? DEFAULT_PYTHON_OPERATION_TIMEOUT_SECONDS : Number(value);
  if (!Number.isFinite(configured) || configured < 0.1 || configured > 60) {
    throw new PythonAiError('upstream_unavailable');
  }
  return configured * 1000;
}

function validateTimeoutOrdering(timeout, operationTimeoutMs = pythonOperationTimeoutMs()) {
  if (!Number.isInteger(timeout) || timeout < MIN_AI_TIMEOUT_MS || timeout > MAX_AI_TIMEOUT_MS ||
      !Number.isFinite(operationTimeoutMs) || timeout - operationTimeoutMs < MIN_TIMEOUT_MARGIN_MS) {
    throw new PythonAiError('upstream_unavailable');
  }
  return timeout;
}

function aiTimeoutMs(value = process.env.PYTHON_AI_TIMEOUT_MS, operationTimeoutMs = pythonOperationTimeoutMs()) {
  if (value === undefined || value === '') return validateTimeoutOrdering(DEFAULT_AI_TIMEOUT_MS, operationTimeoutMs);
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new PythonAiError('upstream_unavailable');
  return validateTimeoutOrdering(Number(value), operationTimeoutMs);
}

async function requestMenuAssistant(internalRequest, {
  signal, baseUrl, timeoutMs, fetchImpl = fetch,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let deadline;
  try {
    const configuredTimeout = timeoutMs === undefined ? aiTimeoutMs() : validateTimeoutOrdering(timeoutMs);
    deadline = setTimeoutImpl(() => { timedOut = true; controller.abort(); }, configuredTimeout);
    let response;
    try {
      response = await fetchImpl(new URL('ai/menu-assistant', aiServiceBaseUrl(baseUrl)), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(internalRequest),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof PythonAiError) throw error;
      throw new PythonAiError(timedOut ? 'upstream_timeout' : 'upstream_unavailable');
    }
    if (!response.ok) {
      if (response.status === 400) throw new PythonAiError('invalid_request');
      if (response.status === 504) throw new PythonAiError('upstream_timeout');
      if (response.status === 503) {
        try {
          const value = await readBoundedJson(response);
          if (value && !Array.isArray(value) && typeof value === 'object' &&
              Object.keys(value).length === 1 && value.detail === 'ai_runtime_unavailable') {
            throw new PythonAiError('ai_runtime_unavailable');
          }
        } catch (error) {
          if (error instanceof PythonAiError) throw error;
        }
      }
      throw new PythonAiError('upstream_unavailable');
    }
    const value = await readBoundedJson(response);
    try {
      return validateInternalAiResponse(value);
    } catch (error) {
      if (error instanceof AiContractError) throw new PythonAiError('invalid_upstream_response');
      throw error;
    }
  } finally {
    if (deadline) clearTimeoutImpl(deadline);
    signal?.removeEventListener('abort', onAbort);
  }
}

module.exports = {
  DEFAULT_AI_SERVICE_URL, DEFAULT_AI_TIMEOUT_MS, DEFAULT_PYTHON_OPERATION_TIMEOUT_SECONDS,
  MAX_AI_UPSTREAM_BODY_BYTES,
  MIN_AI_TIMEOUT_MS, MAX_AI_TIMEOUT_MS, MIN_TIMEOUT_MARGIN_MS,
  PythonAiError, aiServiceBaseUrl, aiTimeoutMs, pythonOperationTimeoutMs,
  readBoundedJson, requestMenuAssistant, validateTimeoutOrdering,
};

import http from 'node:http';
import https from 'node:https';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';

const log = logger.createRequestLogger();

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/**
 * Fetch-like wrapper around node:http/node:https for sidecar calls.
 *
 * Bypasses Node.js 20's bundled undici which has a hardcoded 5-minute
 * headersTimeout that cannot be overridden.
 *
 * @param {string} path - Relative path starting with / (e.g. '/v1/dip/run')
 * @param {Object} [options]
 * @param {string} [options.method='GET']
 * @param {Object} [options.headers]
 * @param {string|Buffer} [options.body]
 * @param {number} [options.timeout=300000] - Timeout in ms (default 5 min)
 * @param {AbortSignal} [options.signal] - External abort signal (e.g. client disconnect)
 * @returns {Promise<{ok: boolean, status: number, statusText: string, json: Function, text: Function, body: import('http').IncomingMessage}>}
 */
export function sidecarFetch(path, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT_MS,
    signal
  } = options;

  if (!path.startsWith('/')) {
    throw new Error(`sidecarFetch: path must start with /, got: ${path}`);
  }

  const baseUrl = (getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000').replace(/\/$/, '');
  const fullUrl = baseUrl + path;
  const parsed = new URL(fullUrl);
  const transport = parsed.protocol === 'https:' ? https : http;

  const reqHeaders = { ...headers };
  if (body && !reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
    if (typeof body === 'string') {
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    } else if (Buffer.isBuffer(body)) {
      reqHeaders['Content-Length'] = body.length;
    }
  }

  return new Promise((resolve, reject) => {
    // If already aborted before we start, bail immediately
    if (signal?.aborted) {
      return reject(new Error('Aborted'));
    }

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout
      },
      (res) => {
        const response = {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          body: res,

          json() {
            return collectBody(res).then((buf) => JSON.parse(buf.toString()));
          },

          text() {
            return collectBody(res).then((buf) => buf.toString());
          }
        };

        resolve(response);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const secs = Math.round(timeout / 1000);
      const err = new Error(`Sidecar request timed out after ${secs}s: ${method} ${path}`);
      err.code = 'SIDECAR_TIMEOUT';
      log.error('Sidecar timeout', { method, path, timeoutMs: timeout });
      reject(err);
    });

    req.on('error', (err) => {
      const wrapped = wrapError(err, method, path, fullUrl);
      log.error('Sidecar request error', { method, path, code: err.code, message: err.message });
      reject(wrapped);
    });

    // External abort signal support
    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // Clean up listener when request completes
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    if (body) {
      req.end(body);
    } else {
      req.end();
    }
  });
}

/**
 * Collect a readable stream into a single Buffer.
 */
function collectBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Wrap connection-level errors with clear messages.
 */
function wrapError(err, method, path, fullUrl) {
  const map = {
    ECONNREFUSED: `Sidecar unavailable (connection refused): ${fullUrl}`,
    ECONNRESET: `Sidecar connection reset: ${fullUrl}`,
    ENOTFOUND: `Sidecar DNS lookup failed: ${fullUrl}`,
    ETIMEDOUT: `Sidecar connection timed out: ${fullUrl}`
  };

  const message = map[err.code];
  if (message) {
    const wrapped = new Error(message);
    wrapped.code = err.code;
    wrapped.cause = err;
    return wrapped;
  }

  return err;
}

export default sidecarFetch;

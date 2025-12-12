import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import { errorHandler, notFoundHandler, methodNotAllowed } from '../../../src/middleware/error.js';
import { ERR } from '../../../src/constants/errorCodes.js';

// Mock request/response helpers
function createMockReq(overrides = {}) {
  return {
    url: '/test',
    method: 'GET',
    body: null,
    query: {},
    params: {},
    get: (header) => {
      const headers = { 'user-agent': 'test-agent' };
      return headers[header.toLowerCase()];
    },
    requestLogger: {
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {}
    },
    ...overrides
  };
}

function createMockRes(overrides = {}) {
  const res = {
    headersSent: false,
    statusCode: null,
    jsonBody: null,
    locals: { requestId: 'req_test123' },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
    ...overrides
  };
  return res;
}

// ============================================================
// errorHandler tests
// ============================================================

describe('errorHandler middleware', () => {

  test('returns early if headers already sent', () => {
    const req = createMockReq();
    const res = createMockRes({ headersSent: true });
    let nextCalled = false;
    const next = (err) => { nextCalled = true; };
    const err = new Error('test');

    errorHandler(err, req, res, next);

    assert.strictEqual(nextCalled, true, 'should call next() when headers sent');
    assert.strictEqual(res.statusCode, null, 'should not set status');
  });

  // ----------------------------------------------------------
  // Zod validation errors (400)
  // ----------------------------------------------------------

  test('handles Zod validation errors with 400 status', () => {
    const schema = z.object({ name: z.string() });
    let zodError;
    try {
      schema.parse({ name: 123 });
    } catch (e) {
      zodError = e;
    }

    const req = createMockReq({ body: { name: 123 } });
    const res = createMockRes();
    const next = () => {};

    errorHandler(zodError, req, res, next);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.data, null);
    assert.strictEqual(res.jsonBody.error.code, ERR.BAD_REQUEST);
    assert.strictEqual(res.jsonBody.error.message, 'Validation failed');
    assert.ok(Array.isArray(res.jsonBody.error.details), 'should include Zod issues array');
    assert.strictEqual(res.jsonBody.requestId, 'req_test123');
  });

  test('Zod error includes issue details', () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().min(0)
    });
    let zodError;
    try {
      schema.parse({ email: 'not-email', age: -5 });
    } catch (e) {
      zodError = e;
    }

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(zodError, req, res, next);

    assert.strictEqual(res.jsonBody.error.details.length, 2, 'should have 2 validation issues');
  });

  // ----------------------------------------------------------
  // Service unavailable errors (503)
  // ----------------------------------------------------------

  test('handles SUPABASE_DISABLED with 503 status', () => {
    const err = new Error('Supabase is disabled');
    err.code = ERR.SUPABASE_DISABLED;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.error.code, ERR.SUPABASE_DISABLED);
    assert.strictEqual(res.jsonBody.error.details.service, 'supabase');
    assert.strictEqual(res.jsonBody.requestId, 'req_test123');
  });

  test('handles PINECONE_DISABLED with 503 status', () => {
    const err = new Error('Pinecone is disabled');
    err.code = ERR.PINECONE_DISABLED;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonBody.error.code, ERR.PINECONE_DISABLED);
    assert.strictEqual(res.jsonBody.error.details.service, 'pinecone');
  });

  test('handles OPENAI_DISABLED with 503 status', () => {
    const err = new Error('OpenAI is disabled');
    err.code = ERR.OPENAI_DISABLED;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonBody.error.code, ERR.OPENAI_DISABLED);
    assert.strictEqual(res.jsonBody.error.details.service, 'openai');
  });

  test('handles SIDECAR_DISABLED with 503 status', () => {
    const err = new Error('Sidecar is disabled');
    err.code = ERR.SIDECAR_DISABLED;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonBody.error.code, ERR.SIDECAR_DISABLED);
    assert.strictEqual(res.jsonBody.error.details.service, 'sidecar');
  });

  // ----------------------------------------------------------
  // Not found errors (404)
  // ----------------------------------------------------------

  test('handles NOT_FOUND error code with 404 status', () => {
    const err = new Error('Document not found');
    err.code = ERR.NOT_FOUND;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.error.code, ERR.NOT_FOUND);
    assert.strictEqual(res.jsonBody.error.message, 'Document not found');
  });

  test('handles error with status 404', () => {
    const err = new Error('Resource not found');
    err.status = 404;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.jsonBody.error.code, ERR.NOT_FOUND);
  });

  // ----------------------------------------------------------
  // Generic errors (400, 500)
  // ----------------------------------------------------------

  test('handles generic 400 error', () => {
    const err = new Error('Invalid input');
    err.status = 400;

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.jsonBody.error.code, ERR.BAD_REQUEST);
    assert.strictEqual(res.jsonBody.error.message, 'Invalid input');
  });

  test('handles generic 500 error', () => {
    const err = new Error('Something went wrong');

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.error.code, ERR.INTERNAL);
    assert.strictEqual(res.jsonBody.error.message, 'Something went wrong');
    assert.strictEqual(res.jsonBody.requestId, 'req_test123');
  });

  test('defaults to 500 when no status provided', () => {
    const err = new Error('Unknown error');

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.jsonBody.error.code, ERR.INTERNAL);
  });

  test('includes error message for debugging (your decision: always show)', () => {
    const err = new Error('Detailed internal error info');

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    // Per your decision: always on the side of debugging
    assert.strictEqual(res.jsonBody.error.message, 'Detailed internal error info');
  });

  // ----------------------------------------------------------
  // Response envelope structure
  // ----------------------------------------------------------

  test('always includes success, data, error, requestId in response', () => {
    const err = new Error('Test');

    const req = createMockReq();
    const res = createMockRes();
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.ok('success' in res.jsonBody, 'should have success field');
    assert.ok('data' in res.jsonBody, 'should have data field');
    assert.ok('error' in res.jsonBody, 'should have error field');
    assert.ok('requestId' in res.jsonBody, 'should have requestId field');
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.data, null);
  });

  test('handles missing requestId gracefully', () => {
    const err = new Error('Test');

    const req = createMockReq();
    const res = createMockRes({ locals: {} });
    const next = () => {};

    errorHandler(err, req, res, next);

    assert.strictEqual(res.jsonBody.requestId, null);
  });

  // ----------------------------------------------------------
  // Logging behavior
  // ----------------------------------------------------------

  test('logs 500 errors with full context', () => {
    let loggedContext = null;
    const req = createMockReq({
      url: '/api/chat',
      method: 'POST',
      body: { message: 'test', threadId: 'thread_123' },
      query: { debug: 'true' },
      requestLogger: {
        warn: () => {},
        error: (msg, ctx) => { loggedContext = ctx; },
        info: () => {},
        debug: () => {}
      }
    });
    const res = createMockRes();
    const next = () => {};

    const err = new Error('Database connection failed');
    err.stack = 'Error: Database connection failed\n    at test.js:1:1';

    errorHandler(err, req, res, next);

    assert.ok(loggedContext, 'should have logged error context');
    assert.strictEqual(loggedContext.error, 'Database connection failed');
    assert.ok(loggedContext.stack, 'should include stack trace');
    assert.strictEqual(loggedContext.url, '/api/chat');
    assert.strictEqual(loggedContext.method, 'POST');
    assert.strictEqual(loggedContext.threadId, 'thread_123');
  });

  test('does not log 400 errors as error level', () => {
    let errorCalled = false;
    const req = createMockReq({
      requestLogger: {
        warn: () => {},
        error: () => { errorCalled = true; },
        info: () => {},
        debug: () => {}
      }
    });
    const res = createMockRes();
    const next = () => {};

    const err = new Error('Bad request');
    err.status = 400;

    errorHandler(err, req, res, next);

    assert.strictEqual(errorCalled, false, '400 errors should not call error logger');
  });
});

// ============================================================
// notFoundHandler tests
// ============================================================

describe('notFoundHandler middleware', () => {

  test('returns 404 with correct envelope', () => {
    const req = createMockReq();
    const res = createMockRes();

    notFoundHandler(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.data, null);
    assert.strictEqual(res.jsonBody.error.code, ERR.NOT_FOUND);
    assert.strictEqual(res.jsonBody.error.message, 'Route not found');
    assert.strictEqual(res.jsonBody.requestId, 'req_test123');
  });
});

// ============================================================
// methodNotAllowed tests
// ============================================================

describe('methodNotAllowed middleware', () => {

  test('returns 405 with allowed methods', () => {
    const middleware = methodNotAllowed(['GET', 'POST']);
    const req = createMockReq({ method: 'DELETE', url: '/api/resource' });
    const res = createMockRes();

    middleware(req, res);

    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.jsonBody.success, false);
    assert.strictEqual(res.jsonBody.error.code, ERR.METHOD_NOT_ALLOWED);
    assert.strictEqual(res.jsonBody.error.message, 'DELETE method not allowed for /api/resource');
    assert.deepStrictEqual(res.jsonBody.error.details.allowedMethods, ['GET', 'POST']);
  });

  test('works with empty allowed methods array', () => {
    const middleware = methodNotAllowed([]);
    const req = createMockReq({ method: 'PUT', url: '/readonly' });
    const res = createMockRes();

    middleware(req, res);

    assert.strictEqual(res.statusCode, 405);
    assert.deepStrictEqual(res.jsonBody.error.details.allowedMethods, []);
  });

  test('works with default (no args)', () => {
    const middleware = methodNotAllowed();
    const req = createMockReq();
    const res = createMockRes();

    middleware(req, res);

    assert.strictEqual(res.statusCode, 405);
    assert.deepStrictEqual(res.jsonBody.error.details.allowedMethods, []);
  });
});

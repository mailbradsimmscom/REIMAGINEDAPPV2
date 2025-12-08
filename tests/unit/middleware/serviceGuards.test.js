// tests/unit/middleware/serviceGuards.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  requireSupabase,
  requireOpenAI,
  requirePinecone,
  requireSidecar,
  requireServices
} from '../../../src/middleware/serviceGuards.js';
import { resetEnvMemo, setTestEnv } from '../../../src/config/env.js';

test('Service Guard Middleware', async (t) => {

  // Reset env memo before each test for clean state
  t.beforeEach(() => {
    resetEnvMemo();
  });

  await t.test('requireSupabase - calls next() when Supabase is configured', () => {
    // Set up test environment
    setTestEnv({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-service-key'
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireSupabase();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, undefined);
  });

  await t.test('requireSupabase - calls next(error) when Supabase is not configured', () => {
    // Clear Supabase environment variables
    setTestEnv({
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_SERVICE_ROLE: undefined,
      SERVICE_ROLE_KEY: undefined
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireSupabase();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError.code, 'SUPABASE_DISABLED');
    assert.strictEqual(nextError.message, 'Supabase not configured');
  });

  await t.test('requireOpenAI - calls next() when OpenAI is configured', () => {
    // Set up test environment
    setTestEnv({
      OPENAI_API_KEY: 'test-openai-key'
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireOpenAI();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, undefined);
  });

  await t.test('requireOpenAI - calls next(error) when OpenAI is not configured', () => {
    // Clear OpenAI environment variables
    setTestEnv({
      OPENAI_API_KEY: undefined
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireOpenAI();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError.code, 'OPENAI_DISABLED');
    assert.strictEqual(nextError.message, 'OpenAI not configured');
  });

  await t.test('requirePinecone - calls next() when Pinecone is configured', () => {
    // Set up test environment
    setTestEnv({
      PYTHON_SIDECAR_URL: 'http://localhost:8000'
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requirePinecone();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, undefined);
  });

  await t.test('requirePinecone - calls next(error) when Pinecone is not configured', () => {
    // Clear Pinecone environment variables
    setTestEnv({
      PYTHON_SIDECAR_URL: undefined
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requirePinecone();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError.code, 'PINECONE_DISABLED');
    assert.strictEqual(nextError.message, 'Pinecone not configured');
  });

  await t.test('requireSidecar - calls next() when Sidecar is configured', () => {
    // Set up test environment
    setTestEnv({
      PYTHON_SIDECAR_URL: 'http://localhost:8000'
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireSidecar();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, undefined);
  });

  await t.test('requireSidecar - calls next(error) when Sidecar is not configured', () => {
    // Clear Sidecar environment variables
    setTestEnv({
      PYTHON_SIDECAR_URL: undefined
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireSidecar();
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError.code, 'SIDECAR_DISABLED');
    assert.strictEqual(nextError.message, 'Python sidecar not configured');
  });

  await t.test('requireServices - calls next() when all services are configured', () => {
    // Set up test environment
    setTestEnv({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-service-key',
      OPENAI_API_KEY: 'test-openai-key',
      PYTHON_SIDECAR_URL: 'http://localhost:8000'
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireServices(['supabase', 'openai', 'sidecar']);
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError, undefined);
  });

  await t.test('requireServices - calls next(error) when some services are not configured', () => {
    // Set up partial test environment - only Supabase configured
    setTestEnv({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-service-key',
      OPENAI_API_KEY: undefined,
      PYTHON_SIDECAR_URL: undefined
    });

    const req = {};
    const res = {};
    let nextCalled = false;
    let nextError = null;

    const next = (error) => {
      nextCalled = true;
      nextError = error;
    };

    const middleware = requireServices(['supabase', 'openai', 'sidecar']);
    middleware(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(nextError.code, 'OPENAI_DISABLED');
    assert(nextError.message.includes('Required services not configured'));
    assert(nextError.disabledServices.includes('OPENAI_DISABLED'));
    assert(nextError.disabledServices.includes('SIDECAR_DISABLED'));
  });

  // Cleanup after all tests
  await t.test('cleanup - reset env memo', () => {
    resetEnvMemo();
  });
});

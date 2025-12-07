// tests/mocks/http-interceptor.js
//
// Mock fetch() for unit tests that need to intercept HTTP calls.
// Use this to avoid hitting real external services (OpenAI, Pinecone, etc.)

/**
 * Mock global fetch with pattern-based responses.
 *
 * @param {Object} responses - Map of URL patterns to responses
 * @returns {Function} Cleanup function to restore original fetch
 *
 * @example
 * import { mockFetch } from '../mocks/http-interceptor.js';
 *
 * test('handles API response', async (t) => {
 *   const cleanup = mockFetch({
 *     'api.openai.com': {
 *       status: 200,
 *       body: { choices: [{ message: { content: 'Hello' } }] }
 *     },
 *     'pinecone.io/query': {
 *       status: 200,
 *       body: { matches: [] }
 *     }
 *   });
 *
 *   t.after(cleanup);  // Restore original fetch after test
 *
 *   // Your test code here - fetch calls matching patterns will be mocked
 * });
 */
export function mockFetch(responses = {}) {
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    const urlString = url.toString();

    // Check each pattern for a match
    for (const [pattern, response] of Object.entries(responses)) {
      if (urlString.includes(pattern)) {
        // Support function responses for dynamic mocking
        const resolvedResponse = typeof response === 'function'
          ? await response(url, options)
          : response;

        return new Response(JSON.stringify(resolvedResponse.body), {
          status: resolvedResponse.status || 200,
          headers: {
            'Content-Type': 'application/json',
            ...resolvedResponse.headers
          }
        });
      }
    }

    // No match - call original fetch (or throw if strict mode)
    return originalFetch(url, options);
  };

  // Return cleanup function
  return () => {
    global.fetch = originalFetch;
  };
}

/**
 * Create a mock fetch that throws for unmatched requests.
 * Use this when you want to ensure ALL external calls are mocked.
 *
 * @param {Object} responses - Map of URL patterns to responses
 * @returns {Function} Cleanup function
 */
export function mockFetchStrict(responses = {}) {
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    const urlString = url.toString();

    for (const [pattern, response] of Object.entries(responses)) {
      if (urlString.includes(pattern)) {
        const resolvedResponse = typeof response === 'function'
          ? await response(url, options)
          : response;

        return new Response(JSON.stringify(resolvedResponse.body), {
          status: resolvedResponse.status || 200,
          headers: {
            'Content-Type': 'application/json',
            ...resolvedResponse.headers
          }
        });
      }
    }

    // Strict mode - throw if no match
    throw new Error(`mockFetchStrict: No mock defined for ${urlString}`);
  };

  return () => {
    global.fetch = originalFetch;
  };
}

/**
 * Create a mock that records all fetch calls for assertions.
 *
 * @param {Object} responses - Map of URL patterns to responses
 * @returns {{ cleanup: Function, calls: Array }} Cleanup function and recorded calls
 *
 * @example
 * const { cleanup, calls } = mockFetchWithHistory({
 *   'api.openai.com': { body: { result: 'ok' } }
 * });
 *
 * await myFunction();
 *
 * assert.strictEqual(calls.length, 1);
 * assert.ok(calls[0].url.includes('openai'));
 *
 * cleanup();
 */
export function mockFetchWithHistory(responses = {}) {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const urlString = url.toString();
    calls.push({ url: urlString, options, timestamp: Date.now() });

    for (const [pattern, response] of Object.entries(responses)) {
      if (urlString.includes(pattern)) {
        const resolvedResponse = typeof response === 'function'
          ? await response(url, options)
          : response;

        return new Response(JSON.stringify(resolvedResponse.body), {
          status: resolvedResponse.status || 200,
          headers: {
            'Content-Type': 'application/json',
            ...resolvedResponse.headers
          }
        });
      }
    }

    return originalFetch(url, options);
  };

  return {
    cleanup: () => { global.fetch = originalFetch; },
    calls
  };
}

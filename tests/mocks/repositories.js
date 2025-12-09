// tests/mocks/repositories.js
// Uses Node.js test runner's t.mock.method() for proper ES module mocking

/**
 * Mock methods on repository/service default exports
 * @param {object} t - Test context from node:test
 * @param {object} stubs - Map of module path to method stubs
 *   Key: relative path from src/ (e.g., 'repositories/pinecone.repository.js')
 *   Value: object mapping method names to mock implementations
 */
export async function mockRepositories(t, stubs = {}) {
  for (const [modulePath, methods] of Object.entries(stubs)) {
    // Import the module to get its default export (the instance)
    const mod = await import(`../../src/${modulePath}`);
    const instance = mod.default;

    if (!instance || typeof instance !== 'object') {
      throw new Error(`Module ${modulePath} does not have a valid default export`);
    }

    // Mock each method using t.mock.method
    for (const [methodName, mockImpl] of Object.entries(methods)) {
      if (typeof instance[methodName] !== 'function') {
        throw new Error(`Method ${methodName} does not exist on ${modulePath}`);
      }
      t.mock.method(instance, methodName, mockImpl);
    }
  }
}

/**
 * Mock methods on services (convenience wrapper)
 */
export async function mockServices(t, stubs = {}) {
  const prefixedStubs = {};
  for (const [k, v] of Object.entries(stubs)) {
    prefixedStubs[`services/${k}`] = v;
  }
  return mockRepositories(t, prefixedStubs);
}

// Convenience function for common mocks
export async function mockCommonServices(t) {
  return mockServices(t, {
    'pinecone.service.js': {
      searchDocuments: async () => ({
        success: true,
        results: [],
        metadata: { totalResults: 0 }
      }),
      getIndexStatistics: async () => ({
        totalVectors: 0,
        dimension: 1536,
        indexFullness: 0
      }),
      getDocumentChunks: async () => []
    }
  });
}

// tests/mocks/repositories.js
export async function mockRepositories(t, stubs = {}) {
  const orig = {};
  
  for (const [k, v] of Object.entries(stubs)) {
    orig[k] = await import(`../../src/repositories/${k}`);
    for (const fn of Object.keys(v)) {
      const origFn = orig[k][fn];
      orig[k][fn] = v[fn];             // mutate export for tests
      t.after(() => { orig[k][fn] = origFn; });
    }
  }
}

// Convenience function for common mocks
export async function mockCommonServices(t) {
  return mockRepositories(t, {
    'pinecone.repository.js': {
      searchDocuments: async () => ({ results: [] }),
      getIndexStatistics: async () => ({ totalVectorCount: 0 }),
      getDocumentChunks: async () => ({ chunks: [] })
    }
  });
}

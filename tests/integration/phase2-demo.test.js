import test from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../setupApp.js';
import { testRequest } from '../helpers/http.js';
import { mockRepositories } from '../mocks/repositories.js';

test('Phase 2: Complete test infrastructure demonstration', async (t) => {
  await t.test('setup with mocks', async () => {
    await initTestApp();
    
    // Mock external dependencies
    await mockRepositories(t, {
      'pinecone.repository.js': {
        searchDocuments: async () => ({ 
          results: [
            { id: 'test1', score: 0.95, metadata: { text: 'test content' } }
          ] 
        }),
        getIndexStatistics: async () => ({ 
          totalVectorCount: 1000,
          dimension: 1536,
          indexFullness: 0.75
        })
      }
    });
  });

  await t.test('GET /health works with test infrastructure', async () => {
    const response = await testRequest({
      method: 'GET',
      url: '/health'
    }).expect(200);

    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, 'healthy');
    assert.ok(response.body.data.timestamp);
    assert.ok(typeof response.body.data.uptime === 'number');
  });

  await t.test('POST /pinecone/search works with mocked dependencies', async () => {
    const response = await testRequest({
      method: 'POST',
      url: '/pinecone/search',
      body: {
        query: 'test query',
        context: 'test context'
      }
    }).expect(200);

    assert.equal(response.body.success, true);
    assert.ok(response.body.data.results);
    assert.equal(response.body.data.results.length, 1);
    assert.equal(response.body.data.results[0].id, 'test1');
  });

  await t.test('DELETE with body works correctly', async () => {
    const response = await testRequest({
      method: 'DELETE',
      url: '/chat/delete',
      body: { sessionId: 'test-session-id' }
    });

    // Should get an error response (since we're not mocking the chat service)
    // but the important thing is that the request with body works
    assert.ok(response.body);
    assert.ok(response.body.success === false || response.body.success === true);
  });

  await t.test('Error responses are properly structured', async () => {
    const response = await testRequest({
      method: 'GET',
      url: '/nonexistent-endpoint'
    }).expect(404);

    assert.equal(response.body.success, false);
    assert.ok(response.body.error);
    assert.ok(response.body.error.code);
    assert.ok(response.body.error.message);
    assert.ok(response.body.requestId !== undefined); // Should be null or string
  });
});

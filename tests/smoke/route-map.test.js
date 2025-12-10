import { test } from 'node:test';
import assert from 'node:assert';

// Helper to wait for server to be ready
async function waitForServer(maxWait = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch('http://localhost:3000/health');
      if (response.ok) return true;
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

test('Route map - /__routes endpoint returns expected routes', async (t) => {
  await t.test('Route map contains expected routes', async () => {
    // Start server in background
    const { spawn } = await import('node:child_process');
    const server = spawn('node', ['src/start.js'], {
      env: { 
        ...process.env, 
        NODE_ENV: 'development',
        ENABLE_ROUTE_DEBUG: '1'  // Explicitly set for route introspection
      },
      stdio: 'pipe'
    });

    // Wait for server to be ready (with health check)
    const isReady = await waitForServer(15000);
    if (!isReady) {
      server.kill();
      throw new Error('Server did not start within 15 seconds');
    }
    
    try {
      // Test route map endpoint
      const response = await fetch('http://localhost:3000/__routes');
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.data.routes));
      assert.ok(data.data.routes.length > 0);
      
      // Check for key routes
      const routes = data.data.routes;
      const routePaths = routes.map(r => r.path);
      
      // Essential routes should be present
      assert.ok(routePaths.includes('/health'), 'Health route missing');
      assert.ok(routePaths.includes('/systems'), 'Systems route missing');
      assert.ok(routePaths.includes('/chat/enhanced'), 'Chat enhanced route missing');
      assert.ok(routePaths.includes('/pinecone/stats'), 'Pinecone stats route missing');
      assert.ok(routePaths.includes('/__routes'), 'Route map endpoint missing');
      
      // Check route structure
      routes.forEach(route => {
        assert.ok(typeof route.path === 'string', 'Route path should be string');
        assert.ok(Array.isArray(route.methods), 'Route methods should be array');
        assert.ok(typeof route.middleware === 'number', 'Route middleware should be number');
      });
      
    } finally {
      // Clean up
      server.kill();
    }
  });
});

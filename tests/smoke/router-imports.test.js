import { test } from 'node:test';
import assert from 'node:assert';

const routerFiles = [
  '../../src/routes/health.router.js',
  '../../src/routes/systems.router.js',
  '../../src/routes/chat/index.js',
  '../../src/routes/document/index.js',
  '../../src/routes/pinecone.router.js',
  '../../src/routes/admin/index.js'
];

test('Router imports - all files load without errors', async (t) => {
  for (const file of routerFiles) {
    await t.test(`Import ${file}`, async () => {
      const module = await import(file);
      assert.ok(module.default || module, 'Module should export something');
    });
  }
});

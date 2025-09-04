import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { get } from '../../helpers/request.js';

test('Debug Supertest directly', async () => {
  // Test direct Supertest usage
  const app = await import('../../../src/index.js');
  const req = request(app.default).get('/health');
  console.log('Direct Supertest request type:', typeof req);
  console.log('Direct Supertest has expect:', typeof req.expect === 'function');
  console.log('Direct Supertest keys:', Object.keys(req).slice(0, 5));
  
  // Test our helper
  const helperReq = await get('/health');
  console.log('Helper request type:', typeof helperReq);
  console.log('Helper has expect:', typeof helperReq.expect === 'function');
  console.log('Helper keys:', Object.keys(helperReq).slice(0, 5));
});

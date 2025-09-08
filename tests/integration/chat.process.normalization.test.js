import request from 'supertest';
import { createApp } from '../../helpers/setupApp.js';
import { strict as assert } from 'node:assert';

describe('chat process uses normalized input', () => {
  let app;
  
  before(async () => { 
    app = await createApp(); 
  });

  it('should resolve "tell me abouy my BBQ"', async () => {
    const res = await request(app)
      .post('/chat/enhanced/process')
      .send({
        sessionId: '00000000-0000-0000-0000-000000000001',
        threadId: '00000000-0000-0000-0000-000000000001',
        message: 'tell me abouy my BBQ'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data);
    
    // Should have systems context for BBQ/Kenyon grill
    assert.ok(res.body.data.systemsContext);
    assert.ok(Array.isArray(res.body.data.systemsContext));
    
    // Should have assistant response
    assert.ok(res.body.data.assistantMessage);
    assert.ok(res.body.data.assistantMessage.content);
  });

  it('should normalize other filler phrases', async () => {
    const res = await request(app)
      .post('/chat/enhanced/process')
      .send({
        sessionId: '00000000-0000-0000-0000-000000000002',
        threadId: '00000000-0000-0000-0000-000000000002',
        message: 'how do I change the filter'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body);
    assert.equal(res.body.success, true);
  });

  it('should handle short queries without normalization', async () => {
    const res = await request(app)
      .post('/chat/enhanced/process')
      .send({
        sessionId: '00000000-0000-0000-0000-000000000003',
        threadId: '00000000-0000-0000-0000-000000000003',
        message: 'bbq'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body);
    assert.equal(res.body.success, true);
  });
});

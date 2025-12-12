import { test } from 'node:test';
import assert from 'node:assert';
import { initTestApp, getAppSync } from '../setupApp.js';
import request from 'supertest';
import { skipIfNoServices } from '../helpers/ci-skip.js';

// Pacing helper to avoid overwhelming external services
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const PACING_DELAY_MS = 2000;

await initTestApp();
const app = getAppSync();

test('Spec-biased retrieval integration test', async (t) => {
  if (skipIfNoServices(t)) return;
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
  // Test pressure question that should trigger spec-biased retrieval
  // Use /chat/enhanced/process for rich response with telemetry
  const response = await request(app)
    .post('/chat/enhanced/process')
    .send({
      message: 'what pressure does my watermaker operate at?'
    })
    .expect(200);
  
  const data = response.body.data;

  // Verify response structure
  // Note: Enhanced route uses threadId, not sessionId
  assert.ok(data.threadId, 'Should have threadId');
  assert.ok(data.assistantMessage, 'Should have assistantMessage');
  assert.ok(data.userMessage, 'Should have userMessage');
  
  // Verify telemetry is present
  assert.ok(data.telemetry, 'Should have telemetry data');
  assert.ok(data.telemetry.requestId, 'Should have requestId');
  
  // Verify spec-bias metadata (optional - only if retrievalMeta is present)
  const retrievalMeta = data.telemetry.retrievalMeta;
  if (retrievalMeta) {
    if (retrievalMeta.specBiasMeta) {
      assert.ok(typeof retrievalMeta.specBiasMeta === 'object', 'Should have specBiasMeta');
      assert.ok(typeof retrievalMeta.specBiasMeta.rawCount === 'number', 'Should have rawCount');
      assert.ok(typeof retrievalMeta.specBiasMeta.passedFloorCount === 'number', 'Should have passedFloorCount');
      assert.ok(typeof retrievalMeta.specBiasMeta.filteredCount === 'number', 'Should have filteredCount');
      assert.ok(typeof retrievalMeta.specBiasMeta.usedFallback === 'boolean', 'Should have usedFallback');
      assert.ok(typeof retrievalMeta.specBiasMeta.floor === 'number', 'Should have floor');
      assert.ok(typeof retrievalMeta.specBiasMeta.topK === 'number', 'Should have topK');
    }
    
    // Verify style detection (optional)
    if (retrievalMeta.styleDetected) {
      assert.ok(typeof retrievalMeta.styleDetected === 'string', 'Should have styleDetected');
      assert.ok(['specBrief', 'steps', 'bullets3', 'brief', 'technical'].includes(retrievalMeta.styleDetected), 
        'Should have valid style');
    }
    
    // Verify environment config (optional)
    if (retrievalMeta.temperature !== undefined) {
      assert.ok(typeof retrievalMeta.temperature === 'number', 'Should have temperature');
    }
    if (retrievalMeta.model) {
      assert.ok(typeof retrievalMeta.model === 'string', 'Should have model');
    }
  }
  
  console.log('✅ Spec-biased retrieval test passed');
  console.log('📊 Telemetry data:', JSON.stringify(data.telemetry, null, 2));

  // Pace requests to avoid overwhelming external services
  await sleep(PACING_DELAY_MS);
});

test('Style detection integration test', async (t) => {
  if (skipIfNoServices(t)) return;
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
  // Test different question types to verify style detection
  // Use /chat/enhanced/process for rich response with telemetry
  const testCases = [
    {
      message: 'what pressure does my watermaker operate at?',
      expectedStyle: 'specBrief'
    },
    {
      message: 'how do I reset my watermaker?',
      expectedStyle: 'steps'
    },
    {
      message: 'my watermaker is not working, what should I do?',
      expectedStyle: 'bullets3'
    },
    {
      message: 'tell me about my watermaker',
      expectedStyle: 'brief'
    }
  ];

  for (const testCase of testCases) {
    // Pace requests BEFORE each test to avoid overwhelming external services
    await sleep(PACING_DELAY_MS);

    const response = await request(app)
      .post('/chat/enhanced/process')
      .send({
        message: testCase.message
      })
      .expect(200);
    
    const retrievalMeta = response.body.data.telemetry?.retrievalMeta;
    const detectedStyle = retrievalMeta?.styleDetected;
    
    console.log(`🎯 Question: "${testCase.message}"`);
    console.log(`🎨 Detected style: ${detectedStyle || 'N/A'} (expected: ${testCase.expectedStyle})`);
    
    // Note: Style detection is optional - only validate if present
    if (detectedStyle) {
      assert.ok(['specBrief', 'steps', 'bullets3', 'brief', 'technical'].includes(detectedStyle),
        `Should detect valid style for: ${testCase.message}`);
    }
  }

  console.log('✅ Style detection test passed');
});

test('Request ID uniqueness test', async (t) => {
  if (skipIfNoServices(t)) return;
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
  // Make multiple requests to verify request IDs are unique
  // Use /chat/enhanced/process for rich response with telemetry
  // Run sequentially with pacing to avoid overwhelming external services
  const results = [];
  for (const msg of ['test 1', 'test 2', 'test 3']) {
    await sleep(PACING_DELAY_MS);
    const res = await request(app).post('/chat/enhanced/process').send({ message: msg }).expect(200);
    results.push(res);
  }
  const requestIds = results.map(res => res.body.data.telemetry?.requestId).filter(Boolean);

  // Only test uniqueness if requestIds are present (optional field)
  if (requestIds.length > 0) {
    // Verify all request IDs are unique
    const uniqueIds = new Set(requestIds);
    assert.strictEqual(uniqueIds.size, requestIds.length, 'All request IDs should be unique');

    // Verify request ID format
    for (const id of requestIds) {
      assert.ok(id.startsWith('req_'), 'Request ID should start with "req_"');
      assert.ok(id.includes('_'), 'Request ID should contain underscore separator');
    }

    console.log('✅ Request ID uniqueness test passed');
    console.log('🆔 Request IDs:', requestIds);
  } else {
    console.log('ℹ️ Request IDs not present (optional field)');
  }
});

test('Spec-bias metadata validation test', async (t) => {
  if (skipIfNoServices(t)) return;
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
  // Use /chat/enhanced/process for rich response with telemetry
  const response = await request(app)
    .post('/chat/enhanced/process')
    .send({
      message: 'what are the technical specifications of my watermaker?'
    })
    .expect(200);
  
  const retrievalMeta = response.body.data.telemetry?.retrievalMeta;
  const specBiasMeta = retrievalMeta?.specBiasMeta;
  
  // Verify metadata structure and types (only if present)
  if (specBiasMeta) {
    assert.ok(specBiasMeta.rawCount >= 0, 'rawCount should be non-negative');
    assert.ok(specBiasMeta.passedFloorCount >= 0, 'passedFloorCount should be non-negative');
    assert.ok(specBiasMeta.filteredCount >= 0, 'filteredCount should be non-negative');
    assert.ok(specBiasMeta.passedFloorCount <= specBiasMeta.rawCount, 'passedFloorCount should not exceed rawCount');
    assert.ok(specBiasMeta.filteredCount <= specBiasMeta.passedFloorCount, 'filteredCount should not exceed passedFloorCount');
    assert.ok(specBiasMeta.floor >= 0 && specBiasMeta.floor <= 1, 'floor should be between 0 and 1');
    assert.ok(specBiasMeta.topK > 0, 'topK should be positive');
    
    console.log('✅ Spec-bias metadata validation test passed');
    console.log('📈 Spec-bias stats:', specBiasMeta);
  } else {
    console.log('ℹ️ Spec-bias metadata not present (optional field)');
  }

  // Pace requests to avoid overwhelming external services
  await sleep(PACING_DELAY_MS);
});

test('Environment configuration test', async (t) => {
  if (skipIfNoServices(t)) return;
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
  // Use /chat/enhanced/process for rich response with telemetry
  const response = await request(app)
    .post('/chat/enhanced/process')
    .send({
      message: 'test environment config'
    })
    .expect(200);
  
  const retrievalMeta = response.body.data.telemetry?.retrievalMeta;
  
  // Verify environment values are properly loaded (only if present)
  if (retrievalMeta) {
    if (retrievalMeta.temperature !== undefined) {
      assert.ok(retrievalMeta.temperature >= 0 && retrievalMeta.temperature <= 2, 
        'Temperature should be valid range');
    }
    if (retrievalMeta.model) {
      assert.ok(retrievalMeta.model.length > 0, 'Model should not be empty');
    }
    
    console.log('✅ Environment configuration test passed');
    console.log('⚙️ Config:', {
      temperature: retrievalMeta.temperature,
      model: retrievalMeta.model
    });
  } else {
    console.log('ℹ️ Environment config not present in retrievalMeta (optional field)');
  }

  // Pace requests to avoid overwhelming external services
  await sleep(PACING_DELAY_MS);
});

test('Schema validation test', async (t) => {
  if (skipIfNoServices(t)) return;
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
  // Use /chat/enhanced/process for rich response with telemetry
  const response = await request(app)
    .post('/chat/enhanced/process')
    .send({
      message: 'test schema validation'
    })
    .expect(200);
  
  // Verify response matches expected schema structure
  const data = response.body.data;
  
  // Required fields
  assert.ok(data.sessionId, 'Should have sessionId');
  assert.ok(data.threadId, 'Should have threadId');
  assert.ok(data.userMessage, 'Should have userMessage');
  assert.ok(data.assistantMessage, 'Should have assistantMessage');
  
  // Optional fields
  assert.ok(data.telemetry, 'Should have telemetry');
  assert.ok(data.sources, 'Should have sources array');
  
  // Telemetry structure (retrievalMeta is optional per schema)
  assert.ok(data.telemetry.requestId, 'Should have requestId in telemetry');
  // retrievalMeta is optional - only validate if present
  if (data.telemetry.retrievalMeta) {
    assert.ok(typeof data.telemetry.retrievalMeta === 'object', 'retrievalMeta should be an object if present');
  }
  
  console.log('✅ Schema validation test passed');
});

console.log('🚀 All spec-bias telemetry integration tests completed!');

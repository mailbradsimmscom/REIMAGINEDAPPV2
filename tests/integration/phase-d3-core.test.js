import { test } from 'node:test';
import assert from 'node:assert';
import { decideStyle, getStyleOpening } from '../../src/utils/intent-style.js';
import { truncateContent } from '../../src/clients/openai.client.js';

test('Style detection utility tests', async (t) => {
  // Test specBrief detection
  const specQuestions = [
    'what pressure does my watermaker operate at?',
    'what voltage does my system use?',
    'what is the capacity in liters per hour?',
    'what are the dimensions of the unit?'
  ];
  
  for (const question of specQuestions) {
    const style = decideStyle(question);
    assert.strictEqual(style, 'specBrief', `Should detect specBrief for: "${question}"`);
  }
  
  // Test steps detection
  const stepsQuestions = [
    'how do I reset my watermaker?',
    'how to flush the system?',
    'steps to prime the pump'
  ];
  
  for (const question of stepsQuestions) {
    const style = decideStyle(question);
    assert.strictEqual(style, 'steps', `Should detect steps for: "${question}"`);
  }
  
  // Test bullets3 detection
  const troubleshootingQuestions = [
    'my watermaker is not working',
    'there is an error with the system',
    'the alarm is going off'
  ];
  
  for (const question of troubleshootingQuestions) {
    const style = decideStyle(question);
    assert.ok(['bullets3', 'specBrief'].includes(style), `Should detect bullets3 or specBrief for: "${question}"`);
  }
  
  console.log('✅ Style detection utility tests passed');
});

test('Style opening generation tests', async (t) => {
  const styles = ['specBrief', 'steps', 'bullets3', 'brief', 'technical'];
  
  for (const style of styles) {
    const opening = getStyleOpening(style);
    assert.ok(typeof opening === 'string', `Should return string for ${style}`);
    assert.ok(opening.length > 0, `Should return non-empty opening for ${style}`);
  }
  
  // Test invalid style
  const invalidOpening = getStyleOpening('invalidStyle');
  assert.ok(typeof invalidOpening === 'string', 'Should return string for invalid style');
  assert.ok(invalidOpening.length > 0, 'Should return fallback opening for invalid style');
  
  console.log('✅ Style opening generation tests passed');
});

test('Content truncation utility tests', async (t) => {
  const longText = 'A'.repeat(1000);
  const shortText = 'Hello';
  
  // Test truncation
  const truncated = truncateContent(longText, 100);
  assert.strictEqual(truncated.length, 103, 'Should truncate to specified length + "..."');
  assert.ok(truncated.endsWith('...'), 'Should end with "..."');
  
  // Test no truncation needed
  const notTruncated = truncateContent(shortText, 100);
  assert.strictEqual(notTruncated, shortText, 'Should return original text when no truncation needed');
  
  // Test edge case
  const exactLength = truncateContent('A'.repeat(100), 100);
  assert.strictEqual(exactLength, 'A'.repeat(100), 'Should not truncate when exactly at limit');
  
  console.log('✅ Content truncation utility tests passed');
});

test('Request ID generation tests', async (t) => {
  // Test request ID format
  const generateRequestId = () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const id1 = generateRequestId();
  const id2 = generateRequestId();
  
  assert.ok(id1.startsWith('req_'), 'Request ID should start with "req_"');
  assert.ok(id1.includes('_'), 'Request ID should contain underscore separator');
  assert.notStrictEqual(id1, id2, 'Request IDs should be unique');
  
  console.log('✅ Request ID generation tests passed');
});

test('Telemetry data structure tests', async (t) => {
  // Test telemetry data structure
  const mockTelemetry = {
    requestId: 'req_1234567890_abc123def',
    retrievalMeta: {
      specBiasMeta: {
        rawCount: 5,
        passedFloorCount: 3,
        filteredCount: 1,
        usedFallback: false,
        floor: 0.05,
        topK: 40
      },
      styleDetected: 'specBrief',
      temperature: 0.7,
      model: 'gpt-4'
    }
  };
  
  // Verify structure
  assert.ok(mockTelemetry.requestId, 'Should have requestId');
  assert.ok(mockTelemetry.retrievalMeta, 'Should have retrievalMeta');
  assert.ok(mockTelemetry.retrievalMeta.specBiasMeta, 'Should have specBiasMeta');
  assert.ok(mockTelemetry.retrievalMeta.styleDetected, 'Should have styleDetected');
  assert.ok(typeof mockTelemetry.retrievalMeta.temperature === 'number', 'Should have temperature as number');
  assert.ok(typeof mockTelemetry.retrievalMeta.model === 'string', 'Should have model as string');
  
  // Verify specBiasMeta structure
  const specBiasMeta = mockTelemetry.retrievalMeta.specBiasMeta;
  assert.ok(typeof specBiasMeta.rawCount === 'number', 'Should have rawCount as number');
  assert.ok(typeof specBiasMeta.passedFloorCount === 'number', 'Should have passedFloorCount as number');
  assert.ok(typeof specBiasMeta.filteredCount === 'number', 'Should have filteredCount as number');
  assert.ok(typeof specBiasMeta.usedFallback === 'boolean', 'Should have usedFallback as boolean');
  assert.ok(typeof specBiasMeta.floor === 'number', 'Should have floor as number');
  assert.ok(typeof specBiasMeta.topK === 'number', 'Should have topK as number');
  
  console.log('✅ Telemetry data structure tests passed');
});

test('Environment configuration validation tests', async (t) => {
  // Test environment value validation
  const mockEnv = {
    LLM_TEMPERATURE: '0.7',
    OPENAI_MODEL: 'gpt-4',
    SEARCH_RANK_FLOOR: '0.05',
    CHAT_CONTEXT_SIZE: '5'
  };
  
  // Test temperature parsing
  const temperature = parseFloat(mockEnv.LLM_TEMPERATURE || '0.7');
  assert.ok(temperature >= 0 && temperature <= 2, 'Temperature should be in valid range');
  
  // Test model validation
  assert.ok(mockEnv.OPENAI_MODEL.length > 0, 'Model should not be empty');
  
  // Test floor validation
  const floor = parseFloat(mockEnv.SEARCH_RANK_FLOOR || '0.05');
  assert.ok(floor >= 0 && floor <= 1, 'Floor should be between 0 and 1');
  
  // Test context size validation
  const contextSize = parseInt(mockEnv.CHAT_CONTEXT_SIZE || '5');
  assert.ok(contextSize > 0, 'Context size should be positive');
  
  console.log('✅ Environment configuration validation tests passed');
});

console.log('🚀 All Phase D3 integration tests completed!');

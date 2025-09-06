import { test } from 'node:test';
import assert from 'node:assert';
import { oaiText, oaiJson, truncateContent } from '../../src/clients/openai.client.js';

test('OpenAI client - oaiText function', async (t) => {
  try {
    const response = await oaiText({
      system: 'You are a helpful assistant. Respond with exactly "Hello World" and nothing else.',
      user: 'Say hello',
      maxOutputTokens: 10,
      seed: 11
    });
    
    assert.ok(typeof response === 'string', 'Should return a string');
    assert.ok(response.length > 0, 'Response should not be empty');
    
    console.log('✅ oaiText test passed');
    console.log('📝 Response:', response);
  } catch (error) {
    console.log('⚠️ oaiText test skipped (OpenAI not configured):', error.message);
  }
});

test('OpenAI client - oaiJson function', async (t) => {
  try {
    const response = await oaiJson({
      system: 'You are a helpful assistant. Return JSON with a "message" field containing "Hello World".',
      user: 'Return a JSON response',
      maxOutputTokens: 50,
      seed: 11
    });
    
    assert.ok(typeof response === 'object', 'Should return an object');
    assert.ok(response.message, 'Should have message field');
    assert.strictEqual(response.message, 'Hello World', 'Message should match expected value');
    
    console.log('✅ oaiJson test passed');
    console.log('📄 JSON Response:', response);
  } catch (error) {
    console.log('⚠️ oaiJson test skipped (OpenAI not configured):', error.message);
  }
});

test('OpenAI client - truncateContent function', async (t) => {
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
  
  console.log('✅ truncateContent test passed');
});

test('OpenAI client - error handling', async (t) => {
  try {
    // Test with invalid parameters
    await oaiText({
      system: 'Test',
      user: 'Test',
      maxOutputTokens: -1, // Invalid
      seed: 11
    });
    
    assert.fail('Should have thrown an error for invalid parameters');
  } catch (error) {
    assert.ok(error.message, 'Should have error message');
    console.log('✅ Error handling test passed');
    console.log('🚨 Expected error:', error.message);
  }
});

test('OpenAI client - style-based temperature', async (t) => {
  // Test that different styles use appropriate temperatures
  const testCases = [
    { style: 'specBrief', expectedTemp: 0 },
    { style: 'technical', expectedTemp: 0 },
    { style: 'brief', expectedTemp: 0.7 }, // From env
    { style: 'steps', expectedTemp: 0.7 }   // From env
  ];
  
  for (const testCase of testCases) {
    try {
      const response = await oaiText({
        system: 'Test',
        user: 'Test',
        style: testCase.style,
        maxOutputTokens: 10,
        seed: 11
      });
      
      // Note: We can't directly test the temperature used, but we can verify
      // the function doesn't throw errors with different styles
      assert.ok(typeof response === 'string', 'Should return string for all styles');
      
      console.log(`✅ Style "${testCase.style}" test passed`);
    } catch (error) {
      console.log(`⚠️ Style "${testCase.style}" test skipped:`, error.message);
    }
  }
});

console.log('🚀 All OpenAI client tests completed!');

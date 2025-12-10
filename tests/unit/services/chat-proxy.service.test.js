// tests/unit/services/chat-proxy.service.test.js
//
// Unit tests for chat-proxy.service.js
// Written BEFORE refactoring to catch regressions.

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv, teardownTestEnv } from '../../helpers/env.js';

// ============================================
// TEST: extractKeywords (Pure Function)
// ============================================

describe('extractKeywords', () => {
  let extractKeywords;

  beforeEach(async () => {
    setupTestEnv();
    // Dynamic import to get fresh module
    const module = await import('../../../src/services/chat-proxy.service.js');
    extractKeywords = module.extractKeywords;
  });

  afterEach(() => {
    teardownTestEnv();
  });

  test('extracts meaningful keywords from query', () => {
    const result = extractKeywords('tell me about my Yanmar engine');
    // Should filter out stop words: tell, me, about, my
    assert.ok(result.includes('yanmar'), 'Should include yanmar');
    assert.ok(result.includes('engine'), 'Should include engine');
    assert.ok(!result.includes('tell'), 'Should not include stop word "tell"');
    assert.ok(!result.includes('me'), 'Should not include stop word "me"');
  });

  test('handles null/undefined input', () => {
    assert.strictEqual(extractKeywords(null), '');
    assert.strictEqual(extractKeywords(undefined), '');
  });

  test('handles empty string', () => {
    assert.strictEqual(extractKeywords(''), '');
  });

  test('handles non-string input', () => {
    assert.strictEqual(extractKeywords(123), '');
    assert.strictEqual(extractKeywords({}), '');
  });

  test('removes short words (2 chars or less)', () => {
    const result = extractKeywords('I am at the AC unit');
    // 'I', 'am', 'at' should be filtered (too short or stop words)
    // 'the' is a stop word
    assert.ok(!result.includes(' i '), 'Should not include "i"');
    assert.ok(result.includes('unit'), 'Should include "unit"');
  });

  test('handles special characters', () => {
    const result = extractKeywords('What is the 4JH57 oil capacity?');
    assert.ok(result.includes('4jh57'), 'Should include model number');
    assert.ok(result.includes('oil'), 'Should include oil');
    assert.ok(result.includes('capacity'), 'Should include capacity');
  });

  test('handles hyphenated words', () => {
    const result = extractKeywords('sea-water pump maintenance');
    assert.ok(result.includes('sea-water') || result.includes('sea') || result.includes('water'),
      'Should handle hyphenated words');
    assert.ok(result.includes('pump'), 'Should include pump');
    assert.ok(result.includes('maintenance'), 'Should include maintenance');
  });

  test('converts to lowercase', () => {
    const result = extractKeywords('YANMAR ENGINE OIL');
    assert.ok(result.includes('yanmar'), 'Should be lowercase');
    assert.ok(!result.includes('YANMAR'), 'Should not have uppercase');
  });

  test('preserves equipment model numbers', () => {
    const result = extractKeywords('SD60 generator maintenance');
    assert.ok(result.includes('sd60'), 'Should preserve SD60 model');
    assert.ok(result.includes('generator'), 'Should include generator');
  });
});

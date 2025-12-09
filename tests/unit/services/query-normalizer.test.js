import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeQuery } from '../../../src/services/query-normalizer.js';

test('normalizeQuery strips leading phrases and stop words', () => {
  // The function lowercases, removes stop words, and filters short words
  assert.equal(normalizeQuery('tell me about my BBQ'), 'bbq');
  assert.equal(normalizeQuery('how do I change filter'), 'change filter');
  assert.equal(normalizeQuery('what is the pressure'), 'pressure');
  assert.equal(normalizeQuery('show me the manual'), 'manual');
  assert.equal(normalizeQuery('please help me'), 'help');
  assert.equal(normalizeQuery('can you tell me'), '');
});

test('normalizeQuery keeps short queries unchanged', () => {
  assert.equal(normalizeQuery('bbq'), 'bbq');
  assert.equal(normalizeQuery('pressure'), 'pressure');
  assert.equal(normalizeQuery('filter'), 'filter');
});

test('normalizeQuery handles edge cases', () => {
  assert.equal(normalizeQuery(''), '');
  assert.equal(normalizeQuery('   '), '');
  assert.equal(normalizeQuery(null), '');
  assert.equal(normalizeQuery(undefined), '');
  assert.equal(normalizeQuery(123), '');
});

test('normalizeQuery normalizes whitespace', () => {
  // After stop word removal: 'bbq'
  assert.equal(normalizeQuery('tell me about   my   BBQ'), 'bbq');
  assert.equal(normalizeQuery('  how do I  change filter  '), 'change filter');
});

test('normalizeQuery only strips first matching prefix', () => {
  // After removing prefix and stop words: 'bbq' (all stopwords removed)
  assert.equal(normalizeQuery('tell me about tell me about BBQ'), 'bbq');
});

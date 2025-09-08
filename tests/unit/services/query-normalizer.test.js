import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeQuery } from '../../../src/services/query-normalizer.js';

test('normalizeQuery strips leading phrases', () => {
  assert.equal(normalizeQuery('tell me abouy my BBQ'), 'my BBQ');
  assert.equal(normalizeQuery('how do I change filter'), 'change filter');
  assert.equal(normalizeQuery('what is the pressure'), 'the pressure');
  assert.equal(normalizeQuery('show me the manual'), 'the manual');
  assert.equal(normalizeQuery('please help me'), 'help me');
  assert.equal(normalizeQuery('can you tell me'), 'tell me');
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
  assert.equal(normalizeQuery('tell me about   my   BBQ'), 'my BBQ');
  assert.equal(normalizeQuery('  how do I  change filter  '), 'change filter');
});

test('normalizeQuery only strips first matching prefix', () => {
  assert.equal(normalizeQuery('tell me about tell me about BBQ'), 'tell me about BBQ');
});

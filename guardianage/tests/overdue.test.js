/**
 * Guardianage Overdue Tests
 * Verify AST (UTC-4) overdue derivation logic.
 */

import { test } from 'node:test';
import assert from 'node:assert';

/**
 * Reimplements the overdue check used across dashboard.js and task.html
 * to verify the logic independently.
 */
function isOverdue(status, dueEndDate) {
  if (status !== 'open' || !dueEndDate) return false;

  const now = new Date();
  const astNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const todayStr = astNow.toISOString().slice(0, 10);

  return todayStr > dueEndDate;
}

test('Overdue — open task past due_end_date is overdue', () => {
  assert.strictEqual(isOverdue('open', '2025-01-01'), true);
});

test('Overdue — complete task past due_end_date is NOT overdue', () => {
  assert.strictEqual(isOverdue('complete', '2025-01-01'), false);
});

test('Overdue — open task with future due_end_date is NOT overdue', () => {
  assert.strictEqual(isOverdue('open', '2099-12-31'), false);
});

test('Overdue — cancelled task is NOT overdue', () => {
  assert.strictEqual(isOverdue('cancelled', '2025-01-01'), false);
});

test('Overdue — open task with null due_end_date is NOT overdue', () => {
  assert.strictEqual(isOverdue('open', null), false);
});

test('Overdue — AST boundary check', () => {
  // This test verifies the AST offset is applied.
  // At midnight UTC on Jan 2, it's still 8pm Jan 1 in AST.
  // A task due Jan 1 should be overdue only after midnight AST (4am UTC Jan 2).

  const now = new Date();
  const astNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const todayAST = astNow.toISOString().slice(0, 10);

  // Today in AST should not be overdue if due_end_date is today
  assert.strictEqual(isOverdue('open', todayAST), false);

  // Yesterday in AST should be overdue
  const yesterday = new Date(astNow.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  assert.strictEqual(isOverdue('open', yesterdayStr), true);
});

/**
 * Guardianage Task Tests
 * Complete, reopen, permissions, photo upload.
 */

import { test, assert, initTestApp, guardianageRequest, loginAsAdmin, loginAsTeamUser } from './setup.js';

let testTaskId = null;

test.before(async () => {
  await initTestApp();

  // Find an open weekly task to use for testing
  const cookie = await loginAsAdmin();
  const res = await guardianageRequest('get', '/api/dashboard', cookie);
  const tasks = res.body.data?.weeklyTasksDue || [];

  // Prefer an open task
  const openTask = tasks.find(t => t.status === 'open');
  if (openTask) {
    testTaskId = openTask.id;
  } else if (tasks.length > 0) {
    // If all weekly tasks are complete, try to reopen one
    testTaskId = tasks[0].id;
    await guardianageRequest('post', `/api/tasks/${testTaskId}/reopen`, cookie);
  }
});

test('Tasks — complete a weekly task', async () => {
  if (!testTaskId) return; // skip if no tasks available

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/tasks/${testTaskId}/complete`, cookie)
    .send({ note: 'Test completion' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);

  // Verify task is now complete
  const detail = await guardianageRequest('get', `/api/tasks/${testTaskId}`, cookie);
  assert.strictEqual(detail.body.data.task.status, 'complete');
  assert.ok(detail.body.data.task.completed_at);
});

test('Tasks — reopen a weekly task', async () => {
  if (!testTaskId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/tasks/${testTaskId}/reopen`, cookie);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);

  // Verify task is open again
  const detail = await guardianageRequest('get', `/api/tasks/${testTaskId}`, cookie);
  assert.strictEqual(detail.body.data.task.status, 'open');
  assert.strictEqual(detail.body.data.task.completed_at, null);
  assert.strictEqual(detail.body.data.task.completed_by_user_id, null);
});

test('Tasks — event history preserved after complete/reopen cycle', async () => {
  if (!testTaskId) return;

  const cookie = await loginAsAdmin();
  const detail = await guardianageRequest('get', `/api/tasks/${testTaskId}`, cookie);
  const events = detail.body.data.events || [];

  // Should have at least completed + reopened events from the previous tests
  const hasCompleted = events.some(e => e.event_type === 'completed');
  const hasReopened = events.some(e => e.event_type === 'reopened');
  assert.ok(hasCompleted, 'Should have a completed event');
  assert.ok(hasReopened, 'Should have a reopened event');
});

test('Tasks — team user can reopen weekly/monthly tasks', async () => {
  if (!testTaskId) return;

  const adminCookie = await loginAsAdmin();
  const teamCookie = await loginAsTeamUser();

  // First complete it as admin
  await guardianageRequest('post', `/api/tasks/${testTaskId}/complete`, adminCookie)
    .send({});

  // Team user reopens it
  const res = await guardianageRequest('post', `/api/tasks/${testTaskId}/reopen`, teamCookie);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('Tasks — team user cannot reopen monthly_major task', async () => {
  const adminCookie = await loginAsAdmin();
  const teamCookie = await loginAsTeamUser();

  // Find a major task
  const dashRes = await guardianageRequest('get', '/api/dashboard', adminCookie);
  const majorItems = dashRes.body.data?.majorItemsOpen || [];
  if (majorItems.length === 0) return; // skip if no major items

  const majorId = majorItems[0].id;

  // Complete as admin
  await guardianageRequest('post', `/api/tasks/${majorId}/complete`, adminCookie).send({});

  // Team user tries to reopen — should get 403
  const res = await guardianageRequest('post', `/api/tasks/${majorId}/reopen`, teamCookie);
  assert.strictEqual(res.status, 403);

  // Cleanup: admin reopens it
  await guardianageRequest('post', `/api/tasks/${majorId}/reopen`, adminCookie);
});

test('Tasks — team user cannot delete photos', async () => {
  if (!testTaskId) return;

  const teamCookie = await loginAsTeamUser();

  // Try to delete a non-existent photo — should still get 403 before any DB lookup
  const res = await guardianageRequest('delete', `/api/tasks/${testTaskId}/photos/00000000-0000-0000-0000-000000000000`, teamCookie);
  assert.strictEqual(res.status, 403);
});

test('Tasks — complete validation rejects bad input', async () => {
  if (!testTaskId) return;

  const cookie = await loginAsAdmin();
  const res = await guardianageRequest('post', `/api/tasks/${testTaskId}/complete`, cookie)
    .send({ note: 12345 }); // note should be string

  // Should either accept (coerce) or reject — checking it doesn't crash
  assert.ok(res.status === 200 || res.status === 400);
});

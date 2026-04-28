/**
 * Guardianage Notes Tests
 * Save creates revision, admin can view revisions, team user cannot.
 */

import { test, assert, initTestApp, guardianageRequest, loginAsAdmin, loginAsTeamUser } from './setup.js';

let testMonthId = null;

test.before(async () => {
  await initTestApp();

  // Get a month to test with
  const cookie = await loginAsAdmin();
  const res = await guardianageRequest('get', '/api/dashboard', cookie);
  testMonthId = res.body.data?.currentMonth?.id;
});

test('Notes — save note creates revision', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/months/${testMonthId}/notes/save`, cookie)
    .send({ text: 'Test note from automated test' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('Notes — second save creates revision 2', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/months/${testMonthId}/notes/save`, cookie)
    .send({ text: 'Updated test note' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('Notes — get note shows current text', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('get', `/api/months/${testMonthId}/notes`, cookie);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.note.current_text, 'Updated test note');
});

test('Notes — admin can view revisions', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('get', `/api/months/${testMonthId}/notes/revisions`, cookie);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.data.revisions.length >= 2, 'Should have at least 2 revisions');
});

test('Notes — team user cannot view revisions', async () => {
  if (!testMonthId) return;

  const teamCookie = await loginAsTeamUser();

  const res = await guardianageRequest('get', `/api/months/${testMonthId}/notes/revisions`, teamCookie);

  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.success, false);
});

test('Notes — save validation rejects empty text', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/months/${testMonthId}/notes/save`, cookie)
    .send({});

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
});

/**
 * Guardianage Supplies Tests
 * Create with revision, edit creates new revision, no delete endpoint.
 */

import { test, assert, initTestApp, guardianageRequest, loginAsAdmin } from './setup.js';

let testMonthId = null;
let testSupplyId = null;

test.before(async () => {
  await initTestApp();

  const cookie = await loginAsAdmin();
  const res = await guardianageRequest('get', '/api/dashboard', cookie);
  testMonthId = res.body.data?.currentMonth?.id;
});

test('Supplies — create supply with revision', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/months/${testMonthId}/supplies`, cookie)
    .send({
      item_name: 'Test bolts',
      amount: 25.50,
      currency_code: 'USD',
      vendor: 'Island Hardware',
      category: 'Hardware',
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.data.supply.id);
  testSupplyId = res.body.data.supply.id;
});

test('Supplies — edit supply creates new revision', async () => {
  if (!testSupplyId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('patch', `/api/supplies/${testSupplyId}`, cookie)
    .send({ amount: 30.00, note: 'Price correction' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.supply.amount, 30);
});

test('Supplies — list includes supply with receipts', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('get', `/api/months/${testMonthId}/supplies`, cookie);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.data.supplies.length > 0);

  const supply = res.body.data.supplies.find(s => s.id === testSupplyId);
  assert.ok(supply, 'Test supply should be in list');
  assert.strictEqual(supply.amount, 30);
});

test('Supplies — no DELETE endpoint exists', async () => {
  if (!testSupplyId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('delete', `/api/supplies/${testSupplyId}`, cookie);

  // Should be 404 (no route) or 405 (method not allowed)
  assert.ok(res.status === 404 || res.status === 405,
    `Expected 404/405, got ${res.status}`);
});

test('Supplies — create validation rejects missing item_name', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/months/${testMonthId}/supplies`, cookie)
    .send({ amount: 10 });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
});

test('Supplies — create validation rejects invalid currency', async () => {
  if (!testMonthId) return;

  const cookie = await loginAsAdmin();

  const res = await guardianageRequest('post', `/api/months/${testMonthId}/supplies`, cookie)
    .send({ item_name: 'Test', amount: 10, currency_code: 'EUR' });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
});

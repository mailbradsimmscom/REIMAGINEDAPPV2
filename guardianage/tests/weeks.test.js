/**
 * Guardianage Week Resolution Tests
 * Verify cross-month current-week lookup used by dashboard.js.
 *
 * Weeks run Mon-Sun and may span month boundaries (filed under the month
 * containing their Monday), so the active week is found by date across the
 * whole season and the displayed month follows the week — not the calendar.
 */

import { test } from 'node:test';
import assert from 'node:assert';

/**
 * Reimplements the default-view resolution from dashboard.js:
 * active week by date across all season weeks, month follows the week,
 * falling back to calendar month, then nearest month.
 */
function resolveView(months, seasonWeeks, todayStr) {
  let currentMonth = null;

  const activeWeek = seasonWeeks.find(w =>
    todayStr >= w.week_start_date && todayStr <= w.week_end_date
  );
  if (activeWeek) {
    currentMonth = months.find(m => m.id === activeWeek.month_id);
  }
  if (!currentMonth) {
    currentMonth = months.find(m =>
      todayStr >= m.month_start_date && todayStr <= m.month_end_date
    );
  }
  if (!currentMonth && months.length > 0) {
    currentMonth = todayStr < months[0].month_start_date
      ? months[0]
      : months[months.length - 1];
  }

  return { currentMonth, currentWeek: activeWeek || null };
}

// Post-migration shape: Mon-Sun weeks, Jul 27-Aug 2 belongs to July.
const months = [
  { id: 'jul', month_start_date: '2026-07-01', month_end_date: '2026-07-31' },
  { id: 'aug', month_start_date: '2026-08-01', month_end_date: '2026-08-31' },
];
const weeks = [
  { id: 'w1', month_id: 'jul', week_start_date: '2026-07-20', week_end_date: '2026-07-26' },
  { id: 'w2', month_id: 'jul', week_start_date: '2026-07-27', week_end_date: '2026-08-02' },
  { id: 'w3', month_id: 'aug', week_start_date: '2026-08-03', week_end_date: '2026-08-09' },
];

test('Weeks — mid-month day resolves to its week and month', () => {
  const { currentMonth, currentWeek } = resolveView(months, weeks, '2026-07-22');
  assert.strictEqual(currentWeek.id, 'w1');
  assert.strictEqual(currentMonth.id, 'jul');
});

test('Weeks — boundary week found from its own month side', () => {
  const { currentMonth, currentWeek } = resolveView(months, weeks, '2026-07-28');
  assert.strictEqual(currentWeek.id, 'w2');
  assert.strictEqual(currentMonth.id, 'jul');
});

test('Weeks — boundary week found from the NEXT month side (month follows week)', () => {
  // Aug 1-2 falls inside Jul 27-Aug 2, which is filed under July.
  const { currentMonth, currentWeek } = resolveView(months, weeks, '2026-08-01');
  assert.strictEqual(currentWeek.id, 'w2');
  assert.strictEqual(currentMonth.id, 'jul');
});

test('Weeks — first day after boundary week rolls to the new month', () => {
  const { currentMonth, currentWeek } = resolveView(months, weeks, '2026-08-03');
  assert.strictEqual(currentWeek.id, 'w3');
  assert.strictEqual(currentMonth.id, 'aug');
});

test('Weeks — date in a week gap falls back to calendar month', () => {
  // No week covers Jul 1-19 in this fixture; month resolves by calendar.
  const { currentMonth, currentWeek } = resolveView(months, weeks, '2026-07-10');
  assert.strictEqual(currentWeek, null);
  assert.strictEqual(currentMonth.id, 'jul');
});

test('Weeks — date after season falls back to last month', () => {
  const { currentMonth, currentWeek } = resolveView(months, weeks, '2026-12-15');
  assert.strictEqual(currentWeek, null);
  assert.strictEqual(currentMonth.id, 'aug');
});

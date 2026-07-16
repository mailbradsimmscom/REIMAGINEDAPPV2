/**
 * Migrate season weeks to continuous Mon-Sun alignment.
 *
 * Weeks before the transition date are untouched (history). From the
 * transition date on: one short transition week (transition date -> first
 * Sunday), then pure Mon-Sun weeks through season end. Weeks spanning a
 * month boundary are filed under the month containing their Monday.
 *
 * Existing week rows are updated in place (IDs preserved, month by month in
 * sort order) so weekly tasks keep their week_id; task due windows are
 * updated to match. Months left with more week rows than Mon-Sun windows
 * have the surplus weeks and their tasks deleted — guarded: a task with any
 * event, photo, or non-open status aborts the migration.
 *
 * Usage:
 *   node guardianage/scripts/migrate-weeks-monsun.mjs           # dry run
 *   node guardianage/scripts/migrate-weeks-monsun.mjs --apply   # write
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const APPLY = process.argv.includes('--apply');
const TRANSITION_START = '2026-07-15';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const monthShort = (dateStr) => new Date(dateStr + 'T00:00:00Z').toLocaleString('en', { month: 'short', timeZone: 'UTC' });
const dayOfMonth = (dateStr) => Number(dateStr.slice(8, 10));
const weekdayName = (dateStr) => new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' });

function displayName(start, end) {
  const sM = monthShort(start), eM = monthShort(end);
  return sM === eM
    ? `${sM} ${dayOfMonth(start)}-${dayOfMonth(end)}`
    : `${sM} ${dayOfMonth(start)}-${eM} ${dayOfMonth(end)}`;
}

// --- Load everything ---
const { data: season, error: sErr } = await sb.from('guardianage_seasons').select('*').eq('status', 'active').single();
if (sErr) throw sErr;
const { data: months, error: mErr } = await sb.from('guardianage_months').select('*').eq('season_id', season.id).order('sort_order');
if (mErr) throw mErr;
const monthIds = months.map((m) => m.id);
const { data: weeks, error: wErr } = await sb.from('guardianage_weeks').select('*').in('month_id', monthIds).order('week_start_date');
if (wErr) throw wErr;
const { data: tasks, error: tErr } = await sb.from('guardianage_tasks').select('*').eq('season_id', season.id);
if (tErr) throw tErr;

const seasonEnd = months[months.length - 1].month_end_date;
const monthByDate = (dateStr) => months.find((m) => dateStr >= m.month_start_date && dateStr <= m.month_end_date);
const monthName = (id) => months.find((m) => m.id === id)?.display_name;

// --- Build target windows: transition week, then Mon-Sun to season end ---
// Transition week runs to the first Sunday on/after TRANSITION_START.
let firstMonday = TRANSITION_START;
while (weekdayName(firstMonday) !== 'Mon') firstMonday = addDays(firstMonday, 1);
const windows = [];
if (firstMonday !== TRANSITION_START) {
  windows.push({ start: TRANSITION_START, end: addDays(firstMonday, -1) });
}
for (let start = firstMonday; start <= seasonEnd; start = addDays(start, 7)) {
  const end = addDays(start, 6);
  windows.push({ start, end: end <= seasonEnd ? end : seasonEnd });
}
for (const w of windows) {
  w.month = monthByDate(w.start); // filed under the month containing its first day
  if (!w.month) throw new Error(`No month contains window start ${w.start}`);
}

// --- Map existing mutable weeks to windows, month by month ---
const protectedWeeks = weeks.filter((w) => w.week_start_date < TRANSITION_START);
const mutableWeeks = weeks.filter((w) => w.week_start_date >= TRANSITION_START);
if (protectedWeeks.some((w) => w.week_end_date >= TRANSITION_START)) {
  throw new Error('A protected week overlaps the transition date — adjust TRANSITION_START');
}

const updates = []; // { week, newStart, newEnd, newName, newNumber, newSort }
const deletions = []; // week rows
for (const month of months) {
  const monthWindows = windows.filter((w) => w.month.id === month.id);
  const monthMutable = mutableWeeks.filter((w) => w.month_id === month.id).sort((a, b) => a.sort_order - b.sort_order);
  const protectedCount = protectedWeeks.filter((w) => w.month_id === month.id).length;

  if (monthWindows.length > monthMutable.length) {
    throw new Error(`${month.display_name}: ${monthWindows.length} windows but only ${monthMutable.length} week rows — creation not supported, review manually`);
  }
  monthWindows.forEach((win, i) => {
    updates.push({
      week: monthMutable[i],
      newStart: win.start,
      newEnd: win.end,
      newName: displayName(win.start, win.end),
      newNumber: protectedCount + i + 1,
      newSort: protectedCount + i + 1,
    });
  });
  deletions.push(...monthMutable.slice(monthWindows.length));
}

// --- Guard: deleted weeks' tasks must be open and history-free ---
const deletedWeekIds = new Set(deletions.map((w) => w.id));
const tasksToDelete = tasks.filter((t) => t.week_id && deletedWeekIds.has(t.week_id));
const taskIdsToDelete = tasksToDelete.map((t) => t.id);
for (const t of tasksToDelete) {
  if (t.status !== 'open' || t.completed_at) {
    throw new Error(`ABORT: task "${t.title}" (${t.id}) in deleted week is not a pristine open task`);
  }
}
if (taskIdsToDelete.length > 0) {
  const { data: events } = await sb.from('guardianage_task_events').select('task_id').in('task_id', taskIdsToDelete);
  const { data: photos } = await sb.from('guardianage_task_photos').select('task_id').in('task_id', taskIdsToDelete);
  if (events?.length || photos?.length) {
    throw new Error(`ABORT: tasks slated for deletion have ${events?.length || 0} events / ${photos?.length || 0} photos`);
  }
}

// --- Report ---
console.log(`Season: ${season.name} (ends ${seasonEnd})`);
console.log(`Protected weeks (before ${TRANSITION_START}): ${protectedWeeks.length} — untouched`);
console.log(`\nWEEK UPDATES (${updates.length}):`);
for (const u of updates) {
  const tCount = tasks.filter((t) => t.week_id === u.week.id).length;
  console.log(
    `  [${monthName(u.week.month_id).padEnd(14)}] ${u.week.display_name.padEnd(12)} -> ${u.newName.padEnd(14)}` +
    `(${u.newStart} ${weekdayName(u.newStart)} to ${u.newEnd} ${weekdayName(u.newEnd)}, #${u.newNumber}, ${tCount} task due-windows updated)`
  );
}
console.log(`\nWEEK DELETIONS (${deletions.length}):`);
for (const w of deletions) {
  const wTasks = tasks.filter((t) => t.week_id === w.id);
  console.log(`  [${monthName(w.month_id).padEnd(14)}] ${w.display_name.padEnd(12)} + ${wTasks.length} open tasks (no events/photos/completions)`);
}
const touchedTaskCount = tasks.filter((t) => t.week_id && updates.some((u) => u.week.id === t.week_id)).length;
console.log(`\nTotals: ${updates.length} weeks updated, ${deletions.length} weeks deleted, ${touchedTaskCount} task due-windows updated, ${taskIdsToDelete.length} tasks deleted`);
console.log(`Weeks after migration: ${protectedWeeks.length + updates.length} (was ${weeks.length})`);

if (!APPLY) {
  console.log('\nDRY RUN — no writes. Re-run with --apply to migrate.');
  process.exit(0);
}

// --- Apply: delete tasks, delete weeks, then update weeks + task due windows ---
const nowIso = new Date().toISOString();
if (taskIdsToDelete.length > 0) {
  const { error } = await sb.from('guardianage_tasks').delete().in('id', taskIdsToDelete);
  if (error) throw new Error('delete tasks: ' + error.message);
}
if (deletions.length > 0) {
  const { error } = await sb.from('guardianage_weeks').delete().in('id', deletions.map((w) => w.id));
  if (error) throw new Error('delete weeks: ' + error.message);
}
for (const u of updates) {
  const { error: wUpErr } = await sb
    .from('guardianage_weeks')
    .update({
      week_start_date: u.newStart,
      week_end_date: u.newEnd,
      display_name: u.newName,
      week_number_in_month: u.newNumber,
      sort_order: u.newSort,
      updated_at: nowIso,
    })
    .eq('id', u.week.id);
  if (wUpErr) throw new Error(`update week ${u.week.display_name}: ${wUpErr.message}`);

  const { error: tUpErr } = await sb
    .from('guardianage_tasks')
    .update({ due_start_date: u.newStart, due_end_date: u.newEnd, updated_at: nowIso })
    .eq('week_id', u.week.id);
  if (tUpErr) throw new Error(`update tasks of ${u.newName}: ${tUpErr.message}`);
}

// --- Verify ---
const { data: weeksAfter } = await sb.from('guardianage_weeks').select('*').in('month_id', monthIds).order('week_start_date');
const { count: tasksAfter } = await sb.from('guardianage_tasks').select('*', { count: 'exact', head: true }).eq('season_id', season.id);
console.log(`\nApplied. Weeks now: ${weeksAfter.length} (expect ${protectedWeeks.length + updates.length}), tasks now: ${tasksAfter} (expect ${tasks.length - taskIdsToDelete.length})`);
let prevEnd = null;
for (const w of weeksAfter.filter((x) => x.week_start_date >= TRANSITION_START)) {
  if (prevEnd && addDays(prevEnd, 1) !== w.week_start_date) {
    console.log(`  WARNING: gap/overlap between ${prevEnd} and ${w.week_start_date}`);
  }
  prevEnd = w.week_end_date;
}
console.log('Continuity check complete.');

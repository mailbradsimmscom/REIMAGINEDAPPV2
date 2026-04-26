/**
 * Seed guardianage task templates and task instances for the active season.
 *
 * Idempotent — uses unique constraints to prevent duplicates.
 *
 * Usage: node guardianage/scripts/seed-tasks.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.PY_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Template definitions ---

const WEEKLY_TEMPLATES = [
  { title: 'Interior moisture check', display_order: 1 },
  { title: 'Check dehumidifier is running correctly', display_order: 2 },
  { title: 'Bilge water check', display_order: 3 },
  { title: 'Quick interior wipe/check for mildew, insects, leaks, or odor', display_order: 4 },
  { title: 'Exterior visual inspection', display_order: 5 },
  { title: 'Check lines, covers, and visible deck hardware', display_order: 6 },
  { title: 'Check lockers and forward locker for moisture or pests', display_order: 7 },
  { title: 'Window/foil/covering condition check', display_order: 8 },
];

const MONTHLY_TEMPLATES = [
  { title: 'Exterior cleaning wash down', display_order: 1 },
  { title: 'DampRid replenishment', display_order: 2 },
  { title: 'Insect trap / pest-control refresh', display_order: 3 },
  { title: 'Storage verification for sails, sail bag, and dinghy batteries', display_order: 4 },
];

const MAJOR_ITEMS_BY_MONTH = {
  '2026-05': [
    { title: 'Remove water in bilges, clean bilges with vinegar, wipe down surfaces, clean port forward locker, wipe lockers', display_order: 1 },
    { title: 'Install desiccant pots and hangers', display_order: 2 },
    { title: 'Install roach and ant traps', display_order: 3 },
    { title: 'Foil all windows', display_order: 4 },
    { title: 'Block all through-hulls to prevent insects from getting in', display_order: 5 },
    { title: 'Protective care: acid wash entire boat, wax and polish smooth surfaces including decks, hulls, below boat, transom', display_order: 6 },
    { title: 'Engine decommissioning service: fresh water flush engines, change oil and oil filter, fuel filter, decommission engines', display_order: 7 },
    { title: 'Clean engine compartment', display_order: 8 },
    { title: 'Wash/clean sail lines', display_order: 9 },
  ],
  '2026-06': [],
  '2026-07': [
    { title: 'Wax and polish smooth surfaces including decks, hulls, below boat, transom', display_order: 1 },
  ],
  '2026-08': [
    { title: 'Sea safety check: EPIRB check, fire extinguisher inspection, Dan buoy survey', display_order: 1 },
    { title: 'Service sail drive lower unit, change lower seals, change O-ring, change oil, clean/service propellers', display_order: 2 },
    { title: '500-hour Yanmar service (TBD / conditional)', display_order: 3 },
  ],
  '2026-09': [
    { title: 'Service all winches', display_order: 1 },
    { title: 'Service windlass, tighten loose bolts/mechanism, check oil level, clean corrosion', display_order: 2 },
  ],
  '2026-10': [
    { title: 'Strip, clean, sand, and prep propellers for Propspeed application', display_order: 1 },
    { title: 'Strip, sand, and prep sail drive leg for Propspeed application', display_order: 2 },
    { title: 'Wax and polish smooth surfaces including decks, hulls, below boat, transom', display_order: 3 },
    { title: 'Bottom paint: water sand, scrape barnacles, prep and apply 2.5 coats of Micron CSC Black; sand dagger boards with VC17; paint rudders with Micron CSC Shark White', display_order: 4 },
  ],
  '2026-11': [
    { title: 'Recommission Boat', display_order: 1 },
  ],
};

async function ensureTemplate(title, taskType, displayOrder) {
  const { data: existing } = await supabase
    .from('guardianage_task_templates')
    .select('id')
    .eq('title', title)
    .eq('task_type', taskType)
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('guardianage_task_templates')
    .insert({
      title,
      task_type: taskType,
      is_active: true,
      has_photo_upload: true,
      display_order: displayOrder,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create template "${title}": ${error.message}`);
  console.log(`  Created template: ${title}`);
  return data.id;
}

async function createTaskIfNotExists(task) {
  // Check-then-insert to handle conditional unique indexes
  let query = supabase
    .from('guardianage_tasks')
    .select('id')
    .eq('task_template_id', task.task_template_id)
    .eq('month_id', task.month_id);

  if (task.week_id) {
    query = query.eq('week_id', task.week_id);
  } else {
    query = query.is('week_id', null);
  }

  const { data: existing } = await query.maybeSingle();
  if (existing) return false;

  const { error } = await supabase
    .from('guardianage_tasks')
    .insert(task);

  if (error) {
    if (error.code === '23505') return false; // race condition duplicate
    throw new Error(`Failed to create task "${task.title}": ${error.message}`);
  }
  return true;
}

async function seed() {
  console.log('Seeding guardianage tasks...\n');

  // Get season
  const { data: season } = await supabase
    .from('guardianage_seasons')
    .select('id')
    .eq('status', 'active')
    .single();

  if (!season) throw new Error('No active season found. Run seed-season.mjs first.');

  // Get all months and weeks
  const { data: months } = await supabase
    .from('guardianage_months')
    .select('id, month_key, month_start_date, month_end_date')
    .eq('season_id', season.id)
    .order('sort_order');

  const { data: allWeeks } = await supabase
    .from('guardianage_weeks')
    .select('id, month_id, week_start_date, week_end_date')
    .order('sort_order');

  // Build lookup
  const monthsByKey = {};
  for (const m of months) monthsByKey[m.month_key] = m;

  const weeksByMonth = {};
  for (const w of allWeeks) {
    if (!weeksByMonth[w.month_id]) weeksByMonth[w.month_id] = [];
    weeksByMonth[w.month_id].push(w);
  }

  // 1. Weekly recurring templates + instances
  console.log('--- Weekly Recurring Tasks ---');
  for (const tmpl of WEEKLY_TEMPLATES) {
    const templateId = await ensureTemplate(tmpl.title, 'weekly_recurring', tmpl.display_order);

    let created = 0;
    for (const month of months) {
      const weeks = weeksByMonth[month.id] || [];
      for (const week of weeks) {
        const wasCreated = await createTaskIfNotExists({
          season_id: season.id,
          month_id: month.id,
          week_id: week.id,
          task_template_id: templateId,
          task_type: 'weekly_recurring',
          title: tmpl.title,
          status: 'open',
          due_start_date: week.week_start_date,
          due_end_date: week.week_end_date,
          display_order: tmpl.display_order,
        });
        if (wasCreated) created++;
      }
    }
    console.log(`  ${tmpl.title}: ${created} new instances`);
  }

  // 2. Monthly recurring templates + instances
  console.log('\n--- Monthly Recurring Tasks ---');
  for (const tmpl of MONTHLY_TEMPLATES) {
    const templateId = await ensureTemplate(tmpl.title, 'monthly_recurring', tmpl.display_order);

    let created = 0;
    for (const month of months) {
      const wasCreated = await createTaskIfNotExists({
        season_id: season.id,
        month_id: month.id,
        week_id: null,
        task_template_id: templateId,
        task_type: 'monthly_recurring',
        title: tmpl.title,
        status: 'open',
        due_start_date: month.month_start_date,
        due_end_date: month.month_end_date,
        display_order: tmpl.display_order,
      });
      if (wasCreated) created++;
    }
    console.log(`  ${tmpl.title}: ${created} new instances`);
  }

  // 3. Monthly major items (one-off per month)
  console.log('\n--- Monthly Major Items ---');
  for (const [monthKey, items] of Object.entries(MAJOR_ITEMS_BY_MONTH)) {
    const month = monthsByKey[monthKey];
    if (!month) {
      console.log(`  Skipping ${monthKey} — month not found`);
      continue;
    }

    if (items.length === 0) {
      console.log(`  ${monthKey}: no major items`);
      continue;
    }

    for (const item of items) {
      const templateId = await ensureTemplate(item.title, 'monthly_major', item.display_order);

      const wasCreated = await createTaskIfNotExists({
        season_id: season.id,
        month_id: month.id,
        week_id: null,
        task_template_id: templateId,
        task_type: 'monthly_major',
        title: item.title,
        status: 'open',
        due_start_date: month.month_start_date,
        due_end_date: month.month_end_date,
        display_order: item.display_order,
      });

      if (wasCreated) {
        console.log(`  ${monthKey}: created "${item.title}"`);
      } else {
        console.log(`  ${monthKey}: "${item.title}" already exists`);
      }
    }
  }

  // Summary
  const { count } = await supabase
    .from('guardianage_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', season.id);

  const { count: templateCount } = await supabase
    .from('guardianage_task_templates')
    .select('id', { count: 'exact', head: true });

  console.log(`\n--- Summary ---`);
  console.log(`Templates: ${templateCount}`);
  console.log(`Task instances: ${count}`);
  console.log('\nDone!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

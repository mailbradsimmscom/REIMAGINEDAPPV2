/**
 * Seed the guardianage season structure.
 *
 * Creates: 1 season, 7 months (May-Nov), all weeks, 1 admin user.
 * Idempotent — safe to re-run.
 *
 * Usage: node guardianage/scripts/seed-season.mjs
 *
 * Requires ADMIN_PASSWORD env var (or defaults to 'admin' in development).
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.PY_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or service key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Season definition ---

const SEASON = {
  name: 'REIMAGINED 2026 Guardianage Season',
  vessel_name: 'REIMAGINED',
  start_date: '2026-05-01',
  end_date: '2026-11-08',
  status: 'active',
};

const MONTHS = [
  { month_key: '2026-05', start: '2026-05-01', end: '2026-05-31', display: 'May 2026', sort: 1 },
  { month_key: '2026-06', start: '2026-06-01', end: '2026-06-30', display: 'June 2026', sort: 2 },
  { month_key: '2026-07', start: '2026-07-01', end: '2026-07-31', display: 'July 2026', sort: 3 },
  { month_key: '2026-08', start: '2026-08-01', end: '2026-08-31', display: 'August 2026', sort: 4 },
  { month_key: '2026-09', start: '2026-09-01', end: '2026-09-30', display: 'September 2026', sort: 5 },
  { month_key: '2026-10', start: '2026-10-01', end: '2026-10-31', display: 'October 2026', sort: 6 },
  { month_key: '2026-11', start: '2026-11-01', end: '2026-11-08', display: 'November 2026', sort: 7 },
];

function generateWeeks(monthStart, monthEnd) {
  const weeks = [];
  let current = new Date(monthStart + 'T00:00:00');
  const end = new Date(monthEnd + 'T00:00:00');
  let weekNum = 1;

  while (current <= end) {
    const weekStart = new Date(current);
    // End of week = start + 6 days, but don't go past month end
    const weekEndCandidate = new Date(current);
    weekEndCandidate.setDate(weekEndCandidate.getDate() + 6);
    const weekEnd = weekEndCandidate > end ? end : weekEndCandidate;

    const startStr = weekStart.toISOString().slice(0, 10);
    const endStr = weekEnd.toISOString().slice(0, 10);

    const startDay = weekStart.getDate();
    const endDay = weekEnd.getDate();
    const monthName = weekStart.toLocaleString('en', { month: 'short' });

    weeks.push({
      week_number_in_month: weekNum,
      week_start_date: startStr,
      week_end_date: endStr,
      display_name: `${monthName} ${startDay}-${endDay}`,
      sort_order: weekNum,
    });

    // Next week starts day after weekEnd
    current = new Date(weekEnd);
    current.setDate(current.getDate() + 1);
    weekNum++;
  }

  return weeks;
}

async function seed() {
  console.log('Seeding guardianage season...\n');

  // 1. Season
  const { data: existingSeason } = await supabase
    .from('guardianage_seasons')
    .select('id')
    .eq('name', SEASON.name)
    .maybeSingle();

  let seasonId;
  if (existingSeason) {
    seasonId = existingSeason.id;
    console.log(`Season already exists: ${seasonId}`);
  } else {
    const { data: newSeason, error } = await supabase
      .from('guardianage_seasons')
      .insert(SEASON)
      .select()
      .single();
    if (error) throw new Error(`Failed to create season: ${error.message}`);
    seasonId = newSeason.id;
    console.log(`Created season: ${seasonId}`);
  }

  // 2. Months
  for (const month of MONTHS) {
    const { data: existing } = await supabase
      .from('guardianage_months')
      .select('id')
      .eq('season_id', seasonId)
      .eq('month_key', month.month_key)
      .maybeSingle();

    let monthId;
    if (existing) {
      monthId = existing.id;
      console.log(`  Month ${month.display} already exists: ${monthId}`);
    } else {
      const { data: newMonth, error } = await supabase
        .from('guardianage_months')
        .insert({
          season_id: seasonId,
          month_key: month.month_key,
          month_start_date: month.start,
          month_end_date: month.end,
          display_name: month.display,
          sort_order: month.sort,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to create month ${month.display}: ${error.message}`);
      monthId = newMonth.id;
      console.log(`  Created month: ${month.display} (${monthId})`);
    }

    // 3. Weeks for this month
    const weeks = generateWeeks(month.start, month.end);
    for (const week of weeks) {
      const { data: existingWeek } = await supabase
        .from('guardianage_weeks')
        .select('id')
        .eq('month_id', monthId)
        .eq('week_number_in_month', week.week_number_in_month)
        .maybeSingle();

      if (existingWeek) {
        console.log(`    Week ${week.display_name} already exists`);
      } else {
        const { error } = await supabase
          .from('guardianage_weeks')
          .insert({ ...week, month_id: monthId });
        if (error) throw new Error(`Failed to create week: ${error.message}`);
        console.log(`    Created week: ${week.display_name}`);
      }
    }
  }

  // 4. Admin user
  const adminLoginId = 'brad';
  const { data: existingAdmin } = await supabase
    .from('guardianage_users')
    .select('id')
    .eq('login_id', adminLoginId)
    .maybeSingle();

  if (existingAdmin) {
    console.log(`\nAdmin user '${adminLoginId}' already exists: ${existingAdmin.id}`);
  } else {
    const adminPassword = process.env.GUARDIANAGE_ADMIN_PASSWORD || 'admin';
    const hash = await bcrypt.hash(adminPassword, 10);
    const { data: newAdmin, error } = await supabase
      .from('guardianage_users')
      .insert({
        login_id: adminLoginId,
        password_hash: hash,
        display_name: 'Brad',
        role: 'admin',
        is_active: true,
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to create admin: ${error.message}`);
    console.log(`\nCreated admin user '${adminLoginId}': ${newAdmin.id}`);
    console.log(`  Password: ${adminPassword}`);
  }

  console.log('\nDone!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

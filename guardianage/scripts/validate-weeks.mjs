/**
 * Validate week seeding integrity.
 *
 * Checks:
 * 1. No week date overlaps within a month
 * 2. Every date in the month belongs to exactly one week
 * 3. Week start/end dates don't exceed month boundaries
 *
 * Usage: node guardianage/scripts/validate-weeks.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.PY_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or service key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function dateRange(start, end) {
  const dates = [];
  const current = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (current <= endDate) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function validate() {
  let errors = 0;

  const { data: months } = await supabase
    .from('guardianage_months')
    .select('id, month_key, month_start_date, month_end_date, display_name')
    .order('sort_order', { ascending: true });

  if (!months || months.length === 0) {
    console.log('No months found.');
    return;
  }

  for (const month of months) {
    console.log(`\nValidating ${month.display_name}...`);

    const { data: weeks } = await supabase
      .from('guardianage_weeks')
      .select('id, week_number_in_month, week_start_date, week_end_date, display_name')
      .eq('month_id', month.id)
      .order('sort_order', { ascending: true });

    if (!weeks || weeks.length === 0) {
      console.log(`  ERROR: No weeks found for ${month.display_name}`);
      errors++;
      continue;
    }

    // Check 1: Week boundaries within month
    for (const week of weeks) {
      if (week.week_start_date < month.month_start_date) {
        console.log(`  ERROR: Week "${week.display_name}" starts before month (${week.week_start_date} < ${month.month_start_date})`);
        errors++;
      }
      if (week.week_end_date > month.month_end_date) {
        console.log(`  ERROR: Week "${week.display_name}" ends after month (${week.week_end_date} > ${month.month_end_date})`);
        errors++;
      }
    }

    // Check 2: No overlaps
    for (let i = 0; i < weeks.length - 1; i++) {
      if (weeks[i].week_end_date >= weeks[i + 1].week_start_date) {
        console.log(`  ERROR: Overlap between "${weeks[i].display_name}" and "${weeks[i + 1].display_name}"`);
        errors++;
      }
    }

    // Check 3: Full coverage — every day in month belongs to exactly one week
    const monthDates = dateRange(month.month_start_date, month.month_end_date);
    const coveredDates = new Set();
    for (const week of weeks) {
      const weekDates = dateRange(week.week_start_date, week.week_end_date);
      for (const d of weekDates) {
        if (coveredDates.has(d)) {
          console.log(`  ERROR: Date ${d} covered by multiple weeks`);
          errors++;
        }
        coveredDates.add(d);
      }
    }

    const uncovered = monthDates.filter(d => !coveredDates.has(d));
    if (uncovered.length > 0) {
      console.log(`  ERROR: ${uncovered.length} dates not covered by any week: ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? '...' : ''}`);
      errors++;
    }

    console.log(`  ${weeks.length} weeks, ${monthDates.length} days, ${coveredDates.size} covered — ${errors === 0 ? 'OK' : 'ERRORS'}`);
  }

  console.log(`\n${errors === 0 ? 'All validations passed!' : `${errors} error(s) found.`}`);
  process.exit(errors > 0 ? 1 : 0);
}

validate().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});

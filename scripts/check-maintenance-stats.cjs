const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  // Check pipeline_runs schema
  console.log('=== pipeline_runs sample ===');
  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('*')
    .limit(2);
  if (runs && runs.length > 0) {
    console.log('Columns:', Object.keys(runs[0]).join(', '));
    console.log('Sample:', JSON.stringify(runs[0], null, 2));
  } else {
    console.log('No data or table does not exist');
  }

  // Check deduplication_reviews schema
  console.log('\n=== deduplication_reviews sample ===');
  const { data: reviews } = await supabase
    .from('deduplication_reviews')
    .select('*')
    .limit(2);
  if (reviews && reviews.length > 0) {
    console.log('Columns:', Object.keys(reviews[0]).join(', '));
    console.log('Sample:', JSON.stringify(reviews[0], null, 2));
  } else {
    console.log('No data or table does not exist');
  }

  // Count by task types for approved tasks
  console.log('\n=== Approved tasks breakdown ===');
  const { data: approved } = await supabase
    .from('maintenance_tasks_index')
    .select('task_category, frequency_basis, system_name, asset_uid')
    .eq('review_status', 'approved');

  if (approved) {
    console.log('Total approved:', approved.length);

    // Group by system
    const bySystem = {};
    approved.forEach(t => {
      const name = t.system_name || t.asset_uid || 'unknown';
      bySystem[name] = (bySystem[name] || 0) + 1;
    });
    console.log('By system:', JSON.stringify(bySystem, null, 2));

    // Group by category
    const byCategory = {};
    approved.forEach(t => {
      const cat = t.task_category || 'unknown';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    console.log('By category:', JSON.stringify(byCategory));

    // Group by frequency_basis
    const byBasis = {};
    approved.forEach(t => {
      const basis = t.frequency_basis || 'unknown';
      byBasis[basis] = (byBasis[basis] || 0) + 1;
    });
    console.log('By frequency_basis:', JSON.stringify(byBasis));
  }

  // Check for "boat" vs "system" distinction
  console.log('\n=== All tasks by system (for boat vs system analysis) ===');
  const { data: allTasks } = await supabase
    .from('maintenance_tasks_index')
    .select('system_name, asset_uid, review_status')
    .order('system_name');

  if (allTasks) {
    const systemCounts = {};
    allTasks.forEach(t => {
      const name = t.system_name || 'unknown';
      if (!systemCounts[name]) {
        systemCounts[name] = { total: 0, pending: 0, approved: 0, rejected: 0, other: 0 };
      }
      systemCounts[name].total++;
      if (t.review_status === 'pending') systemCounts[name].pending++;
      else if (t.review_status === 'approved') systemCounts[name].approved++;
      else if (t.review_status === 'rejected') systemCounts[name].rejected++;
      else systemCounts[name].other++;
    });

    console.log('Systems with tasks:');
    Object.entries(systemCounts)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([name, counts]) => {
        console.log(`  ${name}: ${counts.total} total (${counts.approved} approved, ${counts.pending} pending, ${counts.rejected} rejected, ${counts.other} other)`);
      });
  }

  process.exit(0);
})();

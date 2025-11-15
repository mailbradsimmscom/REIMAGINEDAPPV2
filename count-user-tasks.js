/**
 * Quick script to count active user tasks in the database
 */
import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function countUserTasks() {
  const supabase = await getSupabaseClient();

  if (!supabase) {
    console.error('❌ Supabase client not available');
    process.exit(1);
  }

  // Count all user tasks by status
  const { data: allTasks, error: allError } = await supabase
    .from('user_tasks')
    .select('id, status, due_date');

  if (allError) {
    console.error('❌ Error fetching tasks:', allError.message);
    process.exit(1);
  }

  // Count active tasks
  const { count: activeCount, error: activeError } = await supabase
    .from('user_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  if (activeError) {
    console.error('❌ Error counting active tasks:', activeError.message);
    process.exit(1);
  }

  // Count overdue tasks
  const now = new Date().toISOString();
  const { count: overdueCount, error: overdueError } = await supabase
    .from('user_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .lt('due_date', now);

  if (overdueError) {
    console.error('❌ Error counting overdue tasks:', overdueError.message);
    process.exit(1);
  }

  // Group by status
  const statusCounts = allTasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});

  console.log('\n📊 USER TASKS SUMMARY\n');
  console.log('Total tasks in database:', allTasks.length);
  console.log('\nBy Status:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  console.log('\n🔥 Active (open) tasks:', activeCount);
  console.log('🔴 Overdue tasks:', overdueCount);
  console.log('✅ On-time tasks:', activeCount - overdueCount);
  console.log('\n');

  process.exit(0);
}

countUserTasks();

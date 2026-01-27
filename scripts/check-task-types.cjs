const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  // Check boatos_tasks
  console.log('=== boatos_tasks ===');
  const { data: boatos, error: e1 } = await supabase
    .from('boatos_tasks')
    .select('*')
    .limit(2);
  
  if (e1) {
    console.log('Error:', e1.message);
  } else if (boatos && boatos.length > 0) {
    console.log('Columns:', Object.keys(boatos[0]).join(', '));
    const { count } = await supabase.from('boatos_tasks').select('*', { count: 'exact', head: true });
    console.log('Total count:', count);
  } else {
    console.log('No data or table does not exist');
  }

  // Check user_tasks
  console.log('\n=== user_tasks ===');
  const { data: userTasks, error: e2 } = await supabase
    .from('user_tasks')
    .select('*')
    .limit(2);
  
  if (e2) {
    console.log('Error:', e2.message);
  } else if (userTasks && userTasks.length > 0) {
    console.log('Columns:', Object.keys(userTasks[0]).join(', '));
    const { count } = await supabase.from('user_tasks').select('*', { count: 'exact', head: true });
    console.log('Total count:', count);
    console.log('Sample:', JSON.stringify(userTasks[0], null, 2));
  } else {
    console.log('No data or table does not exist');
  }

  // Check task_completions
  console.log('\n=== task_completions ===');
  const { data: completions, error: e3 } = await supabase
    .from('task_completions')
    .select('*')
    .limit(2);
  
  if (e3) {
    console.log('Error:', e3.message);
  } else if (completions && completions.length > 0) {
    console.log('Columns:', Object.keys(completions[0]).join(', '));
    const { count } = await supabase.from('task_completions').select('*', { count: 'exact', head: true });
    console.log('Total count:', count);
  } else {
    console.log('No data or table does not exist');
  }

  process.exit(0);
})();

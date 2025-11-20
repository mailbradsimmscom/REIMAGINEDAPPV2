import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function checkThreads() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id, name, equipment_context, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('\n📊 Last 3 Chat Threads:\n');
  data.forEach((thread, i) => {
    console.log(`\n=== Thread ${i + 1} ===`);
    console.log(`ID: ${thread.id}`);
    console.log(`Name: ${thread.name}`);
    console.log(`Created: ${thread.created_at}`);
    console.log(`Equipment Context:`, JSON.stringify(thread.equipment_context, null, 2));
  });

  // Also get messages for each thread
  console.log('\n\n📝 Messages for each thread:\n');
  for (const thread of data) {
    const { data: messages, error: msgError } = await supabase
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });

    if (!msgError) {
      console.log(`\n=== Messages for Thread: ${thread.name} ===`);
      messages.forEach((msg, i) => {
        console.log(`\n${i + 1}. [${msg.role.toUpperCase()}] ${msg.content.substring(0, 100)}...`);
      });
    }
  }
}

checkThreads();

// Quick script to check chat messages for thread edd156d1-4887-4d9f-95a9-c209d30b64a9
import { createClient } from '@supabase/supabase-js';
import { getEnv } from './src/config/env.js';

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const chatId = 'edd156d1-4887-4d9f-95a9-c209d30b64a9';

// Get the specific message by ID
const { data: message, error: msgError } = await supabase
  .from('chat_messages')
  .select('*')
  .eq('id', chatId)
  .single();

if (msgError) {
  console.error('Error fetching message:', msgError);
  process.exit(1);
}

console.log('\n💬 MESSAGE INFO:');
console.log(`  Message ID: ${message.id}`);
console.log(`  Thread ID: ${message.thread_id}`);
console.log(`  Role: ${message.role}`);
console.log(`  Created: ${message.created_at}`);
console.log(`  Content: ${message.content.substring(0, 300)}${message.content.length > 300 ? '...' : ''}`);

const threadId = message.thread_id;

// Now get thread info
const { data: threads, error: threadError } = await supabase
  .from('chat_threads')
  .select('*')
  .eq('id', threadId);

if (threadError) {
  console.error('Error fetching thread:', threadError);
} else if (!threads || threads.length === 0) {
  console.log('\n⚠️  Thread not found in database.');
} else {
  const thread = threads[0];
  console.log('\n📋 THREAD INFO:');
  console.log(`  Thread ID: ${thread.id}`);
  console.log(`  Created: ${thread.created_at}`);
  console.log(`  Updated: ${thread.updated_at}`);
  console.log(`  Equipment context count: ${thread.equipment_context?.length || 0}`);

  if (thread.equipment_context && thread.equipment_context.length > 0) {
    console.log('\n🔧 EQUIPMENT IN THREAD CONTEXT:');
    thread.equipment_context.slice(0, 10).forEach((eq, i) => {
      console.log(`  ${i+1}. ${eq.manufacturer} ${eq.model}`);
      console.log(`     - llm_confidence: ${eq.llm_confidence}`);
      console.log(`     - llm_role: ${eq.llm_role}`);
      console.log(`     - source: ${eq.source}`);
    });
  }
}

// Get all messages in thread
const { data: messages, error: messagesError } = await supabase
  .from('chat_messages')
  .select('*')
  .eq('thread_id', threadId)
  .order('created_at', { ascending: true });

if (messagesError) {
  console.error('Error fetching messages:', messagesError);
} else {
  console.log('\n💬 ALL MESSAGES IN THREAD:');
  messages.forEach((msg, i) => {
    const highlight = msg.id === chatId ? ' ← THIS MESSAGE' : '';
    console.log(`\n${i+1}. [${msg.role}] at ${msg.created_at}${highlight}`);
    console.log(`   ID: ${msg.id}`);
    console.log(`   Content: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
  });
}

process.exit(0);

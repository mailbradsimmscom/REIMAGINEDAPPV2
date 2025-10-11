import { getChatThread } from './src/repositories/chat.repository.js';

// Get the most recent thread ID from logs
const threadId = '0a8e2629-8f5e-4f51-b85e-8fec7fa0c29a'; // You'll need to provide this

try {
  const thread = await getChatThread(threadId);
  console.log('Equipment context from DB:');
  console.log(JSON.stringify(thread.equipment_context, null, 2));
} catch (error) {
  console.error('Error:', error.message);
}

process.exit(0);

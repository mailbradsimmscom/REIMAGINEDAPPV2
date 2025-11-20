import { getChatThread } from './src/repositories/chat.repository.js';

async function testGetChatThread() {
  // Use the most recent thread ID from earlier tests
  const threadId = '56601a56-fb48-4c72-8e18-99bdbeade73c';

  console.log('\n=== Testing getChatThread() Function ===\n');
  console.log('Thread ID:', threadId);

  try {
    const result = await getChatThread(threadId);

    console.log('\n📊 Result from getChatThread():');
    console.log('Result exists:', !!result);
    console.log('Result type:', typeof result);
    console.log('Is object:', typeof result === 'object' && result !== null);

    if (result) {
      console.log('\n📋 Keys in result:', Object.keys(result));

      console.log('\n🔧 Equipment Context Field:');
      console.log('Has equipment_context key:', 'equipment_context' in result);
      console.log('equipment_context value:', result.equipment_context);
      console.log('equipment_context type:', typeof result.equipment_context);
      console.log('Is Array:', Array.isArray(result.equipment_context));
      console.log('Length:', result.equipment_context?.length);

      if (result.equipment_context) {
        console.log('\n📦 Equipment Context Contents:');
        console.log(JSON.stringify(result.equipment_context, null, 2));
      } else {
        console.log('\n⚠️ equipment_context is:', result.equipment_context);
      }

      console.log('\n📄 Full Result Object:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n❌ Result is null or undefined');
    }

  } catch (error) {
    console.error('\n❌ Error calling getChatThread:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  }

  process.exit(0);
}

testGetChatThread();

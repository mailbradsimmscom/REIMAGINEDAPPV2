#!/usr/bin/env node

/**
 * Cleanup test data from Supabase.
 * Removes all rows with test prefixes from specified tables.
 *
 * Usage: node scripts/cleanup-test-data.js
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

/**
 * Tables and cleanup strategies
 * - For chat_threads: id is UUID, can't LIKE on it. Use name='New Thread' to identify test threads.
 * - For chat_messages: need to delete by thread_id (foreign key to chat_threads)
 * - For chat_sessions: id is UUID, use session_id if text
 */

async function cleanupTestData() {
  console.log('Cleaning up test data...\n');

  const supabase = await getSupabaseClient();

  if (!supabase) {
    console.error('ERROR: Could not connect to Supabase. Check SUPABASE_URL and service key.');
    process.exit(1);
  }

  let totalDeleted = 0;

  // ============================================
  // STEP 1: Find test threads (name = 'New Thread' with low message count)
  // ============================================
  console.log('Finding test threads...');

  const { data: testThreads, error: findError } = await supabase
    .from('chat_threads')
    .select('id')
    .eq('name', 'New Thread')
    .lte('message_count', 5);  // Test threads typically have few messages

  if (findError) {
    console.log(`  Error finding test threads: ${findError.message}`);
  } else if (!testThreads || testThreads.length === 0) {
    console.log('  No test threads found');
  } else {
    const threadIds = testThreads.map(t => t.id);
    console.log(`  Found ${threadIds.length} test threads to clean up`);

    // ============================================
    // STEP 2: Delete messages from these threads first (foreign key constraint)
    // ============================================
    console.log('\nDeleting chat messages from test threads...');

    const { error: msgDeleteError, count: msgCount } = await supabase
      .from('chat_messages')
      .delete({ count: 'exact' })
      .in('thread_id', threadIds);

    if (msgDeleteError) {
      console.log(`  Error deleting messages: ${msgDeleteError.message}`);
    } else {
      console.log(`  Deleted ${msgCount || 0} messages`);
      totalDeleted += msgCount || 0;
    }

    // ============================================
    // STEP 3: Delete the test threads
    // ============================================
    console.log('\nDeleting test threads...');

    const { error: threadDeleteError, count: threadCount } = await supabase
      .from('chat_threads')
      .delete({ count: 'exact' })
      .in('id', threadIds);

    if (threadDeleteError) {
      console.log(`  Error deleting threads: ${threadDeleteError.message}`);
    } else {
      console.log(`  Deleted ${threadCount || 0} threads`);
      totalDeleted += threadCount || 0;
    }
  }

  // ============================================
  // STEP 4: Clean up chat_sessions with test patterns in session_id (if text column)
  // ============================================
  console.log('\nCleaning chat_sessions...');

  const testPatterns = ['test-%', 'test\\_%', 'timing-test-%'];
  for (const pattern of testPatterns) {
    try {
      const { error: sessionDeleteError, count: sessionCount } = await supabase
        .from('chat_sessions')
        .delete({ count: 'exact' })
        .like('session_id', pattern);

      if (sessionDeleteError) {
        // Might fail if session_id is UUID - that's OK
        if (!sessionDeleteError.message.includes('operator does not exist')) {
          console.log(`  chat_sessions (${pattern}): ${sessionDeleteError.message}`);
        }
        continue;
      }

      if (sessionCount > 0) {
        console.log(`  Deleted ${sessionCount} sessions matching '${pattern}'`);
        totalDeleted += sessionCount;
      }
    } catch (err) {
      // Ignore
    }
  }

  console.log(`\nTotal deleted: ${totalDeleted} rows`);
  return totalDeleted;
}

// Run if called directly
cleanupTestData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });

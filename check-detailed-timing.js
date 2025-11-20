import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function checkDetailedTiming() {
  const supabase = await getSupabaseClient();

  // Get the most recent thread with good data
  const threadId = '967eac52-f3ae-4f12-9844-f7f2d4e06870'; // Most recent thread

  // Get messages with full metadata
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('\n🔍 DETAILED TIMING BREAKDOWN FOR RECENT CHAT\n');
  console.log('=' .repeat(80));

  messages.forEach((msg, i) => {
    console.log(`\nMessage ${i + 1}: ${msg.content.substring(0, 60)}...`);
    console.log('-'.repeat(80));

    if (msg.metadata) {
      console.log('\n📊 METADATA OBJECT:');
      console.log(JSON.stringify(msg.metadata, null, 2));
    }

    if (msg.processing_metadata) {
      console.log('\n🔧 PROCESSING METADATA:');
      console.log(JSON.stringify(msg.processing_metadata, null, 2));
    }

    // Try to extract timing from different places
    const metadata = msg.metadata || {};
    const procMeta = msg.processing_metadata || {};

    console.log('\n⏱️  TIMING ANALYSIS:');

    // Overall time
    if (metadata.processing_time_ms) {
      console.log(`   TOTAL TIME: ${metadata.processing_time_ms}ms (${(metadata.processing_time_ms/1000).toFixed(1)}s)`);
    }

    // Detailed metrics
    if (metadata.detailed_metrics) {
      const m = metadata.detailed_metrics;
      console.log('\n   Component Breakdown:');

      let componentTotal = 0;

      if (m.classification?.duration_ms) {
        console.log(`   - Classification: ${m.classification.duration_ms}ms`);
        componentTotal += m.classification.duration_ms;
      }

      if (m.pinecone?.search_duration_ms) {
        console.log(`   - Pinecone Search: ${m.pinecone.search_duration_ms}ms`);
        componentTotal += m.pinecone.search_duration_ms;
      }

      if (m.dip_tables?.duration_ms) {
        console.log(`   - DIP Tables: ${m.dip_tables.duration_ms}ms`);
        componentTotal += m.dip_tables.duration_ms;
      }

      if (m.perplexity?.duration_ms) {
        console.log(`   - Perplexity: ${m.perplexity.duration_ms}ms`);
        componentTotal += m.perplexity.duration_ms;
      }

      if (m.synthesis?.duration_ms) {
        console.log(`   - Synthesis: ${m.synthesis.duration_ms}ms`);
        componentTotal += m.synthesis.duration_ms;

        if (m.synthesis.model) {
          console.log(`     • Model: ${m.synthesis.model}`);
        }
        if (m.synthesis.prompt_tokens) {
          console.log(`     • Prompt Tokens: ${m.synthesis.prompt_tokens}`);
        }
        if (m.synthesis.completion_tokens) {
          console.log(`     • Completion Tokens: ${m.synthesis.completion_tokens}`);
        }
      }

      if (componentTotal > 0) {
        console.log(`\n   Component Total: ${componentTotal}ms`);
        if (metadata.processing_time_ms) {
          const unaccounted = metadata.processing_time_ms - componentTotal;
          console.log(`   Unaccounted Time: ${unaccounted}ms (${(unaccounted/1000).toFixed(1)}s)`);
        }
      }
    }

    // Check for systems_found
    if (metadata.systems_found !== undefined) {
      console.log(`\n   Systems Found: ${metadata.systems_found}`);
    }

    // Check for synthesis_model
    if (metadata.synthesis_model) {
      console.log(`   Model Used: ${metadata.synthesis_model}`);
    }

    console.log('\n' + '='.repeat(80));
  });

  process.exit(0);
}

checkDetailedTiming();
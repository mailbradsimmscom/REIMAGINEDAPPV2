import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function checkMessageTiming() {
  const supabase = await getSupabaseClient();

  // Get last few threads
  const { data: threads, error: threadError } = await supabase
    .from('chat_threads')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  if (threadError) {
    console.error('Error fetching threads:', threadError);
    process.exit(1);
  }

  console.log('\n📊 PROCESSING TIME ANALYSIS\n');
  console.log('=' .repeat(80));

  for (const thread of threads) {
    // Get messages for this thread with metadata
    const { data: messages, error: msgError } = await supabase
      .from('chat_messages')
      .select('role, content, metadata, processing_metadata, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });

    if (msgError) {
      console.error('Error fetching messages:', msgError);
      continue;
    }

    console.log(`\n📁 Thread: ${thread.name || thread.id}`);
    console.log(`Created: ${thread.created_at}`);
    console.log('-'.repeat(80));

    messages.forEach((msg, i) => {
      console.log(`\n${i + 1}. [${msg.role.toUpperCase()}] ${msg.content.substring(0, 60)}...`);

      if (msg.metadata) {
        // Check for processing_time_ms in metadata
        if (msg.metadata.processing_time_ms) {
          const seconds = (msg.metadata.processing_time_ms / 1000).toFixed(1);
          console.log(`   ⏱️  Processing Time: ${msg.metadata.processing_time_ms}ms (${seconds}s)`);
        }

        // Check for detailed_metrics
        if (msg.metadata.detailed_metrics) {
          const metrics = msg.metadata.detailed_metrics;
          console.log('   📈 Detailed Metrics:');

          if (metrics.classification) {
            console.log(`      - Classification: ${metrics.classification.duration_ms}ms`);
          }
          if (metrics.pinecone) {
            console.log(`      - Pinecone Search: ${metrics.pinecone.search_duration_ms}ms (${metrics.pinecone.results_count} results)`);
          }
          if (metrics.dip_tables) {
            console.log(`      - DIP Tables: ${metrics.dip_tables.duration_ms}ms`);
          }
          if (metrics.perplexity) {
            console.log(`      - Perplexity: ${metrics.perplexity.duration_ms}ms`);
          }
          if (metrics.synthesis) {
            console.log(`      - Synthesis: ${metrics.synthesis.duration_ms}ms`);
            if (metrics.synthesis.model) {
              console.log(`        Model: ${metrics.synthesis.model}`);
            }
            if (metrics.synthesis.reasoning_tokens) {
              console.log(`        Reasoning Tokens: ${metrics.synthesis.reasoning_tokens}`);
            }
            if (metrics.synthesis.prompt_tokens) {
              console.log(`        Prompt Tokens: ${metrics.synthesis.prompt_tokens}`);
            }
            if (metrics.synthesis.completion_tokens) {
              console.log(`        Completion Tokens: ${metrics.synthesis.completion_tokens}`);
            }
          }
        }

        // Check synthesis_model
        if (msg.metadata.synthesis_model) {
          console.log(`   🤖 Model Used: ${msg.metadata.synthesis_model}`);
        }

        // Check for sources
        if (msg.metadata.sources && msg.metadata.sources.length > 0) {
          console.log(`   📚 Sources: ${msg.metadata.sources.length} sources found`);
          msg.metadata.sources.forEach((source, idx) => {
            if (idx < 2) { // Show first 2 sources
              console.log(`      ${idx + 1}. ${source.type}: ${source.title || 'No title'}`);
            }
          });
        }
      }

      if (msg.processing_metadata) {
        if (msg.processing_metadata.classification) {
          console.log(`   🎯 Classification: ${msg.processing_metadata.classification}`);
        }
      }
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 SUMMARY OF FINDINGS:\n');

  // Calculate averages
  let totalTime = 0;
  let count = 0;
  let gpt5Times = [];
  let gpt4miniTimes = [];

  for (const thread of threads) {
    const { data: messages } = await supabase
      .from('chat_messages')
      .select('metadata')
      .eq('thread_id', thread.id)
      .eq('role', 'assistant');

    if (messages) {
      messages.forEach(msg => {
        if (msg.metadata?.processing_time_ms) {
          totalTime += msg.metadata.processing_time_ms;
          count++;

          if (msg.metadata.synthesis_model === 'gpt-5') {
            gpt5Times.push(msg.metadata.processing_time_ms);
          } else if (msg.metadata.synthesis_model === 'gpt-4.1-mini') {
            gpt4miniTimes.push(msg.metadata.processing_time_ms);
          }
        }
      });
    }
  }

  if (count > 0) {
    console.log(`📊 Average Processing Time: ${(totalTime / count / 1000).toFixed(1)}s`);

    if (gpt5Times.length > 0) {
      const avgGpt5 = gpt5Times.reduce((a, b) => a + b, 0) / gpt5Times.length;
      console.log(`   GPT-5 Average: ${(avgGpt5 / 1000).toFixed(1)}s (${gpt5Times.length} messages)`);
    }

    if (gpt4miniTimes.length > 0) {
      const avgMini = gpt4miniTimes.reduce((a, b) => a + b, 0) / gpt4miniTimes.length;
      console.log(`   GPT-4.1-mini Average: ${(avgMini / 1000).toFixed(1)}s (${gpt4miniTimes.length} messages)`);
    }
  }

  process.exit(0);
}

checkMessageTiming();
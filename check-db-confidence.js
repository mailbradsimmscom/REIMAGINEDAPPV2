import { listThreadsWithSummaries } from './src/repositories/chat.repository.js';

const result = await listThreadsWithSummaries({ limit: 1 });

if (result && result.threads && result.threads.length > 0) {
  const thread = result.threads[0];
  const eq_ctx = thread.equipment_context || [];

  console.log(`✅ Database has ${eq_ctx.length} equipment\n`);
  console.log('First 3 equipment with confidence scores:');

  eq_ctx.slice(0, 3).forEach((eq, i) => {
    console.log(`${i + 1}. ${eq.manufacturer} ${eq.model}`);
    console.log(`   llm_confidence: ${eq.llm_confidence}`);
    console.log(`   llm_role: ${eq.llm_role}`);
    console.log(`   source: ${eq.source}\n`);
  });

  console.log(`\nAll ${eq_ctx.length} equipment confidence scores:`);
  eq_ctx.forEach((eq, i) => {
    console.log(`${i + 1}. ${eq.manufacturer} ${eq.model}: confidence=${eq.llm_confidence}, role=${eq.llm_role}`);
  });
} else {
  console.log('No threads found');
}

process.exit(0);

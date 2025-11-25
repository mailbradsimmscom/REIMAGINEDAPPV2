/**
 * Delete all supplies from database
 * WARNING: This will delete ALL supplies!
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import readline from 'readline';

async function confirmDeletion() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('⚠️  DELETE ALL SUPPLIES? Type "DELETE" to confirm: ', (answer) => {
      rl.close();
      resolve(answer === 'DELETE');
    });
  });
}

async function main() {
  console.log('🗑️  Delete All Supplies\n');

  const supabase = await getSupabaseClient();

  // Get current count
  console.log('📊 Checking current supplies...');
  const { count, error: countError } = await supabase
    .from('supplies')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('❌ Error counting supplies:', countError);
    process.exit(1);
  }

  console.log(`   Found ${count} supplies in database\n`);

  if (count === 0) {
    console.log('✅ Database is already empty!');
    return;
  }

  // Confirm deletion
  const confirmed = await confirmDeletion();

  if (!confirmed) {
    console.log('\n❌ Deletion cancelled');
    process.exit(0);
  }

  // Delete all
  console.log('\n🗑️  Deleting all supplies...');

  // Get all IDs first (Supabase has limits on bulk deletes)
  const { data: supplies, error: fetchError } = await supabase
    .from('supplies')
    .select('id');

  if (fetchError) {
    console.error('❌ Error fetching supplies:', fetchError);
    process.exit(1);
  }

  console.log(`   Deleting ${supplies.length} items...`);

  // Delete in batches of 100
  const batchSize = 100;
  let deleted = 0;

  for (let i = 0; i < supplies.length; i += batchSize) {
    const batch = supplies.slice(i, i + batchSize);
    const ids = batch.map(s => s.id);

    const { error: deleteError } = await supabase
      .from('supplies')
      .delete()
      .in('id', ids);

    if (deleteError) {
      console.error(`❌ Error deleting batch ${i / batchSize + 1}:`, deleteError);
      process.exit(1);
    }

    deleted += batch.length;
    console.log(`   Deleted ${deleted}/${supplies.length} items...`);
  }

  console.log('\n✅ All supplies deleted!\n');

  // Verify
  const { count: finalCount } = await supabase
    .from('supplies')
    .select('*', { count: 'exact', head: true });

  console.log(`Final count: ${finalCount}`);
}

main().catch(console.error);

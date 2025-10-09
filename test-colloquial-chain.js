import documentService from './src/services/document.service.js';
import documentRepository from './src/repositories/document.repository.js';

async function testColloquialChain() {
  try {
    console.log('🧪 Testing Colloquial Extraction Chain\n');
    console.log('=' .repeat(60));

    // Use Marco pump (from the test in the doc)
    const assetUid = 'ea9260bb-f8ee-f895-84e8-0e9651f0c027';
    const manufacturer = 'Marco';
    const model = 'self_priming_transfer_pump';

    console.log('Test equipment:');
    console.log(`  Asset UID: ${assetUid}`);
    console.log(`  Manufacturer: ${manufacturer}`);
    console.log(`  Model: ${model}\n`);

    // Step 1: Run the extraction chain
    console.log('Step 1: Running extractAndUpdateColloquialKeywords()...');
    await documentService.extractAndUpdateColloquialKeywords(
      assetUid,
      manufacturer,
      model
    );

    // Step 2: Verify the result in database
    console.log('\nStep 2: Checking database for stored keywords...');
    const supabase = await documentRepository.checkSupabaseAvailability();
    const { data, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, canonical_model_id, colloquial_keywords')
      .eq('asset_uid', assetUid)
      .single();

    if (error) {
      console.error('❌ Error fetching from database:', error.message);
      return;
    }

    console.log('\n✅ SUCCESS! Keywords stored in database:');
    console.log('=' .repeat(60));
    console.log(`Asset: ${data.manufacturer_norm} ${data.canonical_model_id}`);
    console.log(`\nExtracted keywords:\n${data.colloquial_keywords}`);
    console.log('=' .repeat(60));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testColloquialChain();

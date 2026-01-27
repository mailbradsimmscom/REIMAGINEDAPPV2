const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const assetUids = [
  '75b1f767-c270-4df0-97ae-88cc1f497151',  // CZone / waterproof_keypad
  'd2084302-7190-480e-a255-eef83a24b09b',  // ZeroJet / ZeroJet 350
  'eda02391-1355-4add-b7a6-4c7f5f04dbee'   // Blue Sea / 7700
];

(async () => {
  console.log('Updating Manual_Local_Copy flag for 3 systems...\n');

  for (const uid of assetUids) {
    // Get current state
    const { data: before } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, "Manual_Local_Copy"')
      .eq('asset_uid', uid)
      .single();

    console.log('Before:', before?.manufacturer_norm, '/', before?.model_norm, '- Manual_Local_Copy:', before?.Manual_Local_Copy);

    // Update flag
    const { error } = await supabase
      .from('systems')
      .update({ Manual_Local_Copy: true })
      .eq('asset_uid', uid);

    if (error) {
      console.log('  ERROR:', error.message);
    } else {
      console.log('  Updated to true');
    }
  }

  console.log('\nDone.');
  process.exit(0);
})();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  console.log('Running migration 027_anchorage_photos...\n');

  // Test if photos column already exists by trying to select it
  const { data, error } = await supabase
    .from('anchorages')
    .select('photos')
    .limit(1);

  if (error && error.message.includes('photos')) {
    console.log('photos column: Does not exist yet');
    console.log('\nPlease run this SQL in Supabase SQL Editor:');
    console.log('------------------------------------------');
    console.log('ALTER TABLE anchorages');
    console.log("ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT ARRAY[]::TEXT[];");
    console.log('------------------------------------------');
    process.exit(1);
  } else if (error) {
    console.log('Error checking photos column:', error.message);
    process.exit(1);
  } else {
    console.log('photos column: EXISTS');
    console.log('\nMigration 027 already applied.');
  }

  process.exit(0);
})();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data } = await supabase
    .from('systems')
    .select('*')
    .limit(1);

  if (data && data.length > 0) {
    const cols = Object.keys(data[0]);
    console.log('Systems table columns:');
    cols.forEach(c => console.log('  -', c));
    
    // Check for manual-related columns
    const manualCols = cols.filter(c => c.toLowerCase().includes('manual'));
    console.log('\nManual-related columns:', manualCols);
  }
  process.exit(0);
})();

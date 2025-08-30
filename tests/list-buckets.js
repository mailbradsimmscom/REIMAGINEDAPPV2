import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function listBuckets() {
  try {
    console.log('Listing existing buckets...');
    
    const { data, error } = await supabase.storage.listBuckets();

    if (error) {
      console.error('Error listing buckets:', error);
      return;
    }

    console.log('Existing buckets:', data);
    
    if (data && data.length > 0) {
      console.log('\nAvailable bucket names:');
      data.forEach(bucket => {
        console.log(`- ${bucket.name} (public: ${bucket.public})`);
      });
    } else {
      console.log('No buckets found');
    }
  } catch (error) {
    console.error('Failed to list buckets:', error);
  }
}

listBuckets();

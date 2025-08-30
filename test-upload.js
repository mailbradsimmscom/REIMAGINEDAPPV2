import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpload() {
  try {
    console.log('Testing file upload...');
    
    // Create a test file content
    const testContent = 'This is a test PDF content';
    const testFileName = 'test.pdf';
    const docId = createHash('sha256').update(testContent).digest('hex');
    
    console.log('Doc ID:', docId);
    console.log('File name:', testFileName);
    
    // Try to upload to documents bucket
    const filePath = `manuals/${docId}/${testFileName}`;
    console.log('File path:', filePath);
    
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(filePath, testContent, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (error) {
      console.error('Upload error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('Upload successful:', data);
    
    // Try to download the file
    console.log('\nTesting file download...');
    const { data: downloadData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(filePath);

    if (downloadError) {
      console.error('Download error:', downloadError);
      return;
    }

    console.log('Download successful:', downloadData);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testUpload();

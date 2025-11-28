/**
 * Test script for Supabase Storage uploads
 * Run: node test-supabase-storage.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.PY_SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_ROLE_KEY ||
                     process.env.SUPABASE_ANON_KEY;

console.log('=== Supabase Storage Test ===\n');
console.log('SUPABASE_URL:', SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET');
console.log('SUPABASE_KEY:', SUPABASE_KEY ? SUPABASE_KEY.substring(0, 20) + '...' : 'NOT SET');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testStorage() {
  console.log('\n--- Test 1: List Buckets ---');
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error('❌ Error listing buckets:', error.message);
    } else {
      console.log('✓ Buckets found:', buckets.map(b => b.name).join(', '));
    }
  } catch (e) {
    console.error('❌ Exception:', e.message);
  }

  console.log('\n--- Test 2: List files in documents bucket ---');
  try {
    const { data: files, error } = await supabase.storage.from('documents').list('', { limit: 5 });
    if (error) {
      console.error('❌ Error listing files:', error.message);
    } else {
      console.log('✓ Root folders/files:', files.map(f => f.name).join(', ') || '(empty)');
    }
  } catch (e) {
    console.error('❌ Exception:', e.message);
  }

  console.log('\n--- Test 3: List files in documents/supply-photos ---');
  try {
    const { data: files, error } = await supabase.storage.from('documents').list('supply-photos', { limit: 5 });
    if (error) {
      console.error('❌ Error listing supply-photos:', error.message);
    } else {
      console.log('✓ Files in supply-photos:', files.map(f => f.name).join(', ') || '(empty or folder does not exist)');
    }
  } catch (e) {
    console.error('❌ Exception:', e.message);
  }

  console.log('\n--- Test 4: Upload test file to documents/supply-photos ---');
  try {
    const testContent = Buffer.from('test image content ' + Date.now());
    const testPath = `supply-photos/test-${Date.now()}.txt`;

    console.log('Uploading to:', testPath);

    const { data, error } = await supabase.storage
      .from('documents')
      .upload(testPath, testContent, {
        contentType: 'text/plain',
        upsert: true
      });

    if (error) {
      console.error('❌ Upload error:', error.message);
      console.error('   Error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('✓ Upload successful! Path:', data.path);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(testPath);

      console.log('✓ Public URL:', urlData.publicUrl);

      // Clean up - delete test file
      const { error: deleteError } = await supabase.storage
        .from('documents')
        .remove([testPath]);

      if (deleteError) {
        console.log('⚠ Could not delete test file:', deleteError.message);
      } else {
        console.log('✓ Test file cleaned up');
      }
    }
  } catch (e) {
    console.error('❌ Exception:', e.message);
    console.error('   Stack:', e.stack);
  }

  console.log('\n--- Test 5: Upload actual image (small base64) ---');
  try {
    // 1x1 red pixel PNG
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const testPath = `supply-photos/test-image-${Date.now()}.png`;

    console.log('Uploading PNG to:', testPath);

    const { data, error } = await supabase.storage
      .from('documents')
      .upload(testPath, tinyPng, {
        contentType: 'image/png',
        upsert: true
      });

    if (error) {
      console.error('❌ Image upload error:', error.message);
      console.error('   Error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('✓ Image upload successful! Path:', data.path);

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(testPath);

      console.log('✓ Public URL:', urlData.publicUrl);

      // Clean up
      await supabase.storage.from('documents').remove([testPath]);
      console.log('✓ Test image cleaned up');
    }
  } catch (e) {
    console.error('❌ Exception:', e.message);
  }

  console.log('\n=== Test Complete ===');
}

testStorage();

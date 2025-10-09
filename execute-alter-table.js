import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function executeAlterTable() {
  const sql = `
    ALTER TABLE systems
    ADD COLUMN IF NOT EXISTS colloquial_keywords text;
  `;

  try {
    console.log('Executing ALTER TABLE command...');

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/query`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        query: sql
      })
    });

    const result = await response.text();

    if (response.ok) {
      console.log('✅ ALTER TABLE executed successfully');
    } else {
      // This is expected - Supabase doesn't allow DDL through REST API
      // Let's try a different approach - directly check if column exists
      console.log('Note: Direct SQL execution not available through REST API');
      console.log('Checking if column already exists...');

      // Try to query the column
      const testResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/systems?select=asset_uid,colloquial_keywords&limit=1`,
        {
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          }
        }
      );

      if (testResponse.ok) {
        const data = await testResponse.json();
        console.log('✅ Column colloquial_keywords exists in systems table!');
        console.log('Sample query result:', data);
      } else {
        const error = await testResponse.text();
        if (error.includes("column systems.colloquial_keywords does not exist")) {
          console.log('\n❌ Column colloquial_keywords does NOT exist yet');
          console.log('\n' + '='.repeat(80));
          console.log('MANUAL ACTION REQUIRED:');
          console.log('Please go to your Supabase Dashboard and execute this SQL:');
          console.log('='.repeat(80));
          console.log(sql);
          console.log('='.repeat(80));
          console.log('\nSteps:');
          console.log('1. Open https://supabase.com/dashboard');
          console.log('2. Select your project');
          console.log('3. Go to SQL Editor');
          console.log('4. Paste and execute the SQL above');
          console.log('5. Then run this script again to verify');
        } else {
          console.log('Unexpected response:', error);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

executeAlterTable();
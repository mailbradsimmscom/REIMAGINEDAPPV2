import { getSupabaseClient } from './src/repositories/supabaseClient.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const execAsync = promisify(exec);

async function createDatabaseBackup() {
  try {
    // Get Supabase connection details from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase environment variables');
      return;
    }
    
    // Extract database connection details from Supabase URL
    // Supabase URL format: https://project-ref.supabase.co
    const urlMatch = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (!urlMatch) {
      console.error('Invalid Supabase URL format');
      return;
    }
    
    const projectRef = urlMatch[1];
    
    // Create backup directory if it doesn't exist
    const backupDir = './backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Generate timestamp for backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `supabase-backup-${timestamp}.sql`);
    
    console.log('Creating database backup...');
    console.log(`Project: ${projectRef}`);
    console.log(`Backup file: ${backupFile}`);
    
    // Use npx to run Supabase CLI without global installation
    const command = `npx supabase@latest db dump --project-ref ${projectRef} --file ${backupFile}`;
    
    console.log(`Running: ${command}`);
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      console.error('Backup stderr:', stderr);
    }
    
    if (stdout) {
      console.log('Backup stdout:', stdout);
    }
    
    // Check if backup file was created
    if (fs.existsSync(backupFile)) {
      const stats = fs.statSync(backupFile);
      console.log(`✅ Backup created successfully!`);
      console.log(`📁 File: ${backupFile}`);
      console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`🕒 Created: ${stats.birthtime}`);
    } else {
      console.error('❌ Backup file was not created');
    }
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    
    if (error.message.includes('supabase: command not found') || error.message.includes('npx')) {
      console.log('\n💡 The script will automatically download and use Supabase CLI via npx');
      console.log('   No global installation needed!');
    }
  }
}

// Run the backup
createDatabaseBackup();

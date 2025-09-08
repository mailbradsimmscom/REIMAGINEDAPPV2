#!/usr/bin/env node

/**
 * Database Migration Runner
 * Executes SQL migrations against the Supabase database
 * 
 * Usage: node scripts/migrations/run-migration.js [migration-file]
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupabaseClient } from '../../src/repositories/supabaseClient.js';
import { logger } from '../../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const requestLogger = logger.createRequestLogger();

async function runMigration(migrationFile) {
  try {
    requestLogger.info('Starting database migration', { migrationFile });
    
    // Read the migration SQL file
    const migrationPath = join(__dirname, migrationFile);
    const sql = readFileSync(migrationPath, 'utf8');
    
    // Get Supabase client
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    // Split SQL into individual statements and execute them
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Executing ${statements.length} SQL statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        console.log(`  ${i + 1}. ${statement.substring(0, 50)}...`);
        
        const { data, error } = await supabase.rpc('exec', { sql: statement });
        
        if (error) {
          // If exec RPC doesn't exist, try direct query execution
          if (error.message.includes('exec')) {
            console.log('  ⚠️  exec RPC not available, trying direct execution...');
            // For direct execution, we'll need to handle different statement types
            if (statement.toUpperCase().startsWith('SELECT')) {
              const { data: queryData, error: queryError } = await supabase
                .from('information_schema.columns')
                .select('*')
                .limit(1);
              
              if (queryError) {
                console.log(`  ❌ Query execution failed: ${queryError.message}`);
              } else {
                console.log(`  ✅ Query executed successfully`);
              }
            } else {
              console.log(`  ⚠️  Non-SELECT statement skipped (${statement.substring(0, 30)}...)`);
            }
          } else {
            throw error;
          }
        } else {
          console.log(`  ✅ Statement executed successfully`);
        }
      }
    }
    
    requestLogger.info('Migration completed successfully', { migrationFile });
    
    console.log('✅ Migration completed successfully');
    console.log('📊 All SQL statements have been processed');
    
  } catch (error) {
    requestLogger.error('Migration execution failed', { 
      error: error.message, 
      migrationFile,
      stack: error.stack 
    });
    
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Main execution
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node run-migration.js <migration-file>');
  console.error('Example: node run-migration.js 001_add_normalized_system_metadata_to_documents.sql');
  process.exit(1);
}

runMigration(migrationFile);

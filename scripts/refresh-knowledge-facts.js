#!/usr/bin/env node

/**
 * View Refresh Script
 * Manually refreshes the knowledge_facts materialized view
 * 
 * Usage:
 *   node scripts/refresh-knowledge-facts.js [options]
 * 
 * Options:
 *   --health-check    Check view health before refreshing
 *   --stats          Show view statistics after refresh
 *   --help           Show this help message
 */

import { logger } from '../src/utils/logger.js';
import viewRefreshService from '../src/services/viewRefresh.service.js';

const scriptLogger = logger.createRequestLogger();

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    healthCheck: false,
    stats: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--health-check':
        options.healthCheck = true;
        break;
      case '--stats':
        options.stats = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
View Refresh Script
Manually refreshes the knowledge_facts materialized view

Usage:
  node scripts/refresh-knowledge-facts.js [options]

Options:
  --health-check    Check view health before refreshing
  --stats          Show view statistics after refresh
  --help           Show this help message

Examples:
  # Basic refresh
  node scripts/refresh-knowledge-facts.js

  # Check health first, then refresh, then show stats
  node scripts/refresh-knowledge-facts.js --health-check --stats

  # Just check health without refreshing
  node scripts/refresh-knowledge-facts.js --health-check
`);
}

// Main refresh function
async function refreshKnowledgeFacts(options) {
  try {
    scriptLogger.info('Starting knowledge facts view refresh', options);

    // Health check if requested
    if (options.healthCheck) {
      console.log('🔍 Checking view health...');
      const health = await viewRefreshService.checkViewHealth();
      
      if (!health.healthy) {
        console.error('❌ View health check failed:', health.error);
        if (!health.exists) {
          console.error('   The knowledge_facts view does not exist. Please run the migration first.');
          process.exit(1);
        }
        console.error('   Proceeding with refresh anyway...');
      } else {
        console.log('✅ View is healthy and accessible');
        if (health.sampleData) {
          console.log(`   Sample data: ${health.sampleData.fact_type}`);
        }
      }
    }

    // Get stats before refresh if requested
    if (options.stats) {
      console.log('📊 Getting pre-refresh statistics...');
      try {
        const stats = await viewRefreshService.getViewRefreshStats();
        console.log(`   Total facts: ${stats.data.totalFacts}`);
        console.log(`   Fact types:`, stats.data.factTypes);
      } catch (error) {
        console.warn('⚠️  Could not get pre-refresh stats:', error.message);
      }
    }

    // Perform the refresh
    console.log('🔄 Refreshing knowledge_facts view...');
    const result = await viewRefreshService.refreshKnowledgeFactsViewSafe();
    
    if (result.success) {
      console.log(`✅ View refreshed successfully using ${result.method} method`);
    } else {
      console.error('❌ View refresh failed:', result.error);
      process.exit(1);
    }

    // Get stats after refresh if requested
    if (options.stats) {
      console.log('📊 Getting post-refresh statistics...');
      try {
        const stats = await viewRefreshService.getViewRefreshStats();
        console.log(`   Total facts: ${stats.data.totalFacts}`);
        console.log(`   Fact types:`, stats.data.factTypes);
      } catch (error) {
        console.warn('⚠️  Could not get post-refresh stats:', error.message);
      }
    }

    scriptLogger.info('Knowledge facts view refresh completed', { 
      success: result.success,
      method: result.method,
      options
    });

    console.log('\n🎉 View refresh completed successfully!');
    return result;

  } catch (error) {
    scriptLogger.error('View refresh failed', { error: error.message });
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('🚀 Starting Knowledge Facts View Refresh...');
  console.log('Options:', options);

  try {
    await refreshKnowledgeFacts(options);
  } catch (error) {
    console.error('\n❌ View refresh failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { refreshKnowledgeFacts, parseArgs, showHelp };

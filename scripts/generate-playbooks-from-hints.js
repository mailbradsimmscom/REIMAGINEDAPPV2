#!/usr/bin/env node

/**
 * Playbook Generation Script
 * Generates structured playbooks from approved playbook hints
 * 
 * Usage:
 *   node scripts/generate-playbooks-from-hints.js [options]
 * 
 * Options:
 *   --system <name>     Generate playbooks for specific system
 *   --subsystem <name>  Generate playbooks for specific subsystem
 *   --doc-id <id>       Generate playbooks for specific document
 *   --dry-run          Show what would be generated without creating
 *   --force            Overwrite existing playbooks
 *   --help             Show this help message
 */

import { logger } from '../src/utils/logger.js';
import playbookRepository from '../src/repositories/playbook.repository.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

const scriptLogger = logger.createRequestLogger();

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    system: null,
    subsystem: null,
    docId: null,
    dryRun: false,
    force: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--system':
        options.system = args[++i];
        break;
      case '--subsystem':
        options.subsystem = args[++i];
        break;
      case '--doc-id':
        options.docId = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
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
Playbook Generation Script
Generates structured playbooks from approved playbook hints

Usage:
  node scripts/generate-playbooks-from-hints.js [options]

Options:
  --system <name>     Generate playbooks for specific system
  --subsystem <name>  Generate playbooks for specific subsystem  
  --doc-id <id>       Generate playbooks for specific document
  --dry-run          Show what would be generated without creating
  --force            Overwrite existing playbooks
  --help             Show this help message

Examples:
  # Generate all playbooks
  node scripts/generate-playbooks-from-hints.js

  # Generate playbooks for a specific system
  node scripts/generate-playbooks-from-hints.js --system "water-treatment"

  # Dry run to see what would be generated
  node scripts/generate-playbooks-from-hints.js --dry-run

  # Force overwrite existing playbooks
  node scripts/generate-playbooks-from-hints.js --force
`);
}

// Generate playbook title from system/subsystem
function generatePlaybookTitle(systemNorm, subsystemNorm) {
  const system = systemNorm || 'General';
  const subsystem = subsystemNorm || 'Maintenance';
  
  return `${system} - ${subsystem} Playbook`;
}

// Generate steps from playbook hints
function generateStepsFromHints(hints) {
  return hints.map((hint, index) => ({
    step_number: index + 1,
    instruction: hint.test_name || hint.description || `Step ${index + 1}`,
    source_hint_id: hint.id,
    doc_id: hint.doc_id
  }));
}

// Main generation function
async function generatePlaybooks(options) {
  try {
    scriptLogger.info('Starting playbook generation', options);

    // Get playbook hints grouped by system/subsystem
    const filters = {};
    if (options.system) filters.system_norm = options.system;
    if (options.subsystem) filters.subsystem_norm = options.subsystem;
    if (options.docId) filters.doc_id = options.docId;

    const { data: hintGroups, error } = await playbookRepository.getPlaybookHintsForGeneration(filters);
    if (error) throw error;

    if (!hintGroups || hintGroups.length === 0) {
      scriptLogger.info('No playbook hints found for generation', { filters });
      return;
    }

    scriptLogger.info(`Found ${hintGroups.length} system/subsystem groups with playbook hints`);

    const results = {
      generated: 0,
      skipped: 0,
      errors: 0,
      playbooks: []
    };

    for (const group of hintGroups) {
      try {
        const { system_norm, subsystem_norm, doc_id, hints } = group;
        
        // Check if playbook already exists
        const existingPlaybook = await playbookRepository.checkPlaybookExists(system_norm, subsystem_norm);
        
        if (existingPlaybook.data && !options.force) {
          scriptLogger.info(`Skipping existing playbook: ${existingPlaybook.data.title}`, {
            system_norm,
            subsystem_norm
          });
          results.skipped++;
          continue;
        }

        // Generate playbook data
        const playbookData = {
          title: generatePlaybookTitle(system_norm, subsystem_norm),
          system_norm,
          subsystem_norm,
          doc_id
        };

        const steps = generateStepsFromHints(hints);

        if (options.dryRun) {
          scriptLogger.info('DRY RUN: Would generate playbook', {
            title: playbookData.title,
            system_norm,
            subsystem_norm,
            stepsCount: steps.length,
            hints: hints.map(h => h.test_name || h.description)
          });
          results.playbooks.push({
            ...playbookData,
            steps,
            hints: hints.map(h => h.test_name || h.description)
          });
          results.generated++;
        } else {
          // Delete existing playbook if force is enabled
          if (existingPlaybook.data && options.force) {
            await playbookRepository.deletePlaybook(existingPlaybook.data.playbook_id);
            scriptLogger.info('Deleted existing playbook', { playbookId: existingPlaybook.data.playbook_id });
          }

          // Create new playbook
          const result = await playbookRepository.createPlaybook(playbookData, steps, 'script');
          
          scriptLogger.info('Generated playbook', {
            playbookId: result.data.playbook_id,
            title: result.data.title,
            stepsCount: steps.length
          });

          results.playbooks.push({
            playbookId: result.data.playbook_id,
            ...playbookData,
            stepsCount: steps.length
          });
          results.generated++;
        }
      } catch (error) {
        scriptLogger.error('Failed to generate playbook for group', {
          error: error.message,
          system_norm: group.system_norm,
          subsystem_norm: group.subsystem_norm
        });
        results.errors++;
      }
    }

    // Print summary
    console.log('\n🎯 Playbook Generation Summary:');
    console.log(`✅ Generated: ${results.generated}`);
    console.log(`⏭️  Skipped: ${results.skipped}`);
    console.log(`❌ Errors: ${results.errors}`);
    
    if (results.playbooks.length > 0) {
      console.log('\n📋 Generated Playbooks:');
      results.playbooks.forEach(playbook => {
        console.log(`  • ${playbook.title} (${playbook.stepsCount || playbook.steps?.length || 0} steps)`);
      });
    }

    scriptLogger.info('Playbook generation completed', results);
    return results;

  } catch (error) {
    scriptLogger.error('Playbook generation failed', { error: error.message });
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

  console.log('🚀 Starting Playbook Generation...');
  console.log('Options:', options);

  try {
    await generatePlaybooks(options);
    console.log('\n✅ Playbook generation completed successfully!');
  } catch (error) {
    console.error('\n❌ Playbook generation failed:', error.message);
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

export { generatePlaybooks, parseArgs, showHelp };

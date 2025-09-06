/**
 * Suggestions apply service - merges accepted suggestions into JSON config files
 * Provides safe application of admin-approved changes with snapshot safety
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createSnapshot } from '../utils/snapshots.service.js';
import { SuggestionsSchema } from '../schemas/ingestion.schema.js';
import { logger } from '../utils/logger.js';

// Configuration file paths
const ENTITIES_FILE = 'src/config/lexicons/entities.json';
const INTENTS_FILE = 'src/config/intents.json';
const MAINTENANCE_FILE = 'src/config/lexicons/maintenance.json';
const UNITS_FILE = 'src/config/lexicons/units.json';
const GOLDENS_DIR = 'tests/goldens';

/**
 * Apply accepted suggestions to configuration files
 * @param {Object} params - Apply parameters
 * @param {string} params.docId - Document ID
 * @param {Object} params.accepted - Accepted suggestions (subset of SuggestionsSchema)
 * @param {Object} params.options - Apply options
 * @returns {Promise<Object>} Apply result with snapshot ID and change counts
 */
export async function applySuggestions({ docId, accepted, options = {} }) {
  const requestLogger = logger.createRequestLogger();
  
  const {
    create_snapshot = true,
    dry_run = false,
    notify_on_completion = false
  } = options;
  
  try {
    // Validate suggestions payload
    const parsed = SuggestionsSchema.safeParse(accepted);
    if (!parsed.success) {
      const error = new Error('Invalid suggestions payload');
      error.details = parsed.error.flatten();
      throw error;
    }
    
    requestLogger.info('Starting suggestions application', {
      docId,
      dryRun: dry_run,
      createSnapshot: create_snapshot
    });
    
    // Create snapshot of target files before changes
    let snapshotId = null;
    if (create_snapshot && !dry_run) {
      const targetFiles = [ENTITIES_FILE, INTENTS_FILE, MAINTENANCE_FILE, UNITS_FILE];
      const snapshot = await createSnapshot(targetFiles);
      snapshotId = snapshot.snapshot_id;
      
      requestLogger.info('Snapshot created before apply', { snapshotId });
    }
    
    const applyResult = {
      doc_id: docId,
      snapshot_id: snapshotId,
      applied_changes: {
        entities: 0,
        playbooks: 0,
        intents: 0,
        units: 0,
        tests: 0
      },
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString(),
      dry_run: dry_run
    };
    
    // Apply entities aliases
    if (accepted.entities?.add_aliases) {
      try {
        const count = await mergeJsonMapArray(ENTITIES_FILE, accepted.entities.add_aliases, dry_run);
        applyResult.applied_changes.entities = count;
        requestLogger.info('Entities applied', { count, dryRun: dry_run });
      } catch (error) {
        applyResult.errors.push(`Entities: ${error.message}`);
        requestLogger.error('Failed to apply entities', { error: error.message });
      }
    }
    
    // Apply intent hints
    if (accepted.intents?.hints?.length) {
      try {
        const count = await mergeIntentHints(INTENTS_FILE, accepted.intents.hints, dry_run);
        applyResult.applied_changes.intents = count;
        requestLogger.info('Intent hints applied', { count, dryRun: dry_run });
      } catch (error) {
        applyResult.errors.push(`Intents: ${error.message}`);
        requestLogger.error('Failed to apply intent hints', { error: error.message });
      }
    }
    
    // Apply playbook bumps into maintenance lexicon
    if (accepted.playbooks && Object.keys(accepted.playbooks).length > 0) {
      try {
        const count = await mergeMaintenanceLexicon(MAINTENANCE_FILE, accepted.playbooks, dry_run);
        applyResult.applied_changes.playbooks = count;
        requestLogger.info('Playbooks applied', { count, dryRun: dry_run });
      } catch (error) {
        applyResult.errors.push(`Playbooks: ${error.message}`);
        requestLogger.error('Failed to apply playbooks', { error: error.message });
      }
    }
    
    // Apply unit suggestions
    if (accepted.units?.suggest_add?.length) {
      try {
        const count = await mergeUnits(UNITS_FILE, accepted.units.suggest_add, dry_run);
        applyResult.applied_changes.units = count;
        requestLogger.info('Units applied', { count, dryRun: dry_run });
      } catch (error) {
        applyResult.errors.push(`Units: ${error.message}`);
        requestLogger.error('Failed to apply units', { error: error.message });
      }
    }
    
    // Write golden tests
    if (accepted.tests?.seed_goldens?.length) {
      try {
        const count = await writeGoldenTests(docId, accepted.tests.seed_goldens, dry_run);
        applyResult.applied_changes.tests = count;
        requestLogger.info('Golden tests written', { count, dryRun: dry_run });
      } catch (error) {
        applyResult.errors.push(`Tests: ${error.message}`);
        requestLogger.error('Failed to write golden tests', { error: error.message });
      }
    }
    
    // Calculate total changes
    const totalChanges = Object.values(applyResult.applied_changes).reduce((sum, count) => sum + count, 0);
    
    requestLogger.info('Suggestions application completed', {
      docId,
      totalChanges,
      errorCount: applyResult.errors.length,
      snapshotId,
      dryRun: dry_run,
      action: 'apply_suggestions',
      timestamp: applyResult.timestamp
    });
    
    return applyResult;
    
  } catch (error) {
    requestLogger.error('Suggestions application failed', {
      docId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Read JSON file with fallback
 * @param {string} filePath - File path
 * @param {any} fallback - Fallback value if file doesn't exist
 * @returns {Promise<any>} Parsed JSON or fallback
 */
async function readJson(filePath, fallback = {}) {
  try {
    const absPath = path.resolve(process.cwd(), filePath);
    const content = await fs.readFile(absPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

/**
 * Write JSON file
 * @param {string} filePath - File path
 * @param {any} data - Data to write
 * @param {boolean} dryRun - If true, don't actually write
 * @returns {Promise<void>}
 */
async function writeJson(filePath, data, dryRun = false) {
  if (dryRun) return;
  
  const absPath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, JSON.stringify(data, null, 2));
}

/**
 * Merge JSON map arrays (for entities aliases)
 * @param {string} targetFile - Target file path
 * @param {Object} addMap - Map of keys to arrays to add
 * @param {boolean} dryRun - If true, don't actually write
 * @returns {Promise<number>} Number of items added
 */
async function mergeJsonMapArray(targetFile, addMap, dryRun = false) {
  const current = await readJson(targetFile, { aliases: {} });
  
  // Normalize into flat record<string, string[]>
  const base = (Array.isArray(current) || current.aliases) ? (current.aliases || {}) : current;
  const merged = { ...base };
  
  let addedCount = 0;
  
  for (const [key, newItems] of Object.entries(addMap)) {
    if (!Array.isArray(newItems)) continue;
    
    const existing = new Set(merged[key] || []);
    const beforeSize = existing.size;
    
    for (const item of newItems) {
      if (item && typeof item === 'string' && item.trim()) {
        existing.add(item.trim());
      }
    }
    
    merged[key] = Array.from(existing).sort((a, b) => a.localeCompare(b));
    addedCount += existing.size - beforeSize;
  }
  
  // Preserve original shape if it had { aliases: {...} }
  const toWrite = current.aliases ? { aliases: merged } : merged;
  await writeJson(targetFile, toWrite, dryRun);
  
  return addedCount;
}

/**
 * Merge intent hints into intents configuration
 * @param {string} filePath - Intents file path
 * @param {Array} hints - Intent hints to add
 * @param {boolean} dryRun - If true, don't actually write
 * @returns {Promise<number>} Number of hints added
 */
async function mergeIntentHints(filePath, hints, dryRun = false) {
  const current = await readJson(filePath, { patterns: [] });
  const patterns = Array.isArray(current.patterns) ? [...current.patterns] : [];
  
  let addedCount = 0;
  
  for (const hint of hints) {
    if (!hint.intent || typeof hint.raise_to !== 'number') continue;
    
    const regex = `\\b(${hint.intent.toLowerCase()})\\b`;
    const newPattern = {
      intent: hint.intent.toUpperCase(),
      regex: regex,
      weight: Math.max(0, Math.min(1, hint.raise_to))
    };
    
    // Check if pattern already exists
    const exists = patterns.some(p => 
      p.intent === newPattern.intent && p.regex === newPattern.regex
    );
    
    if (!exists) {
      patterns.push(newPattern);
      addedCount++;
    }
  }
  
  await writeJson(filePath, { patterns }, dryRun);
  return addedCount;
}

/**
 * Merge maintenance lexicon with playbook suggestions
 * @param {string} filePath - Maintenance file path
 * @param {Object} playbooks - Playbook suggestions
 * @param {boolean} dryRun - If true, don't actually write
 * @returns {Promise<number>} Number of items added
 */
async function mergeMaintenanceLexicon(filePath, playbooks, dryRun = false) {
  const current = await readJson(filePath, { 
    maintenance_tokens: [], 
    interval_regexes: [] 
  });
  
  const tokens = new Set(current.maintenance_tokens || []);
  const regexes = new Set(current.interval_regexes || []);
  
  let addedCount = 0;
  
  for (const playbook of Object.values(playbooks)) {
    // Add boost tokens
    if (Array.isArray(playbook.boost_add)) {
      for (const token of playbook.boost_add) {
        if (token && typeof token === 'string' && token.trim()) {
          const trimmed = token.trim();
          if (!tokens.has(trimmed)) {
            tokens.add(trimmed);
            addedCount++;
          }
        }
      }
    }
    
    // Add filter regexes
    if (Array.isArray(playbook.filters_add)) {
      for (const regex of playbook.filters_add) {
        if (regex && typeof regex === 'string' && regex.trim()) {
          const trimmed = regex.trim();
          if (!regexes.has(trimmed)) {
            regexes.add(trimmed);
            addedCount++;
          }
        }
      }
    }
  }
  
  const updated = {
    maintenance_tokens: Array.from(tokens).sort((a, b) => a.localeCompare(b)),
    interval_regexes: Array.from(regexes)
  };
  
  await writeJson(filePath, updated, dryRun);
  return addedCount;
}

/**
 * Merge units suggestions into units configuration
 * @param {string} filePath - Units file path
 * @param {Array} suggestions - Unit suggestions to add
 * @param {boolean} dryRun - If true, don't actually write
 * @returns {Promise<number>} Number of units added
 */
async function mergeUnits(filePath, suggestions, dryRun = false) {
  const current = await readJson(filePath, {});
  
  let addedCount = 0;
  
  for (const suggestion of suggestions) {
    if (!suggestion.alias || !suggestion.suggestedGroup) continue;
    
    const group = suggestion.suggestedGroup;
    const alias = suggestion.alias.trim();
    
    if (!alias) continue;
    
    const groupArray = current[group] || [];
    
    // Find or create "other" bucket for new aliases
    let otherBucket = groupArray.find(item => 
      item && item.canonical === 'other'
    );
    
    if (!otherBucket) {
      otherBucket = { canonical: 'other', aliases: [] };
      groupArray.push(otherBucket);
    }
    
    // Add alias if not already present
    const existingAliases = new Set(otherBucket.aliases || []);
    if (!existingAliases.has(alias)) {
      existingAliases.add(alias);
      otherBucket.aliases = Array.from(existingAliases).sort((a, b) => a.localeCompare(b));
      addedCount++;
    }
    
    current[group] = groupArray;
  }
  
  await writeJson(filePath, current, dryRun);
  return addedCount;
}

/**
 * Write golden test files
 * @param {string} docId - Document ID
 * @param {Array} goldenTests - Test cases to write
 * @param {boolean} dryRun - If true, don't actually write
 * @returns {Promise<number>} Number of tests written
 */
async function writeGoldenTests(docId, goldenTests, dryRun = false) {
  if (!Array.isArray(goldenTests) || goldenTests.length === 0) {
    return 0;
  }
  
  const safeDocId = safeName(docId || 'system');
  const fileName = `${safeDocId}.json`;
  const filePath = path.join(GOLDENS_DIR, fileName);
  
  const testData = {
    entity_hint: docId,
    created_at: new Date().toISOString(),
    cases: goldenTests.map(testCase => ({
      intent: 'AUTO',
      q: testCase,
      expected_entities: [],
      expected_intent: 'maintenance'
    }))
  };
  
  await writeJson(filePath, testData, dryRun);
  return goldenTests.length;
}

/**
 * Create safe filename from string
 * @param {string} name - Name to make safe
 * @returns {string} Safe filename
 */
function safeName(name) {
  return String(name || 'system')
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/(^\-|\-$)/g, '');
}

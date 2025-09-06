/**
 * Config guard service - ensure critical lexicon files exist
 * Seeds defaults if missing to make startup resilient
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const MAINT_PATH = 'src/config/lexicons/maintenance.json';
const UNITS_PATH = 'src/config/lexicons/units.json';

/**
 * Ensure critical lexicon files exist with sensible defaults
 * @returns {Promise<void>}
 */
export async function ensureLexicons() {
  await ensureFile(MAINT_PATH, defaultMaintenance());
  await ensureFile(UNITS_PATH, defaultUnits());
}

/**
 * Ensure a file exists, create with default content if missing
 * @param {string} relPath - Relative file path
 * @param {Object} seedObj - Default object to write if file doesn't exist
 * @returns {Promise<void>}
 */
async function ensureFile(relPath, seedObj) {
  const abs = path.resolve(process.cwd(), relPath);
  
  try {
    await fs.access(abs);
    // File exists - validate it's valid JSON
    const txt = await fs.readFile(abs, 'utf-8');
    JSON.parse(txt);
  } catch {
    // File doesn't exist or is invalid JSON - create it
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(seedObj, null, 2), 'utf-8');
  }
}

/**
 * Default maintenance lexicon content
 * @returns {Object} Default maintenance configuration
 */
function defaultMaintenance() {
  return {
    maintenance_tokens: [
      "filter", "filters", "micron", "cartridge", "carbon", "active carbon",
      "replace", "replacement", "interval", "maintenance", "service", "hours", "year", "schedule",
      "pre-filter", "pre filter", "strainer", "membrane", "flush", "flushing"
    ],
    interval_regexes: [
      "every\\s+\\d+(?:-\\d+)?\\s+(?:hours?|days?|weeks?|months?|years?)",
      "once\\s+per\\s+(?:day|week|month|year)",
      "\\b\\d+\\s*(?:hours?|days?|weeks?|months?|years?)\\b"
    ]
  };
}

/**
 * Default units lexicon content
 * @returns {Object} Default units configuration
 */
function defaultUnits() {
  return {
    length: [
      { "canonical": "m",  "aliases": ["m", "meter", "metre"] },
      { "canonical": "ft", "aliases": ["ft", "feet", "′", "'"] },
      { "canonical": "in", "aliases": ["in", "inch", "inches", "″", "\""] }
    ],
    pressure: [
      { "canonical": "bar", "aliases": ["bar"] },
      { "canonical": "kPa", "aliases": ["kpa", "kPa"] },
      { "canonical": "psi", "aliases": ["psi"] }
    ],
    power: [
      { "canonical": "kW", "aliases": ["kw", "kW"] },
      { "canonical": "hp", "aliases": ["hp", "horsepower"] }
    ],
    torque: [
      { "canonical": "N·m", "aliases": ["n·m", "n-m", "nm", "Nm"] }
    ]
  };
}

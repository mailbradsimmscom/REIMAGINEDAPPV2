import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load patterns from JSON file
const patternsPath = join(__dirname, '../../config/query-normalizer.json');
const patterns = JSON.parse(readFileSync(patternsPath, 'utf8'));

const STOP_PREFIXES = patterns.map(p => new RegExp(p, 'i'));

/**
 * Normalize user query by removing common filler phrases
 * @param {string} raw - Raw user input
 * @returns {string} - Normalized query
 */
export function normalizeQuery(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let q = raw.trim();

  for (const rx of STOP_PREFIXES) {
    if (rx.test(q)) {
      q = q.replace(rx, '');
      break;
    }
  }

  return q.replace(/\s+/g, ' ').trim();
}

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load patterns from JSON file
const patternsPath = join(__dirname, '../../config/query-normalizer.json');
const patterns = JSON.parse(readFileSync(patternsPath, 'utf8'));

const STOP_PREFIXES = patterns.map(p => new RegExp(p, 'i'));

// Stop words to remove (from extractKeywords in chat-proxy.service.js)
const STOP_WORDS = new Set(['tell', 'me', 'about', 'my', 'the', 'a', 'an', 'is', 'are', 'what', 'how', 'when', 'where', 'why', 'which', 'who', 'can', 'could', 'would', 'should', 'will', 'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been', 'being', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'from', 'by', 'it', 'its', 'this', 'that', 'these', 'those']);

/**
 * Normalize user query by removing common filler phrases and stop words
 * @param {string} raw - Raw user input
 * @returns {string} - Normalized query
 */
export function normalizeQuery(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let q = raw.trim();

  // Step 1: Remove prefix patterns (e.g., "tell me about")
  for (const rx of STOP_PREFIXES) {
    if (rx.test(q)) {
      q = q.replace(rx, '');
      break;
    }
  }

  // Step 2: Remove stop words and filter short words
  const words = q.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));

  return words.join(' ').trim();
}

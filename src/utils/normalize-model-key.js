/**
 * Normalize a model key for canonical matching.
 *
 * Rules: uppercase, strip all whitespace, hyphens, and underscores.
 * Must produce identical output to Python's:
 *   re.sub(r'[\s\-_]', '', raw.upper())
 *
 * Examples:
 *   "VC 20"        → "VC20"
 *   "FUSION-LINK"  → "FUSIONLINK"
 *   "ZEN 150 48VDC"→ "ZEN15048VDC"
 *   "B70770"       → "B70770"
 *
 * @param {string} raw - Raw model string
 * @returns {string} Normalized model key
 */
export function normalizeModelKey(raw) {
  if (!raw) return '';
  return raw.toUpperCase().replace(/[\s\-_]/g, '');
}

/**
 * Nominatim Reverse Geocoding Utility
 * Shared utility for converting coordinates to place names
 *
 * Uses OpenStreetMap Nominatim API with:
 * - Town-first preference (better for sailor recognition)
 * - French Caribbean territory handling
 * - Rate limiting support for batch operations
 */

import { logger } from './logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * French overseas territories that should show territory name instead of "France"
 */
const FRENCH_CARIBBEAN_TERRITORIES = [
  'Guadeloupe',
  'Martinique',
  'Saint Martin',
  'Saint Barthélemy'
];

/**
 * Reverse geocode coordinates to get a place name
 * Optimized for Caribbean sailing locations
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<string|null>} Place name (e.g., "Deshaies, Guadeloupe") or null
 *
 * @example
 * const place = await reverseGeocode(16.3089, -61.7989);
 * // Returns: "Deshaies, Guadeloupe"
 */
export async function reverseGeocode(lat, lon) {
  try {
    // Use zoom 14 for local detail (neighborhood/village level)
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'BoatOS/1.0' }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const address = data.address || {};

    // Prefer town over village (more recognizable names for sailors)
    // e.g., "Deshaies" instead of "Ferry"
    const placeName = address.town || address.village || address.city || address.island ||
           address.municipality || address.county || address.state_district ||
           address.state || null;

    if (!placeName) return null;

    const state = address.state;
    const country = address.country;

    // For French overseas territories, use territory name instead of "France"
    // e.g., "Deshaies, Guadeloupe" instead of "Deshaies, France"
    if (country === 'France' && state && FRENCH_CARIBBEAN_TERRITORIES.includes(state)) {
      return `${placeName}, ${state}`;
    }

    // For other locations, include country for context
    return country ? `${placeName}, ${country}` : placeName;
  } catch (error) {
    requestLogger.warn('Reverse geocode failed', { lat, lon, error: error.message });
    return null;
  }
}

/**
 * Delay helper for rate limiting Nominatim API calls
 * Nominatim requires max 1 request per second
 *
 * @param {number} ms - Milliseconds to delay (default 1100ms for safety margin)
 * @returns {Promise<void>}
 */
export function delay(ms = 1100) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Batch reverse geocode multiple coordinates with rate limiting
 * Respects Nominatim's 1 request/second limit
 *
 * @param {Array<{lat: number, lon: number, id?: string}>} coordinates - Array of coordinate objects
 * @returns {Promise<Array<{lat: number, lon: number, id?: string, placeName: string|null}>>}
 *
 * @example
 * const results = await batchReverseGeocode([
 *   { lat: 16.3089, lon: -61.7989, id: 'trip-1' },
 *   { lat: 14.6167, lon: -61.0667, id: 'trip-2' }
 * ]);
 */
export async function batchReverseGeocode(coordinates) {
  const results = [];

  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];

    // Rate limit: wait between calls (except first)
    if (i > 0) {
      await delay();
    }

    const placeName = await reverseGeocode(coord.lat, coord.lon);
    results.push({
      ...coord,
      placeName
    });
  }

  return results;
}

export default {
  reverseGeocode,
  delay,
  batchReverseGeocode
};

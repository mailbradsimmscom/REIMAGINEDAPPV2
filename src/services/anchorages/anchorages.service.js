/**
 * Anchorages Service
 * Business logic for anchorage and mooring tracking
 */

import { anchoragesRepository } from '../../repositories/anchorages.repository.js';
import { logger } from '../../utils/logger.js';
import { reverseGeocode, delay } from '../../utils/nominatim.js';

const requestLogger = logger.createRequestLogger();

/**
 * Format decimal degrees to nautical format (like B&G display)
 * 14.73022 → "N 14°43.813'"
 * -61.18192 → "W 61°10.915'"
 * @param {number} decimal - Decimal degrees
 * @param {boolean} isLatitude - True for lat (N/S), false for lon (E/W)
 * @returns {string} Formatted coordinate
 */
export function formatCoordinate(decimal, isLatitude) {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const dir = isLatitude
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W');
  return `${dir} ${degrees}°${minutes.toFixed(3)}'`;
}

/**
 * Compute inferred anchor/mooring position (upwind of boat)
 * Uses inverse haversine to find point at given distance and bearing
 * @param {number} boatLat - Boat latitude (decimal degrees)
 * @param {number} boatLon - Boat longitude (decimal degrees)
 * @param {number} scopeMeters - Rode/chain length in meters
 * @param {number} windDir - Wind direction in degrees (where wind comes FROM)
 * @returns {Object} { anchor_lat, anchor_lon }
 */
export function computeAnchorPosition(boatLat, boatLon, scopeMeters, windDir) {
  if (!scopeMeters || scopeMeters <= 0) {
    return { anchor_lat: null, anchor_lon: null };
  }

  // Default wind direction if not available
  const bearing = (windDir || 0) * Math.PI / 180;

  const R = 6371000; // Earth radius in meters
  const lat1 = boatLat * Math.PI / 180;
  const lon1 = boatLon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(scopeMeters / R) +
    Math.cos(lat1) * Math.sin(scopeMeters / R) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(scopeMeters / R) * Math.cos(lat1),
    Math.cos(scopeMeters / R) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    anchor_lat: Math.round((lat2 * 180 / Math.PI) * 100000) / 100000,
    anchor_lon: Math.round((lon2 * 180 / Math.PI) * 100000) / 100000
  };
}

/**
 * Format duration hours into human-readable string
 * @param {number} hours - Duration in hours
 * @returns {string} e.g., "1 day 13 hours", "5 hours"
 */
export function formatDuration(hours) {
  if (!hours || hours < 1) return 'Less than 1 hour';

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  const parts = [];
  if (days === 1) parts.push('1 day');
  else if (days > 1) parts.push(`${days} days`);

  if (remainingHours === 1) parts.push('1 hour');
  else if (remainingHours > 1) parts.push(`${remainingHours} hours`);

  return parts.join(' ') || '0 hours';
}

/**
 * Get compass label for wind direction
 * @param {number} degrees - Wind direction in degrees
 * @returns {string} Compass label (N, NE, E, SE, S, SW, W, NW)
 */
export function getCompassLabel(degrees) {
  if (degrees == null) return '';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

/**
 * List all anchorages with formatted fields
 * @returns {Promise<Array>} Anchorages with computed display fields
 */
export async function listAnchorages() {
  const anchorages = await anchoragesRepository.findAll();

  return anchorages.map(a => ({
    ...a,
    position_formatted: {
      lat: formatCoordinate(a.latitude, true),
      lon: formatCoordinate(a.longitude, false)
    },
    anchor_position_formatted: a.anchor_lat ? {
      lat: formatCoordinate(a.anchor_lat, true),
      lon: formatCoordinate(a.anchor_lon, false)
    } : null,
    duration_formatted: formatDuration(a.duration_hours),
    wind_formatted: a.avg_wind_speed != null
      ? `${a.avg_wind_speed} kts from ${getCompassLabel(a.avg_wind_direction)} (${Math.round(a.avg_wind_direction || 0)}°)`
      : null
  }));
}

/**
 * Get single anchorage by ID
 * @param {string} id - Anchorage UUID
 * @returns {Promise<Object|null>} Anchorage with formatted fields
 */
export async function getAnchorage(id) {
  const anchorage = await anchoragesRepository.findById(id);

  if (!anchorage) return null;

  return {
    ...anchorage,
    position_formatted: {
      lat: formatCoordinate(anchorage.latitude, true),
      lon: formatCoordinate(anchorage.longitude, false)
    },
    anchor_position_formatted: anchorage.anchor_lat ? {
      lat: formatCoordinate(anchorage.anchor_lat, true),
      lon: formatCoordinate(anchorage.anchor_lon, false)
    } : null,
    duration_formatted: formatDuration(anchorage.duration_hours),
    wind_formatted: anchorage.avg_wind_speed != null
      ? `${anchorage.avg_wind_speed} kts from ${getCompassLabel(anchorage.avg_wind_direction)} (${Math.round(anchorage.avg_wind_direction || 0)}°)`
      : null
  };
}

/**
 * Update anchorage - computes anchor position when scope is set
 * @param {string} id - Anchorage UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated anchorage
 */
export async function updateAnchorage(id, updates) {
  // Get current anchorage to compute anchor position if scope changed
  const current = await anchoragesRepository.findById(id);
  if (!current) {
    throw new Error(`Anchorage not found: ${id}`);
  }

  const finalUpdates = { ...updates };

  // If scope is being set/changed, compute anchor position
  if (updates.scope_meters !== undefined) {
    const { anchor_lat, anchor_lon } = computeAnchorPosition(
      current.latitude,
      current.longitude,
      updates.scope_meters,
      current.avg_wind_direction
    );
    finalUpdates.anchor_lat = anchor_lat;
    finalUpdates.anchor_lon = anchor_lon;
  }

  const updated = await anchoragesRepository.update(id, finalUpdates);

  requestLogger.info('Anchorage updated', { id, updates: Object.keys(finalUpdates) });

  return {
    ...updated,
    position_formatted: {
      lat: formatCoordinate(updated.latitude, true),
      lon: formatCoordinate(updated.longitude, false)
    },
    anchor_position_formatted: updated.anchor_lat ? {
      lat: formatCoordinate(updated.anchor_lat, true),
      lon: formatCoordinate(updated.anchor_lon, false)
    } : null
  };
}

/**
 * Delete anchorage
 * @param {string} id - Anchorage UUID
 * @returns {Promise<void>}
 */
export async function deleteAnchorage(id) {
  await anchoragesRepository.remove(id);
  requestLogger.info('Anchorage deleted', { id });
}

/**
 * Calculate distance between two points in degrees (Euclidean)
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distance in degrees
 */
function distanceDegrees(lat1, lon1, lat2, lon2) {
  return Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lon2 - lon1, 2));
}

/**
 * Merge overlapping candidates at the same location
 * Groups candidates within 300m of each other, merges with earliest arrival and latest departure
 * @param {Array} candidates - Raw candidates from detection
 * @returns {Array} Merged candidates
 */
function mergeCandidates(candidates) {
  if (candidates.length <= 1) return candidates;

  const MERGE_THRESHOLD = 0.0027; // ~300m
  const merged = [];
  const used = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;

    const group = [candidates[i]];
    used.add(i);

    // Find all candidates within threshold of this one
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;

      const dist = distanceDegrees(
        candidates[i].latitude, candidates[i].longitude,
        candidates[j].latitude, candidates[j].longitude
      );

      if (dist <= MERGE_THRESHOLD) {
        group.push(candidates[j]);
        used.add(j);
      }
    }

    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      // Merge group: earliest arrival, latest departure, average position/wind
      const arrivals = group.map(c => new Date(c.arrived_at)).sort((a, b) => a - b);
      const departures = group
        .filter(c => c.departed_at)
        .map(c => new Date(c.departed_at))
        .sort((a, b) => b - a);

      const mergedCandidate = {
        latitude: group.reduce((sum, c) => sum + c.latitude, 0) / group.length,
        longitude: group.reduce((sum, c) => sum + c.longitude, 0) / group.length,
        arrived_at: arrivals[0].toISOString(),
        departed_at: departures.length > 0 ? departures[0].toISOString() : null,
        avg_wind_speed: group.reduce((sum, c) => sum + (c.avg_wind_speed || 0), 0) / group.length,
        avg_wind_direction: group[0].avg_wind_direction // Use first one's direction
      };

      // Round coordinates
      mergedCandidate.latitude = Math.round(mergedCandidate.latitude * 100000) / 100000;
      mergedCandidate.longitude = Math.round(mergedCandidate.longitude * 100000) / 100000;
      mergedCandidate.avg_wind_speed = Math.round(mergedCandidate.avg_wind_speed * 10) / 10;

      requestLogger.info('Merged candidates at same location', {
        count: group.length,
        arrived_at: mergedCandidate.arrived_at,
        departed_at: mergedCandidate.departed_at
      });

      merged.push(mergedCandidate);
    }
  }

  return merged;
}

/**
 * Detect new anchorages from GPS history and insert them
 * Also attempts to link to arrival/departure trips
 * Features:
 * - Merges overlapping candidates at same location
 * - Updates existing anchorages if new candidate extends duration
 * - Auto-merges existing duplicate records
 * @param {number} minHours - Minimum stationary hours (default 4)
 * @returns {Promise<Object>} { detected: number, inserted: number, updated: number, merged: number, anchorages: Array }
 */
export async function detectNewAnchorages(minHours = 4) {
  requestLogger.info('Starting anchorage detection', { minHours });

  // Get candidates from GPS history
  const rawCandidates = await anchoragesRepository.detectFromGpsHistory(minHours);

  // Merge overlapping candidates at same location (Change 3)
  const candidates = mergeCandidates(rawCandidates);

  requestLogger.info('Candidates after merging', {
    raw: rawCandidates.length,
    merged: candidates.length
  });

  let inserted = 0;
  let updated = 0;
  const newAnchorages = [];

  for (const candidate of candidates) {
    // Check if an anchorage exists at this location (Change 4)
    const existing = await anchoragesRepository.findAtLocation(
      candidate.latitude,
      candidate.longitude
    );

    if (existing) {
      const candidateArrived = new Date(candidate.arrived_at);
      const existingDeparted = existing.departed_at ? new Date(existing.departed_at) : null;
      const existingArrived = new Date(existing.arrived_at);

      // If there's a 24+ hour gap between the existing anchorage and this candidate,
      // treat it as a return visit — create a new record instead of extending.
      // This handles: left an anchorage, went somewhere else, came back days/weeks later.
      // Also catches stale records with departed_at = null (compare against arrived_at).
      const GAP_THRESHOLD_MS = 24 * 60 * 60 * 1000;
      const referenceTime = existingDeparted || existingArrived;
      const gap = candidateArrived - referenceTime;

      if (gap > GAP_THRESHOLD_MS) {
        // Close out the stale record if it has no departed_at
        if (!existingDeparted) {
          await anchoragesRepository.update(existing.id, {
            departed_at: existingArrived.toISOString(),
            duration_hours: 0
          });
          requestLogger.info('Closed stale anchorage with no departed_at', {
            id: existing.id,
            location: existing.location_name
          });
        }
        // Fall through to insert as new anchorage below
      } else {
        // Within 24 hours — check if we should extend the duration
        const candidateDeparted = candidate.departed_at ? new Date(candidate.departed_at) : null;

        const shouldExtendDeparture = candidateDeparted && (!existingDeparted || candidateDeparted > existingDeparted);
        const shouldExtendArrival = candidateArrived < existingArrived;
        const isNowStillHere = candidate.departed_at === null && existing.departed_at !== null;

        if (shouldExtendDeparture || shouldExtendArrival || isNowStillHere) {
          const updates = {};

          if (shouldExtendArrival) {
            updates.arrived_at = candidate.arrived_at;
          }
          if (shouldExtendDeparture || isNowStillHere) {
            updates.departed_at = candidate.departed_at;
          }

          const finalArrived = new Date(updates.arrived_at || existing.arrived_at);
          const finalDeparted = updates.departed_at ? new Date(updates.departed_at) : null;
          updates.duration_hours = finalDeparted
            ? Math.round((finalDeparted - finalArrived) / (1000 * 60 * 60))
            : null;

          await anchoragesRepository.update(existing.id, updates);
          updated++;

          requestLogger.info('Extended existing anchorage', {
            id: existing.id,
            location: existing.location_name,
            extendedArrival: shouldExtendArrival,
            extendedDeparture: shouldExtendDeparture || isNowStillHere,
            newDuration: updates.duration_hours
          });
        } else {
          requestLogger.debug('Anchorage already exists, no update needed', {
            lat: candidate.latitude,
            lon: candidate.longitude
          });
        }

        continue;
      }
    }

    // New anchorage - try to link to trips
    const [arrivalTrip, departureTrip] = await Promise.all([
      anchoragesRepository.findTripNearTime(candidate.arrived_at, 60, 'arrival'),
      candidate.departed_at
        ? anchoragesRepository.findTripNearTime(candidate.departed_at, 60, 'departure')
        : null
    ]);

    // Calculate duration
    const arrivedAt = new Date(candidate.arrived_at);
    const departedAt = candidate.departed_at ? new Date(candidate.departed_at) : null;
    const durationHours = departedAt
      ? Math.round((departedAt - arrivedAt) / (1000 * 60 * 60))
      : null;

    // Insert anchorage
    const anchorage = await anchoragesRepository.create({
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      arrived_at: candidate.arrived_at,
      departed_at: candidate.departed_at,
      duration_hours: durationHours,
      avg_wind_speed: candidate.avg_wind_speed,
      avg_wind_direction: candidate.avg_wind_direction,
      arrival_trip_id: arrivalTrip?.id || null,
      departure_trip_id: departureTrip?.id || null,
      auto_detected: true
    });

    // Auto-geocode to get location name (with rate limiting for Nominatim)
    if (inserted > 0) {
      await delay();
    }
    const locationName = await reverseGeocode(anchorage.latitude, anchorage.longitude);
    if (locationName) {
      await anchoragesRepository.update(anchorage.id, { location_name: locationName });
      anchorage.location_name = locationName;
    }

    newAnchorages.push({
      ...anchorage,
      position_formatted: {
        lat: formatCoordinate(anchorage.latitude, true),
        lon: formatCoordinate(anchorage.longitude, false)
      }
    });
    inserted++;
  }

  // Auto-merge existing duplicate records at same location (Change 6)
  const mergeResult = await mergeExistingDuplicates();

  requestLogger.info('Anchorage detection complete', {
    detected: rawCandidates.length,
    afterMerge: candidates.length,
    inserted,
    updated,
    duplicatesMerged: mergeResult.merged
  });

  return {
    detected: rawCandidates.length,
    inserted,
    updated,
    merged: mergeResult.merged,
    anchorages: newAnchorages
  };
}

/**
 * Merge existing duplicate anchorage records at the same location
 * Groups anchorages within 300m of each other, keeps earliest arrival with latest departure
 * @returns {Promise<Object>} { merged: number, groups: Array }
 */
export async function mergeExistingDuplicates() {
  const allAnchorages = await anchoragesRepository.findAll();

  if (allAnchorages.length <= 1) {
    return { merged: 0, groups: [] };
  }

  const MERGE_THRESHOLD = 0.0027; // ~300m
  const groups = [];
  const used = new Set();

  // Group anchorages by location
  for (let i = 0; i < allAnchorages.length; i++) {
    if (used.has(allAnchorages[i].id)) continue;

    const group = [allAnchorages[i]];
    used.add(allAnchorages[i].id);

    for (let j = i + 1; j < allAnchorages.length; j++) {
      if (used.has(allAnchorages[j].id)) continue;

      const dist = distanceDegrees(
        allAnchorages[i].latitude, allAnchorages[i].longitude,
        allAnchorages[j].latitude, allAnchorages[j].longitude
      );

      if (dist <= MERGE_THRESHOLD) {
        group.push(allAnchorages[j]);
        used.add(allAnchorages[j].id);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  let merged = 0;

  // Process each group with duplicates
  for (const group of groups) {
    // Sort by arrived_at to find the earliest
    group.sort((a, b) => new Date(a.arrived_at) - new Date(b.arrived_at));

    const keeper = group[0]; // Keep the one with earliest arrival
    const toDelete = group.slice(1);

    // Find latest departure from the group
    const departures = group
      .filter(a => a.departed_at)
      .map(a => new Date(a.departed_at))
      .sort((a, b) => b - a);

    // Find the best location name (prefer non-null, longest)
    const locationNames = group
      .filter(a => a.location_name)
      .map(a => a.location_name)
      .sort((a, b) => b.length - a.length);

    // Build updates for keeper
    const updates = {};

    // Use latest departure
    if (departures.length > 0) {
      const latestDeparted = departures[0];
      const existingDeparted = keeper.departed_at ? new Date(keeper.departed_at) : null;

      if (!existingDeparted || latestDeparted > existingDeparted) {
        updates.departed_at = latestDeparted.toISOString();
      }
    }

    // Preserve the null departed_at if any record in group has it (still here)
    const hasStillHere = group.some(a => a.departed_at === null);
    if (hasStillHere) {
      updates.departed_at = null;
    }

    // Use best location name
    if (locationNames.length > 0 && (!keeper.location_name || locationNames[0].length > keeper.location_name.length)) {
      updates.location_name = locationNames[0];
    }

    // Recalculate duration
    const finalArrived = new Date(keeper.arrived_at);
    const finalDeparted = updates.departed_at !== undefined
      ? (updates.departed_at ? new Date(updates.departed_at) : null)
      : (keeper.departed_at ? new Date(keeper.departed_at) : null);

    updates.duration_hours = finalDeparted
      ? Math.round((finalDeparted - finalArrived) / (1000 * 60 * 60))
      : null;

    // Update the keeper
    if (Object.keys(updates).length > 0) {
      await anchoragesRepository.update(keeper.id, updates);
    }

    // Delete the duplicates
    for (const dup of toDelete) {
      await anchoragesRepository.remove(dup.id);
      merged++;

      requestLogger.info('Deleted duplicate anchorage', {
        deletedId: dup.id,
        keptId: keeper.id,
        location: keeper.location_name || dup.location_name
      });
    }

    requestLogger.info('Merged anchorage group', {
      keptId: keeper.id,
      deletedCount: toDelete.length,
      location: updates.location_name || keeper.location_name,
      newDuration: updates.duration_hours
    });
  }

  return { merged, groups: groups.length };
}

/**
 * Populate location names for anchorages that don't have one
 * Uses reverse geocoding from OpenStreetMap
 * @returns {Promise<Object>} { updated: number, anchorages: Array }
 */
export async function populateLocationNames() {
  const anchorages = await anchoragesRepository.findAll();
  const needsName = anchorages.filter(a => !a.location_name);

  requestLogger.info('Populating location names', { total: anchorages.length, needsName: needsName.length });

  let updated = 0;
  const updatedAnchorages = [];

  for (const anchorage of needsName) {
    // Rate limit: Nominatim requires max 1 request per second
    if (updated > 0) {
      await delay();
    }

    const name = await reverseGeocode(anchorage.latitude, anchorage.longitude);

    if (name) {
      await anchoragesRepository.update(anchorage.id, { location_name: name });
      updatedAnchorages.push({ id: anchorage.id, location_name: name });
      updated++;
      requestLogger.info('Location name set', { id: anchorage.id, name });
    }
  }

  return { updated, anchorages: updatedAnchorages };
}

/**
 * Create anchorage manually (not from GPS detection)
 * @param {Object} data - Anchorage data
 * @returns {Promise<Object>} Created anchorage
 */
export async function createAnchorage(data) {
  // Compute duration if dates provided
  let durationHours = null;
  if (data.arrived_at && data.departed_at) {
    const arrivedAt = new Date(data.arrived_at);
    const departedAt = new Date(data.departed_at);
    durationHours = Math.round((departedAt - arrivedAt) / (1000 * 60 * 60));
  }

  // Compute anchor position if scope provided
  let anchorPos = { anchor_lat: null, anchor_lon: null };
  if (data.scope_meters && data.latitude && data.longitude) {
    anchorPos = computeAnchorPosition(
      data.latitude,
      data.longitude,
      data.scope_meters,
      data.avg_wind_direction
    );
  }

  const anchorage = await anchoragesRepository.create({
    ...data,
    duration_hours: durationHours,
    ...anchorPos,
    auto_detected: false
  });

  requestLogger.info('Anchorage created manually', { id: anchorage.id });

  return {
    ...anchorage,
    position_formatted: {
      lat: formatCoordinate(anchorage.latitude, true),
      lon: formatCoordinate(anchorage.longitude, false)
    }
  };
}

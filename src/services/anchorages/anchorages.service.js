/**
 * Anchorages Service
 * Business logic for anchorage and mooring tracking
 */

import { anchoragesRepository } from '../../repositories/anchorages.repository.js';
import { logger } from '../../utils/logger.js';

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
 * Detect new anchorages from GPS history and insert them
 * Also attempts to link to arrival/departure trips
 * @param {number} minHours - Minimum stationary hours (default 4)
 * @returns {Promise<Object>} { detected: number, inserted: number, anchorages: Array }
 */
export async function detectNewAnchorages(minHours = 4) {
  requestLogger.info('Starting anchorage detection', { minHours });

  // Get candidates from GPS history
  const candidates = await anchoragesRepository.detectFromGpsHistory(minHours);

  let inserted = 0;
  const newAnchorages = [];

  for (const candidate of candidates) {
    // Check if already exists
    const exists = await anchoragesRepository.exists(
      candidate.latitude,
      candidate.longitude,
      candidate.arrived_at
    );

    if (exists) {
      requestLogger.debug('Anchorage already exists, skipping', {
        lat: candidate.latitude,
        lon: candidate.longitude,
        arrived: candidate.arrived_at
      });
      continue;
    }

    // Try to link to trips
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

    newAnchorages.push({
      ...anchorage,
      position_formatted: {
        lat: formatCoordinate(anchorage.latitude, true),
        lon: formatCoordinate(anchorage.longitude, false)
      }
    });
    inserted++;
  }

  requestLogger.info('Anchorage detection complete', {
    detected: candidates.length,
    inserted
  });

  return {
    detected: candidates.length,
    inserted,
    anchorages: newAnchorages
  };
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

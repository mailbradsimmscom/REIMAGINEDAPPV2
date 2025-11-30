/**
 * Trip Tracking Service
 * Business logic for trip management
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Haversine distance between two points in nautical miles
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate total distance from telemetry points
 */
function calculateTotalDistance(telemetryRows) {
  let total = 0;
  for (let i = 1; i < telemetryRows.length; i++) {
    const prev = telemetryRows[i - 1];
    const curr = telemetryRows[i];
    if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
      total += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * Calculate average of array values
 */
function average(arr) {
  if (!arr || arr.length === 0) return null;
  const sum = arr.reduce((a, b) => a + b, 0);
  return Math.round((sum / arr.length) * 100) / 100;
}

/**
 * Simplify track for map display (take every Nth point)
 */
function simplifyTrack(telemetryRows, sampleRate = 5) {
  return telemetryRows
    .filter((_, i) => i % sampleRate === 0)
    .map(row => ({
      lat: row.latitude,
      lon: row.longitude,
      t: row.recorded_at
    }));
}

/**
 * List trips with optional filters
 */
export async function listTrips({ status, limit = 20, offset = 0 } = {}) {
  const supabase = await getSupabaseClient();

  let query = supabase
    .from('trips')
    .select('*')
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    requestLogger.error('Error listing trips', { error: error.message });
    throw new Error(`Failed to list trips: ${error.message}`);
  }

  return data;
}

/**
 * Get single trip with all related data
 */
export async function getTrip(tripId) {
  const supabase = await getSupabaseClient();

  // Get trip
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripError) {
    throw new Error(`Trip not found: ${tripError.message}`);
  }

  // Get telemetry for track
  const { data: telemetry } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude, recorded_at, sog')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true });

  // Get sail events
  const { data: sailEvents } = await supabase
    .from('trip_sail_events')
    .select('*')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true });

  // Get weather summary
  const { data: weather } = await supabase
    .from('trip_weather')
    .select('wind_speed_kts, wave_height_m, air_temp_c')
    .eq('trip_id', tripId);

  // Get comments
  const { data: comments } = await supabase
    .from('trip_comments')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });

  // Build weather summary
  let weatherSummary = null;
  if (weather && weather.length > 0) {
    const windSpeeds = weather.map(w => w.wind_speed_kts).filter(Boolean);
    const waveHeights = weather.map(w => w.wave_height_m).filter(Boolean);
    const temps = weather.map(w => w.air_temp_c).filter(Boolean);

    weatherSummary = {
      avg_wind_kts: average(windSpeeds),
      max_wind_kts: windSpeeds.length > 0 ? Math.max(...windSpeeds) : null,
      avg_wave_height_m: average(waveHeights),
      avg_temp_c: average(temps)
    };
  }

  return {
    trip,
    track: telemetry ? simplifyTrack(telemetry) : [],
    sail_events: sailEvents || [],
    weather_summary: weatherSummary,
    comments: comments || []
  };
}

/**
 * Get active trip (if any)
 */
export async function getActiveTrip() {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    requestLogger.error('Error getting active trip', { error: error.message });
    throw new Error(`Failed to get active trip: ${error.message}`);
  }

  return data;
}

/**
 * Start a new trip
 */
export async function startTrip() {
  const supabase = await getSupabaseClient();

  // Check no active trip exists
  const existing = await getActiveTrip();
  if (existing) {
    throw new Error('A trip is already in progress');
  }

  // Create new trip with auto-generated title
  const title = `Trip - ${new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })}`;

  const { data: trip, error } = await supabase
    .from('trips')
    .insert({
      status: 'active',
      title
    })
    .select()
    .single();

  if (error) {
    requestLogger.error('Error starting trip', { error: error.message });
    throw new Error(`Failed to start trip: ${error.message}`);
  }

  requestLogger.info('Trip started', { tripId: trip.id, title });
  return trip;
}

/**
 * Stop an active trip and compute summary stats
 */
export async function stopTrip(tripId) {
  const supabase = await getSupabaseClient();

  // Verify trip exists and is active
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    throw new Error('Trip not found');
  }

  if (trip.status !== 'active') {
    throw new Error('Trip is not active');
  }

  // Get all telemetry for summary computation
  const { data: telemetry, error: telemetryError } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude, sog, recorded_at')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true });

  if (telemetryError) {
    throw new Error(`Failed to get telemetry: ${telemetryError.message}`);
  }

  // Compute summary (even if no telemetry)
  let summary = {
    status: 'completed',
    ended_at: new Date().toISOString(),
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    distance_nm: 0,
    duration_minutes: 0,
    avg_sog: null,
    max_sog: null
  };

  if (telemetry && telemetry.length > 0) {
    const first = telemetry[0];
    const last = telemetry[telemetry.length - 1];
    const speeds = telemetry.map(t => t.sog).filter(Boolean);

    summary = {
      ...summary,
      start_lat: first.latitude,
      start_lon: first.longitude,
      end_lat: last.latitude,
      end_lon: last.longitude,
      distance_nm: calculateTotalDistance(telemetry),
      duration_minutes: Math.round((new Date(last.recorded_at) - new Date(first.recorded_at)) / 60000),
      avg_sog: average(speeds),
      max_sog: speeds.length > 0 ? Math.round(Math.max(...speeds) * 100) / 100 : null
    };
  }

  // Generate title from GPS start/end locations
  const generatedTitle = await generateTripTitle(tripId);
  if (generatedTitle) {
    summary.title = generatedTitle;
  }

  // Update trip
  const { data: updatedTrip, error: updateError } = await supabase
    .from('trips')
    .update(summary)
    .eq('id', tripId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to update trip: ${updateError.message}`);
  }

  requestLogger.info('Trip stopped', {
    tripId,
    title: summary.title,
    distance_nm: summary.distance_nm,
    duration_minutes: summary.duration_minutes
  });

  return updatedTrip;
}

/**
 * Resume a stopped trip (within 30 min window)
 */
export async function resumeTrip(tripId) {
  const RESUME_WINDOW_MINUTES = 30;
  const supabase = await getSupabaseClient();

  // Get the trip
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    throw new Error('Trip not found');
  }

  if (trip.status !== 'completed') {
    throw new Error('Only completed trips can be resumed');
  }

  // Check if another trip is already active
  const activeTrip = await getActiveTrip();
  if (activeTrip) {
    throw new Error('Another trip is already in progress');
  }

  // Check resume window
  const endedAt = new Date(trip.ended_at);
  const now = new Date();
  const minutesSinceEnd = (now - endedAt) / 60000;

  if (minutesSinceEnd > RESUME_WINDOW_MINUTES) {
    throw new Error(`Cannot resume trip - ended more than ${RESUME_WINDOW_MINUTES} minutes ago`);
  }

  // Resume: set status back to active, clear summary fields
  const { data: updatedTrip, error: updateError } = await supabase
    .from('trips')
    .update({
      status: 'active',
      ended_at: null,
      start_lat: null,
      start_lon: null,
      end_lat: null,
      end_lon: null,
      distance_nm: null,
      duration_minutes: null,
      avg_sog: null,
      max_sog: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', tripId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to resume trip: ${updateError.message}`);
  }

  requestLogger.info('Trip resumed', { tripId });
  return updatedTrip;
}

/**
 * Update trip title
 */
export async function updateTrip(tripId, { title }) {
  const supabase = await getSupabaseClient();

  const { data: trip, error } = await supabase
    .from('trips')
    .update({
      title,
      updated_at: new Date().toISOString()
    })
    .eq('id', tripId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update trip: ${error.message}`);
  }

  return trip;
}

/**
 * Delete trip (cascade deletes all related data)
 */
export async function deleteTrip(tripId) {
  const supabase = await getSupabaseClient();

  const { error } = await supabase
    .from('trips')
    .delete()
    .eq('id', tripId);

  if (error) {
    throw new Error(`Failed to delete trip: ${error.message}`);
  }

  requestLogger.info('Trip deleted', { tripId });
  return { success: true };
}

/**
 * Get live stats for active trip
 */
export async function getActiveTripStats(tripId) {
  const supabase = await getSupabaseClient();

  // Get trip
  const { data: trip } = await supabase
    .from('trips')
    .select('started_at')
    .eq('id', tripId)
    .single();

  if (!trip) {
    throw new Error('Trip not found');
  }

  // Get telemetry
  const { data: telemetry } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude, sog, recorded_at')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true });

  const now = new Date();
  const started = new Date(trip.started_at);
  const durationMs = now - started;

  let stats = {
    duration_ms: durationMs,
    duration_formatted: formatDuration(durationMs),
    distance_nm: 0,
    avg_sog: null,
    current_sog: null,
    telemetry_count: 0
  };

  if (telemetry && telemetry.length > 0) {
    const speeds = telemetry.map(t => t.sog).filter(Boolean);
    const latest = telemetry[telemetry.length - 1];

    stats = {
      ...stats,
      distance_nm: calculateTotalDistance(telemetry),
      avg_sog: average(speeds),
      current_sog: latest.sog,
      telemetry_count: telemetry.length
    };
  }

  return stats;
}

/**
 * Format duration in HH:MM:SS
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Record a sail configuration change
 * Position is auto-filled from latest telemetry
 */
export async function recordSailEvent(tripId, sailConfig) {
  const supabase = await getSupabaseClient();

  // Verify trip exists and is active
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, status')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    throw new Error('Trip not found');
  }

  if (trip.status !== 'active') {
    throw new Error('Can only record sail events for active trips');
  }

  // Get latest telemetry position
  const { data: latestTelemetry } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = latestTelemetry || { latitude: null, longitude: null };

  // Insert sail event
  const { data: sailEvent, error } = await supabase
    .from('trip_sail_events')
    .insert({
      trip_id: tripId,
      latitude: position.latitude,
      longitude: position.longitude,
      main_sail: sailConfig.main_sail || null,
      jib: sailConfig.jib || false,
      code_zero: sailConfig.code_zero || false,
      asym_spinnaker: sailConfig.asym_spinnaker || false,
      notes: sailConfig.notes || null
    })
    .select()
    .single();

  if (error) {
    requestLogger.error('Error recording sail event', { error: error.message, tripId });
    throw new Error(`Failed to record sail event: ${error.message}`);
  }

  requestLogger.info('Sail event recorded', {
    tripId,
    sailEventId: sailEvent.id,
    main_sail: sailConfig.main_sail
  });

  return sailEvent;
}

/**
 * Get sail events for a trip
 */
export async function getSailEvents(tripId) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('trip_sail_events')
    .select('*')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get sail events: ${error.message}`);
  }

  return data || [];
}

/**
 * Get the current (latest) sail configuration for a trip
 */
export async function getCurrentSailConfig(tripId) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('trip_sail_events')
    .select('*')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get current sail config: ${error.message}`);
  }

  // Return default config if no events yet
  if (!data) {
    return {
      main_sail: null,
      jib: false,
      code_zero: false,
      asym_spinnaker: false
    };
  }

  return data;
}

/**
 * Add a comment to a trip
 */
export async function addComment(tripId, comment) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('trip_comments')
    .insert({
      trip_id: tripId,
      comment
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to add comment: ${error.message}`);
  }

  requestLogger.info('Comment added', { tripId, commentId: data.id });
  return data;
}

/**
 * Get comments for a trip
 */
export async function getComments(tripId) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('trip_comments')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get comments: ${error.message}`);
  }

  return data || [];
}

/**
 * Delete a comment
 */
export async function deleteComment(tripId, commentId) {
  const supabase = await getSupabaseClient();

  const { error } = await supabase
    .from('trip_comments')
    .delete()
    .eq('id', commentId)
    .eq('trip_id', tripId);

  if (error) {
    throw new Error(`Failed to delete comment: ${error.message}`);
  }

  return { success: true };
}

/**
 * Extract values from SignalK data structure
 * Only extracts .value properties that are primitives (not objects/arrays)
 * Also captures units from sibling meta.units
 *
 * @param {Object} obj - SignalK data object
 * @param {string} prefix - Current path prefix
 * @param {Object} result - Accumulated results { values: {}, units: {} }
 * @returns {Object} { values: { path: value }, units: { path: unit } }
 */
function extractSignalKValues(obj, prefix = '', result = { values: {}, units: {} }) {
  if (!obj || typeof obj !== 'object') return result;

  for (const key of Object.keys(obj)) {
    // Skip metadata fields we don't want to display
    if (['$source', 'timestamp', 'values', 'pgn', 'meta'].includes(key)) continue;

    const val = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;

    // Skip switch data entirely - not useful for trip analysis
    if (key === 'switches' || path.includes('.switches.')) continue;

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      // Check if this is a SignalK value node (has 'value' property)
      if ('value' in val) {
        const actualValue = val.value;

        // Only include primitive values (string, number, boolean)
        if (actualValue !== null && actualValue !== undefined &&
            typeof actualValue !== 'object') {
          result.values[path] = actualValue;

          // Capture unit if available from meta
          if (val.meta && val.meta.units) {
            result.units[path] = val.meta.units;
          }
        }
        // Skip if value is object/array (not displayable as single cell)
      } else {
        // Recurse into nested objects
        extractSignalKValues(val, path, result);
      }
    }
  }

  return result;
}

/**
 * Filter out columns with low variance (all same value or mostly null)
 *
 * @param {Array} samples - Array of sample objects
 * @param {Array} columns - Array of column names
 * @returns {Array} Filtered column names
 */
function filterLowVarianceColumns(samples, columns) {
  if (samples.length === 0) return columns;

  return columns.filter(col => {
    // Always keep core navigation columns
    const coreColumns = ['recorded_at', 'latitude', 'longitude', 'sog', 'cog', 'heading'];
    if (coreColumns.includes(col)) return true;

    // Always keep weather columns (they have inherent value even if similar)
    const weatherColumns = ['wind_speed_kts', 'wind_direction', 'wind_gusts_kts',
      'wave_height_m', 'wave_period_s', 'swell_height_m', 'swell_period_s',
      'air_temp_c', 'pressure_hpa'];
    if (weatherColumns.includes(col)) return true;

    // Get all values for this column
    const values = samples.map(s => s[col]);

    // Filter out columns where all values are objects (shows as [object Object])
    const allObjects = values.every(v => v !== null && v !== undefined && typeof v === 'object');
    if (allObjects) return false;

    // Count nulls/undefined
    const nullCount = values.filter(v => v === null || v === undefined).length;
    const nullRatio = nullCount / values.length;

    // Filter if >80% null
    if (nullRatio > 0.8) return false;

    // Check variance (are all non-null values the same?)
    const nonNullValues = values.filter(v => v !== null && v !== undefined);
    if (nonNullValues.length === 0) return false;

    // Get unique values (stringify for comparison)
    const uniqueValues = new Set(nonNullValues.map(v => String(v)));

    // Filter if all values are identical (no variance)
    if (uniqueValues.size === 1) return false;

    return true;
  });
}

/**
 * Get combined telemetry + weather data sampled at intervals
 * Returns data flattened for table display, with units metadata
 * Filters out low-variance columns automatically
 */
export async function getTelemetrySamples(tripId, intervalMinutes = 15) {
  const supabase = await getSupabaseClient();

  // Fetch telemetry and weather in parallel
  const [telemetryResult, weatherResult] = await Promise.all([
    supabase
      .from('trip_telemetry')
      .select('recorded_at, latitude, longitude, sog, cog, heading, signalk_data')
      .eq('trip_id', tripId)
      .order('recorded_at', { ascending: true }),
    supabase
      .from('trip_weather')
      .select('recorded_at, wind_speed_kts, wind_direction, wind_gusts_kts, wave_height_m, wave_period_s, wave_direction, swell_height_m, swell_period_s, swell_direction, air_temp_c, pressure_hpa, cloud_cover_pct, visibility_m')
      .eq('trip_id', tripId)
      .order('recorded_at', { ascending: true })
  ]);

  if (telemetryResult.error) {
    throw new Error(`Failed to get telemetry: ${telemetryResult.error.message}`);
  }

  const telemetry = telemetryResult.data || [];
  const weather = weatherResult.data || [];

  if (telemetry.length === 0) {
    return { samples: [], columns: [], units: {} };
  }

  // Sample at intervals
  const intervalMs = intervalMinutes * 60 * 1000;
  const samples = [];
  let lastSampleTime = null;
  const allColumns = new Set(['recorded_at', 'latitude', 'longitude', 'sog', 'cog', 'heading']);
  const allUnits = {
    // Core navigation units
    sog: 'kn',
    cog: 'deg',
    heading: 'deg',
    // Weather units (from Open-Meteo)
    wind_speed_kts: 'kn',
    wind_direction: 'deg',
    wind_gusts_kts: 'kn',
    wave_height_m: 'm',
    wave_period_s: 's',
    wave_direction: 'deg',
    swell_height_m: 'm',
    swell_period_s: 's',
    swell_direction: 'deg',
    air_temp_c: 'C',
    pressure_hpa: 'hPa',
    cloud_cover_pct: '%',
    visibility_m: 'm'
  };

  // Weather columns
  const weatherColumns = ['wind_speed_kts', 'wind_direction', 'wind_gusts_kts', 'wave_height_m', 'wave_period_s', 'wave_direction', 'swell_height_m', 'swell_period_s', 'swell_direction', 'air_temp_c', 'pressure_hpa', 'cloud_cover_pct', 'visibility_m'];
  weatherColumns.forEach(c => allColumns.add(c));

  // Helper to find closest weather record
  function findClosestWeather(timestamp) {
    if (weather.length === 0) return null;
    const targetTime = new Date(timestamp).getTime();
    let closest = weather[0];
    let closestDiff = Math.abs(new Date(closest.recorded_at).getTime() - targetTime);

    for (const w of weather) {
      const diff = Math.abs(new Date(w.recorded_at).getTime() - targetTime);
      if (diff < closestDiff) {
        closest = w;
        closestDiff = diff;
      }
    }
    // Only use if within 30 minutes
    return closestDiff <= 30 * 60 * 1000 ? closest : null;
  }

  for (const point of telemetry) {
    const pointTime = new Date(point.recorded_at).getTime();

    if (lastSampleTime === null || (pointTime - lastSampleTime) >= intervalMs) {
      // Extract SignalK values and units
      const { values: signalkValues, units: signalkUnits } = extractSignalKValues(point.signalk_data || {});

      // Track all columns and units we see
      for (const key of Object.keys(signalkValues)) {
        allColumns.add(key);
      }
      Object.assign(allUnits, signalkUnits);

      // Find matching weather
      const closestWeather = findClosestWeather(point.recorded_at);

      samples.push({
        recorded_at: point.recorded_at,
        latitude: point.latitude,
        longitude: point.longitude,
        sog: point.sog,
        cog: point.cog,
        heading: point.heading,
        // Weather data
        wind_speed_kts: closestWeather?.wind_speed_kts ?? null,
        wind_direction: closestWeather?.wind_direction ?? null,
        wind_gusts_kts: closestWeather?.wind_gusts_kts ?? null,
        wave_height_m: closestWeather?.wave_height_m ?? null,
        wave_period_s: closestWeather?.wave_period_s ?? null,
        wave_direction: closestWeather?.wave_direction ?? null,
        swell_height_m: closestWeather?.swell_height_m ?? null,
        swell_period_s: closestWeather?.swell_period_s ?? null,
        swell_direction: closestWeather?.swell_direction ?? null,
        air_temp_c: closestWeather?.air_temp_c ?? null,
        pressure_hpa: closestWeather?.pressure_hpa ?? null,
        cloud_cover_pct: closestWeather?.cloud_cover_pct ?? null,
        visibility_m: closestWeather?.visibility_m ?? null,
        // SignalK data (only primitive values)
        ...signalkValues,
        _raw: point.signalk_data
      });

      lastSampleTime = pointTime;
    }
  }

  // Always include last point
  if (telemetry.length > 0 && samples.length > 0) {
    const lastPoint = telemetry[telemetry.length - 1];
    const lastSample = samples[samples.length - 1];
    if (lastPoint.recorded_at !== lastSample.recorded_at) {
      const { values: signalkValues, units: signalkUnits } = extractSignalKValues(lastPoint.signalk_data || {});
      for (const key of Object.keys(signalkValues)) {
        allColumns.add(key);
      }
      Object.assign(allUnits, signalkUnits);

      const closestWeather = findClosestWeather(lastPoint.recorded_at);
      samples.push({
        recorded_at: lastPoint.recorded_at,
        latitude: lastPoint.latitude,
        longitude: lastPoint.longitude,
        sog: lastPoint.sog,
        cog: lastPoint.cog,
        heading: lastPoint.heading,
        wind_speed_kts: closestWeather?.wind_speed_kts ?? null,
        wind_direction: closestWeather?.wind_direction ?? null,
        wind_gusts_kts: closestWeather?.wind_gusts_kts ?? null,
        wave_height_m: closestWeather?.wave_height_m ?? null,
        wave_period_s: closestWeather?.wave_period_s ?? null,
        wave_direction: closestWeather?.wave_direction ?? null,
        swell_height_m: closestWeather?.swell_height_m ?? null,
        swell_period_s: closestWeather?.swell_period_s ?? null,
        swell_direction: closestWeather?.swell_direction ?? null,
        air_temp_c: closestWeather?.air_temp_c ?? null,
        pressure_hpa: closestWeather?.pressure_hpa ?? null,
        cloud_cover_pct: closestWeather?.cloud_cover_pct ?? null,
        visibility_m: closestWeather?.visibility_m ?? null,
        ...signalkValues,
        _raw: lastPoint.signalk_data
      });
    }
  }

  // Filter out low-variance columns
  const allColumnsArray = Array.from(allColumns);
  const filteredColumns = filterLowVarianceColumns(samples, allColumnsArray);

  // Sort columns sensibly: core nav first, then weather, then signalk
  const sortedColumns = filteredColumns.sort((a, b) => {
    const order = ['recorded_at', 'latitude', 'longitude', 'sog', 'cog', 'heading'];
    const aIdx = order.indexOf(a);
    const bIdx = order.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    // Weather columns next
    if (a.includes('wind') || a.includes('wave') || a.includes('swell') || a.includes('temp') || a.includes('pressure')) {
      if (!(b.includes('wind') || b.includes('wave') || b.includes('swell') || b.includes('temp') || b.includes('pressure'))) {
        return -1;
      }
    }
    if (b.includes('wind') || b.includes('wave') || b.includes('swell') || b.includes('temp') || b.includes('pressure')) {
      if (!(a.includes('wind') || a.includes('wave') || a.includes('swell') || a.includes('temp') || a.includes('pressure'))) {
        return 1;
      }
    }
    return a.localeCompare(b);
  });

  return {
    samples,
    columns: sortedColumns,
    units: allUnits
  };
}

/**
 * Reverse geocode a lat/lon to get a place name
 */
async function reverseGeocode(lat, lon) {
  try {
    // Use zoom 14 for more local detail
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'BoatOS/1.0' }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const address = data.address || {};

    // Try various fields in order of preference
    return address.village || address.town || address.city || address.island ||
           address.municipality || address.county || address.state_district ||
           address.state || address.country || null;
  } catch (error) {
    requestLogger.warn('Reverse geocode failed', { lat, lon, error: error.message });
    return null;
  }
}

/**
 * Generate trip title from start/end GPS locations
 */
export async function generateTripTitle(tripId) {
  const supabase = await getSupabaseClient();

  const { data: firstPoint } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: lastPoint } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!firstPoint || !lastPoint) return null;

  const [startName, endName] = await Promise.all([
    reverseGeocode(firstPoint.latitude, firstPoint.longitude),
    reverseGeocode(lastPoint.latitude, lastPoint.longitude)
  ]);

  if (!startName && !endName) return null;
  if (startName === endName || !endName) return startName;
  if (!startName) return `To ${endName}`;

  return `${startName} to ${endName}`;
}

export default {
  listTrips,
  getTrip,
  getActiveTrip,
  startTrip,
  stopTrip,
  resumeTrip,
  updateTrip,
  deleteTrip,
  getActiveTripStats,
  recordSailEvent,
  getSailEvents,
  getCurrentSailConfig,
  addComment,
  getComments,
  deleteComment,
  getTelemetrySamples,
  generateTripTitle
};

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
  deleteComment
};

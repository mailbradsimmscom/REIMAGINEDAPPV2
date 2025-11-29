/**
 * Weather Collector Service for Trips
 * Fetches Open-Meteo weather data during active trips
 * Runs as background job every 15 minutes
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const requestLogger = logger.createRequestLogger();

// Collection interval: 15 minutes
const COLLECTION_INTERVAL_MS = 15 * 60 * 1000;

let collectionTimer = null;

/**
 * Fetch marine weather from Open-Meteo Marine API
 */
async function fetchMarineWeather(lat, lon) {
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', [
    'wave_height',
    'wave_direction',
    'wave_period',
    'wind_wave_height',
    'wind_wave_direction',
    'wind_wave_period',
    'swell_wave_height',
    'swell_wave_direction',
    'swell_wave_period'
  ].join(','));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Marine API error: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch standard weather from Open-Meteo Forecast API
 */
async function fetchStandardWeather(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', [
    'temperature_2m',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'pressure_msl',
    'cloud_cover',
    'visibility',
    'precipitation'
  ].join(','));
  url.searchParams.set('wind_speed_unit', 'kn'); // knots

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Forecast API error: ${response.status}`);
  }
  return response.json();
}

/**
 * Collect weather data for a trip at a given position
 */
async function collectWeatherForTrip(tripId, lat, lon) {
  const supabase = await getSupabaseClient();

  try {
    requestLogger.info('Collecting weather data', { tripId, lat, lon });

    // Fetch both marine and standard weather in parallel
    const [marineData, standardData] = await Promise.all([
      fetchMarineWeather(lat, lon).catch(err => {
        requestLogger.warn('Marine weather fetch failed', { error: err.message });
        return null;
      }),
      fetchStandardWeather(lat, lon).catch(err => {
        requestLogger.warn('Standard weather fetch failed', { error: err.message });
        return null;
      })
    ]);

    // Extract values
    const marine = marineData?.current || {};
    const standard = standardData?.current || {};

    const weatherRecord = {
      trip_id: tripId,
      latitude: lat,
      longitude: lon,
      source: 'open-meteo-marine',

      // Wind data (from standard API, in knots)
      wind_speed_kts: standard.wind_speed_10m || null,
      wind_direction: standard.wind_direction_10m || null,
      wind_gusts_kts: standard.wind_gusts_10m || null,

      // Wave data (from marine API)
      wave_height_m: marine.wave_height || null,
      wave_period_s: marine.wave_period || null,
      wave_direction: marine.wave_direction || null,

      // Swell data (from marine API)
      swell_height_m: marine.swell_wave_height || null,
      swell_period_s: marine.swell_wave_period || null,
      swell_direction: marine.swell_wave_direction || null,

      // Atmosphere (from standard API)
      air_temp_c: standard.temperature_2m || null,
      sea_temp_c: null, // Not available from Open-Meteo free tier
      pressure_hpa: standard.pressure_msl || null,
      cloud_cover_pct: standard.cloud_cover || null,
      visibility_m: standard.visibility || null,
      precipitation_mm: standard.precipitation || null,

      // Store full API response for debugging
      api_response: {
        marine: marineData,
        standard: standardData,
        collected_at: new Date().toISOString()
      }
    };

    // Insert into database
    const { data, error } = await supabase
      .from('trip_weather')
      .insert(weatherRecord)
      .select()
      .single();

    if (error) {
      throw new Error(`Database insert failed: ${error.message}`);
    }

    requestLogger.info('Weather data collected', {
      tripId,
      weatherId: data.id,
      wind_kts: weatherRecord.wind_speed_kts,
      wave_m: weatherRecord.wave_height_m
    });

    return data;

  } catch (error) {
    requestLogger.error('Weather collection failed', {
      tripId,
      lat,
      lon,
      error: error.message
    });
    throw error;
  }
}

/**
 * Check for active trips and collect weather data
 */
async function collectWeatherForActiveTrips() {
  const supabase = await getSupabaseClient();

  try {
    // Get active trips
    const { data: activeTrips, error: tripError } = await supabase
      .from('trips')
      .select('id')
      .eq('status', 'active');

    if (tripError) {
      requestLogger.error('Failed to get active trips', { error: tripError.message });
      return;
    }

    if (!activeTrips || activeTrips.length === 0) {
      requestLogger.debug('No active trips for weather collection');
      return;
    }

    // Process each active trip
    for (const trip of activeTrips) {
      try {
        // Get latest telemetry position
        const { data: latestTelemetry } = await supabase
          .from('trip_telemetry')
          .select('latitude, longitude')
          .eq('trip_id', trip.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestTelemetry?.latitude || !latestTelemetry?.longitude) {
          requestLogger.debug('No telemetry position for trip', { tripId: trip.id });
          continue;
        }

        // Collect weather for this position
        await collectWeatherForTrip(
          trip.id,
          latestTelemetry.latitude,
          latestTelemetry.longitude
        );

      } catch (error) {
        requestLogger.error('Weather collection failed for trip', {
          tripId: trip.id,
          error: error.message
        });
        // Continue with next trip
      }
    }

  } catch (error) {
    requestLogger.error('Weather collection job failed', { error: error.message });
  }
}

/**
 * Start the weather collection background job
 */
export function startWeatherCollector() {
  if (collectionTimer) {
    requestLogger.warn('Weather collector already running');
    return;
  }

  requestLogger.info('Starting weather collector', {
    intervalMinutes: COLLECTION_INTERVAL_MS / 60000
  });

  // Run immediately, then every 15 minutes
  collectWeatherForActiveTrips();
  collectionTimer = setInterval(collectWeatherForActiveTrips, COLLECTION_INTERVAL_MS);
}

/**
 * Stop the weather collection background job
 */
export function stopWeatherCollector() {
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
    requestLogger.info('Weather collector stopped');
  }
}

/**
 * Manually trigger weather collection (for testing)
 */
export async function triggerWeatherCollection() {
  await collectWeatherForActiveTrips();
}

export default {
  startWeatherCollector,
  stopWeatherCollector,
  triggerWeatherCollection,
  collectWeatherForTrip
};

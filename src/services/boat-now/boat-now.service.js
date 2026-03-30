/**
 * Boat Now Service
 * Provides current boat position, weather, and historical data for charts
 */

import { gpsRepository } from '../../repositories/gps.repository.js';
import { reverseGeocode } from '../../utils/nominatim.js';
import { logger } from '../../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Fetch current weather from Open-Meteo APIs
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<Object>} Current weather conditions
 */
async function fetchCurrentWeather(lat, lon) {
  try {
    // Fetch marine and standard weather in parallel
    const [marineResponse, standardResponse] = await Promise.all([
      fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period`),
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code&wind_speed_unit=kn`)
    ]);

    const [marineData, standardData] = await Promise.all([
      marineResponse.ok ? marineResponse.json() : null,
      standardResponse.ok ? standardResponse.json() : null
    ]);

    const marine = marineData?.current || {};
    const standard = standardData?.current || {};

    return {
      temperature_c: standard.temperature_2m ?? null,
      wind_speed_kts: standard.wind_speed_10m ?? null,
      wind_direction: standard.wind_direction_10m ?? null,
      wind_gusts_kts: standard.wind_gusts_10m ?? null,
      precipitation_mm: standard.precipitation ?? null,
      weather_code: standard.weather_code ?? null,
      wave_height_m: marine.wave_height ?? null,
      wave_direction: marine.wave_direction ?? null,
      wave_period_s: marine.wave_period ?? null
    };
  } catch (error) {
    requestLogger.error('Failed to fetch weather', { error: error.message });
    return null;
  }
}

/**
 * Convert weather code to description
 * @param {number} code - WMO weather code
 * @returns {string} Human-readable description
 */
function weatherCodeToDescription(code) {
  const codes = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
  };
  return codes[code] || 'Unknown';
}

/**
 * Convert degrees to compass direction
 * @param {number} degrees - Direction in degrees (0-360)
 * @returns {string} Compass direction (N, NE, E, etc.)
 */
function degreesToCompass(degrees) {
  if (degrees === null || degrees === undefined) return 'N/A';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Downsample data to specified interval
 * Keeps data points that are at least intervalMinutes apart
 * @param {Array} data - Array of position objects with timestamp
 * @param {number} intervalMinutes - Minimum minutes between points
 * @returns {Array} Downsampled data
 */
function downsampleByInterval(data, intervalMinutes = 10) {
  if (!data || data.length === 0) return [];

  const intervalMs = intervalMinutes * 60 * 1000;
  const result = [data[0]]; // Always include first point
  let lastTimestamp = new Date(data[0].timestamp).getTime();

  for (let i = 1; i < data.length; i++) {
    const currentTimestamp = new Date(data[i].timestamp).getTime();
    if (currentTimestamp - lastTimestamp >= intervalMs) {
      result.push(data[i]);
      lastTimestamp = currentTimestamp;
    }
  }

  // Always include the last point (current position)
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }

  return result;
}

/**
 * Get complete boat status - position, weather, and historical data
 * @param {number} hoursBack - Hours of history to fetch (default 5)
 * @returns {Promise<Object>} Complete boat status
 */
export async function getBoatStatus(hoursBack = 5) {
  // Get current position
  const currentPosition = await gpsRepository.getCurrentPosition();

  if (!currentPosition) {
    return {
      hasData: false,
      message: 'No GPS data available'
    };
  }

  const { latitude, longitude, timestamp } = currentPosition;

  // Fetch place name and weather in parallel
  const [placeName, weather] = await Promise.all([
    reverseGeocode(latitude, longitude),
    fetchCurrentWeather(latitude, longitude)
  ]);

  // Get historical positions for charts (last N hours) — use RPC for server-side downsampling
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - (hoursBack * 60 * 60 * 1000));
  const summaryResult = await gpsRepository.getPositionsSummaryInRange(startTime, endTime, 600);
  const sortedHistory = (summaryResult.positions || []).sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  // Format historical data for charts
  const chartData = {
    timestamps: sortedHistory.map(p => p.timestamp),
    windSpeed: sortedHistory.map(p => p.true_wind_speed),
    windDirection: sortedHistory.map(p => p.true_wind_direction),
    latitude: sortedHistory.map(p => p.latitude),
    longitude: sortedHistory.map(p => p.longitude),
    sog: sortedHistory.map(p => p.speed_over_ground)
  };

  return {
    hasData: true,
    current: {
      position: {
        latitude,
        longitude,
        timestamp
      },
      placeName: placeName || 'Unknown Location',
      weather: weather ? {
        ...weather,
        weather_description: weatherCodeToDescription(weather.weather_code),
        wind_direction_compass: degreesToCompass(weather.wind_direction),
        wave_direction_compass: degreesToCompass(weather.wave_direction)
      } : null
    },
    history: {
      hoursBack,
      pointCount: sortedHistory.length,
      data: chartData
    }
  };
}

export default {
  getBoatStatus
};

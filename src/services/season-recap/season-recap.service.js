/**
 * Season Recap Service
 * Generates and stores season recap content using OpenAI
 *
 * Note: Uses direct OpenAI API call (not shared client) to support
 * GPT-5.x models with correct Responses API parameters
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Call OpenAI API directly using Chat Completions endpoint
 * Uses max_completion_tokens (required for /v1/chat/completions)
 *
 * Note: GPT-5.x runs in compatibility mode on this endpoint.
 * Temperature/seed may be ignored. Tone enforced via prompt.
 *
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User content
 * @returns {Promise<string>} Generated text
 */
async function callOpenAI(systemPrompt, userPrompt) {
  const env = getEnv();
  const model = env.OPENAI_MODEL || 'gpt-4o';

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_completion_tokens: 4000  // Required for /v1/chat/completions endpoint
  };

  requestLogger.info('Calling OpenAI for season recap', {
    model,
    systemLength: systemPrompt.length,
    userLength: userPrompt.length
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

/**
 * Build the system prompt for recap generation
 * @param {string} style - 'boring' or 'exciting'
 * @returns {string} System prompt
 */
function buildSystemPrompt(style) {
  if (style === 'boring') {
    return `You are a technical marine log writer. Generate a factual, detailed season recap for a sailing catamaran.

Your style should be:
- Professional and matter-of-fact
- Focus on facts, distances, dates, and statistics
- Include technical details about passages
- Mention each anchorage with duration and conditions
- Use proper nautical terminology
- Be thorough but not embellished

Format your response as clean HTML with:
- <h2> for major sections
- <h3> for subsections
- <p> for paragraphs
- <ul>/<li> for lists
- <strong> for emphasis on key facts
- Use proper semantic HTML

Do NOT include <html>, <head>, <body> tags - just the content.`;
  } else if (style === 'exciting') {
    return `You are a dramatic sailing storyteller with a flair for adventure. Generate an exciting, entertaining season recap for a sailing catamaran.

Your style should be:
- Dramatic and engaging, like a travel documentary
- Use vivid descriptions and metaphors
- Make even routine passages sound like adventures
- Add humor where appropriate
- Build narrative tension and excitement
- Celebrate the journey and destinations
- Use colorful nautical language

Format your response as clean HTML with:
- <h2> for major sections
- <h3> for subsections
- <p> for paragraphs
- <ul>/<li> for lists
- <strong> for emphasis
- <em> for dramatic effect
- Use proper semantic HTML

Do NOT include <html>, <head>, <body> tags - just the content.`;
  } else {
    // unhinged
    return `You are an UNHINGED sailing storyteller who has consumed too much rum and has the most incredible tales to tell. Generate an absolutely WILD, over-the-top, dramatic season recap for a sailing catamaran.

Your style should be:
- EXTREMELY dramatic - every wave was a monster, every breeze was a gale
- Verbose and flowery - use ALL the adjectives
- Theatrical - like a pirate captain recounting legends at a tavern
- Hilarious - exaggerate everything to comedic effect
- Include dramatic pauses, exclamations, and rhetorical questions
- Reference sea monsters, Neptune, mermaids, and other nautical mythology
- Make the crew sound like legendary heroes
- Every anchorage was paradise or purgatory, nothing in between
- Include the actual statistics but present them like WORLD RECORDS
- Use phrases like "AND THEN..." and "BUT WAIT, THERE'S MORE!"
- Channel your inner Captain Jack Sparrow meets David Attenborough

LOCAL & REGIONAL COLOR:
- Reference the unique character of each island (French Caribbean culture in Guadeloupe/Martinique, British influence in Antigua, volcanic drama of Dominica, etc.)
- Mention local landmarks, bays, and geographic features by name
- Include Caribbean history, folklore, and legends where relevant
- Reference local food, rum, music, and island life
- Describe the distinct personality of each anchorage and port
- Use local place names and nautical features (The Saints, Pitons, Pigeon Island, etc.)
- Weave in the trade winds, Caribbean seasons, and regional weather patterns

STILL include all the real details - distances, dates, locations, durations - but wrap them in MAXIMUM DRAMA.

OUTPUT LENGTH AND VERBOSITY:
- Be EXTREMELY detailed and thorough - this is a legendary tale, not a summary
- Each trip deserves its own dramatic arc with setup, tension, and resolution
- Each anchorage deserves vivid scene-setting and atmosphere
- Use complete paragraphs, not bullet points
- Minimum 3-4 paragraphs per major section
- Include dramatic transitions between sections
- Do not abbreviate or summarize - ELABORATE

Format your response as clean HTML with:
- <h2> for major sections (make them dramatic!)
- <h3> for subsections
- <p> for paragraphs
- <ul>/<li> for lists
- <strong> for EMPHASIS
- <em> for dramatic effect
- Use proper semantic HTML

Do NOT include <html>, <head>, <body> tags - just the content.`;
  }
}

/**
 * Format trip data for the prompt
 * @param {Array} trips - Trip records
 * @returns {string} Formatted trip data
 */
function formatTripsData(trips) {
  if (!trips || trips.length === 0) {
    return 'No trips recorded this season.';
  }

  let output = 'TRIPS DATA:\n\n';

  trips.forEach((trip, idx) => {
    output += `Trip ${idx + 1}: ${trip.title || 'Unnamed Trip'}\n`;
    output += `  - Date: ${new Date(trip.started_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    if (trip.distance_nm) output += `  - Distance: ${trip.distance_nm} nautical miles\n`;
    if (trip.duration_minutes) {
      const hours = Math.floor(trip.duration_minutes / 60);
      const mins = trip.duration_minutes % 60;
      output += `  - Duration: ${hours}h ${mins}m\n`;
    }
    if (trip.avg_sog) output += `  - Average Speed: ${trip.avg_sog} knots\n`;
    if (trip.max_sog) output += `  - Max Speed: ${trip.max_sog} knots\n`;
    output += '\n';
  });

  // Calculate totals
  const totalDistance = trips.reduce((sum, t) => sum + (t.distance_nm || 0), 0);
  const totalMinutes = trips.reduce((sum, t) => sum + (t.duration_minutes || 0), 0);
  const totalHours = Math.round(totalMinutes / 60);

  output += `\nSEASON TOTALS:\n`;
  output += `  - Total Trips: ${trips.length}\n`;
  output += `  - Total Distance: ${totalDistance.toFixed(1)} nautical miles\n`;
  output += `  - Total Sailing Time: ${totalHours} hours\n`;

  return output;
}

/**
 * Format anchorage data for the prompt
 * @param {Array} anchorages - Anchorage records
 * @returns {string} Formatted anchorage data
 */
function formatAnchoragesData(anchorages) {
  if (!anchorages || anchorages.length === 0) {
    return 'No anchorages recorded this season.';
  }

  let output = '\nANCHORAGES DATA:\n\n';

  anchorages.forEach((anch, idx) => {
    output += `Anchorage ${idx + 1}: ${anch.location_name || 'Unknown Location'}\n`;
    output += `  - Type: ${anch.anchorage_type || 'anchor'}\n`;
    if (anch.arrived_at) {
      output += `  - Arrived: ${new Date(anch.arrived_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    }
    if (anch.duration_hours) {
      const days = Math.floor(anch.duration_hours / 24);
      const hours = anch.duration_hours % 24;
      if (days > 0) {
        output += `  - Duration: ${days} days, ${hours} hours\n`;
      } else {
        output += `  - Duration: ${hours} hours\n`;
      }
    }
    if (anch.avg_wind_speed) output += `  - Average Wind: ${anch.avg_wind_speed} knots\n`;
    output += '\n';
  });

  // Calculate totals
  const totalHours = anchorages.reduce((sum, a) => sum + (a.duration_hours || 0), 0);
  const totalDays = Math.round(totalHours / 24);

  output += `\nANCHORAGE TOTALS:\n`;
  output += `  - Total Anchorages/Moorings: ${anchorages.length}\n`;
  output += `  - Total Time at Anchor: ${totalDays} days\n`;

  return output;
}

/**
 * Get stored recap by style
 * @param {string} style - 'boring' or 'exciting'
 * @returns {Promise<Object|null>} Stored recap or null
 */
export async function getRecap(style) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('season_recaps')
    .select('*')
    .eq('style', style)
    .maybeSingle();

  if (error) {
    requestLogger.error('Error fetching recap', { style, error: error.message });
    throw new Error(`Failed to fetch recap: ${error.message}`);
  }

  return data;
}

/**
 * Get all recaps
 * @returns {Promise<Object>} { boring: recap|null, exciting: recap|null, unhinged: recap|null }
 */
export async function getAllRecaps() {
  const [boring, exciting, unhinged] = await Promise.all([
    getRecap('boring'),
    getRecap('exciting'),
    getRecap('unhinged')
  ]);

  return { boring, exciting, unhinged };
}

/**
 * Generate and store a new recap
 * @param {string} style - 'boring', 'exciting', or 'unhinged'
 * @returns {Promise<Object>} Generated recap record
 */
export async function generateRecap(style) {
  if (!['boring', 'exciting', 'unhinged'].includes(style)) {
    throw new Error('Style must be "boring", "exciting", or "unhinged"');
  }

  const supabase = await getSupabaseClient();
  const env = getEnv();

  requestLogger.info('Starting recap generation', { style });

  // Fetch all trips and anchorages
  const [tripsResult, anchoragesResult] = await Promise.all([
    supabase
      .from('trips')
      .select('*')
      .eq('status', 'completed')
      .order('started_at', { ascending: true }),
    supabase
      .from('anchorages')
      .select('*')
      .order('arrived_at', { ascending: true })
  ]);

  if (tripsResult.error) {
    throw new Error(`Failed to fetch trips: ${tripsResult.error.message}`);
  }
  if (anchoragesResult.error) {
    throw new Error(`Failed to fetch anchorages: ${anchoragesResult.error.message}`);
  }

  const trips = tripsResult.data || [];
  const anchorages = anchoragesResult.data || [];

  requestLogger.info('Fetched data for recap', {
    tripsCount: trips.length,
    anchoragesCount: anchorages.length
  });

  // Build prompts
  const systemPrompt = buildSystemPrompt(style);
  const userPrompt = `Please generate a ${style === 'boring' ? 'factual and detailed' : 'dramatic and exciting'} season recap based on the following sailing data:\n\n${formatTripsData(trips)}\n\n${formatAnchoragesData(anchorages)}\n\nGenerate a comprehensive recap covering all the trips and anchorages. Make it engaging and thorough.`;

  // Call OpenAI directly (GPT-5.x compatible)
  const modelUsed = env.OPENAI_MODEL || 'gpt-4o';

  const content = await callOpenAI(systemPrompt, userPrompt);

  requestLogger.info('OpenAI recap generated', {
    style,
    contentLength: content.length
  });

  // Upsert the recap (update if exists, insert if not)
  const { data: existingRecap } = await supabase
    .from('season_recaps')
    .select('id')
    .eq('style', style)
    .maybeSingle();

  let result;
  const recapData = {
    style,
    content,
    model_used: modelUsed,
    trips_count: trips.length,
    anchorages_count: anchorages.length,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (existingRecap) {
    // Update existing
    const { data, error } = await supabase
      .from('season_recaps')
      .update(recapData)
      .eq('id', existingRecap.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update recap: ${error.message}`);
    result = data;
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('season_recaps')
      .insert(recapData)
      .select()
      .single();

    if (error) throw new Error(`Failed to insert recap: ${error.message}`);
    result = data;
  }

  requestLogger.info('Recap stored successfully', {
    style,
    id: result.id,
    tripsCount: trips.length,
    anchoragesCount: anchorages.length
  });

  return result;
}

export default {
  getRecap,
  getAllRecaps,
  generateRecap
};

/**
 * AI Analysis Service for Supplies
 * Handles photo analysis (GPT-4V) and system recommendations (Pinecone + GPT-4)
 */

import fs from 'fs';
import path from 'path';
import { oaiVision } from '../../clients/openai.client.js';
import pineconeRepository from '../../repositories/pinecone.repository.js';
import { getSystemByAssetUid } from '../../repositories/systems.repository.js';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';

const requestLogger = logger.createRequestLogger();

/**
 * Analyze a photo of a supply item using GPT-4V
 * @param {string} photoUrl - URL to the photo (must be publicly accessible)
 * @param {Object} options - Optional categories and units from database
 * @param {string[]} options.categories - List of category names
 * @param {string[]} options.units - List of unit names with abbreviations
 * @returns {Promise<Object>} Extracted item details
 */
export async function analyzeSupplyPhoto(photoUrl, options = {}) {
  try {
    requestLogger.info('Analyzing supply photo', { photoUrl });

    // Validate photo path
    if (!photoUrl || typeof photoUrl !== 'string') {
      throw new Error('Invalid photo path provided');
    }

    // Build file path and read image as base64
    const filePath = photoUrl.startsWith('/')
      ? path.join(process.cwd(), photoUrl)
      : path.join(process.cwd(), '/', photoUrl);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Photo file not found: ${filePath}`);
    }

    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = photoUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

    requestLogger.info('Photo loaded for GPT-4V analysis', {
      filePath,
      fileSize: imageBuffer.length,
      mimeType
    });

    // Use provided categories/units or defaults
    const categories = options.categories?.length > 0
      ? options.categories.join(', ')
      : 'Engine Parts & Service, Electrical, Plumbing & Water Systems, Rigging & Deck Hardware, Safety Equipment, General Supplies, Tools, Consumables, Other';

    const units = options.units?.length > 0
      ? options.units.join(', ')
      : 'Each (ea), Box (box), Gallon (gal), Quart (qt), Liter (L), Feet (ft), Meter (m), Set (set), Pair (pr), Pack (pk)';

    const systemPrompt = `You are an expert at analyzing marine equipment and supply items from photos.
Your task is to extract key information from the image and return it in a structured format.

Focus on identifying:
- Item name (what is this item?)
- Brand/manufacturer (if visible)
- Part number or model number (if visible)
- Suggested category (where would this item belong in a boat inventory?)
- Suggested unit of measure (how would this item typically be counted/measured?)

Be specific and accurate. If you cannot determine something with confidence, use null.`;

    const userPrompt = `Analyze this supply item photo and extract:

1. Item name (e.g., "Oil Filter", "Bilge Pump", "Shackle")
2. Brand (e.g., "Racor", "Rule", "Harken")
3. Part number (e.g., "2010PM", "500GPH", "H2161")
4. Suggested category - choose the BEST match from: ${categories}
5. Suggested unit - choose the BEST match from: ${units}

Return your analysis in this exact JSON format:
{
  "item_name": "extracted name or null",
  "brand": "extracted brand or null",
  "part_number": "extracted part number or null",
  "suggested_category": "best matching category from the list",
  "suggested_unit": "best matching unit from the list (just the name, not abbreviation)",
  "confidence": 0.0-1.0,
  "notes": "brief explanation of what you see and your reasoning"
}`;

    const response = await oaiVision({
      system: systemPrompt,
      user: userPrompt,
      imageUrl: imageDataUrl,
      maxOutputTokens: 500
    });

    requestLogger.info('GPT-4V raw response', { response: response.substring(0, 200) });

    // Parse JSON response
    let analysisResult;
    try {
      // Try to extract JSON from response (GPT-4V sometimes adds markdown)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      requestLogger.error('Failed to parse GPT-4V response', { error: parseError.message, response });
      throw new Error('Failed to parse AI response. Please try again.');
    }

    // Validate required fields
    if (!analysisResult.suggested_category) {
      analysisResult.suggested_category = 'Other';
    }

    requestLogger.info('Photo analysis completed', {
      item_name: analysisResult.item_name,
      brand: analysisResult.brand,
      suggested_unit: analysisResult.suggested_unit,
      confidence: analysisResult.confidence
    });

    return {
      success: true,
      data: {
        item_name: analysisResult.item_name,
        brand: analysisResult.brand,
        part_number: analysisResult.part_number,
        suggested_category: analysisResult.suggested_category,
        suggested_unit: analysisResult.suggested_unit || null,
        confidence: analysisResult.confidence || 0,
        notes: analysisResult.notes || ''
      }
    };

  } catch (error) {
    requestLogger.error('Photo analysis failed', { error: error.message, photoUrl });
    throw new Error(`Photo analysis failed: ${error.message}`);
  }
}

/**
 * Analyze a photo using base64 data directly (no file system needed)
 * @param {string} imageBase64 - Base64 data URL (data:image/jpeg;base64,...)
 * @param {Object} options - Optional categories and units from database
 * @param {string[]} options.categories - List of category names
 * @param {string[]} options.units - List of unit names with abbreviations
 * @returns {Promise<Object>} Extracted item details
 */
export async function analyzeSupplyPhotoBase64(imageBase64, options = {}) {
  try {
    requestLogger.info('Analyzing supply photo from base64');

    // Validate base64 data
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new Error('Invalid base64 image data provided');
    }

    if (!imageBase64.startsWith('data:image/')) {
      throw new Error('Invalid image format - expected data URL');
    }

    // Use provided categories/units or defaults
    const categories = options.categories?.length > 0
      ? options.categories.join(', ')
      : 'Engine Parts & Service, Electrical, Plumbing & Water Systems, Rigging & Deck Hardware, Safety Equipment, General Supplies, Tools, Consumables, Other';

    const units = options.units?.length > 0
      ? options.units.join(', ')
      : 'Each (ea), Box (box), Gallon (gal), Quart (qt), Liter (L), Feet (ft), Meter (m), Set (set), Pair (pr), Pack (pk)';

    const systemPrompt = `You are an expert at analyzing marine equipment and supply items from photos.
Your task is to extract key information from the image and return it in a structured format.

Focus on identifying:
- Item name (what is this item?)
- Brand/manufacturer (if visible)
- Part number or model number (if visible)
- Suggested category (where would this item belong in a boat inventory?)
- Suggested unit of measure (how would this item typically be counted/measured?)

Be specific and accurate. If you cannot determine something with confidence, use null.`;

    const userPrompt = `Analyze this supply item photo and extract:

1. Item name (e.g., "Oil Filter", "Bilge Pump", "Shackle")
2. Brand (e.g., "Racor", "Rule", "Harken")
3. Part number (e.g., "2010PM", "500GPH", "H2161")
4. Suggested category - choose the BEST match from: ${categories}
5. Suggested unit - choose the BEST match from: ${units}

Return your analysis in this exact JSON format:
{
  "item_name": "extracted name or null",
  "brand": "extracted brand or null",
  "part_number": "extracted part number or null",
  "suggested_category": "best matching category from the list",
  "suggested_unit": "best matching unit from the list (just the name, not abbreviation)",
  "confidence": 0.0-1.0,
  "notes": "brief explanation of what you see and your reasoning"
}`;

    const response = await oaiVision({
      system: systemPrompt,
      user: userPrompt,
      imageUrl: imageBase64,
      maxOutputTokens: 500
    });

    requestLogger.info('GPT-4V raw response', { response: response.substring(0, 200) });

    // Parse JSON response
    let analysisResult;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      requestLogger.error('Failed to parse GPT-4V response', { error: parseError.message, response });
      throw new Error('Failed to parse AI response. Please try again.');
    }

    if (!analysisResult.suggested_category) {
      analysisResult.suggested_category = 'Other';
    }

    requestLogger.info('Photo analysis completed (base64)', {
      item_name: analysisResult.item_name,
      brand: analysisResult.brand,
      suggested_unit: analysisResult.suggested_unit,
      confidence: analysisResult.confidence
    });

    return {
      success: true,
      data: {
        item_name: analysisResult.item_name,
        brand: analysisResult.brand,
        part_number: analysisResult.part_number,
        suggested_category: analysisResult.suggested_category,
        suggested_unit: analysisResult.suggested_unit || null,
        confidence: analysisResult.confidence || 0,
        notes: analysisResult.notes || ''
      }
    };

  } catch (error) {
    requestLogger.error('Photo analysis failed (base64)', { error: error.message });
    throw new Error(`Photo analysis failed: ${error.message}`);
  }
}

/**
 * Suggest boat systems relevant to a supply item
 * Uses Pinecone semantic search + systems table lookup
 * @param {Object} itemData - Supply item details
 * @returns {Promise<Object>} System recommendations
 */
export async function suggestSystemsForSupply(itemData) {
  try {
    const { item_name, brand, part_number, category } = itemData;

    requestLogger.info('Suggesting systems for supply', { item_name, brand, part_number, category });

    // Build semantic search query (excluding category - it dilutes relevance)
    const queryParts = [
      item_name,
      brand,
      part_number
    ].filter(Boolean);

    if (queryParts.length === 0) {
      throw new Error('No item data provided for system recommendations');
    }

    const searchQuery = queryParts.join(' ');
    requestLogger.info('Built Pinecone search query', { searchQuery });

    // Search Pinecone for relevant document chunks
    const pineconeResults = await pineconeRepository.searchVectors(searchQuery, {
      topK: 20,
      includeMetadata: true,
      includeValues: false
    });

    requestLogger.info('Pinecone search completed', {
      matchesCount: pineconeResults.matches?.length || 0
    });

    if (!pineconeResults.matches || pineconeResults.matches.length === 0) {
      return {
        success: true,
        data: {
          suggestions: [],
          query: searchQuery,
          message: 'No relevant systems found in documentation'
        }
      };
    }

    // Group results by asset_uid and calculate relevance
    const systemScores = {};

    for (const match of pineconeResults.matches) {
      const metadata = match.metadata || {};
      const assetUid = metadata.linked_asset_uid;

      if (!assetUid) {
        continue; // Skip chunks without linked_asset_uid
      }

      if (!systemScores[assetUid]) {
        systemScores[assetUid] = {
          asset_uid: assetUid,
          scores: [],
          chunks: [],
          manufacturer: metadata.manufacturer || 'Unknown',
          model: metadata.model || 'Unknown'
        };
      }

      systemScores[assetUid].scores.push(match.score);
      systemScores[assetUid].chunks.push({
        content: metadata.content || metadata.text || '',
        score: match.score,
        page: metadata.page || 0
      });
    }

    // Calculate average score for each system and sort
    const rankedSystems = Object.values(systemScores)
      .map(sys => ({
        ...sys,
        avgScore: sys.scores.reduce((a, b) => a + b, 0) / sys.scores.length,
        maxScore: Math.max(...sys.scores),
        chunkCount: sys.chunks.length
      }))
      .sort((a, b) => b.maxScore - a.maxScore)
      .slice(0, 5); // Top 5 systems

    requestLogger.info('Ranked systems', {
      systemsCount: rankedSystems.length,
      topSystem: rankedSystems[0]?.asset_uid
    });

    // Lookup full system metadata from systems table
    const suggestions = [];

    for (const rankedSystem of rankedSystems) {
      try {
        const systemData = await getSystemByAssetUid(rankedSystem.asset_uid);

        if (!systemData) {
          requestLogger.warn('System not found in database', { asset_uid: rankedSystem.asset_uid });
          continue;
        }

        // Get best chunk for context
        const bestChunk = rankedSystem.chunks
          .sort((a, b) => b.score - a.score)[0];

        suggestions.push({
          asset_uid: systemData.asset_uid,
          manufacturer: systemData.manufacturer_norm || rankedSystem.manufacturer,
          model: systemData.model_norm || rankedSystem.model,
          system: systemData.system_norm || 'Unknown',
          subsystem: systemData.subsystem_norm || 'Unknown',
          description: systemData.description || '',
          confidence: Math.round(rankedSystem.maxScore * 100) / 100,
          reason: bestChunk.content.substring(0, 200) + (bestChunk.content.length > 200 ? '...' : ''),
          chunkCount: rankedSystem.chunkCount
        });

      } catch (lookupError) {
        requestLogger.error('Failed to lookup system', {
          asset_uid: rankedSystem.asset_uid,
          error: lookupError.message
        });
        // Continue with other systems
      }
    }

    requestLogger.info('System suggestions completed', {
      suggestionsCount: suggestions.length
    });

    return {
      success: true,
      data: {
        suggestions,
        query: searchQuery,
        totalMatches: pineconeResults.matches.length
      }
    };

  } catch (error) {
    requestLogger.error('System suggestions failed', {
      error: error.message,
      itemData
    });
    throw new Error(`System suggestions failed: ${error.message}`);
  }
}

export default {
  analyzeSupplyPhoto,
  analyzeSupplyPhotoBase64,
  suggestSystemsForSupply
};

/**
 * Test script for OpenAI Vision API
 * Tests analyzing a supply photo with base64 encoding
 *
 * Usage: node scripts/test-openai-vision.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not found in .env');
  process.exit(1);
}

// Image path - the test image
const imagePath = path.join(__dirname, '..', 'code updates', 'temp pic', 'Supplies Management  BoatOS.png');

async function testVisionAPI() {
  console.log('=== OpenAI Vision API Test ===\n');

  // Check if image exists
  if (!fs.existsSync(imagePath)) {
    console.error('ERROR: Image not found at:', imagePath);
    process.exit(1);
  }

  console.log('Image path:', imagePath);

  // Read and encode image as base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = 'image/png';

  console.log('Image size:', imageBuffer.length, 'bytes');
  console.log('Base64 length:', base64Image.length, 'chars');
  console.log('\nSending to OpenAI Vision API...\n');

  const systemPrompt = `You are an expert at analyzing marine equipment and supply items from photos.
Your task is to extract key information from the image and return it in a structured format.

Focus on identifying:
- Item name (what is this item?)
- Brand/manufacturer (if visible)
- Part number or model number (if visible)
- Suggested category (where would this item belong in a boat inventory?)

Be specific and accurate. If you cannot determine something with confidence, use null.`;

  const userPrompt = `Analyze this supply item photo and extract:

1. Item name (e.g., "Oil Filter", "Bilge Pump", "Shackle")
2. Brand (e.g., "Racor", "Rule", "Harken")
3. Part number (e.g., "2010PM", "500GPH", "H2161")
4. Suggested category (choose from: Engine Parts & Service, Electrical, Plumbing & Water Systems, Rigging & Deck Hardware, Safety Equipment, General Supplies, Tools, Consumables, Other)

Return your analysis in this exact JSON format:
{
  "item_name": "extracted name or null",
  "brand": "extracted brand or null",
  "part_number": "extracted part number or null",
  "suggested_category": "best matching category",
  "confidence": 0.0-1.0,
  "notes": "brief explanation of what you see and your reasoning"
}`;

  const requestBody = {
    model: 'gpt-4o',  // Using gpt-4o which has vision capabilities
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high'
            }
          }
        ]
      }
    ],
    max_tokens: 500,
    temperature: 0
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('API Error:', response.status, JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('=== RAW RESPONSE ===');
    console.log(JSON.stringify(data, null, 2));

    console.log('\n=== EXTRACTED CONTENT ===');
    const content = data.choices[0].message.content;
    console.log(content);

    // Try to parse JSON from response
    console.log('\n=== PARSED RESULT ===');
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(JSON.stringify(parsed, null, 2));
    } else {
      console.log('Could not extract JSON from response');
    }

    console.log('\n=== TOKEN USAGE ===');
    console.log('Prompt tokens:', data.usage.prompt_tokens);
    console.log('Completion tokens:', data.usage.completion_tokens);
    console.log('Total tokens:', data.usage.total_tokens);

  } catch (error) {
    console.error('Request failed:', error.message);
    process.exit(1);
  }
}

testVisionAPI();

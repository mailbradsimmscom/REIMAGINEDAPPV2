#!/usr/bin/env node
/**
 * Test Model Detection - Isolated Testing Script
 *
 * Tests the model detection pipeline WITHOUT going through upload flow.
 * This lets us validate parsing and detection work before testing full pipeline.
 *
 * Usage:
 *   node scripts/test-model-detection.cjs <path-to-pdf>
 *   node scripts/test-model-detection.cjs /path/to/Yanmar_4JH_Manual.pdf
 *
 * Requirements:
 *   - Python sidecar running on port 8000
 *
 * Steps:
 *   1. Reads PDF from disk
 *   2. Calls /v1/parse (with OCR enabled)
 *   3. Extracts text elements
 *   4. Calls /v1/detect-models
 *   5. Displays results
 */

const fs = require('fs');
const path = require('path');

// Get PDF path from args
const pdfPath = process.argv[2];

if (!pdfPath) {
  console.log(`
Usage: node scripts/test-model-detection.cjs <path-to-pdf>

Example:
  node scripts/test-model-detection.cjs ~/Downloads/0AJHC-EN0015_2019.12.pdf
  `);
  process.exit(1);
}

const SIDECAR_URL = process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000';

async function testModelDetection() {
  console.log('🔬 Test Model Detection Script');
  console.log('==============================\n');

  // Step 1: Check PDF exists
  const absolutePath = path.resolve(pdfPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ File not found: ${absolutePath}`);
    process.exit(1);
  }

  const fileName = path.basename(absolutePath);
  const fileBuffer = fs.readFileSync(absolutePath);
  console.log(`📄 PDF: ${fileName}`);
  console.log(`   Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Step 2: Check sidecar health
  console.log(`\n🔗 Sidecar URL: ${SIDECAR_URL}`);
  try {
    const healthResp = await fetch(`${SIDECAR_URL}/health`);
    if (!healthResp.ok) throw new Error(`Status ${healthResp.status}`);
    console.log('   ✅ Sidecar is healthy\n');
  } catch (err) {
    console.error(`   ❌ Sidecar not responding: ${err.message}`);
    console.error('   Make sure Python sidecar is running: cd python-sidecar && python -m app.main');
    process.exit(1);
  }

  // Step 3: Call parse endpoint
  console.log('📖 Step 1: Parsing PDF...');
  const startParse = Date.now();

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  formData.append('file', blob, fileName);
  formData.append('extract_tables', 'false');
  formData.append('ocr_enabled', 'true');  // Enable OCR for scanned PDFs

  let parseResult;
  try {
    const parseResp = await fetch(`${SIDECAR_URL}/v1/parse`, {
      method: 'POST',
      body: formData
    });

    if (!parseResp.ok) {
      const errorText = await parseResp.text();
      throw new Error(`Parse failed: ${parseResp.status} ${errorText}`);
    }

    parseResult = await parseResp.json();
    const parseTime = ((Date.now() - startParse) / 1000).toFixed(1);
    console.log(`   ✅ Parse complete (${parseTime}s)`);
    console.log(`   Elements: ${parseResult.elements?.length || 0}`);
    console.log(`   Element types: ${[...new Set(parseResult.elements?.map(e => e.element_type) || [])].join(', ')}`);
  } catch (err) {
    console.error(`   ❌ Parse failed: ${err.message}`);
    process.exit(1);
  }

  // Step 4: Extract text
  console.log('\n📝 Step 2: Extracting text...');

  const textElements = parseResult.elements?.filter(el => el.element_type === 'text') || [];
  const textContent = textElements
    .map(el => el.content)
    .join('\n')
    .substring(0, 15000);

  console.log(`   Text elements: ${textElements.length}`);
  console.log(`   Total text length: ${textContent.length} chars`);

  if (textContent.length < 100) {
    console.error(`   ❌ Insufficient text content (${textContent.length} chars)`);
    console.log('\n   First element preview:');
    console.log(`   ${parseResult.elements?.[0]?.content?.substring(0, 300) || 'No elements'}`);
    process.exit(1);
  }

  console.log(`\n   Text preview (first 500 chars):`);
  console.log('   ' + '-'.repeat(60));
  console.log(`   ${textContent.substring(0, 500).replace(/\n/g, '\n   ')}`);
  console.log('   ' + '-'.repeat(60));

  // Step 5: Call detect-models endpoint
  console.log('\n🔍 Step 3: Detecting models...');
  const startDetect = Date.now();

  try {
    const detectResp = await fetch(`${SIDECAR_URL}/v1/detect-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: textContent,
        doc_id: 'test-' + Date.now(),
        filename: fileName
      })
    });

    if (!detectResp.ok) {
      const errorText = await detectResp.text();
      throw new Error(`Detection failed: ${detectResp.status} ${errorText}`);
    }

    const detectResult = await detectResp.json();
    const detectTime = ((Date.now() - startDetect) / 1000).toFixed(1);

    console.log(`   ✅ Detection complete (${detectTime}s)\n`);

    // Display results
    console.log('═'.repeat(60));
    console.log('   RESULTS');
    console.log('═'.repeat(60));
    console.log(`   Models detected: ${JSON.stringify(detectResult.models_detected)}`);
    console.log(`   Is multi-model:  ${detectResult.is_multi_model}`);
    console.log(`   Confidence:      ${detectResult.confidence}`);
    console.log(`   Evidence:        ${detectResult.evidence?.substring(0, 200) || 'N/A'}`);
    console.log('═'.repeat(60));

    if (detectResult.models_detected?.length > 0) {
      console.log('\n✅ Model detection working correctly!');
    } else {
      console.log('\n⚠️  No models detected. Check the evidence above for details.');
    }

  } catch (err) {
    console.error(`   ❌ Detection failed: ${err.message}`);
    process.exit(1);
  }
}

testModelDetection().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});

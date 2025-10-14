import { readFileSync } from 'fs';

/**
 * Extract text from PDF using Python sidecar's working parser
 */
export async function extractPdfTextWithPython(pdfPath, logger) {
  try {
    logger.info(`Using Python sidecar to parse: ${pdfPath}`);

    // Read PDF file
    const pdfBuffer = readFileSync(pdfPath);
    const filename = pdfPath.split('/').pop();

    // Create FormData for multipart upload
    const formData = new FormData();
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    formData.append('file', blob, filename);
    formData.append('extract_tables', 'false');
    formData.append('ocr_enabled', 'false'); // Faster without OCR

    // Call Python sidecar's parse endpoint
    const response = await fetch('http://localhost:8000/v1/parse', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60000) // 60 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python parser error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (!result.success || !result.elements) {
      throw new Error('Python parser returned no text');
    }

    // Extract text from all elements
    let fullText = '';
    for (const element of result.elements) {
      if (element.content) {
        fullText += element.content + '\n';
      }
    }

    // Limit to first 5000 words for validation
    const words = fullText.split(/\s+/).slice(0, 5000).join(' ');

    logger.info(`Python parser extracted ${words.length} characters from ${result.pages_parsed} pages`);
    return words;

  } catch (error) {
    logger.error(`Python PDF extraction failed: ${error.message}`);

    // Check if Python sidecar is running
    if (error.message.includes('ECONNREFUSED')) {
      logger.error('Python sidecar not running! Start it with: cd python-sidecar && python3 -m app.main');
    }

    return null;
  }
}
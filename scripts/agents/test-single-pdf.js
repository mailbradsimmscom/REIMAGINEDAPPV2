import 'dotenv/config';
import { readFileSync } from 'fs';
import { setTimeout } from 'timers/promises';

async function testSinglePDF() {
  const pdfPath = 'scripts/agents/manual-hunter-results/pdfs/Yanmar_port_engine.pdf';

  console.log(`Testing LlamaParser with: ${pdfPath}`);

  // Read PDF file
  const pdfBuffer = readFileSync(pdfPath);
  const filename = pdfPath.split('/').pop();

  console.log(`PDF size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Check for API key
  const apiKey = process.env.LLAMAPARSE_API_KEY;
  if (!apiKey) {
    console.error('LLAMAPARSE_API_KEY not found');
    return;
  }

  console.log('API key found, uploading to LlamaParser...');

  // Create FormData for multipart upload
  const formData = new FormData();
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('file', blob, filename);
  formData.append('parsing_instruction', 'Extract text from first 10 pages');

  // Upload to LlamaParser
  const uploadResponse = await fetch('https://api.cloud.llamaindex.ai/api/parsing/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData,
    signal: AbortSignal.timeout(30000)
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    console.error(`Upload failed (${uploadResponse.status}): ${error}`);
    return;
  }

  const result = await uploadResponse.json();
  console.log('Upload response:', JSON.stringify(result, null, 2));

  // Check if we got a job ID
  const jobId = result.id || result.job_id;
  if (!jobId) {
    console.log('No job ID - checking for direct result...');
    if (result.text || result.markdown) {
      console.log('Got direct text response!');
      console.log('Text length:', (result.text || result.markdown).length);
      console.log('First 500 chars:', (result.text || result.markdown).substring(0, 500));
    } else {
      console.log('No text in response');
    }
    return;
  }

  console.log(`Got job ID: ${jobId}`);
  console.log('Starting to poll for results...');

  // Poll for results
  let attempts = 0;
  const maxAttempts = 60; // 3 minutes
  const pollInterval = 3000; // 3 seconds

  while (attempts < maxAttempts) {
    attempts++;
    await setTimeout(pollInterval);

    const statusUrl = `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}/result`;
    console.log(`[Attempt ${attempts}/${maxAttempts}] Polling: ${statusUrl}`);

    const statusResponse = await fetch(statusUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!statusResponse.ok) {
      console.log(`Poll failed (${statusResponse.status}): ${await statusResponse.text()}`);
      continue;
    }

    const statusResult = await statusResponse.json();
    console.log(`Response status: ${statusResult.status || 'no status field'}`);

    // Log full response structure once
    if (attempts === 1) {
      console.log('Full response structure:', JSON.stringify(Object.keys(statusResult), null, 2));
    }

    // Check for completion
    if (statusResult.status === 'SUCCESS' || statusResult.status === 'COMPLETED') {
      console.log('✅ Job completed!');

      // Try to find text in various places
      let text = '';
      if (statusResult.text) {
        text = statusResult.text;
        console.log('Found text in .text field');
      } else if (statusResult.markdown) {
        text = statusResult.markdown;
        console.log('Found text in .markdown field');
      } else if (statusResult.pages) {
        console.log('Found pages array with', statusResult.pages.length, 'pages');
        text = statusResult.pages.map(p => p.text || p.content || '').join('\n');
      } else if (statusResult.result) {
        console.log('Found result object');
        text = statusResult.result.text || statusResult.result.markdown || '';
      }

      if (text) {
        console.log(`\n✅ SUCCESS! Extracted ${text.length} characters`);
        console.log('\nFirst 1000 characters:');
        console.log('=' .repeat(50));
        console.log(text.substring(0, 1000));
        console.log('=' .repeat(50));
      } else {
        console.log('❌ Status is SUCCESS but no text found in response');
        console.log('Full response:', JSON.stringify(statusResult, null, 2));
      }
      break;
    } else if (statusResult.status === 'ERROR' || statusResult.status === 'FAILED') {
      console.log('❌ Job failed:', statusResult.error || statusResult.message);
      break;
    } else if (statusResult.status === 'PENDING' || statusResult.status === 'PROCESSING') {
      if (attempts % 5 === 0) {
        console.log(`Still processing... (${attempts * pollInterval / 1000}s elapsed)`);
      }
    } else {
      console.log('Unknown status or no status field');
      // Check if there's text anyway
      if (statusResult.text || statusResult.markdown) {
        console.log('Found text despite no status!');
        const text = statusResult.text || statusResult.markdown;
        console.log(`Extracted ${text.length} characters`);
        console.log('First 500 chars:', text.substring(0, 500));
        break;
      }
    }
  }

  if (attempts >= maxAttempts) {
    console.log('❌ Timeout after 3 minutes');
  }
}

// Run test
testSinglePDF().catch(console.error);
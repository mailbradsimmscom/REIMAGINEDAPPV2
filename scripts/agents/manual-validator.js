import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { config } from './manual-validator-config.js';

/**
 * Manual Validator Agent
 * Validates downloaded PDFs using LlamaParse + GPT-4o-mini
 * Scores and ranks each manual for quality and relevance
 */

class ManualValidator {
  constructor() {
    this.results = [];
    this.processed = 0;
    this.logger = this.createLogger();
    this.startTime = Date.now();
  }

  createLogger() {
    const logLevel = process.env.LOG_LEVEL || 'info';
    return {
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.log(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
      debug: (msg) => logLevel === 'debug' && console.log(`[DEBUG] ${msg}`)
    };
  }

  /**
   * Load systems metadata from CSV
   */
  loadSystemsMetadata() {
    const csv = readFileSync(config.paths.systemsCsv, 'utf-8');
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');

    const systems = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const values = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/^"|"$/g, ''));

      const obj = {};
      headers.forEach((header, idx) => {
        obj[header.trim()] = values[idx];
      });

      systems[obj.asset_uid] = obj;
    }

    return systems;
  }

  /**
   * Load manual hunter results to get PDF -> system mapping
   */
  loadManualHunterResults() {
    try {
      // Find latest results file
      const resultsDir = 'scripts/agents/manual-hunter-results';
      const files = readdirSync(resultsDir)
        .filter(f => f.startsWith('run-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length === 0) {
        throw new Error('No manual hunter results found');
      }

      const mapping = {};

      // Load all result files to build complete mapping
      for (const file of files) {
        const filePath = join(resultsDir, file);
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));

        for (const result of data.results) {
          if (result.downloaded && result.local_path) {
            const filename = result.local_path.split('/').pop();
            mapping[filename] = {
              asset_uid: result.asset_uid,
              manufacturer: result.manufacturer,
              model: result.model,
              system: result.system,
              subsystem: result.subsystem,
              source: result.source,
              manual_url: result.manual_url
            };
          }
        }
      }

      return mapping;

    } catch (error) {
      this.logger.error(`Failed to load manual hunter results: ${error.message}`);
      return {};
    }
  }

  /**
   * Extract text from PDF using pdf-parse
   */
  async extractPdfText(pdfPath) {
    try {
      this.logger.debug(`Parsing PDF: ${pdfPath}`);

      // Read PDF file
      const pdfBuffer = readFileSync(pdfPath);

      // Parse PDF
      const pdfParse = await import('pdf-parse');
      const parse = pdfParse.default || pdfParse;
      const data = await parse(pdfBuffer, {
        max: config.llamaParse.maxPages // Only parse first 10 pages
      });

      const text = data.text;

      // Limit to first 5000 words
      const words = text.split(/\s+/).slice(0, 5000).join(' ');

      this.logger.debug(`Extracted ${words.length} characters from PDF (${data.numpages} pages)`);
      return words;

    } catch (error) {
      this.logger.error(`PDF extraction failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate PDF using GPT-4o-mini
   */
  async validatePdf(pdfText, metadata, systemInfo) {
    try {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not found');
      }

      if (!pdfText || pdfText.length < 100) {
        return {
          manufacturer_match: 0,
          model_match: 0,
          manual_type: 'unknown',
          marine_context: false,
          content_relevance: 0,
          overall_confidence: 0,
          reasoning: 'PDF text extraction failed or too short',
          concerns: ['Could not extract sufficient text from PDF'],
          recommendation: 'REJECT'
        };
      }

      const prompt = `
Expected Marine Equipment:
- Manufacturer: ${metadata.manufacturer}
- Model: ${metadata.model}
- Description: ${systemInfo?.description || 'N/A'}
- System Type: ${metadata.system} / ${metadata.subsystem}

PDF Content (first 10 pages):
${pdfText.substring(0, 4000)}

Validate this PDF and provide scores (0-100):

1. manufacturer_match: Does the PDF match the expected manufacturer?
2. model_match: Does the model number in the PDF match the expected model?
3. manual_type: What type is this? ("user_manual" | "installation_guide" | "service_manual" | "parts_catalog" | "unknown")
4. marine_context: Is this specifically for marine/boat use? (true/false)
5. content_relevance: Does the content match the system description?

Also provide:
- overall_confidence: Overall score 0-100
- reasoning: Brief explanation of scores
- concerns: Array of any issues found
- recommendation: "APPROVED" (>=75) | "REVIEW" (50-74) | "REJECT" (<50)

Return ONLY valid JSON, no markdown.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages: [
            {
              role: 'system',
              content: 'You are a marine systems documentation expert. Validate PDFs and return structured JSON.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: config.llm.temperature,
          max_tokens: config.llm.maxTokens,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      return JSON.parse(content);

    } catch (error) {
      this.logger.error(`Validation failed: ${error.message}`);
      return {
        manufacturer_match: 0,
        model_match: 0,
        manual_type: 'unknown',
        marine_context: false,
        content_relevance: 0,
        overall_confidence: 0,
        reasoning: `Validation error: ${error.message}`,
        concerns: ['LLM validation failed'],
        recommendation: 'REJECT'
      };
    }
  }

  /**
   * Process a single PDF
   */
  async processPdf(filename, metadata, systemInfo) {
    this.logger.info(`\n--- Validating: ${filename} ---`);

    const pdfPath = join(config.paths.pdfs, filename);

    const result = {
      filename,
      asset_uid: metadata.asset_uid,
      manufacturer: metadata.manufacturer,
      model: metadata.model,
      system: metadata.system,
      subsystem: metadata.subsystem,
      download_source: metadata.source,
      status: 'pending'
    };

    try {
      // Extract text
      const pdfText = await this.extractPdfText(pdfPath);

      if (!pdfText) {
        result.status = 'extraction_failed';
        result.validation = {
          overall_confidence: 0,
          recommendation: 'REJECT',
          concerns: ['PDF text extraction failed']
        };
        return result;
      }

      // Validate with LLM
      const validation = await this.validatePdf(pdfText, metadata, systemInfo);

      result.status = 'validated';
      result.validation = validation;

      this.logger.info(`✅ ${validation.recommendation} (${validation.overall_confidence}%)`);
      this.logger.info(`   Type: ${validation.manual_type} | Marine: ${validation.marine_context}`);

      if (validation.concerns && validation.concerns.length > 0) {
        this.logger.warn(`   Concerns: ${validation.concerns.join(', ')}`);
      }

    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      result.validation = {
        overall_confidence: 0,
        recommendation: 'REJECT',
        concerns: [error.message]
      };
      this.logger.error(`Error: ${error.message}`);
    }

    return result;
  }

  /**
   * Process PDFs in batches
   */
  async processBatch(pdfs, mapping, systems) {
    const results = [];

    for (let i = 0; i < pdfs.length; i += config.batchSize) {
      const batch = pdfs.slice(i, i + config.batchSize);

      this.logger.info(`\n=== Batch ${Math.floor(i / config.batchSize) + 1} (${i + 1}-${Math.min(i + batch.length, pdfs.length)} of ${pdfs.length}) ===`);

      const batchResults = await Promise.all(
        batch.map(filename => {
          const metadata = mapping[filename];

          if (!metadata) {
            this.logger.warn(`No metadata found for ${filename}, skipping`);
            return {
              filename,
              status: 'no_metadata',
              validation: {
                overall_confidence: 0,
                recommendation: 'REJECT',
                concerns: ['No metadata found in manual hunter results']
              }
            };
          }

          const systemInfo = systems[metadata.asset_uid];
          return this.processPdf(filename, metadata, systemInfo);
        })
      );

      results.push(...batchResults);
      this.processed += batchResults.length;

      // Small delay between batches
      if (i + config.batchSize < pdfs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Generate reports
   */
  generateReports(results) {
    // Sort by confidence score
    const sorted = results
      .filter(r => r.validation)
      .sort((a, b) => b.validation.overall_confidence - a.validation.overall_confidence);

    // Generate CSV
    const csvHeader = 'rank,filename,confidence,recommendation,manual_type,marine_specific,manufacturer_match,model_match,concerns\n';
    const csvRows = sorted.map((r, idx) => {
      const v = r.validation;
      const concerns = (v.concerns || []).join('; ').replace(/,/g, '|');
      return `${idx + 1},${r.filename},${v.overall_confidence},${v.recommendation},${v.manual_type},${v.marine_context},${v.manufacturer_match},${v.model_match},"${concerns}"`;
    }).join('\n');

    const csv = csvHeader + csvRows;

    // Generate Markdown report
    const stats = {
      total: results.length,
      approved: sorted.filter(r => r.validation.recommendation === 'APPROVED').length,
      review: sorted.filter(r => r.validation.recommendation === 'REVIEW').length,
      rejected: sorted.filter(r => r.validation.recommendation === 'REJECT').length,
      userManuals: sorted.filter(r => r.validation.manual_type === 'user_manual').length,
      installGuides: sorted.filter(r => r.validation.manual_type === 'installation_guide').length,
      marineSpecific: sorted.filter(r => r.validation.marine_context === true).length
    };

    let md = `# Manual Validation Report\n\n`;
    md += `**Generated:** ${new Date().toISOString()}\n`;
    md += `**Duration:** ${Math.floor((Date.now() - this.startTime) / 1000)}s\n\n`;

    md += `## Summary\n\n`;
    md += `- **Total Manuals:** ${stats.total}\n`;
    md += `- **Approved:** ${stats.approved} (${(stats.approved/stats.total*100).toFixed(1)}%)\n`;
    md += `- **Review Needed:** ${stats.review} (${(stats.review/stats.total*100).toFixed(1)}%)\n`;
    md += `- **Rejected:** ${stats.rejected} (${(stats.rejected/stats.total*100).toFixed(1)}%)\n\n`;

    md += `## Document Types\n\n`;
    md += `- **User Manuals:** ${stats.userManuals}\n`;
    md += `- **Installation Guides:** ${stats.installGuides}\n`;
    md += `- **Marine-Specific:** ${stats.marineSpecific}\n\n`;

    md += `## Top 10 Approved Manuals\n\n`;
    sorted.filter(r => r.validation.recommendation === 'APPROVED').slice(0, 10).forEach((r, idx) => {
      md += `${idx + 1}. **${r.filename}** (${r.validation.overall_confidence}%)\n`;
      md += `   - Manufacturer: ${r.manufacturer} ${r.model}\n`;
      md += `   - Type: ${r.validation.manual_type}\n`;
      md += `   - Marine: ${r.validation.marine_context ? 'Yes' : 'No'}\n\n`;
    });

    md += `## Needs Review\n\n`;
    const reviewItems = sorted.filter(r => r.validation.recommendation === 'REVIEW');
    if (reviewItems.length > 0) {
      reviewItems.forEach(r => {
        md += `- **${r.filename}** (${r.validation.overall_confidence}%)\n`;
        md += `  - Concerns: ${(r.validation.concerns || []).join(', ')}\n`;
      });
    } else {
      md += `No manuals need review.\n`;
    }

    return { csv, md, json: sorted };
  }

  /**
   * Save results
   */
  saveResults(csv, md, json) {
    const outputDir = config.paths.output;

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(config.paths.reportCsv, csv);
    this.logger.info(`✅ Saved CSV: ${config.paths.reportCsv}`);

    writeFileSync(config.paths.reportMd, md);
    this.logger.info(`✅ Saved report: ${config.paths.reportMd}`);

    writeFileSync(config.paths.reportJson, JSON.stringify(json, null, 2));
    this.logger.info(`✅ Saved JSON: ${config.paths.reportJson}`);
  }

  /**
   * Main entry point
   */
  async run() {
    try {
      this.logger.info('\n🔍 Manual Validator Agent Started\n');

      // Load data
      this.logger.info('Loading systems metadata...');
      const systems = this.loadSystemsMetadata();
      this.logger.info(`Loaded ${Object.keys(systems).length} systems`);

      this.logger.info('Loading manual hunter results...');
      const mapping = this.loadManualHunterResults();
      this.logger.info(`Found ${Object.keys(mapping).length} PDFs to validate`);

      // Get list of PDFs
      const pdfs = readdirSync(config.paths.pdfs).filter(f => f.endsWith('.pdf'));
      this.logger.info(`Found ${pdfs.length} PDF files\n`);

      // Process PDFs
      const results = await this.processBatch(pdfs, mapping, systems);

      // Generate reports
      const { csv, md, json } = this.generateReports(results);

      // Save results
      this.saveResults(csv, md, json);

      // Print summary
      const approved = results.filter(r => r.validation?.recommendation === 'APPROVED').length;
      const review = results.filter(r => r.validation?.recommendation === 'REVIEW').length;
      const rejected = results.filter(r => r.validation?.recommendation === 'REJECT').length;

      this.logger.info('\n=== SUMMARY ===');
      this.logger.info(`Total PDFs: ${results.length}`);
      this.logger.info(`Approved: ${approved}`);
      this.logger.info(`Review: ${review}`);
      this.logger.info(`Rejected: ${rejected}`);
      this.logger.info(`Duration: ${Math.floor((Date.now() - this.startTime) / 1000)}s\n`);

      this.logger.info('✅ Manual Validator Agent Completed\n');

      process.exit(0);

    } catch (error) {
      this.logger.error(`Fatal error: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Run agent if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new ManualValidator();
  agent.run();
}

export default ManualValidator;

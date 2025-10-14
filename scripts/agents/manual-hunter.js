import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { setTimeout } from 'timers/promises';
import { config } from './manual-hunter-config.js';
import { executeStrategies } from './manual-hunter-strategies.js';
import { extractPdfTextWithPython } from './manual-hunter-python-parser.js';

/**
 * Manual Hunter Agent
 * Finds and downloads PDF manuals for marine equipment systems
 *
 * Usage: node scripts/agents/manual-hunter.js
 */

class ManualHunter {
  constructor() {
    this.results = [];
    this.pdfsDownloaded = 0;
    this.serpApiCalls = 0;
    this.logger = this.createLogger();
    this.startTime = Date.now();
    this.blacklist = this.loadBlacklist();
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
   * Load blacklist from disk
   */
  loadBlacklist() {
    try {
      if (!config.blacklist.enabled) {
        return {};
      }

      const blacklistPath = config.paths.blacklist;
      if (!existsSync(blacklistPath)) {
        this.logger?.debug('No blacklist file found, starting fresh');
        return {};
      }

      const data = readFileSync(blacklistPath, 'utf-8');
      const blacklist = JSON.parse(data);

      const count = Object.keys(blacklist).length;
      if (count > 0) {
        this.logger?.info(`Loaded blacklist with ${count} systems`);
      }

      return blacklist;
    } catch (error) {
      this.logger?.error(`Failed to load blacklist: ${error.message}`);
      return {};
    }
  }

  /**
   * Save blacklist to disk
   */
  saveBlacklist() {
    try {
      if (!config.blacklist.enabled) {
        return;
      }

      const blacklistPath = config.paths.blacklist;
      writeFileSync(blacklistPath, JSON.stringify(this.blacklist, null, 2));
      this.logger.debug(`Saved blacklist (${Object.keys(this.blacklist).length} systems)`);
    } catch (error) {
      this.logger.error(`Failed to save blacklist: ${error.message}`);
    }
  }

  /**
   * Check if a system is blacklisted
   */
  isBlacklisted(system) {
    if (!config.blacklist.enabled) {
      return false;
    }

    const entry = this.blacklist[system.asset_uid];
    if (!entry) {
      return false;
    }

    return entry.attempts >= config.blacklist.maxAttempts;
  }

  /**
   * Check if a specific URL has been rejected for this system
   */
  isUrlRejected(system, url) {
    if (!config.blacklist.enabled || !url) {
      return false;
    }

    const entry = this.blacklist[system.asset_uid];
    if (!entry || !entry.rejected_urls) {
      return false;
    }

    return entry.rejected_urls.includes(url);
  }

  /**
   * Track a failed attempt for a system
   */
  trackFailedAttempt(system, url, reason) {
    if (!config.blacklist.enabled) {
      return;
    }

    const uid = system.asset_uid;

    // Initialize entry if doesn't exist
    if (!this.blacklist[uid]) {
      this.blacklist[uid] = {
        asset_uid: uid,
        manufacturer: system.manufacturer_norm,
        model: system.model_norm,
        rejected_urls: [],
        attempts: 0,
        last_attempt: null,
        last_rejection_reason: null
      };
    }

    const entry = this.blacklist[uid];

    // Track this attempt
    entry.attempts++;
    entry.last_attempt = new Date().toISOString();
    entry.last_rejection_reason = reason;

    // Track rejected URL (avoid duplicates)
    if (url && !entry.rejected_urls.includes(url)) {
      entry.rejected_urls.push(url);
    }

    // Log status
    if (entry.attempts >= config.blacklist.maxAttempts) {
      this.logger.warn(`⛔ Blacklisted: ${system.manufacturer_norm} ${system.model_norm} (${entry.attempts} attempts)`);
    } else {
      this.logger.debug(`Tracked failed attempt ${entry.attempts}/${config.blacklist.maxAttempts} for ${system.manufacturer_norm} ${system.model_norm}`);
    }

    // Save after each update
    this.saveBlacklist();
  }

  /**
   * Extract text from PDF using Python sidecar parser
   */
  async extractPdfText(pdfPath) {
    try {
      if (!config.validation.enabled) {
        return null;
      }

      // Use Python sidecar instead of broken LlamaParser
      return await extractPdfTextWithPython(pdfPath, this.logger);

    } catch (error) {
      this.logger.error(`PDF extraction failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate PDF content using GPT-4o-mini
   */
  async validatePdfContent(pdfText, metadata, system) {
    try {
      if (!config.validation.enabled) {
        return { valid: true, confidence: 100, reason: 'Validation disabled' };
      }

      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        this.logger.error('OPENAI_API_KEY not found, skipping validation');
        return { valid: true, confidence: 100, reason: 'No API key' };
      }

      if (!pdfText || pdfText.length < 100) {
        // Don't reject on extraction failure - keep PDF for manual review
        this.logger.warn('PDF text extraction failed - marking for manual review');
        return {
          valid: true,  // KEEP the PDF
          confidence: 50, // Neutral confidence
          reason: 'PDF text extraction failed - needs manual review',
          concerns: ['Could not extract text from PDF for automated validation'],
          manual_type: 'unknown',
          marine_context: null,
          manufacturer_match: null,
          model_match: null,
          recommendation: 'REVIEW' // Mark for manual review
        };
      }

      const prompt = `
Expected Marine Equipment:
- Manufacturer: ${metadata.manufacturer}
- Model: ${metadata.model}
- System Type: ${system.system_norm} / ${system.subsystem_norm}

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
          model: config.validation.llm.model,
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
          temperature: config.validation.llm.temperature,
          max_tokens: config.validation.llm.maxTokens,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const validation = JSON.parse(content);

      // Convert to our format
      return {
        valid: validation.overall_confidence >= config.validation.rejectThreshold,
        confidence: validation.overall_confidence,
        reason: validation.reasoning,
        concerns: validation.concerns || [],
        manual_type: validation.manual_type,
        marine_context: validation.marine_context,
        manufacturer_match: validation.manufacturer_match,
        model_match: validation.model_match,
        recommendation: validation.recommendation
      };

    } catch (error) {
      this.logger.error(`Validation failed: ${error.message}`);
      return {
        valid: true, // Don't reject on validation error
        confidence: 50,
        reason: `Validation error: ${error.message}`,
        concerns: ['LLM validation failed']
      };
    }
  }

  /**
   * Parse CSV file into array of system objects
   */
  parseCsv(csvPath) {
    const csv = readFileSync(csvPath, 'utf-8');
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');

    return lines.slice(1).map(line => {
      // Handle quoted fields
      const values = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const obj = {};
      headers.forEach((header, i) => {
        obj[header.trim()] = values[i]?.replace(/^"|"$/g, ''); // Remove quotes
      });

      return obj;
    });
  }

  /**
   * Validate PDF URL and size
   */
  async validatePdf(url) {
    try {
      // Basic URL validation
      if (!url || !url.startsWith('http')) {
        return { valid: false, reason: 'Invalid URL' };
      }

      // Try HEAD request to check Content-Type and size
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)'
          },
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
          return { valid: false, reason: `HTTP ${response.status}` };
        }

        // Check Content-Type
        const contentType = response.headers.get('content-type');
        if (contentType && !config.pdf.contentTypes.some(type => contentType.includes(type))) {
          // Not a PDF, but might still be valid if URL ends with .pdf
          if (!url.toLowerCase().endsWith('.pdf')) {
            return { valid: false, reason: `Wrong content type: ${contentType}` };
          }
        }

        // Check file size
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const size = parseInt(contentLength, 10);

          if (size < config.pdf.minSize) {
            return { valid: false, reason: `File too small: ${size} bytes` };
          }

          if (size > config.pdf.maxSize) {
            return { valid: false, reason: `File too large: ${size} bytes` };
          }

          this.logger.debug(`PDF size: ${(size / 1024 / 1024).toFixed(2)} MB`);
        }

        return { valid: true, size: contentLength ? parseInt(contentLength, 10) : null };

      } catch (fetchError) {
        // HEAD request failed, try basic URL validation
        this.logger.debug(`HEAD request failed: ${fetchError.message}`);

        // Fallback to URL pattern check
        if (url.toLowerCase().endsWith('.pdf') || url.includes('/pdf/')) {
          return { valid: true, size: null, note: 'Could not verify, assuming valid' };
        }

        return { valid: false, reason: `Fetch failed: ${fetchError.message}` };
      }

    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Download PDF to local directory
   */
  async downloadPdf(url, filename) {
    try {
      this.logger.info(`Downloading: ${filename}`);

      // Ensure PDFs directory exists
      const pdfsDir = config.paths.pdfs;
      if (!existsSync(pdfsDir)) {
        mkdirSync(pdfsDir, { recursive: true });
      }

      const filepath = `${pdfsDir}/${filename}`;

      // Download PDF
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)'
        },
        signal: AbortSignal.timeout(60000) // 60 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Get file as buffer
      const buffer = await response.arrayBuffer();
      const size = buffer.byteLength;

      // Validate size
      if (size < config.pdf.minSize) {
        throw new Error(`Downloaded file too small: ${size} bytes`);
      }

      if (size > config.pdf.maxSize) {
        throw new Error(`Downloaded file too large: ${size} bytes`);
      }

      // Write to disk
      writeFileSync(filepath, Buffer.from(buffer));

      this.pdfsDownloaded++;
      this.logger.info(`✅ Downloaded ${this.pdfsDownloaded}/${config.maxPdfs}: ${filename} (${(size / 1024 / 1024).toFixed(2)} MB)`);

      return {
        success: true,
        path: filepath,
        size: size
      };

    } catch (error) {
      this.logger.error(`❌ Download failed for ${filename}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process a single system
   */
  async processSystem(system) {
    this.logger.info(`\n--- Processing: ${system.manufacturer_norm} ${system.model_norm} ---`);

    const result = {
      asset_uid: system.asset_uid,
      manufacturer: system.manufacturer_norm,
      model: system.model_norm,
      system: system.system_norm,
      subsystem: system.subsystem_norm,
      status: 'not_found',
      manual_url: null,
      source: null,
      confidence: null,
      verified: false,
      downloaded: false,
      error: null,
      strategies_tried: []
    };

    // Check blacklist first
    if (this.isBlacklisted(system)) {
      const entry = this.blacklist[system.asset_uid];
      result.status = 'max_attempts_exceeded';
      result.error = `Blacklisted after ${entry.attempts} failed attempts`;
      this.logger.warn(`⛔ SKIPPED (blacklisted): ${system.manufacturer_norm} ${system.model_norm}`);
      return result;
    }

    try {
      // Execute search strategies (pass agent instance for tracking)
      const searchResult = await executeStrategies(
        system,
        config.strategies,
        this.logger,
        this
      );

      result.strategies_tried = config.strategies
        .filter(s => s.enabled)
        .map(s => s.name);

      if (!searchResult) {
        this.logger.warn(`❌ No manual found for ${system.manufacturer_norm} ${system.model_norm}`);
        this.trackFailedAttempt(system, null, 'No manual found');
        return result;
      }

      result.manual_url = searchResult.url;
      result.source = searchResult.source;
      result.confidence = searchResult.confidence || 'medium';

      // Validate PDF
      const validation = await this.validatePdf(searchResult.url);
      if (!validation.valid) {
        result.status = 'invalid';
        result.error = validation.reason;
        this.logger.warn(`⚠️  Invalid PDF: ${validation.reason}`);
        this.trackFailedAttempt(system, searchResult.url, `Validation failed: ${validation.reason}`);
        return result;
      }

      result.verified = true;
      result.status = 'found';

      // Download if under limit
      if (this.pdfsDownloaded < config.maxPdfs) {
        const filename = `${system.manufacturer_norm}_${system.model_norm}.pdf`
          .replace(/[^a-zA-Z0-9_.-]/g, '_');

        const download = await this.downloadPdf(searchResult.url, filename);

        if (download.success) {
          result.downloaded = true;
          result.local_path = download.path;
          result.file_size = download.size;

          // ⭐ NEW: Inline validation after download
          if (config.validation.enabled) {
            this.logger.info(`🔍 Validating PDF content...`);

            // Extract text from PDF
            const pdfText = await this.extractPdfText(download.path);

            // Validate with LLM
            const contentValidation = await this.validatePdfContent(
              pdfText,
              {
                manufacturer: system.manufacturer_norm,
                model: system.model_norm
              },
              system
            );

            // Store validation results
            result.validation = {
              confidence: contentValidation.confidence,
              recommendation: contentValidation.recommendation,
              manual_type: contentValidation.manual_type,
              marine_context: contentValidation.marine_context,
              manufacturer_match: contentValidation.manufacturer_match,
              model_match: contentValidation.model_match,
              reasoning: contentValidation.reason,
              concerns: contentValidation.concerns
            };

            // Handle validation result
            if (!contentValidation.valid) {
              // REJECT: Delete PDF and blacklist URL
              result.status = 'validation_failed';
              result.downloaded = false;
              result.error = `Validation REJECT (${contentValidation.confidence}%): ${contentValidation.reason}`;

              this.logger.warn(`❌ REJECTED (${contentValidation.confidence}%): ${contentValidation.recommendation}`);
              if (contentValidation.concerns && contentValidation.concerns.length > 0) {
                this.logger.warn(`   Concerns: ${contentValidation.concerns.join(', ')}`);
              }

              // Delete the PDF
              if (config.validation.deleteOnReject) {
                try {
                  unlinkSync(download.path);
                  this.logger.info(`🗑️  Deleted rejected PDF`);
                  this.pdfsDownloaded--; // Don't count rejected PDFs
                } catch (deleteError) {
                  this.logger.error(`Failed to delete PDF: ${deleteError.message}`);
                }
              }

              // Add URL to blacklist
              this.trackFailedAttempt(system, searchResult.url, `Validation failed: ${contentValidation.reason}`);

            } else {
              // APPROVED or REVIEW: Keep PDF
              result.status = 'validated';
              this.logger.info(`✅ ${contentValidation.recommendation} (${contentValidation.confidence}%): ${contentValidation.manual_type}`);
            }
          }

        } else {
          result.error = download.error;
          this.trackFailedAttempt(system, searchResult.url, `Download failed: ${download.error}`);
        }
      } else {
        this.logger.warn(`⚠️  Skipping download (reached limit of ${config.maxPdfs})`);
        result.status = 'found_not_downloaded';
      }

    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      this.logger.error(`Error processing system: ${error.message}`);
      this.trackFailedAttempt(system, result.manual_url, `Error: ${error.message}`);
    }

    return result;
  }

  /**
   * Process systems in batches
   */
  async processBatch(systems) {
    const results = [];

    for (let i = 0; i < systems.length; i += config.batchSize) {
      if (this.pdfsDownloaded >= config.maxPdfs) {
        this.logger.info(`\n🛑 Reached PDF limit (${config.maxPdfs}). Stopping.`);
        break;
      }

      if (this.serpApiCalls >= config.maxSerpApiCalls) {
        this.logger.info(`\n🛑 Reached SerpAPI limit (${config.maxSerpApiCalls} calls). Stopping.`);
        break;
      }

      const batch = systems.slice(i, i + config.batchSize);
      this.logger.info(`\n=== Batch ${Math.floor(i / config.batchSize) + 1} (${i + 1}-${Math.min(i + batch.length, systems.length)} of ${systems.length}) ===`);

      const batchResults = await Promise.all(
        batch.map(system => this.processSystem(system))
      );

      results.push(...batchResults);

      // Delay between batches
      if (i + config.batchSize < systems.length && this.pdfsDownloaded < config.maxPdfs) {
        this.logger.debug(`Waiting ${config.requestDelay}ms before next batch...`);
        await setTimeout(config.requestDelay);
      }
    }

    return results;
  }

  /**
   * Generate summary statistics
   */
  generateSummary(results) {
    const statusCounts = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    const duration = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      total_systems: results.length,
      pdfs_downloaded: this.pdfsDownloaded,
      serpapi_calls: this.serpApiCalls,
      duration_seconds: duration,
      status_breakdown: statusCounts,
      success_rate: ((statusCounts.found || 0) / results.length * 100).toFixed(1) + '%'
    };
  }

  /**
   * Generate markdown report
   */
  generateReport(results, summary) {
    const timestamp = new Date().toISOString();

    let md = `# Manual Hunter Report\n\n`;
    md += `**Generated:** ${timestamp}\n`;
    md += `**Duration:** ${summary.duration_seconds}s\n\n`;

    md += `## Summary\n\n`;
    md += `- **Total Systems:** ${summary.total_systems}\n`;
    md += `- **PDFs Downloaded:** ${summary.pdfs_downloaded}/${config.maxPdfs}\n`;
    md += `- **Success Rate:** ${summary.success_rate}\n\n`;

    md += `## Status Breakdown\n\n`;
    Object.entries(summary.status_breakdown).forEach(([status, count]) => {
      md += `- **${status}:** ${count}\n`;
    });

    md += `\n## Found Manuals\n\n`;
    const found = results.filter(r => r.status === 'found' || r.status === 'found_not_downloaded');
    if (found.length > 0) {
      found.forEach(r => {
        md += `### ${r.manufacturer} ${r.model}\n`;
        md += `- **URL:** ${r.manual_url}\n`;
        md += `- **Source:** ${r.source}\n`;
        md += `- **Downloaded:** ${r.downloaded ? 'Yes' : 'No'}\n`;
        md += `- **System:** ${r.system} / ${r.subsystem}\n\n`;
      });
    } else {
      md += `No manuals found.\n\n`;
    }

    md += `## Not Found\n\n`;
    const notFound = results.filter(r => r.status === 'not_found');
    if (notFound.length > 0) {
      notFound.forEach(r => {
        md += `- ${r.manufacturer} ${r.model} (${r.system} / ${r.subsystem})\n`;
      });
    } else {
      md += `All systems found!\n`;
    }

    return md;
  }

  /**
   * Save results to disk
   */
  saveResults(results, summary) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const outputDir = config.paths.output;

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    if (!existsSync(config.paths.pdfs)) {
      mkdirSync(config.paths.pdfs, { recursive: true });
    }

    // Save JSON
    const jsonPath = `${outputDir}/run-${timestamp}.json`;
    writeFileSync(jsonPath, JSON.stringify({
      timestamp,
      summary,
      results
    }, null, 2));

    this.logger.info(`✅ Saved JSON: ${jsonPath}`);

    // Save markdown report
    const report = this.generateReport(results, summary);
    const mdPath = `${outputDir}/run-${timestamp}-report.md`;
    writeFileSync(mdPath, report);

    this.logger.info(`✅ Saved report: ${mdPath}`);

    return { jsonPath, mdPath };
  }

  /**
   * Main entry point
   */
  async run() {
    try {
      this.logger.info('\n🚀 Manual Hunter Agent Started\n');
      this.logger.info(`Config: Max PDFs = ${config.maxPdfs}, Batch Size = ${config.batchSize}`);

      // Parse input CSV
      const systems = this.parseCsv(config.paths.input);
      this.logger.info(`Loaded ${systems.length} systems from CSV\n`);

      // Process systems
      const results = await this.processBatch(systems);

      // Generate summary
      const summary = this.generateSummary(results);

      // Save results
      const paths = this.saveResults(results, summary);

      // Print summary
      this.logger.info('\n=== SUMMARY ===');
      this.logger.info(`Total Systems: ${summary.total_systems}`);
      this.logger.info(`PDFs Downloaded: ${summary.pdfs_downloaded}/${config.maxPdfs}`);
      this.logger.info(`SerpAPI Calls: ${this.serpApiCalls}/${config.maxSerpApiCalls}`);
      this.logger.info(`Success Rate: ${summary.success_rate}`);
      this.logger.info(`Duration: ${summary.duration_seconds}s`);

      if (config.blacklist.enabled) {
        const blacklistCount = Object.keys(this.blacklist).length;
        const blacklistedResults = results.filter(r => r.status === 'max_attempts_exceeded').length;
        if (blacklistCount > 0) {
          this.logger.info(`\n⛔ Blacklist: ${blacklistCount} systems (${blacklistedResults} skipped this run)`);
        }
      }

      this.logger.info(`\nResults saved to:`);
      this.logger.info(`  - ${paths.jsonPath}`);
      this.logger.info(`  - ${paths.mdPath}`);
      if (config.blacklist.enabled) {
        this.logger.info(`  - ${config.paths.blacklist}`);
      }

      this.logger.info('\n✅ Manual Hunter Agent Completed\n');

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
  const agent = new ManualHunter();
  agent.run();
}

export default ManualHunter;

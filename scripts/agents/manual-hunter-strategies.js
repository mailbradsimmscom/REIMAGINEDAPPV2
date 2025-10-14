import { setTimeout } from 'timers/promises';

/**
 * Search Strategies for Manual Hunter Agent
 * Each strategy attempts to find a PDF manual URL for a system
 */

/**
 * Extract PDF URLs from search results
 */
function extractPdfUrls(text) {
  const urlPattern = /https?:\/\/[^\s<>"]+\.pdf/gi;
  const matches = text.match(urlPattern) || [];
  return [...new Set(matches)]; // Remove duplicates
}

/**
 * Extract simplified model name for better search results
 * E.g., "triducer_multisensor_airmar_dst810" -> "dst810"
 */
function simplifyModel(modelNorm) {
  // Extract alphanumeric sequences that look like model numbers
  const modelPattern = /([A-Z]{2,}[-\s]?\d+[A-Z]*|\d+[A-Z]{2,})/i;
  const match = modelNorm.match(modelPattern);

  if (match) {
    return match[0].replace(/[-_\s]/g, '');
  }

  // Fallback: Remove underscores, take last significant word
  const words = modelNorm.split('_').filter(w => w.length > 2);
  return words[words.length - 1] || modelNorm;
}

/**
 * Strategy 1: Web Search (SerpAPI)
 * Uses SerpAPI to search Google for PDF manuals
 */
export async function webSearchStrategy(system, logger, agent) {
  try {
    // Try simplified model name first
    const simpleModel = simplifyModel(system.model_norm);

    // Prioritize user manual over installation manual
    const query = `"${system.manufacturer_norm}" "${simpleModel}" "user manual" filetype:pdf`;
    logger.info(`WebSearch (SerpAPI): ${query}`);

    const serpApiKey = process.env.SERPAPI_KEY;

    if (!serpApiKey) {
      logger.debug('SERPAPI_KEY not found in environment');
      return null;
    }

    // Check if we've hit the SerpAPI call limit
    const { config } = await import('./manual-hunter-config.js');
    if (agent && agent.serpApiCalls >= config.maxSerpApiCalls) {
      logger.warn(`⚠️  Reached SerpAPI limit (${config.maxSerpApiCalls} calls)`);
      return null;
    }

    // Increment call counter
    if (agent) {
      agent.serpApiCalls++;
      logger.debug(`SerpAPI calls: ${agent.serpApiCalls}/${config.maxSerpApiCalls}`);
    }

    // Call SerpAPI
    const searchUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)'
      }
    });

    if (!response.ok) {
      logger.error(`SerpAPI returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Check for errors
    if (data.error) {
      logger.error(`SerpAPI error: ${data.error}`);
      return null;
    }

    // Extract organic results
    const organicResults = data.organic_results || [];

    if (organicResults.length === 0) {
      logger.debug('No search results found');
      return null;
    }

    // Look for PDF URLs in results, prioritizing user manuals
    const userManualResults = [];
    const otherResults = [];

    for (const result of organicResults) {
      if (result.link && result.link.toLowerCase().endsWith('.pdf')) {
        const title = (result.title || '').toLowerCase();
        const link = result.link.toLowerCase();

        // Prioritize user manuals, de-prioritize installation guides
        if (title.includes('user') || link.includes('user')) {
          userManualResults.push({ ...result, priority: 'high' });
        } else if (title.includes('install') || link.includes('install')) {
          otherResults.push({ ...result, priority: 'low' });
        } else {
          otherResults.push({ ...result, priority: 'medium' });
        }
      }
    }

    // Check user manuals first
    for (const result of userManualResults) {
      // Skip if URL is blacklisted
      if (agent && agent.isUrlRejected && agent.isUrlRejected(system, result.link)) {
        logger.debug(`⚠️  Skipping rejected URL: ${result.link}`);
        continue;
      }

      logger.info(`Found USER MANUAL in organic results: ${result.link}`);
      return {
        url: result.link,
        confidence: 'high',
        title: result.title,
        type: 'user_manual'
      };
    }

    // Then check other results
    for (const result of otherResults) {
      if (result.priority === 'medium') {
        // Skip if URL is blacklisted
        if (agent && agent.isUrlRejected && agent.isUrlRejected(system, result.link)) {
          logger.debug(`⚠️  Skipping rejected URL: ${result.link}`);
          continue;
        }

        logger.info(`Found PDF in organic results: ${result.link}`);
        return {
          url: result.link,
          confidence: 'high',
          title: result.title
        };
      }

    }

    // Last resort: check installation manuals
    for (const result of otherResults) {
      if (result.priority === 'low') {
        // Skip if URL is blacklisted
        if (agent && agent.isUrlRejected && agent.isUrlRejected(system, result.link)) {
          logger.debug(`⚠️  Skipping rejected URL: ${result.link}`);
          continue;
        }

        logger.info(`Found installation guide (fallback): ${result.link}`);
        return {
          url: result.link,
          confidence: 'medium',
          title: result.title,
          type: 'installation_guide'
        };
      }
    }

    // Check if there are any PDF links in the full response
    const responseText = JSON.stringify(data);
    const allPdfUrls = extractPdfUrls(responseText);

    if (allPdfUrls.length > 0) {
      logger.info(`Found PDF in response: ${allPdfUrls[0]}`);
      return {
        url: allPdfUrls[0],
        confidence: 'medium'
      };
    }

    logger.debug('No PDF URLs found in search results');
    return null;

  } catch (error) {
    logger.error(`WebSearch failed: ${error.message}`);
    return null;
  }
}

/**
 * Strategy 2: ManualsLib.com
 * Searches manualslib.com for the manual
 */
export async function manualslibStrategy(system, logger) {
  try {
    // Try multiple manualslib URL patterns
    const manufacturer = system.manufacturer_norm.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const model = system.model_norm.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const searchUrl = `https://www.manualslib.com/products/${manufacturer}-${model}.html`;
    logger.info(`ManualsLib: ${searchUrl}`);

    // Try to fetch the page
    try {
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)'
        }
      });

      if (!response.ok) {
        logger.debug(`ManualsLib returned ${response.status}`);
        return null;
      }

      const html = await response.text();

      // Look for PDF download links in the HTML
      const pdfUrls = extractPdfUrls(html);

      if (pdfUrls.length > 0) {
        logger.info(`Found PDF on ManualsLib: ${pdfUrls[0]}`);
        return {
          url: pdfUrls[0],
          confidence: 'high'
        };
      }

      // Alternative: Look for manual view page
      const manualLinkPattern = /href="(\/manual\/[^"]+)"/;
      const match = html.match(manualLinkPattern);

      if (match) {
        const manualPageUrl = `https://www.manualslib.com${match[1]}`;
        logger.debug(`Found manual page: ${manualPageUrl}`);

        // Note: Would need to fetch this page and extract PDF
        // For now, return the manual page URL
        return {
          url: manualPageUrl,
          confidence: 'medium',
          note: 'Manual page found, PDF extraction may be needed'
        };
      }

    } catch (fetchError) {
      logger.debug(`Fetch failed: ${fetchError.message}`);
    }

    return null;

  } catch (error) {
    logger.error(`ManualsLib failed: ${error.message}`);
    return null;
  }
}

/**
 * Strategy 3: Archive.org
 * Searches Wayback Machine for archived manuals
 */
export async function archiveStrategy(system, logger) {
  try {
    const manufacturer = system.manufacturer_norm.toLowerCase();
    const model = system.model_norm.toLowerCase();

    // Try archive.org search
    const searchQuery = `"${manufacturer}" "${model}" manual`;
    const archiveSearchUrl = `https://archive.org/search.php?query=${encodeURIComponent(searchQuery)}&and[]=mediatype:texts`;

    logger.info(`Archive.org search: ${searchQuery}`);

    try {
      const response = await fetch(archiveSearchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)'
        }
      });

      if (!response.ok) {
        logger.debug(`Archive.org returned ${response.status}`);
        return null;
      }

      const html = await response.text();

      // Look for PDF links in search results
      const pdfUrls = extractPdfUrls(html);

      if (pdfUrls.length > 0) {
        logger.info(`Found PDF on Archive.org: ${pdfUrls[0]}`);
        return {
          url: pdfUrls[0],
          confidence: 'medium'
        };
      }

    } catch (fetchError) {
      logger.debug(`Archive.org fetch failed: ${fetchError.message}`);
    }

    return null;

  } catch (error) {
    logger.error(`Archive.org failed: ${error.message}`);
    return null;
  }
}

/**
 * Strategy 4: Manufacturer Website
 * Attempts to find manual on manufacturer's official site
 */
export async function manufacturerStrategy(system, logger) {
  try {
    // Common manufacturer site patterns
    const manufacturer = system.manufacturer_norm.toLowerCase().replace(/[^a-z0-9]/g, '');
    const possibleUrls = [
      `https://www.${manufacturer}.com/support/manuals`,
      `https://www.${manufacturer}.com/downloads`,
      `https://${manufacturer}.com/manuals`
    ];

    logger.info(`Manufacturer: Trying ${possibleUrls.length} URL patterns`);

    await setTimeout(1000);

    // TODO: Implement WebFetch to check manufacturer sites

    return null;

  } catch (error) {
    logger.error(`Manufacturer strategy failed: ${error.message}`);
    return null;
  }
}

/**
 * Execute all enabled strategies for a system
 * Returns first successful result
 */
export async function executeStrategies(system, strategies, logger, agent) {
  const strategyMap = {
    'websearch': webSearchStrategy,
    'manualslib': manualslibStrategy,
    'archive': archiveStrategy,
    'manufacturer': manufacturerStrategy
  };

  for (const strategy of strategies) {
    if (!strategy.enabled) continue;

    const strategyFn = strategyMap[strategy.name];
    if (!strategyFn) {
      logger.warn(`Unknown strategy: ${strategy.name}`);
      continue;
    }

    // Pass agent instance for call tracking
    const result = await strategyFn(system, logger, agent);

    if (result && result.url) {
      logger.info(`✅ Found via ${strategy.name}: ${result.url}`);
      return {
        ...result,
        source: strategy.name
      };
    }
  }

  return null;
}

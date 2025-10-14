export const config = {
  // Maximum PDFs to download before stopping
  maxPdfs: 40,

  // Maximum SerpAPI calls before stopping (to control costs)
  maxSerpApiCalls: 150,

  // Process systems in parallel (batches)
  batchSize: 5,

  // Delay between requests (ms) to avoid rate limiting
  requestDelay: 3000, // 3 seconds for SerpAPI rate limits

  // Timeout for each search attempt (ms)
  searchTimeout: 30000,

  // PDF validation
  pdf: {
    minSize: 10 * 1024, // 10 KB
    maxSize: 50 * 1024 * 1024, // 50 MB
    contentTypes: ['application/pdf', 'application/x-pdf']
  },

  // Search strategies (in priority order)
  strategies: [
    {
      name: 'websearch',
      enabled: true,
      description: 'Google search for PDF manuals'
    },
    {
      name: 'manualslib',
      enabled: true,
      description: 'ManualsLib.com search'
    },
    {
      name: 'archive',
      enabled: true,
      description: 'Archive.org / Wayback Machine'
    },
    {
      name: 'manufacturer',
      enabled: false, // Often blocked, enable if needed
      description: 'Direct manufacturer website'
    }
  ],

  // Blacklist configuration
  blacklist: {
    maxAttempts: 5, // Max attempts before blacklisting a system
    enabled: true
  },

  // Validation configuration (inline validation after download)
  validation: {
    enabled: true, // ENABLED - Using Python sidecar's working parser!
    deleteOnReject: true, // Delete bad PDFs (like welding machine manuals)
    rejectThreshold: 50, // Score < 50 = REJECT and blacklist URL
    llm: {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 1000
    },
    maxPages: 10 // Only parse first 10 pages
  },

  // Output paths
  paths: {
    input: process.env.TEST_YANMAR === 'true'
      ? 'scripts/agents/systems-needing-manuals-yanmar-test.csv'
      : process.env.BATCH === '3'
      ? 'scripts/agents/systems-needing-manuals-batch3.csv'
      : process.env.BATCH === '2'
      ? 'scripts/agents/systems-needing-manuals-batch2.csv'
      : process.env.TEST_MODE === 'true'
      ? 'scripts/agents/systems-needing-manuals-test.csv'
      : 'scripts/agents/systems-needing-manuals.csv',
    output: 'scripts/agents/manual-hunter-results',
    pdfs: 'scripts/agents/manual-hunter-results/pdfs',
    blacklist: 'scripts/agents/manual-hunter-blacklist.json',
    state: 'scripts/agents/manual-hunter-state.json'
  }
};

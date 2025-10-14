export const config = {
  // Processing
  batchSize: 10, // Process 10 PDFs at a time

  // LlamaParse settings
  llamaParse: {
    maxPages: 10, // Only parse first 10 pages
    timeout: 30000 // 30 second timeout per PDF
  },

  // GPT-4o-mini settings
  llm: {
    model: 'gpt-4o-mini',
    temperature: 0.1, // Low temperature for consistent validation
    maxTokens: 1000
  },

  // Scoring thresholds
  thresholds: {
    approved: 75,    // >= 75 = APPROVED
    review: 50,      // 50-74 = REVIEW
    // < 50 = REJECT
  },

  // Paths
  paths: {
    pdfs: process.env.TEST_MODE_VALIDATOR === 'true'
      ? 'scripts/agents/manual-hunter-results/pdfs-test'
      : 'scripts/agents/manual-hunter-results/pdfs',
    systemsCsv: process.env.BATCH === '3'
      ? 'scripts/agents/systems-needing-manuals-batch3.csv'
      : process.env.BATCH === '2'
      ? 'scripts/agents/systems-needing-manuals-batch2.csv'
      : 'scripts/agents/systems-needing-manuals.csv',
    resultsJson: 'scripts/agents/manual-hunter-results/run-*.json', // Latest run
    output: 'scripts/agents/validation-results',
    reportCsv: 'scripts/agents/validation-results/ranked-manuals.csv',
    reportJson: 'scripts/agents/validation-results/validation-results.json',
    reportMd: 'scripts/agents/validation-results/validation-report.md'
  }
};

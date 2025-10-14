# Manual Hunter Agent

AI-powered agent that searches for and downloads PDF manuals for marine equipment systems.

## Overview

The Manual Hunter Agent automates the tedious process of finding technical manuals for 100+ marine systems. It:

1. Reads a list of systems needing manuals
2. Searches multiple sources (Google, ManualsLib, Archive.org)
3. Downloads up to 40 PDFs
4. Generates a detailed report

## Quick Start

### 1. Export Systems Needing Manuals

```bash
node scripts/export-systems-needing-manuals.js
```

This creates `scripts/agents/systems-needing-manuals.csv` with all systems where `manual != true` and no documents uploaded.

**Output:** 136 systems need manuals (as of 2025-10-11)

### 2. Run Agent Locally (Test Mode)

```bash
node scripts/agents/manual-hunter.js
```

**Note:** Current strategies are placeholder implementations. Real search requires:
- WebSearch API integration
- WebFetch for scraping
- HTTP client for downloads

### 3. Run Agent on GitHub Actions (Recommended)

1. Go to GitHub Actions tab
2. Select "Manual Hunter Agent" workflow
3. Click "Run workflow"
4. Set max PDFs (default: 40)
5. Wait ~1 hour
6. Download artifacts:
   - `manual-hunter-pdfs-XXX.zip` (PDFs)
   - `manual-hunter-reports-XXX.zip` (JSON + markdown)

## Configuration

Edit `scripts/agents/manual-hunter-config.js`:

```javascript
{
  maxPdfs: 40,           // Stop after 40 downloads
  batchSize: 5,          // Process 5 systems in parallel
  requestDelay: 2000,    // 2 seconds between batches
  searchTimeout: 30000   // 30 second timeout per search
}
```

## Search Strategies

The agent tries multiple strategies in priority order:

1. **WebSearch** - Google for `"{manufacturer} {model} manual filetype:pdf"`
2. **ManualsLib** - Searches manualslib.com (marine-focused)
3. **Archive.org** - Wayback Machine for discontinued products
4. **Manufacturer** - Direct manufacturer website (often blocked)

Stops at first success per system.

## Output

### JSON Report
```json
{
  "timestamp": "2025-10-11T10:30:00Z",
  "summary": {
    "total_systems": 136,
    "pdfs_downloaded": 40,
    "success_rate": "29.4%"
  },
  "results": [
    {
      "asset_uid": "603ed86f-...",
      "manufacturer": "fortress",
      "model": "anchor",
      "status": "found",
      "manual_url": "https://...",
      "source": "manualslib",
      "downloaded": true,
      "local_path": "scripts/agents/manual-hunter-results/pdfs/fortress_anchor.pdf"
    }
  ]
}
```

### Markdown Report

Human-readable summary with:
- Success rate
- Found manuals (with URLs)
- Not found (for manual follow-up)

### Downloaded PDFs

`scripts/agents/manual-hunter-results/pdfs/`
- `manufacturer_model.pdf`
- Max 40 files
- Zipped for GitHub artifact upload

## Next Steps After Agent Run

1. **Review Results**
   - Download artifacts from GitHub
   - Check markdown report for quality

2. **Upload PDFs to System**
   ```bash
   # Option A: Bulk upload script (to be created)
   node scripts/bulk-upload-manuals.js

   # Option B: Use existing upload API
   curl -X POST http://localhost:3000/admin/api/documents/upload \
     -H "x-admin-token: $ADMIN_TOKEN" \
     -F "file=@fortress_anchor.pdf" \
     -F "manufacturer=fortress" \
     -F "model=anchor"
   ```

3. **Update Systems Table**
   - Mark systems with `manual = true` after upload
   - Or agent can do this automatically (needs DB credentials)

4. **Re-run for Not Found**
   - Edit CSV to remove found systems
   - Try different search strategies
   - Manual procurement for remaining

## Architecture

```
┌─────────────────────────────────────────┐
│  1. export-systems-needing-manuals.js  │
│     Query DB → Export CSV               │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  2. manual-hunter.js (Main Agent)      │
│     Read CSV → Search → Download        │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  3. manual-hunter-strategies.js        │
│     WebSearch, ManualsLib, Archive.org  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  4. Output                              │
│     - PDFs (zipped)                     │
│     - JSON report                       │
│     - Markdown report                   │
└─────────────────────────────────────────┘
```

## Limitations (Current Version)

⚠️ **This is a test/prototype implementation**

Search strategies are **placeholder stubs**. To make it production-ready:

1. **Add WebSearch integration**
   - Use Google Custom Search API
   - Or Brave Search API
   - Or scrape Google (use Playwright)

2. **Add WebFetch/scraping**
   - HTTP client (axios/fetch)
   - HTML parsing (cheerio)
   - PDF validation (check Content-Type)

3. **Add actual downloads**
   - Stream PDFs to disk
   - Verify file integrity
   - Handle timeouts/retries

4. **Add rate limiting**
   - Respect robots.txt
   - Rotate user agents
   - Use proxies if needed

## Cost Estimate (GitHub Actions)

- **Free tier:** 2,000 minutes/month
- **This job:** ~60 minutes (136 systems × 30s each)
- **Monthly runs:** 33 runs/month (well within free tier)

## Troubleshooting

**CSV not found:**
```bash
node scripts/export-systems-needing-manuals.js
```

**No PDFs downloaded:**
- Check search strategies are implemented
- Check rate limiting isn't too aggressive
- Try running on fewer systems first

**GitHub Actions timeout:**
- Reduce `maxPdfs` to 20
- Increase `searchTimeout` if searches are slow

## Future Enhancements

- [ ] Implement real search strategies
- [ ] Auto-upload to Supabase after download
- [ ] Email digest of found manuals
- [ ] Slack notification when job completes
- [ ] Web UI to review/approve manuals before upload
- [ ] Retry logic for failed systems
- [ ] LLM validation (is this actually a manual?)

## Files

```
scripts/agents/
├── README.md                           # This file
├── manual-hunter.js                    # Main agent
├── manual-hunter-config.js             # Configuration
├── manual-hunter-strategies.js         # Search strategies
├── systems-needing-manuals.csv         # Input (136 systems)
└── manual-hunter-results/              # Output
    ├── pdfs/                           # Downloaded PDFs
    ├── run-YYYY-MM-DD.json             # Results JSON
    └── run-YYYY-MM-DD-report.md        # Human-readable report

.github/workflows/
└── manual-hunter.yml                   # GitHub Actions workflow

scripts/
└── export-systems-needing-manuals.js   # Export CSV from DB
```

## Contributing

To add a new search strategy:

1. Add strategy to `manual-hunter-config.js`
2. Implement function in `manual-hunter-strategies.js`
3. Return `{ url, confidence }` on success, `null` on failure
4. Test locally before deploying

## License

Part of REIMAGINEDAPPV2 - AI-Powered Boat/OS

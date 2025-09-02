# Dependency Visualization

This directory contains automatically generated dependency graphs for the Reimagined App V2 codebase.

## Generated Files

### `app-madge.png`
- **Tool:** Madge
- **Content:** JavaScript dependency graph for the entire `src/` directory
- **Format:** PNG image
- **Generated:** `npm run graph:madge`

### `sidecar-deps.svg`
- **Tool:** pydeps
- **Content:** Python dependency graph for the `python-sidecar/app/` directory
- **Format:** SVG image
- **Generated:** `npm run graph:py`

## Available Scripts

### Generate All Graphs
```bash
npm run docs:generate
```
Generates both JavaScript and Python dependency graphs.

### Individual Graph Generation
```bash
# JavaScript dependencies (Madge)
npm run graph:madge

# Python dependencies (pydeps)
npm run graph:py

# Generate all graphs
npm run graph:all
```

### Cleanup
```bash
npm run docs:clean
```
Removes all generated graph files.

## What the Graphs Show

### JavaScript Dependencies (`app-madge.png`)
- **Router Structure:** How our split routers connect to services
- **Service Layer:** `routes → services → repositories` pattern
- **Middleware:** Security, validation, and error handling flow
- **Split Router Validation:** Clean separation between admin/document/chat

### Python Dependencies (`sidecar-deps.svg`)
- **Sidecar Architecture:** How Python modules interact
- **Document Processing:** Parser, models, and Pinecone client relationships
- **API Integration:** Main application and utility modules

## Architecture Insights

### Router Split Benefits (Visible in `app-madge.png`)
1. **Clean Separation:** Each router directory is clearly isolated
2. **Barrel Exports:** `index.js` files act as clean interfaces
3. **Service Layer:** Routes only call services, never repositories directly
4. **No Circular Dependencies:** Clean dependency flow

### Code Quality Validation
- **File Size Compliance:** All files ≤ 117 lines (visible in graph complexity)
- **Single Responsibility:** Each endpoint file has focused dependencies
- **Maintainability:** Clear dependency paths for debugging

## Usage in Development

### For New Developers
1. **Understanding Architecture:** Start with `app-madge.png` to see the overall structure
2. **Finding Dependencies:** Use graphs to trace how changes affect other modules
3. **Code Reviews:** Include dependency graphs in PRs for architectural changes

### For Refactoring
1. **Before Changes:** Generate graphs to understand current dependencies
2. **After Changes:** Regenerate to validate no circular dependencies introduced
3. **Architecture Validation:** Ensure `routes → services → repositories` pattern is maintained

### For Documentation
1. **Architecture Docs:** Include relevant graphs in `ROUTER_ARCHITECTURE.md`
2. **Team Onboarding:** Use graphs to explain codebase structure
3. **Design Decisions:** Document why certain dependencies exist

## Technical Notes

### Tools Used
- **Madge:** JavaScript dependency analysis (works well with ES modules)
- **pydeps:** Python dependency analysis (handles complex module relationships)
- **Graphviz:** SVG generation (installed via Homebrew)

### Configuration
- **JavaScript:** Uses Madge with `.js` extension filtering
- **Python:** Uses pydeps with SVG output and no display
- **Exclusions:** Test files and documentation are excluded from analysis

### File Sizes
- **app-madge.png:** ~742KB (high-resolution dependency graph)
- **sidecar-deps.svg:** ~611B (vector-based Python dependencies)

## Troubleshooting

### Common Issues
1. **Missing Graphviz:** Install via `brew install graphviz`
2. **Missing pydeps:** Install via `pipx install pydeps`
3. **Path Issues:** Ensure `~/.local/bin` is in PATH for pydeps

### Regeneration
If graphs become outdated or corrupted:
```bash
npm run docs:clean
npm run docs:generate
```

## Future Enhancements

### Potential Improvements
1. **Interactive Graphs:** Consider using D3.js for interactive dependency visualization
2. **CI Integration:** Generate graphs automatically in GitHub Actions
3. **Dependency Metrics:** Add complexity and coupling metrics
4. **Change Tracking:** Compare graphs over time to track architectural evolution

### Additional Tools
- **dependency-cruiser:** More detailed JavaScript analysis (currently having configuration issues)
- **jscpd:** Code duplication detection
- **eslint-plugin-import:** Import/export validation

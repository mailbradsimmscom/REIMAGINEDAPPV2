/**
 * Generate an HTML page wrapping the dependency graph SVG
 * Output: docs/auto/deps.html
 */

import { readFileSync, writeFileSync } from 'node:fs';

const svgPath = 'docs/auto/graphs/deps.svg';
const outPath = 'docs/auto/deps.html';

const svg = readFileSync(svgPath, 'utf-8');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dependency Graph — BoatOS</title>
  <style>
    body { margin: 0; padding: 20px; background: #fff; font-family: system-ui, sans-serif; }
    h1 { font-size: 1.4rem; color: #333; margin-bottom: 16px; }
    .graph-container { overflow: auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; }
    .graph-container svg { max-width: 100%; height: auto; }
    .meta { color: #888; font-size: 0.85rem; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>BoatOS Dependency Graph</h1>
  <div class="graph-container">
    ${svg}
  </div>
  <p class="meta">Generated ${new Date().toISOString().slice(0, 10)} by dependency-cruiser + Graphviz</p>
</body>
</html>`;

writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);

/**
 * Enhanced Mintlify Code Reference Generator
 * ------------------------------------------
 * Extracts JSDoc summaries + exported function/class names.
 */

import fs from "fs";
import path from "path";

const SRC_DIR = "src";
const OUT_DIR = "docs/auto/code";
fs.mkdirSync(OUT_DIR, { recursive: true });

function getFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getFiles(fullPath));
    else if (entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

/**
 * Extract first JSDoc block and export names
 */
function extractMetadata(code) {
  const jsdocMatch = code.match(/\/\*\*([\s\S]*?)\*\//);
  let description = jsdocMatch
    ? jsdocMatch[1]
        .replace(/\n\s*\*\s?/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "Auto-generated code reference";

  // Escape YAML special characters
  description = description
    .replace(/:/g, " -")
    .replace(/"/g, "'")
    .replace(/\n/g, " ")
    .trim();

  const exports = [];
  const exportRegex =
    /export\s+(?:function|class|const|let|var)\s+([A-Za-z0-9_]+)/g;
  let match;
  while ((match = exportRegex.exec(code))) exports.push(match[1]);

  const title = exports.length > 0 ? exports.join(", ") : "Module";
  
  // Escape title as well
  const escapedTitle = title.replace(/:/g, " -").replace(/"/g, "'");
  
  return { title: escapedTitle, description };
}

/**
 * Main generation
 */
const files = getFiles(SRC_DIR);
const pages = [];

for (const file of files) {
  const rel = path.relative(SRC_DIR, file);
  const name = path.basename(file, ".js");
  const code = fs.readFileSync(file, "utf-8");
  const { title, description } = extractMetadata(code);

  const outPath = path.join(OUT_DIR, `${name}.mdx`);
  const mdx = `---
title: ${title}
description: ${description}
---

\`\`\`javascript
${code}
\`\`\`
`;

  fs.writeFileSync(outPath, mdx, "utf-8");
  pages.push({ name: title, path: `/auto/code/${name}` });
}

fs.writeFileSync(
  "docs/pages.json",
  JSON.stringify({ pages }, null, 2),
  "utf-8"
);

console.log(`✅ Generated ${pages.length} enriched docs in ${OUT_DIR}`);
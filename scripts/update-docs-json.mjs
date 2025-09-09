// scripts/update-docs-json.mjs
import { promises as fs } from 'fs';
import { join } from 'path';

const groupName = 'Code Reference';
const baseDir = 'docs/auto/code';
const docsJsonPath = 'docs/docs.json';

async function main() {
  const entries = await fs.readdir(baseDir);
  const mdxFiles = entries
    .filter(name => name.endsWith('.mdx'))
    .map(name => `auto/code/${name.replace(/\.mdx$/, '')}`)
    .sort();

  const json = JSON.parse(await fs.readFile(docsJsonPath, 'utf-8'));

  // Replace or add the Code Reference group
  const otherGroups = json.navigation.filter(g => g.group !== groupName);
  json.navigation = [
    ...otherGroups,
    {
      group: groupName,
      pages: mdxFiles
    }
  ];

  await fs.writeFile(docsJsonPath, JSON.stringify(json, null, 2));
  console.log(`✅ Updated ${docsJsonPath} with ${mdxFiles.length} pages.`);
}

main().catch(err => {
  console.error('❌ Failed to update docs.json:', err);
});

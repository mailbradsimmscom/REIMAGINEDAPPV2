// scripts/zod-coverage.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const ROUTE_DIR = 'src/routes';
const has = (s, re) => re.test(s);

const importZodRE = /\bfrom\s+['"]zod['"]/;
const importSchemaRE = /\bimport\s+{[^}]*\b(z|Z)od[^}]*}\s+from\s+['"][^'"]+['"]/;
const validateInputRE = /\bvalidate(Input|Params|Query|Body)?\s*\(/;     // your validate middleware
const validateResponseRE = /\bvalidateResponse\s*\(|\bRESPONSE_VALIDATE\b/;

const handlers = []; // {file, hasZodImport, hasInputValidation, hasResponseValidation}

// Recursively find all .js files in routes directory
async function findRouteFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findRouteFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

const routeFiles = await findRouteFiles(ROUTE_DIR);

for (const file of routeFiles) {
  const src = await fs.readFile(file, 'utf8');
  const rec = {
    file,
    hasZodImport: has(src, importZodRE) || has(src, importSchemaRE),
    hasInputValidation: has(src, validateInputRE),
    hasResponseValidation: has(src, validateResponseRE),
  };
  handlers.push(rec);
}

const byFile = handlers.sort((a,b)=>a.file.localeCompare(b.file));
const total = byFile.length;
const inputOk = byFile.filter(x => x.hasInputValidation).length;
const respOk = byFile.filter(x => x.hasResponseValidation).length;

console.log(`ZOD INPUT coverage: ${inputOk}/${total} (${Math.round(100*inputOk/Math.max(1,total))}%)`);
console.log(`ZOD RESPONSE gating present: ${respOk}/${total} (${Math.round(100*respOk/Math.max(1,total))}%)\n`);

const missInput = byFile.filter(x => !x.hasInputValidation);
const missResp = byFile.filter(x => !x.hasResponseValidation);

if (missInput.length) {
  console.log('Missing INPUT validation in:');
  missInput.forEach(x => console.log('  -', x.file));
  console.log('');
}
if (missResp.length) {
  console.log('Missing RESPONSE validation/gating in:');
  missResp.forEach(x => console.log('  -', x.file));
  console.log('');
}

// Fail CI if not 100%
if (total && (inputOk !== total || respOk !== total)) {
  process.exitCode = 1;
}

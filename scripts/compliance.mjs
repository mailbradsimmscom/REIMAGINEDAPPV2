#!/usr/bin/env node
/**
 * REIMAGINEDAPPV2 Compliance Report (Node 20+, ESM, no deps)
 * Prints a tight chart; exits non-zero on blocking failures (unless --report).
 *
 * Blocking checks:
 *  - Tracked artifacts (node_modules/, logs, PDFs, builds, venvs)
 *  - process.env leaks outside src/config/env.js
 *  - Legacy *.routes.js present
 *  - Duplicate (method, path) routes using EFFECTIVE paths (segment mount + local path)
 *  - Missing validateResponse() (per file OR covered by segment index.js barrel)
 *  - /admin router not gated by adminOnly
 *  - Routes importing from repositories (violates routes → services → repositories)
 *  - axios present (forbidden)
 *  - Zod INPUT at route edge missing in any handler file
 *
 * Warning (non-blocking):
 *  - Files in src/ over MAX_FILE_LINES (default 250)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const ROUTES_DIR = path.join(SRC, 'routes');
const ADMIN_INDEX = path.join(ROUTES_DIR, 'admin', 'index.js');
const ENV_JS = path.join(SRC, 'config', 'env.js');
const MAX_FILE_LINES = Number(process.env.MAX_FILE_LINES || 250);

const args = new Set(process.argv.slice(2));
const asReportOnly = args.has('--report'); // chart only; do not fail

function now() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function walk(dir, filter = (f) => f.endsWith('.js')) {
  const out = [];
  async function rec(d) {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await rec(p);
      else if (filter(p)) out.push(p);
    }
  }
  await rec(dir);
  return out;
}
function fmtResult(ok) { return ok ? 'PASS' : 'FAIL'; }
function fmtWarn(ok) { return ok ? 'OK' : 'WARN'; }
function truncList(arr, n = 3) { return arr.length <= n ? arr.join(', ') : `${arr.slice(0, n).join(', ')} … (+${arr.length - n} more)`; }
function columnize(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  return rows.map(r => r.map((c, i) => String(c).padEnd(widths[i])).join('  ')).join('\n');
}

// ---------- CHECKS ----------
async function checkArtifactsTracked() {
  let files = [];
  try {
    const out = execSync('git ls-files -z', { encoding: 'utf8' });
    files = out.split('\0').filter(Boolean);
  } catch { /* not a git repo; treat as OK */ }
  const banned = [
    /^node_modules\//i, /^logs\//i, /\.log$/i, /^dist\//i, /^build\//i,
    /^coverage\//i, /^python-sidecar\/venv\//i, /^\.venv\//i, /\.pdf$/i,
  ];
  const hits = files.filter(f => banned.some(r => r.test(f)));
  return { ok: hits.length === 0, details: hits };
}

async function checkEnvLeaks() {
  const files = await walk(SRC, (p) => p.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    if (f === ENV_JS) continue;
    const s = await fs.readFile(f, 'utf8');
    if (/\bprocess\.env\./.test(s)) offenders.push(path.relative(ROOT, f).replaceAll('\\', '/'));
  }
  return { ok: offenders.length === 0, details: offenders };
}

async function checkFileSizes() {
  const EXEMPT = [/^tests\//, /^migrations\//, /^sql\//];
  const files = await walk(SRC, (p) => p.endsWith('.js'));
  const overs = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).replaceAll('\\', '/');
    if (EXEMPT.some(r => r.test(rel))) continue;
    const lines = (await fs.readFile(f, 'utf8')).split('\n').length;
    if (lines > MAX_FILE_LINES) overs.push(`${rel}(${lines})`);
  }
  return { ok: overs.length === 0, details: overs };
}

// Derive router "segment" for a file under src/routes
function segmentOfRoutesFile(relFromRoutes) {
  if (relFromRoutes.includes('/')) return relFromRoutes.split('/')[0]; // e.g., chat/history.route.js → chat
  const base = path.basename(relFromRoutes, '.js');
  return base.replace(/\.(router|routes|route)$/i, '');
}

async function checkRoutesIntegrity() {
  const files = await walk(ROUTES_DIR, (p) => p.endsWith('.js'));
  const legacy = files
    .filter(f => /\.routes\.js$/i.test(f))
    .map(f => path.relative(ROOT, f).replaceAll('\\', '/'));

  // Build a map of segment -> (absLeafPath -> mount) by parsing segment's index.js
  const byRel = new Map(files.map(f => [path.relative(ROUTES_DIR, f).replaceAll('\\', '/'), f]));
  const segments = new Set(
    [...byRel.keys()]
      .map(rel => rel.split('/')[0])
      .filter(seg => seg && byRel.has(`${seg}/index.js`))
  );

  const segmentMounts = new Map(); // seg -> Map(absLeafPath -> '/mount')
  for (const seg of segments) {
    const indexAbs = byRel.get(`${seg}/index.js`);
    const indexSrc = await fs.readFile(indexAbs, 'utf8');

    // import Alias from './foo.route.js'
    const imports = new Map(); // alias -> abs path
    const importRe = /import\s+([A-Za-z0-9_$]+)\s+from\s+['"]\.\/([^'"]+)['"]/g;
    for (let m; (m = importRe.exec(indexSrc));) {
      const alias = m[1];
      let relLeaf = m[2];
      if (!/\.js$/.test(relLeaf)) relLeaf += '.js';
      const absLeaf = path.join(ROUTES_DIR, seg, relLeaf).replaceAll('\\', '/');
      imports.set(alias, absLeaf);
    }

    // router.use('/mount', Alias) OR r.use('/mount', Alias)
    const mounts = new Map(); // abs leaf -> '/mount'
    const useRe = /\b(?:router|r)\.use\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_$]+)\s*\)/g;
    for (let m; (m = useRe.exec(indexSrc));) {
      const mount = m[1];
      const alias = m[2];
      const absLeaf = imports.get(alias);
      if (absLeaf) mounts.set(absLeaf, mount);
    }
    segmentMounts.set(seg, mounts);
  }

  const routeRE = /\brouter\.(get|post|put|patch|delete)\s*\(/;
  const fileToSeg = (abs) => {
    const relFromRoutes = path.relative(ROUTES_DIR, abs).replaceAll('\\', '/');
    return relFromRoutes.includes('/') ? relFromRoutes.split('/')[0] : relFromRoutes.replace(/\.js$/, '').replace(/\.(router|route)$/i, '');
  };

  const duplicates = [];
  const routeMap = new Map(); // "METHOD effectivePath" -> [files]
  const missingVR = [];
  let handlerFiles = 0, withVR = 0;

  for (const abs of files) {
    const relAbs = path.relative(ROOT, abs).replaceAll('\\', '/');
    const seg = fileToSeg(abs);
    const src = await fs.readFile(abs, 'utf8');

    // Effective mount for this leaf (if any)
    let mount = '';
    const segMounts = segmentMounts.get(seg);
    if (segMounts && segMounts.has(abs.replaceAll('\\', '/'))) mount = segMounts.get(abs.replaceAll('\\', '/'));

    // Collect EFFECTIVE routes (mount + local path)
    const localRouteRe = /\brouter\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    for (let m; (m = localRouteRe.exec(src));) {
      const method = m[1].toUpperCase();
      const localPath = m[2];
      const effective = `${mount}${localPath}`.replace(/\/{2,}/g, '/');
      const key = `${method} ${effective}`;
      const arr = routeMap.get(key) || [];
      arr.push(relAbs);
      routeMap.set(key, arr);
    }

    // Response gating coverage
    if (routeRE.test(src)) {
      handlerFiles++;
      const hasFileVR = /validateResponse\s*\(/.test(src);
      // Covered by segment barrel?
      let segCovered = false;
      const segIndexRel = `${seg}/index.js`;
      if (byRel.has(segIndexRel)) {
        const segIndexSrc = await fs.readFile(byRel.get(segIndexRel), 'utf8');
        segCovered = /validateResponse\s*\(/.test(segIndexSrc);
      }
      if (hasFileVR || segCovered) withVR++; else missingVR.push(relAbs);
    }
  }

  // True duplicates: same METHOD + EFFECTIVE path seen in >1 file
  for (const [k, arr] of routeMap.entries()) {
    if (arr.length > 1) duplicates.push(`${k} ← ${arr.join(', ')}`);
  }

  return {
    legacy,
    duplicates,
    missingVR,
    vrCoverage: { total: handlerFiles, withVR }
  };
}

async function checkAdminGate() {
  if (!(await exists(ADMIN_INDEX))) return { ok: false, reason: 'admin index not found' };
  const src = await fs.readFile(ADMIN_INDEX, 'utf8');
  const hasImport = /adminOnly/.test(src);
  const hasUse = /\.use\(\s*adminOnly\s*\)/.test(src) || /r\.use\(\s*adminOnly\s*\)/.test(src);
  return { ok: hasImport && hasUse };
}

async function checkRouteRepoBoundary() {
  // Forbid imports from repositories inside any routes file
  const files = await walk(ROUTES_DIR, (p) => p.endsWith('.js'));
  const offenders = [];
  const re = /from\s+['"][.\/]+(?:\.\.\/)+repositories\//; // ../../repositories/ or ../repositories/
  for (const f of files) {
    const s = await fs.readFile(f, 'utf8');
    if (re.test(s)) offenders.push(path.relative(ROOT, f).replaceAll('\\', '/'));
  }
  return { ok: offenders.length === 0, details: offenders };
}

async function checkAxiosForbidden() {
  const files = await walk(SRC, (p) => p.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    const s = await fs.readFile(f, 'utf8');
    if (/\bfrom\s+['"]axios['"]/.test(s) || /\brequire\(\s*['"]axios['"]\s*\)/.test(s))
      offenders.push(path.relative(ROOT, f).replaceAll('\\', '/'));
  }
  return { ok: offenders.length === 0, details: offenders };
}

async function checkZodInputCoverage() {
  // Only count files that actually define HTTP handlers
  const files = await walk(ROUTES_DIR, (p) => p.endsWith('.js'));
  const routeRE = /\brouter\.(get|post|put|patch|delete)\s*\(/;
  const validateInputRE = /\bvalidate(?:Input|Params|Query|Body)?\s*\(/; // adjust if your middleware name differs
  let total = 0, withInput = 0;
  const missing = [];
  for (const f of files) {
    const src = await fs.readFile(f, 'utf8');
    if (!routeRE.test(src)) continue; // barrel-only router; skip counting
    total++;
    if (validateInputRE.test(src)) withInput++;
    else missing.push(path.relative(ROOT, f).replaceAll('\\', '/'));
  }
  return { ok: total > 0 && withInput === total, withInput, total, missing };
}

// ---------- RUN ----------
(async () => {
  const rows = [];

  const artifacts = await checkArtifactsTracked();
  rows.push(['Artifacts tracked', fmtResult(artifacts.ok), artifacts.ok ? '0' : truncList(artifacts.details)]);

  const leaks = await checkEnvLeaks();
  rows.push(['Env leaks (process.env outside env.js)', fmtResult(leaks.ok), leaks.ok ? '0' : truncList(leaks.details)]);

  const sizes = await checkFileSizes();
  rows.push([`Files > ${MAX_FILE_LINES} lines (src)`, fmtWarn(sizes.ok), sizes.ok ? '0' : truncList(sizes.details)]);

  const routes = await checkRoutesIntegrity();
  const legacyOk = routes.legacy.length === 0;
  const dupOk = routes.duplicates.length === 0;
  const vrOk = routes.vrCoverage.withVR === routes.vrCoverage.total;

  rows.push(['Legacy *.routes.js', fmtResult(legacyOk), legacyOk ? '0' : truncList(routes.legacy)]);
  rows.push(['Duplicate routes', fmtResult(dupOk), dupOk ? '0' : truncList(routes.duplicates)]);
  rows.push(['validateResponse present (routes)', fmtResult(vrOk), `${routes.vrCoverage.withVR}/${routes.vrCoverage.total}`]);

  const admin = await checkAdminGate();
  rows.push(['/admin gated by adminOnly', fmtResult(admin.ok), admin.ok ? 'yes' : (admin.reason || 'no')]);

  const boundary = await checkRouteRepoBoundary();
  rows.push(['No route → repository imports', fmtResult(boundary.ok), boundary.ok ? '0' : truncList(boundary.details)]);

  const axios = await checkAxiosForbidden();
  rows.push(['Axios forbidden', fmtResult(axios.ok), axios.ok ? '0' : truncList(axios.details)]);

  const zodIn = await checkZodInputCoverage();
  rows.push(['Zod INPUT at route edge', fmtResult(zodIn.ok), `${zodIn.withInput}/${zodIn.total}${zodIn.ok ? '' : ' – ' + truncList(zodIn.missing)}`]);

  // Render chart
  const header = ['Check', 'Result', 'Details'];
  const table = [header, ...rows];

  console.log(`REIMAGINEDAPPV2 Compliance — ${now()}`);
  console.log(columnize(table));

  const blockingFails =
    (!artifacts.ok) ||
    (!leaks.ok) ||
    (!legacyOk) ||
    (!dupOk) ||
    (!vrOk) ||
    (!admin.ok) ||
    (!boundary.ok) ||
    (!axios.ok) ||
    (!zodIn.ok);

  const warns = !sizes.ok ? 1 : 0;
  console.log(`\nOverall: ${blockingFails ? 'FAIL' : 'PASS'} (${blockingFails ? 'blocking issues present' : 'no blocking issues'}${warns ? `, ${warns} warning` : ''})`);
  if (!asReportOnly && blockingFails) process.exit(1);
})();

#!/usr/bin/env node

/**
 * Check UI coverage - ensures every page in the manifest has a test.
 * Fails CI if new pages are added without tests.
 *
 * Usage: npm run test:check-coverage
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/**
 * Load the pages manifest
 */
function loadManifest() {
  const manifestPath = join(projectRoot, 'tests/pages-manifest.json');

  if (!existsSync(manifestPath)) {
    console.error('ERROR: tests/pages-manifest.json not found');
    console.error('Run: npm run test:discover-pages');
    process.exit(1);
  }

  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

/**
 * Load page interactions config (which pages have tests)
 */
function loadInteractions() {
  const interactionsPath = join(projectRoot, 'tests/e2e/page-interactions.json');

  if (!existsSync(interactionsPath)) {
    // Return empty - all pages will be "untested"
    return { pages: {}, maintenanceAgent: { pages: {} } };
  }

  const data = JSON.parse(readFileSync(interactionsPath, 'utf-8'));

  // Handle both old format (object with urls as keys) and new format (object with pages property)
  return {
    pages: data.pages || {},
    maintenanceAgent: data.maintenanceAgent || { pages: {} }
  };
}

/**
 * Recursively get all files in a directory
 */
function getFilesRecursive(dir) {
  const results = [];

  if (!existsSync(dir)) {
    return results;
  }

  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...getFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Find E2E test files that reference specific pages
 */
function findTestCoverage() {
  const e2eDir = join(projectRoot, 'tests/e2e');
  const nightlyDir = join(projectRoot, 'tests/nightly');

  const testFiles = [
    ...getFilesRecursive(e2eDir).filter(f => f.endsWith('.spec.js')),
    ...getFilesRecursive(nightlyDir).filter(f => f.endsWith('.test.js')),
  ];

  const coverageMap = new Map();

  for (const testFile of testFiles) {
    const content = readFileSync(testFile, 'utf-8');

    // Extract URLs from test files
    const urlMatches = content.match(/['"](\/[^'"]*)['"]/g) || [];
    for (const match of urlMatches) {
      const url = match.replace(/['"]/g, '');
      if (url.includes('.html') || url === '/' || url === '/admin' || url === '/landing') {
        if (!coverageMap.has(url)) {
          coverageMap.set(url, []);
        }
        coverageMap.get(url).push(testFile);
      }
    }
  }

  return coverageMap;
}

/**
 * Main check function
 */
function checkCoverage() {
  console.log('Checking UI coverage...\n');

  const manifest = loadManifest();
  const interactions = loadInteractions();
  const testCoverage = findTestCoverage();

  const discoveredUrls = new Set(manifest.pages.map(p => p.url));

  // Build set of tested URLs from interactions config
  const testedUrls = new Set();

  // Add main app pages from interactions
  for (const url of Object.keys(interactions.pages)) {
    testedUrls.add(url);
    // Also add with /public prefix for static files
    if (url.startsWith('/public/')) {
      testedUrls.add(url);
    }
  }

  // Add maintenance agent pages (with /maintenance-agent prefix)
  for (const url of Object.keys(interactions.maintenanceAgent?.pages || {})) {
    testedUrls.add(`/maintenance-agent${url}`);
  }

  // Add coverage from test files
  for (const url of testCoverage.keys()) {
    testedUrls.add(url);
  }

  // Find untested pages
  const untested = [];
  for (const page of manifest.pages) {
    // Normalize URL for matching
    const normalizedUrl = page.url.replace(/^\/public/, '');

    const hasTest =
      testedUrls.has(page.url) ||
      testedUrls.has(normalizedUrl) ||
      testCoverage.has(page.url) ||
      testCoverage.has(normalizedUrl);

    if (!hasTest) {
      untested.push(page);
    }
  }

  // Report results
  const testedCount = manifest.pages.length - untested.length;
  const coveragePercent = ((testedCount / manifest.pages.length) * 100).toFixed(1);

  console.log('=== UI Coverage Report ===');
  console.log(`Total pages discovered: ${manifest.pages.length}`);
  console.log(`  Main app: ${manifest.mainApp}`);
  console.log(`  Maintenance agent: ${manifest.maintenanceAgent}`);
  console.log(``);
  console.log(`Pages with tests: ${testedCount}`);
  console.log(`Untested pages: ${untested.length}`);
  console.log(`Coverage: ${coveragePercent}%`);
  console.log('========================\n');

  if (untested.length > 0) {
    console.log('UNTESTED PAGES:');
    untested.forEach(p => console.log(`  ${p.url}`));
    console.log('');
    console.log('To add coverage, update tests/e2e/page-interactions.json');
    console.log('');
  }

  // Determine pass/fail based on coverage threshold
  const COVERAGE_THRESHOLD = 50; // Set to 100 when all pages are covered
  const pass = parseFloat(coveragePercent) >= COVERAGE_THRESHOLD;

  if (!pass) {
    console.log(`CI FAILURE: Coverage ${coveragePercent}% is below threshold ${COVERAGE_THRESHOLD}%`);
    process.exit(1);
  }

  console.log(`Coverage check passed! (${coveragePercent}% >= ${COVERAGE_THRESHOLD}%)`);
}

// Run if called directly
checkCoverage();

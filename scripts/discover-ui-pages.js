#!/usr/bin/env node

/**
 * Discover all UI pages in the codebase.
 * Generates tests/pages-manifest.json with URLs for each page.
 *
 * Usage: npm run test:discover-pages
 */

import { writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/**
 * Patterns to skip (partials, deprecated, etc.)
 */
const SKIP_PATTERNS = [
  /partials\//,
  /deprecated-/,
  /\.min\./,
];

/**
 * Recursively get all HTML files from a directory
 */
function getHtmlFilesRecursive(dir, baseDir) {
  const results = [];

  if (!existsSync(dir)) {
    return results;
  }

  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...getHtmlFilesRecursive(fullPath, baseDir));
    } else if (extname(item) === '.html') {
      const relativePath = relative(baseDir, fullPath);

      // Skip if matches any skip pattern
      if (SKIP_PATTERNS.some(p => p.test(relativePath))) {
        continue;
      }

      results.push(relativePath);
    }
  }

  return results;
}

/**
 * Get all HTML files from a directory with URL prefix
 */
function getHtmlFiles(baseDir, urlPrefix) {
  const files = getHtmlFilesRecursive(baseDir, baseDir);

  return files.map(file => {
    const url = `${urlPrefix}/${file}`;
    return {
      file: relative(projectRoot, join(baseDir, file)),
      url: url.replace(/\\/g, '/'),
      type: 'static'
    };
  });
}

/**
 * Route-served pages (not static files)
 */
const ROUTE_PAGES = [
  { url: '/', name: 'Chat Interface (Root)', type: 'route' },
  { url: '/admin', name: 'Admin Dashboard', type: 'route' },
  { url: '/landing', name: 'Landing Page', type: 'route' },
];

/**
 * Main discovery function
 */
function discoverAllPages() {
  const pages = [];

  // Main app public pages
  const mainPublicDir = join(projectRoot, 'src/public');
  if (existsSync(mainPublicDir)) {
    pages.push(...getHtmlFiles(mainPublicDir, '/public'));
  }

  // Maintenance agent pages (different port in production)
  const maintenanceDir = join(projectRoot, 'maintenance-agent/public');
  if (existsSync(maintenanceDir)) {
    const maintenancePages = getHtmlFiles(maintenanceDir, '/maintenance-agent');
    maintenancePages.forEach(p => {
      p.service = 'maintenance-agent';
      p.port = 3001;
    });
    pages.push(...maintenancePages);
  }

  // Add route-served pages
  pages.push(...ROUTE_PAGES);

  return pages;
}

/**
 * Generate manifest file
 */
function generateManifest() {
  console.log('Discovering UI pages...\n');

  const pages = discoverAllPages();

  // Sort by URL for consistency
  pages.sort((a, b) => a.url.localeCompare(b.url));

  // Group by service
  const mainAppPages = pages.filter(p => p.service !== 'maintenance-agent');
  const maintenancePages = pages.filter(p => p.service === 'maintenance-agent');

  console.log(`Found ${mainAppPages.length} main app pages:`);
  mainAppPages.forEach(p => console.log(`  ${p.url}`));

  console.log(`\nFound ${maintenancePages.length} maintenance-agent pages:`);
  maintenancePages.forEach(p => console.log(`  ${p.url}`));

  // Write manifest
  const manifestPath = join(projectRoot, 'tests/pages-manifest.json');
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalPages: pages.length,
    mainApp: mainAppPages.length,
    maintenanceAgent: maintenancePages.length,
    pages
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to: ${manifestPath}`);
  console.log(`Total: ${pages.length} pages`);

  return manifest;
}

// Run if called directly
generateManifest();

#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const SIDECAR_PORT = 8000;
const SIDECAR_HEALTH_URL = `http://localhost:${SIDECAR_PORT}/health`;
const SIDECAR_STARTUP_TIMEOUT = 30000; // 30 seconds
const HEALTH_CHECK_INTERVAL = 1000; // 1 second

// Paths
const PROJECT_ROOT = join(__dirname, '..');
const SIDECAR_DIR = join(PROJECT_ROOT, 'python-sidecar');
const SIDECAR_MAIN = join(SIDECAR_DIR, 'app', 'main.py');

let sidecarProcess = null;

// Utility functions
function log(message) {
  console.log(`[TEST-SETUP] ${message}`);
}

function error(message) {
  console.error(`[TEST-SETUP] ERROR: ${message}`);
}

// Check if sidecar is already running
async function checkSidecarHealth() {
  try {
    const response = await fetch(SIDECAR_HEALTH_URL);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Start the Python sidecar service
function startSidecar() {
  return new Promise((resolve, reject) => {
    log('Starting Python sidecar service...');
    
    // Check if Python sidecar directory exists
    if (!existsSync(SIDECAR_MAIN)) {
      reject(new Error(`Sidecar main.py not found at: ${SIDECAR_MAIN}`));
      return;
    }

    // Start the sidecar process
    sidecarProcess = spawn('python', [SIDECAR_MAIN], {
      cwd: SIDECAR_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PYTHONPATH: SIDECAR_DIR }
    });

    // Handle sidecar output
    sidecarProcess.stdout.on('data', (data) => {
      log(`Sidecar stdout: ${data.toString().trim()}`);
    });

    sidecarProcess.stderr.on('data', (data) => {
      log(`Sidecar stderr: ${data.toString().trim()}`);
    });

    // Handle sidecar process exit
    sidecarProcess.on('error', (err) => {
      error(`Failed to start sidecar: ${err.message}`);
      reject(err);
    });

    sidecarProcess.on('exit', (code) => {
      if (code !== 0) {
        error(`Sidecar process exited with code ${code}`);
        reject(new Error(`Sidecar process exited with code ${code}`));
      }
    });

    // Wait for sidecar to be healthy
    let attempts = 0;
    const maxAttempts = SIDECAR_STARTUP_TIMEOUT / HEALTH_CHECK_INTERVAL;
    
    const healthCheck = async () => {
      attempts++;
      
      if (await checkSidecarHealth()) {
        log(`Sidecar is healthy after ${attempts} attempts`);
        resolve();
        return;
      }
      
      if (attempts >= maxAttempts) {
        const err = new Error(`Sidecar failed to start within ${SIDECAR_STARTUP_TIMEOUT}ms`);
        error(err.message);
        reject(err);
        return;
      }
      
      setTimeout(healthCheck, HEALTH_CHECK_INTERVAL);
    };

    // Start health check after a short delay
    setTimeout(healthCheck, HEALTH_CHECK_INTERVAL);
  });
}

// Stop the sidecar service
function stopSidecar() {
  return new Promise((resolve) => {
    if (!sidecarProcess) {
      resolve();
      return;
    }

    log('Stopping Python sidecar service...');
    
    sidecarProcess.on('exit', (code) => {
      log(`Sidecar process stopped with code ${code}`);
      resolve();
    });

    sidecarProcess.kill('SIGTERM');
    
    // Force kill after 5 seconds if it doesn't stop gracefully
    setTimeout(() => {
      if (sidecarProcess && !sidecarProcess.killed) {
        log('Force killing sidecar process...');
        sidecarProcess.kill('SIGKILL');
      }
    }, 5000);
  });
}

// Run tests
function runTests() {
  return new Promise((resolve, reject) => {
    log('Running tests...');
    
    const testProcess = spawn('node', ['--test', 'tests/integration/'], {
      stdio: 'inherit',
      cwd: PROJECT_ROOT
    });

    testProcess.on('exit', (code) => {
      if (code === 0) {
        log('Tests completed successfully');
        resolve();
      } else {
        error(`Tests failed with code ${code}`);
        reject(new Error(`Tests failed with code ${code}`));
      }
    });

    testProcess.on('error', (err) => {
      error(`Failed to run tests: ${err.message}`);
      reject(err);
    });
  });
}

// Main execution
async function main() {
  try {
    // Check if sidecar is already running
    if (await checkSidecarHealth()) {
      log('Sidecar is already running, using existing instance');
    } else {
      // Start sidecar
      await startSidecar();
    }

    // Run tests
    await runTests();
    
  } catch (error) {
    error(`Test execution failed: ${error.message}`);
    process.exit(1);
  } finally {
    // Cleanup
    await stopSidecar();
    log('Test setup complete');
  }
}

// Handle process signals
process.on('SIGINT', async () => {
  log('Received SIGINT, cleaning up...');
  await stopSidecar();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('Received SIGTERM, cleaning up...');
  await stopSidecar();
  process.exit(0);
});

// Run the main function
main().catch((err) => {
  console.error(`[TEST-SETUP] Fatal error: ${err.message}`);
  process.exit(1);
});

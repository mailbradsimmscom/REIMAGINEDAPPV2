#!/usr/bin/env node

/**
 * Performance Monitoring Script
 * 
 * Monitors test execution performance and provides metrics
 * for CI integration and local development.
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

const startTime = performance.now();

// Test categories with expected counts
const testCategories = {
  'Health': 8,
  'Chat': 10,
  'Systems': 10,
  'Admin': 10,
  'Document': 18,
  'Pinecone': 18
};

const totalExpectedTests = Object.values(testCategories).reduce((sum, count) => sum + count, 0);

console.log('🚀 Starting Performance Monitoring...');
console.log('=====================================');
console.log(`📊 Expected test count: ${totalExpectedTests}`);
console.log(`⏰ Start time: ${new Date().toISOString()}`);
console.log('');

// Performance thresholds
const thresholds = {
  individualTest: 10000, // 10 seconds
  totalSuite: 30000,     // 30 seconds
  memoryUsage: 512       // 512MB
};

// Run only the core test files
const testFiles = [
  'tests/integration/health.test.js',
  'tests/integration/chat.test.js',
  'tests/integration/systems.test.js',
  'tests/integration/admin.test.js',
  'tests/integration/document.test.js',
  'tests/integration/pinecone.test.js'
];

const testProcess = spawn('node', ['--test', ...testFiles], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    ADMIN_TOKEN: 'admin-secret-key'
  }
});

let testOutput = '';
let testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  duration: 0
};

testProcess.stdout.on('data', (data) => {
  testOutput += data.toString();
  process.stdout.write(data); // Also show output in real-time
});

testProcess.stderr.on('data', (data) => {
  process.stderr.write(data); // Show stderr in real-time
});

testProcess.on('close', (code) => {
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  // Parse test results from output
  const lines = testOutput.split('\n');
  for (const line of lines) {
    if (line.includes('# tests')) {
      const match = line.match(/(\d+)/);
      if (match) testResults.total = parseInt(match[1]);
    }
    if (line.includes('# pass')) {
      const match = line.match(/(\d+)/);
      if (match) testResults.passed = parseInt(match[1]);
    }
    if (line.includes('# fail')) {
      const match = line.match(/(\d+)/);
      if (match) testResults.failed = parseInt(match[1]);
    }
    if (line.includes('# duration_ms')) {
      const match = line.match(/(\d+)/);
      if (match) testResults.duration = parseInt(match[1]);
    }
  }
  
  // Performance analysis
  console.log('\n📊 Performance Analysis');
  console.log('=======================');
  console.log(`⏱️  Total execution time: ${duration.toFixed(2)}ms`);
  console.log(`📈 Test suite duration: ${testResults.duration}ms`);
  console.log(`✅ Tests passed: ${testResults.passed}/${testResults.total}`);
  console.log(`❌ Tests failed: ${testResults.failed}`);
  console.log('');
  
  // Performance thresholds
  console.log('🎯 Performance Thresholds');
  console.log('=========================');
  
  const avgTestTime = testResults.total > 0 ? testResults.duration / testResults.total : 0;
  const memoryUsage = process.memoryUsage();
  const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
  
  const thresholdChecks = [
    {
      name: 'Individual test time',
      value: avgTestTime,
      threshold: thresholds.individualTest,
      unit: 'ms',
      passed: avgTestTime < thresholds.individualTest
    },
    {
      name: 'Total suite time',
      value: testResults.duration,
      threshold: thresholds.totalSuite,
      unit: 'ms',
      passed: testResults.duration < thresholds.totalSuite
    },
    {
      name: 'Memory usage',
      value: memoryMB,
      threshold: thresholds.memoryUsage,
      unit: 'MB',
      passed: memoryMB < thresholds.memoryUsage
    }
  ];
  
  let allThresholdsPassed = true;
  
  for (const check of thresholdChecks) {
    const status = check.passed ? '✅' : '❌';
    const result = check.passed ? 'PASS' : 'FAIL';
    console.log(`${status} ${check.name}: ${check.value.toFixed(2)}${check.unit} (threshold: ${check.threshold}${check.unit}) [${result}]`);
    if (!check.passed) allThresholdsPassed = false;
  }
  
  console.log('');
  console.log('📋 Test Coverage Summary');
  console.log('========================');
  console.log(`Expected tests: ${totalExpectedTests}`);
  console.log(`Actual tests: ${testResults.total}`);
  console.log(`Coverage: ${((testResults.total / totalExpectedTests) * 100).toFixed(1)}%`);
  
  if (testResults.total === totalExpectedTests) {
    console.log('✅ All expected test categories covered');
  } else {
    console.log('⚠️  Some test categories may be missing');
  }
  
  console.log('');
  console.log('🎯 Final Status');
  console.log('===============');
  
  if (code === 0 && testResults.failed === 0 && allThresholdsPassed) {
    console.log('🎉 SUCCESS: All tests passed and performance thresholds met!');
    console.log('🚀 Ready for deployment');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Tests failed or performance thresholds exceeded');
    if (code !== 0) console.log(`   - Exit code: ${code}`);
    if (testResults.failed > 0) console.log(`   - Failed tests: ${testResults.failed}`);
    if (!allThresholdsPassed) console.log('   - Performance thresholds exceeded');
    process.exit(1);
  }
});

testProcess.on('error', (error) => {
  console.error('❌ Error running tests:', error.message);
  process.exit(1);
});

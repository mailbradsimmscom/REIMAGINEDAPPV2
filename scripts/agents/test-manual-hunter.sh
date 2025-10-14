#!/bin/bash

# Test Manual Hunter Agent on 3 systems

echo "🧪 Testing Manual Hunter Agent (3 systems)"
echo ""

# Create test CSV with just 3 systems
TEST_CSV="scripts/agents/systems-needing-manuals-test.csv"

# Extract header + first 3 data rows
head -4 scripts/agents/systems-needing-manuals.csv > "$TEST_CSV"

echo "✅ Created test CSV: $TEST_CSV"
cat "$TEST_CSV"
echo ""

# Update config to use test CSV
echo "📝 Updating config for test run..."

# Run agent with test CSV
NODE_ENV=test LOG_LEVEL=debug node -e "
import ManualHunter from './scripts/agents/manual-hunter.js';
import { config } from './scripts/agents/manual-hunter-config.js';

// Override config for test
config.paths.input = 'scripts/agents/systems-needing-manuals-test.csv';
config.maxPdfs = 3;
config.batchSize = 1; // Process one at a time for debugging

const agent = new ManualHunter();
agent.run();
"

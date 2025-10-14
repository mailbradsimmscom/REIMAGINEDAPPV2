#!/bin/bash

# Test validator on 3 PDFs

echo "🧪 Testing Manual Validator (3 PDFs)"

# Create temp directory with just 3 PDFs
TEST_DIR="scripts/agents/manual-hunter-results/pdfs-test"
mkdir -p "$TEST_DIR"

# Copy first 3 PDFs
ls scripts/agents/manual-hunter-results/pdfs/*.pdf | head -3 | while read pdf; do
  cp "$pdf" "$TEST_DIR/"
done

echo "Copied 3 PDFs to test directory"
ls -lh "$TEST_DIR"

# Temporarily override PDF path in validator
export TEST_MODE_VALIDATOR=true

# Run validator
TEST_MODE=true node scripts/agents/manual-validator.js

# Cleanup
rm -rf "$TEST_DIR"

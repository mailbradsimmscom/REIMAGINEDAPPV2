#!/bin/bash
set -e

# Load API credentials
source .structurizr.env

# Push latest workspace.json to Structurizr Cloud
structurizr-cli push \
  --workspace structurizr/workspace.json \
  --workspaceId $STRUCTURIZR_ID \
  --apiKey $STRUCTURIZR_KEY \
  --apiSecret $STRUCTURIZR_SECRET

echo "✅ Structurizr model pushed successfully!"

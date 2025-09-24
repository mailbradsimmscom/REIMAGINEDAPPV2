#!/bin/bash

# Find all MDX files, strip `docs/` prefix and `.mdx` suffix
pages=$(find docs/auto/code -name '*.mdx' \
  | sed 's#^docs/##; s#\.mdx$##' \
  | jq -R . \
  | jq -s .)

# Generate JSON
jq -n --argjson pages "$pages" '{
  "$schema": "https://mintlify.com/schema.json",
  "name": "REIMAGINEDAPPV2",
  "theme": "mint",
  "favicon": "favicon.svg",
  "colors": { "primary": "#2563eb" },
  "navigation": {
    "languages": [
      {
        "language": "en",
        "versions": [
          {
            "version": "v1",
            "tabs": [
              {
                "tab": "Documentation",
                "groups": [
                  {
                    "group": "Overview",
                    "pages": $pages
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}' > docs/docs.json

echo "✅ docs/docs.json generated"

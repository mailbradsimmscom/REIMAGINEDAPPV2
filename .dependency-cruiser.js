/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  "forbidden": [
    {
      "name": "no-circular",
      "severity": "error",
      "comment": "This dependency creates a circular dependency",
      "from": {},
      "to": {
        "circular": true
      }
    },
    {
      "name": "no-orphans",
      "severity": "warn",
      "comment": "This module is not used anywhere",
      "from": {
        "orphan": true,
        "pathNot": "\\.d\\.ts$"
      },
      "to": {}
    }
  ],
  "allowed": [
    {
      "from": {
        "path": "^src/routes"
      },
      "to": {
        "path": "^src/services"
      }
    },
    {
      "from": {
        "path": "^src/services"
      },
      "to": {
        "path": "^src/repositories"
      }
    }
  ],
  "allowedSeverity": "warn",
  "options": {
    "doNotFollow": {
      "path": "node_modules",
      "dependencyTypes": [
        "npm-no-pkg",
        "npm-unknown"
      ]
    },
    "includeOnly": "^src",
    "exclude": {
      "path": "tests",
      "path": "docs"
    },
    "moduleSystems": ["es6"],
    "tsPreCompilationDeps": false,
    "enhancedResolveOptions": {
      "exportsFields": ["exports"],
      "conditionNames": ["import", "require", "node", "default"]
    },
    "reporterOptions": {
      "dot": {
        "collapsePattern": "node_modules/[^/]+"
      }
    }
  }
};

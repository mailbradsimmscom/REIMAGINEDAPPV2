/**
 * Generate Node.js Backend Architecture Model
 * Scans src/ directory and creates detailed Structurizr model
 */
import fs from 'fs';
import path from 'path';

const SRC_DIR = 'src';
const STRUCTURIZR_DIR = 'structurizr';

fs.mkdirSync(STRUCTURIZR_DIR, { recursive: true });

let nextId = 1;

// Scan directory structure
function scanDirectory(baseDir) {
  const routes = [];
  const services = [];
  const repositories = [];
  const middleware = [];
  const utils = [];
  const models = [];

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(SRC_DIR, fullPath);
      
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.js')) {
        const id = `node-${relativePath.replace(/[^a-zA-Z0-9]/g, '-')}`;
        // Use relative path as name to ensure uniqueness
        const displayName = relativePath.replace('.js', '').replace(/\\/g, '/');
        const component = {
          id,
          name: displayName,
          description: `${relativePath}`,
          technology: 'JavaScript/Node.js',
          tags: ''
        };

        // Categorize by path
        if (relativePath.includes('routes/')) {
          component.tags = 'Route';
          routes.push(component);
        } else if (relativePath.includes('services/')) {
          component.tags = 'Service';
          services.push(component);
        } else if (relativePath.includes('repositories/')) {
          component.tags = 'Repository';
          repositories.push(component);
        } else if (relativePath.includes('middleware/')) {
          component.tags = 'Middleware';
          middleware.push(component);
        } else if (relativePath.includes('models/') || relativePath.includes('schemas/')) {
          component.tags = 'Model';
          models.push(component);
        } else {
          component.tags = 'Utility';
          utils.push(component);
        }
      }
    }
  }

  scan(baseDir);
  return { routes, services, repositories, middleware, models, utils };
}

// Build the model
const components = scanDirectory(SRC_DIR);
const allComponents = [
  ...components.routes,
  ...components.services,
  ...components.repositories,
  ...components.middleware,
  ...components.models,
  ...components.utils
];

console.log(`📊 Scanned Node.js codebase:`);
console.log(`   - Routes: ${components.routes.length}`);
console.log(`   - Services: ${components.services.length}`);
console.log(`   - Repositories: ${components.repositories.length}`);
console.log(`   - Middleware: ${components.middleware.length}`);
console.log(`   - Models: ${components.models.length}`);
console.log(`   - Utils: ${components.utils.length}`);
console.log(`   📦 Total: ${allComponents.length} components`);

// Create containers for logical grouping
const containers = [
  {
    id: 'webapp-routes',
    name: 'API Routes Layer',
    description: 'Express route handlers and HTTP endpoints',
    technology: 'Express.js',
    tags: 'Container,Routes',
    components: components.routes
  },
  {
    id: 'webapp-services',
    name: 'Business Logic Layer',
    description: 'Core business services and orchestration',
    technology: 'JavaScript Services',
    tags: 'Container,Services',
    components: components.services
  },
  {
    id: 'webapp-repositories',
    name: 'Data Access Layer',
    description: 'Repository pattern for database operations',
    technology: 'Data Access Layer',
    tags: 'Container,Repositories',
    components: components.repositories
  },
  {
    id: 'webapp-middleware',
    name: 'Middleware Stack',
    description: 'Authentication, validation, logging, security',
    technology: 'Express Middleware',
    tags: 'Container,Middleware',
    components: components.middleware
  },
  {
    id: 'webapp-models',
    name: 'Data Models & Schemas',
    description: 'Zod schemas and data models',
    technology: 'Zod/JavaScript',
    tags: 'Container,Models',
    components: components.models
  }
];

// Build the software system
const nodeSystem = {
  id: 'reimaginedapp',
  name: 'REIMAGINEDAPPV2 Backend',
  description: 'Node.js Express backend with layered architecture',
  location: 'Internal',
  tags: 'SoftwareSystem,Backend',
  containers
};

// Create the workspace fragment
const workspace = {
  workspace: {
    name: 'REIMAGINEDAPPV2 - Node.js Backend',
    description: 'Auto-generated from src/ directory',
    model: {
      softwareSystems: [nodeSystem]
    }
  }
};

// Write the node.json file
const outputPath = path.join(STRUCTURIZR_DIR, 'node.json');
fs.writeFileSync(outputPath, JSON.stringify(workspace, null, 2));

console.log(`✅ Generated Node.js model`);
console.log(`📁 Output: ${outputPath}`);
console.log(`📊 ${containers.length} containers with ${allComponents.length} components total`);

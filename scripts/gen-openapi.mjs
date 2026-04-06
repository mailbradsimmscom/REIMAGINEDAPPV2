/**
 * Generate a basic OpenAPI 3.0 spec from Express routes
 * Output: docs/auto/openapi.json
 */

import { writeFileSync } from 'node:fs';
import listEndpoints from 'express-list-endpoints';
import app from '../src/index.js';

const endpoints = listEndpoints(app).sort((a, b) =>
  a.path.localeCompare(b.path)
);

const paths = {};

for (const endpoint of endpoints) {
  const path = endpoint.path.replace(/:(\w+)/g, '{$1}');
  if (!paths[path]) paths[path] = {};

  for (const method of endpoint.methods) {
    paths[path][method.toLowerCase()] = {
      summary: `${method} ${endpoint.path}`,
      responses: {
        200: { description: 'Success' }
      },
      ...(endpoint.middlewares?.length > 0 && {
        'x-middlewares': endpoint.middlewares
      })
    };
  }
}

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'BoatOS API',
    version: '1.0.0',
    description: 'Auto-generated API specification for BoatOS'
  },
  paths
};

writeFileSync('docs/auto/openapi.json', JSON.stringify(spec, null, 2));
console.log(`Wrote docs/auto/openapi.json (${Object.keys(paths).length} paths)`);

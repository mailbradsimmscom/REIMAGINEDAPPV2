// src/debug/routes.js
import path from 'node:path';
import { ENV } from '../config/env.js';

/**
 * Extract routes from Express app (Express 4 & 5 compatible)
 * Uses the same approach as printRoutes.js for consistency
 * @param {Express} app - Express application
 * @returns {Array} Array of route objects
 */
function getRoutes(app) {
  const routes = [];
  
  // Express 5 uses app.router.stack (we found 52 items there)
  // Express 4 uses app._router.stack
  // Check both locations, but prioritize router.stack for Express 5
  const stack = app.router?.stack ?? app._router?.stack ?? app.stack ?? [];
  
  function collectRoutes(layerStack, base = '') {
    for (const layer of layerStack) {
      if (layer?.route?.path) {
        // Direct route
        const methods = Object.keys(layer.route.methods)
          .filter(Boolean)
          .map(m => m.toUpperCase())
          .sort();
        // Handle root path specially: /base + / should be /base, not /base/
        const routePath = layer.route.path === '/' ? '' : layer.route.path;
        const fullPath = path.posix.join(base || '/', routePath) || '/';
        routes.push({
          path: fullPath,
          methods,
          middleware: layer.route.stack?.length || 0
        });
      } else if (layer?.name === 'router' && layer?.handle?.stack) {
        // Mounted router - Express 5 doesn't expose mount path on layer
        // Use our custom _mountPath property set by safeMount() in index.js
        // Fall back to layer.path for Express 4 compatibility
        const prefix = layer.handle._mountPath ?? layer.path ?? '';

        const newBase = path.posix.join(base || '/', prefix || '');
        collectRoutes(layer.handle.stack, newBase);
      }
    }
  }
  
  collectRoutes(stack);
  return routes;
}

export function attachRouteDebugger(app) {
  // Enable in development OR when explicitly enabled via ENABLE_ROUTE_DEBUG=1
  // Use process.env directly to avoid cached ENV.NODE_ENV issue
  const enableRoutes = process.env.NODE_ENV === 'development' || 
                       process.env.NODE_ENV === 'test' || 
                       process.env.ENABLE_ROUTE_DEBUG === '1';
  
  if (!enableRoutes) return;

  app.get('/__routes', (_req, res) => {
    const routes = getRoutes(app);
    res.json({ 
      success: true, 
      data: { routes }
    });
  });
}

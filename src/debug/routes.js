// src/debug/routes.js
import listEndpoints from 'express-list-endpoints';
import { ENV } from '../config/env.js';

export function attachRouteDebugger(app) {
  // Enable in development OR when explicitly enabled via ENABLE_ROUTE_DEBUG=1
  const enableRoutes = ENV.NODE_ENV === 'development' || 
                       ENV.NODE_ENV === 'test' || 
                       process.env.ENABLE_ROUTE_DEBUG === '1';
  
  if (!enableRoutes) return;

  app.get('/__routes', (_req, res) => {
    const routes = listEndpoints(app);
    res.json({ 
      success: true, 
      data: { 
        routes: routes.map(r => ({
          path: r.path,
          methods: r.methods,
          middleware: r.middlewares?.length || 0
        }))
      } 
    });
  });
}

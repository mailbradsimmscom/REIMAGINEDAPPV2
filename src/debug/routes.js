// src/debug/routes.js
import listEndpoints from 'express-list-endpoints';
import { ENV } from '../config/env.js';

export function attachRouteDebugger(app) {
  if (ENV.NODE_ENV === 'production') return;
  
  app.get('/__routes', (_req, res) => {
    const routes = listEndpoints(app);
    res.json(routes);
  });
}

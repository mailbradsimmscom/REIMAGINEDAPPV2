// src/debug/routes.js
import listEndpoints from 'express-list-endpoints';

export function attachRouteDebugger(app) {
  if (process.env.NODE_ENV === 'production') return;
  
  app.get('/__routes', (_req, res) => {
    const routes = listEndpoints(app);
    res.json(routes);
  });
}

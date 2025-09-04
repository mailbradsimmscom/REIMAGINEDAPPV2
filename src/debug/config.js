import { ENV } from '../config/env.js';

export function attachConfigInspector(app) {
  if (ENV.NODE_ENV === 'production') return;
  
  app.get('/__config', (_req, res) => {
    res.json({
      features: {
        adminEnabled: !!ENV.ADMIN_TOKEN,
        supabaseEnabled: !!(ENV.SUPABASE_URL && (ENV.SUPABASE_SERVICE_KEY || ENV.SUPABASE_SERVICE_ROLE || ENV.SERVICE_ROLE_KEY)),
        pineconeEnabled: !!(ENV.PYTHON_SIDECAR_URL),
      },
      namespace: ENV.PINECONE_NAMESPACE || ENV.DEFAULT_NAMESPACE || null,
      appVersion: ENV.APP_VERSION || 'unknown',
    });
  });
}

import { getEnv } from '../config/env.js';

export function attachConfigInspector(app) {
  if (process.env.NODE_ENV === 'production') return;
  
  app.get('/__config', (_req, res) => {
    const env = getEnv({ loose: true });
    res.json({
      features: {
        adminEnabled: !!env.ADMIN_TOKEN,
        supabaseEnabled: !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY)),
        pineconeEnabled: !!(env.PYTHON_SIDECAR_URL),
      },
      namespace: env.PINECONE_NAMESPACE || env.DEFAULT_NAMESPACE || null,
      appVersion: env.APP_VERSION || 'unknown',
    });
  });
}

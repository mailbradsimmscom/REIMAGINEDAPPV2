import { env } from '../config/env.js';

function mask(value) {
  if (!value) return null;
  const len = value.length;
  const head = value.slice(0, 6);
  const tail = value.slice(-4);
  return `${head}...${tail} (len:${len})`;
}

export function debugEnvRoute(_req, res) {
  // Development-only route
  if (process.env.NODE_ENV === 'production') {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  const payload = {
    supabaseUrlPrefix: env.supabaseUrl?.slice(0, 20) ?? null,
    supabaseKeyMasked: mask(env.supabaseServiceKey)
  };
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default debugEnvRoute;

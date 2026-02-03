/**
 * Admin auth helper (simplest viable)
 *
 * - No hardcoded tokens in repo
 * - PIN unlock once per browser (localStorage)
 * - All admin pages use adminFetch()
 */

const AUTH_STORAGE_KEY = 'adminToken';
const AUTH_ENDPOINT = '/api/auth/pin';

export function getAdminToken() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

export function clearAdminToken() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function requestTokenFromPin(pin) {
  const response = await fetch(AUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

  let data;
  try {
    data = await response.json();
  } catch (e) {
    // If the server returns non-JSON (e.g., HTML error page), surface a clean message.
    throw new Error(`Auth endpoint returned non-JSON response (HTTP ${response.status})`);
  }

  // Response shape per src/app.js:228-231: { success: true, token }
  const token = data?.token || '';

  if (data?.success && token) {
    localStorage.setItem(AUTH_STORAGE_KEY, token);
    return token;
  }

  throw new Error(data?.error || data?.message || 'Invalid PIN');
}

/**
 * Ensure admin token exists (PIN prompt if needed)
 * Returns token string or throws if user cancels.
 */
export async function ensureAdminToken() {
  let token = getAdminToken();
  if (token) return token;

  while (true) {
    const pin = window.prompt('Enter Admin PIN');
    if (pin == null) throw new Error('PIN entry cancelled');
    const trimmed = String(pin).trim();
    if (!trimmed) continue;

    try {
      token = await requestTokenFromPin(trimmed);
      return token;
    } catch (e) {
      // Keep UX simple: just alert and re-prompt
      window.alert(e?.message || 'Invalid PIN');
    }
  }
}

/**
 * Fetch wrapper that always includes x-admin-token.
 * If token is invalid (401/403), clears it and re-prompts once.
 */
export async function adminFetch(url, options = {}) {
  const token = await ensureAdminToken();

  const headers = {
    ...(options.headers || {}),
    'x-admin-token': token,
  };

  // Don't set Content-Type for FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const resp = await fetch(url, { ...options, headers });

  if (resp.status === 401 || resp.status === 403) {
    // Token rotated/expired/invalid → clear and retry once
    clearAdminToken();
    const retryToken = await ensureAdminToken();
    const retryHeaders = { ...headers, 'x-admin-token': retryToken };
    return fetch(url, { ...options, headers: retryHeaders });
  }

  return resp;
}

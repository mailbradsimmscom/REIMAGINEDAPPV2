# Admin Token PIN Authentication Migration

**Created:** 2026-02-03
**Status:** Planning
**Priority:** High (Security)

---

## Executive Summary

Replace all hardcoded `ADMIN_TOKEN` values in frontend files with the existing PIN-based authentication flow. This eliminates credential exposure in git while maintaining the same user experience.

---

## Current State (Problem)

### Hardcoded Token
The admin token `d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0` is hardcoded in **17 frontend files**, exposing it in git history.

### Affected Files

#### HTML Files (15)
| File | Occurrences | Priority |
|------|-------------|----------|
| `src/public/document-ingest.html` | 6 | High |
| `src/public/upload.html` | 6 | High |
| `src/public/documents.html` | 3 | High |
| `src/public/onboarding.html` | 3 | High |
| `src/public/testing-golden-tests.html` | 3 | Medium |
| `src/public/testing-specifications.html` | 3 | Medium |
| `src/public/testing-intent-router.html` | 3 | Medium |
| `src/public/testing-playbook.html` | 3 | Medium |
| `src/public/testing.html` | 1 | Medium |
| `src/public/pinecone-admin.html` | 1 | Medium |
| `src/public/dashboard.html` | 1 | Medium |
| `src/public/test-results.html` | 1 | Low |
| `src/public/logs-viewer.html` | 1 | Low |
| `src/public/deprecated-testing-progress.html` | 1 | Low (deprecated) |
| `src/public/deprecated-simple-playbooks.html` | 1 | Low (deprecated) |

#### JavaScript Files (1)
| File | Occurrences | Priority |
|------|-------------|----------|
| `src/public/js/admin/boot.js` | 1 | High |

#### Other (can be scrubbed or ignored)
| File | Action |
|------|--------|
| `docs/auto/code/boot.mdx` | Scrub (auto-generated) |
| `deprecated/src-old/public/admin_old.html` | Ignore (deprecated) |
| `scripts/test-step8-complete.js` | Review (test script) |
| `code updates/*.md` | Already scrubbed |

---

## Target State (Solution)

### Existing PIN Authentication Flow

The infrastructure already exists in `src/app.js:208-232`:

```javascript
// POST /api/auth/pin
// 1. User submits simple PIN (e.g., "1234")
// 2. Server validates against ADMIN_PIN in .env
// 3. If valid, returns ADMIN_TOKEN
// 4. Frontend stores token in localStorage
```

### Reference implementation (optional modal)

`src/public/anchor-watch-admin.html` already implements PIN auth using a styled modal. This is a good **optional** UX upgrade, but the v1 migration plan intentionally uses a **native prompt()** flow to keep implementation minimal while still removing hardcoded tokens.

```javascript
// Check for existing token
let ADMIN_TOKEN = localStorage.getItem('adminToken') || '';

// If no token, show login modal
if (!ADMIN_TOKEN) {
    showLoginModal();
}

// PIN submission handler
async function handlePinSubmit(pin) {
    const response = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
    });

    const data = await response.json();

    if (data.success) {
        localStorage.setItem('adminToken', data.token);
        ADMIN_TOKEN = data.token;
        hideLoginAndStart();
    } else {
        showError('Invalid PIN');
    }
}
```

### User Experience

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  FIRST VISIT                                                │
│  ───────────                                                │
│  1. User navigates to admin page                            │
│  2. Page checks localStorage → no token                     │
│  3. PIN prompt appears: "Enter Admin PIN"                   │
│  4. User enters PIN (e.g., "1234")                          │
│  5. Server validates → returns token                        │
│  6. Token stored in localStorage                            │
│  7. Admin page loads                                        │
│                                                             │
│  SUBSEQUENT VISITS                                          │
│  ─────────────────                                          │
│  1. User navigates to admin page                            │
│  2. Page checks localStorage → token exists                 │
│  3. Admin page loads immediately (no PIN prompt)            │
│                                                             │
│  TOKEN EXPIRY / LOGOUT                                      │
│  ─────────────────────                                      │
│  - Clear localStorage.removeItem('adminToken')              │
│  - Next visit will prompt for PIN again                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1 (Simplified): Single shared auth helper (no modal)

Goal: **PIN once → everything works**. Keep this dead simple:
- Store token in `localStorage`
- Any admin API call automatically ensures a token exists
- If token is missing/invalid, prompt for PIN again

**File:** `src/public/js/admin/auth.js`

```javascript
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

  // Don’t set Content-Type for FormData
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
```

Optional upgrade later (not required for v1): replace `prompt()/alert()` with a styled modal like `anchor-watch-admin.html`.

### Phase 2: Migrate pages to remove hardcoded tokens

For each page:
- Remove any `const ADMIN_TOKEN = '...'` (hardcoded)
- Replace any inline `fetch(..., { headers: { 'x-admin-token': '...' }})` with `adminFetch(...)`

Pattern A: pages using `boot.js`
- Minimal: update `boot.js` to import and attach `window.adminFetch = adminFetch` (no modal logic required).

Pattern B: standalone pages

```html
<script type="module">
  import { adminFetch } from '/public/js/admin/auth.js';
  // ... page code uses adminFetch instead of fetch for admin APIs ...
</script>
```

### Phase 3: Cleanup

- Verify no remaining hardcoded tokens via ripgrep (preferred):
  - `rg "d0bf5af4" src/`

---

## Migration Checklist

### Phase 1: Foundation
- [ ] Create `src/public/js/admin/auth.js`
- [ ] Test auth module with existing `/api/auth/pin` endpoint
- [ ] Verify `ADMIN_PIN` is set in `.env`

### Phase 2: Core Files
- [ ] Update `src/public/js/admin/boot.js` (optional) to expose `window.adminFetch`

### Phase 3: High Priority Pages
- [ ] `src/public/document-ingest.html`
- [ ] `src/public/upload.html`
- [ ] `src/public/documents.html`
- [ ] `src/public/onboarding.html`

### Phase 4: Medium Priority Pages
- [ ] `src/public/testing-golden-tests.html`
- [ ] `src/public/testing-specifications.html`
- [ ] `src/public/testing-intent-router.html`
- [ ] `src/public/testing-playbook.html`
- [ ] `src/public/testing.html`
- [ ] `src/public/pinecone-admin.html`
- [ ] `src/public/dashboard.html`

### Phase 5: Low Priority Pages
- [ ] `src/public/test-results.html`
- [ ] `src/public/logs-viewer.html`
- [ ] `src/public/deprecated-testing-progress.html` (or delete)
- [ ] `src/public/deprecated-simple-playbooks.html` (or delete)

### Phase 6: Cleanup
- [ ] Remove hardcoded token from `docs/auto/code/boot.mdx`
- [ ] Review `scripts/test-step8-complete.js`
- [ ] Verify no remaining hardcoded tokens: `rg "d0bf5af4" src/`
- [ ] Update any related documentation

---

## Testing Plan

### Unit Tests
1. `auth.js` - Token storage/retrieval
2. `auth.js` - PIN authentication success/failure
3. `auth.js` - ensureAdminToken() prompt loop + cancel behavior (mock window.prompt)
4. `auth.js` - adminFetch() retries once on 401/403 (mock fetch)

### Integration Tests
1. Fresh browser (no localStorage) → PIN prompt appears
2. Valid PIN → token stored, page loads
3. Invalid PIN → error shown, can retry
4. Page refresh after login → no PIN prompt
5. Clear localStorage → PIN prompt appears again
6. All admin API calls include correct token header

### Manual Testing
1. Test each migrated page in fresh incognito window
2. Test invalid token behavior: rotate token server-side → first call prompts for PIN again
3. Test on mobile browsers (prompt behavior)

---

## Rollback Plan

If issues arise:
1. Revert to previous commit
2. Hardcoded tokens will work again immediately
3. No data migration required

---

## Security Notes

### After Migration
- Rotate `ADMIN_TOKEN` in `.env` (old one is in git history)
- Consider rotating `ADMIN_PIN` as well
- Token is only stored in:
  - Server `.env` file (not in git)
  - User's browser localStorage (per-device)

### Git History
The old hardcoded token remains in git history. Options:
1. **Accept risk** - Token will be rotated anyway
2. **Rewrite history** - `git filter-branch` (disruptive)
3. **New repo** - Fresh start (very disruptive)

Recommendation: Rotate token after migration, accept history risk.

---

## Estimated Effort

| Phase | Files | Effort |
|-------|-------|--------|
| Phase 1: Foundation | 1 new file | 30-60 min |
| Phase 2: Core (optional) | 1 file | 15-30 min |
| Phase 3: High Priority | 4 files | 45-90 min |
| Phase 4: Medium Priority | 7 files | 60-120 min |
| Phase 5: Low Priority | 4 files | 30-60 min |
| Phase 6: Cleanup | misc | 30 min |
| Testing | all | 45-90 min |
| **Total** | | **4-6 hours** |

---

## References

- Existing PIN auth endpoint: `src/app.js:208-232`
- Reference implementation: `src/public/anchor-watch-admin.html:1952-1984`
- Current boot.js: `src/public/js/admin/boot.js`
- Environment config: `src/config/env.js:30` (`ADMIN_PIN`)

# Mobile Navigation & Chat

## Overview

Mobile-optimized pages provide an iOS-native experience for on-boat use. A shared hamburger menu component provides consistent navigation across all mobile pages. Three dedicated mobile pages handle chat and the home dashboard.

**Design System:** iOS native (SF Pro Display, -apple-system, safe-area-inset, 100dvh)
**Target:** iPhone Safari, PWA capable (apple-mobile-web-app-capable)

---

## Mobile Pages

### unified-mobile.html (Home Dashboard)

**Access:** `/public/unified-mobile.html`
**Purpose:** Primary landing page for mobile. Quick-action grid linking to all features.

```
+-------------------------------------------+
|  BoatOS Mobile                            |
|  (subtitle from GPS or default)           |
+-------------------------------------------+
|                                           |
|  Quick Actions (2x2 grid):               |
|  [Current Status] [Power System]         |
|  [AIS Tracking]   [Position Monitor]     |
|                                           |
|  [────── Anchor Alarm ──────]            |
|                                           |
|  Navigation:                              |
|  [Trips]  [Anchorages]  [Season Recap]   |
|                                           |
|  [Chat button at bottom]                  |
+-------------------------------------------+
```

### index-mobile.html (Chat Entry)

**Access:** `/public/index-mobile.html`
**Purpose:** Mobile chat home/entry page. Links shared chat-styles.css. Minimal overrides for mobile viewport.

### chat-mobile.html (Chat Interface)

**Access:** `/public/chat-mobile.html`
**Purpose:** Full chat interface optimized for mobile.

**Key features:**
- Translucent header with backdrop-filter blur (iOS style)
- Stats panel hidden on mobile (`display: none !important`)
- `100dvh` dynamic viewport height (accounts for iOS toolbar)
- `overscroll-behavior: none` prevents pull-to-refresh
- PWA manifest at `/public/manifest-chat.json`
- `apple-mobile-web-app-status-bar-style: black-translucent`
- Message threading with scroll management

---

## Hamburger Menu Component

**File:** `src/public/js/mobile-hamburger.js` (277 lines)
**Usage:** Add `<script src="/public/js/mobile-hamburger.js"></script>` before `</body>`

### How It Works

1. Self-initializing IIFE with guard (`window.__hamburgerMenuInitialized`)
2. Injects CSS styles into `<head>`
3. Creates: hamburger button (fixed top-left), backdrop overlay, slide-out menu panel
4. Hides existing back buttons on the page (hamburger replaces them)
5. Escape key closes menu

### Menu Structure

```
Home

BOAT STATUS
  Current Status    → /public/boat-now.html
  Power System      → /public/victron-mobile.html
  AIS Tracking      → /public/ais.html
  Position Monitor  → /public/position-monitor.html

NAVIGATION & TRIPS
  Anchor Watch      → /public/anchor-watch-admin.html
  Anchorages        → /public/anchorages.html
  Trip Log          → /public/trips.html
  Season Recap      → /public/season-recap.html

WEATHER
  Weather Areas     → /public/weather-areas.html
  Add Location      → /public/weather-area-add.html

BOAT MANAGEMENT
  Supplies          → /public/supplies.html
  Maintenance       → {maintenance-url}/app-mobile.html
  Tasks             → {maintenance-url}/tasks-mobile.html

─────────────────
  Chat              → /public/index-mobile.html
```

### Multi-Environment URL Detection

The maintenance service runs on a separate port/host. The hamburger menu auto-detects the environment:

| Hostname | Maintenance URL |
|----------|----------------|
| `chat.catamaranos.com` | `https://admin.catamaranos.com` |
| `boatos-main.onrender.com` | `https://boatos-maintenance.onrender.com` |
| `localhost` | `http://localhost:3001` |
| IP address (e.g., `192.168.20.106`) | `{protocol}//{ip}:3001` |

### Active State Detection

Each menu item has a `match` array of URL substrings. The component checks `window.location.pathname` against these to highlight the current page:

```javascript
// Example: AIS page matches 'ais.html' in pathname
{ label: 'AIS Tracking', href: '/public/ais.html', match: ['ais.html'] }
```

### CSS Injection

The component injects these key styles:
- **Hamburger button:** Fixed position, z-index 200, safe-area-inset padding
- **Backdrop:** Fixed overlay, z-index 250, 40% opacity black
- **Menu panel:** Fixed left, 270px wide, z-index 300, slide-in with cubic-bezier
- **Body padding:** Forces `padding-top: calc(48px + env(safe-area-inset-top))` so content doesn't overlap the button

### Pages Using Hamburger Menu

All mobile-facing pages include the hamburger script:
- ais.html, anchor-watch-admin.html, anchorages.html
- boat-now.html, position-monitor.html, victron-mobile.html
- trips.html, trip-detail.html, trip-edit.html
- season-recap.html, supplies.html
- weather-areas.html, weather-area-add.html, weather-area-view.html
- index-mobile.html, chat-mobile.html, unified-mobile.html
- maintenance-review.html, maintenance-tasks-list.html

---

## iOS Design Patterns Used

| Pattern | Implementation |
|---------|---------------|
| Safe area insets | `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)` |
| Dynamic viewport | `100dvh` instead of `100vh` |
| Overscroll prevention | `overscroll-behavior: none` |
| Font stack | `-apple-system, BlinkMacSystemFont, 'SF Pro Display'` |
| Tap highlighting | `-webkit-tap-highlight-color: transparent` |
| Smooth scrolling | `-webkit-overflow-scrolling: touch` |
| Color palette | iOS system colors (#007AFF blue, #34C759 green, #FF3B30 red, #8E8E93 gray, #F2F2F7 background) |
| PWA meta tags | `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` |
| Translucent header | `backdrop-filter: blur(20px)` with semi-transparent background |
| Touch targets | Minimum 44px for interactive elements |

---

## Files & Locations

| Purpose | Path |
|---------|------|
| Home dashboard | `src/public/unified-mobile.html` |
| Chat entry page | `src/public/index-mobile.html` |
| Chat interface | `src/public/chat-mobile.html` |
| Chat styles (shared) | `src/public/chat-styles.css` |
| Chat PWA manifest | `src/public/manifest-chat.json` |
| Hamburger menu component | `src/public/js/mobile-hamburger.js` |
| Mobile nav helper | `src/public/js/mobile-nav.js` |

---

## Related Docs

- [Chat](./chat.md) - Chat architecture and API details
- [Anchor Alarm](./anchor-alarm.md) - Anchor watch and position monitor
- [AIS](./ais.md) - AIS vessel tracking

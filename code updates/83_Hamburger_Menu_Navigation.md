# Hamburger Menu Navigation

**Created:** 2026-02-04
**Status:** In Progress (Phase 1 complete, testing)
**Priority:** Medium (UX)

---

## Summary

Add a shared hamburger menu (top-left) to all mobile/public pages, replacing existing ← back arrows. Provides grouped navigation to the full page tree. Complements the existing bottom nav which handles core quick-access items.

---

## Progress

### Completed
- [x] Created `src/public/js/mobile-hamburger.js` (self-injecting IIFE)
- [x] Menu structure: 5 groups, 14 items
- [x] Slide-out animation, backdrop, Escape key close
- [x] Auto-hides existing back buttons (`.back-button`, `.back-btn`)
- [x] Active page highlighting
- [x] Safe-area aware (iPhone notch/home indicator)
- [x] Cross-service maintenance URL detection
- [x] Test page wired: `weather-areas.html`

### Remaining
- [ ] Test hamburger on production (weather-areas.html deployed)
- [ ] Fix any CSS/positioning issues from testing
- [ ] Add `<script src="/public/js/mobile-hamburger.js"></script>` to remaining 18 mobile pages
- [ ] Verify back-button hiding works on all 11 pages with ← arrows
- [ ] Test on iOS Safari, Chrome
- [ ] Update design doc with any changes from testing

---

## Architecture

```
┌─ ☰ ──────────── Page Title ──┐
│                               │
│         Page Content          │     ☰ replaces ← back arrow
│                               │
├───────────────────────────────┤
│  🏠  ⚓  🔌  🔧  💬          │     Bottom nav (unchanged)
└───────────────────────────────┘
```

Tapping ☰ opens slide-out menu:

```
┌───────────────────┬───────────┐
│                   │           │
│  🏠 Home          │  (dimmed  │
│                   │  page     │
│  BOAT STATUS      │  behind)  │
│  ├ Current Status │           │
│  ├ Power System   │           │
│  ├ AIS Tracking   │           │
│  └ Position       │           │
│                   │           │
│  NAVIGATION & TRIPS│          │
│  ├ Anchor Watch   │           │
│  ├ Anchorages     │           │
│  ├ Trip Log       │           │
│  └ Season Recap   │           │
│                   │           │
│  WEATHER          │           │
│  ├ Weather Areas  │           │
│  └ Add Location   │           │
│                   │           │
│  BOAT MANAGEMENT  │           │
│  ├ Supplies       │           │
│  ├ Maintenance    │           │
│  └ Tasks          │           │
│                   │           │
│  💬 Chat          │           │
│                   │           │
└───────────────────┘           │
```

---

## Full Page Tree

```
🏠 Home                          → unified-mobile.html

BOAT STATUS
├── Current Status                → boat-now.html
├── Power System                  → victron-mobile.html
├── AIS Tracking                  → ais.html
└── Position Monitor              → position-monitor.html

NAVIGATION & TRIPS
├── Anchor Watch                  → anchor-watch-admin.html
├── Anchorages & Moorings         → anchorages.html
├── Trip Log                      → trips.html
└── Season Recap                  → season-recap.html

WEATHER
├── Weather Areas                 → weather-areas.html
└── Add Location                  → weather-area-add.html

BOAT MANAGEMENT
├── Supplies                      → supplies.html
├── Maintenance Review            → maintenance-review.html
└── Maintenance Tasks             → maintenance-tasks-list.html

💬 Chat                           → index-mobile.html
```

**Pages NOT in menu** (intentional):
- `weather-area-view.html` - Accessed via Weather Areas (detail page)
- `trip-detail.html` - Accessed via Trip Log (detail page)
- `index.html` - Desktop chat (redirects to mobile)
- `chat-mobile.html` - Alternate chat view
- `landing.html` - Marketing page
- `funnel.html` - Pipeline page
- `other-links.html` - Misc links (candidate to include or remove)

---

## Files Created/Modified

### New Files
- `src/public/js/mobile-hamburger.js` - Hamburger menu component (~210 lines)

### Modified Files
- `src/public/weather-areas.html` - Added hamburger script (test page)

### Files to Modify (remaining rollout)
All 18 remaining mobile pages need this line added before `</body>`:
```html
<script src="/public/js/mobile-hamburger.js"></script>
```

Pages:
- `src/public/unified-mobile.html`
- `src/public/boat-now.html`
- `src/public/victron-mobile.html`
- `src/public/ais.html`
- `src/public/position-monitor.html`
- `src/public/anchor-watch-admin.html`
- `src/public/anchorages.html`
- `src/public/trips.html`
- `src/public/trip-detail.html`
- `src/public/season-recap.html`
- `src/public/weather-area-view.html`
- `src/public/weather-area-add.html`
- `src/public/supplies.html`
- `src/public/maintenance-review.html`
- `src/public/maintenance-tasks-list.html`
- `src/public/index-mobile.html`
- `src/public/chat-mobile.html`
- `src/public/other-links.html`

---

## Back Arrow Replacement

The hamburger replaces existing ← back buttons. `mobile-hamburger.js` auto-hides them on init.

| Page | Back Arrow | Was Linking To |
|------|-----------|----------------|
| `boat-now.html` | `←` (.back-button) | unified-mobile.html |
| `supplies.html` | `←` (.back-btn) | unified-mobile.html |
| `trips.html` | `‹` (.back-button) | unified-mobile.html |
| `trip-detail.html` | `‹` (.back-button) | /trips |
| `season-recap.html` | `←` (.back-button) | other-links.html |
| `weather-area-view.html` | `‹` (.back-btn) | weather-areas.html |
| `anchorages.html` | `←` (.back-button) | unified-mobile.html |
| `ais.html` | `←` (.back-button) | unified-mobile.html |
| `other-links.html` | `←` (.back-button) | unified-mobile.html |
| `chat-mobile.html` | `‹ Back` (button) | history.back() |
| `position-monitor.html` | TBD | TBD |

---

## Technical Details

### Z-index Layering
```
z-index: 300  → hamburger menu (slide-out panel)
z-index: 250  → backdrop (dark overlay)
z-index: 200  → hamburger button (☰)
z-index: 100  → bottom nav (existing mobile-nav.js)
```

### Cross-Service Links
Maintenance links detect hostname:
- `chat.catamaranos.com` → `https://admin.catamaranos.com`
- `boatos-main.onrender.com` → `https://boatos-maintenance.onrender.com`
- `localhost` → `http://localhost:3001`
- Local IP → `{protocol}//{ip}:3001`

### Key Implementation Details
- IIFE pattern (same as mobile-nav.js)
- Double-init guard: `window.__hamburgerMenuInitialized`
- Hides back buttons by matching `.back-button`, `.back-btn`, and links to unified-mobile
- Body gets `padding-top: calc(48px + env(safe-area-inset-top))` for hamburger space
- Menu width: 270px
- Transition: 0.3s cubic-bezier

---

## Complexity & Risk

| Factor | Assessment |
|--------|------------|
| Complexity | Low - Same pattern as mobile-nav.js |
| Risk | Very Low - Additive, existing pages unchanged |
| Rollback | Remove script tag from pages |
| Testing | Manual on each page |

---

## References

- Hamburger component: `src/public/js/mobile-hamburger.js`
- Bottom nav component: `src/public/js/mobile-nav.js`
- Test page: `src/public/weather-areas.html`

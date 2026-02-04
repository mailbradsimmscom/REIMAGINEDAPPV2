# Hamburger Menu Navigation

**Created:** 2026-02-04
**Status:** Planning
**Priority:** Medium (UX)

---

## Summary

Add a shared hamburger menu (top-left) to all mobile/public pages, providing grouped navigation to the full page tree. Complements the existing bottom nav which handles core quick-access items.

---

## Current Navigation

```
┌──────────────────────────────┐
│         Page Content          │
│                               │
│    (no top nav on most pages) │
│                               │
├───────────────────────────────┤
│  🏠  ⚓  🔌  🔧  💬          │  ← Bottom nav (5 items)
└───────────────────────────────┘
```

**Problem:** 19 pages, only 5 in bottom nav. No way to navigate to weather, supplies, trips, etc. except going Home first.

---

## Proposed Navigation

```
┌─ ☰ ──────────── Page Title ──┐
│                               │
│         Page Content          │
│                               │
├───────────────────────────────┤
│  🏠  ⚓  🔌  🔧  💬          │  ← Bottom nav (unchanged)
└───────────────────────────────┘
```

Tapping ☰ opens a slide-out menu from the left:

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

## Implementation Plan

### Phase 1: Create shared hamburger component

**File:** `src/public/js/mobile-hamburger.js`

Same pattern as `mobile-nav.js`:
- IIFE, self-contained
- Injects CSS + HTML into page
- Loaded via `<script src="/public/js/mobile-hamburger.js"></script>`
- Highlights current page in menu
- Slide-out animation (left to right)
- Backdrop overlay (tap to close)
- Scrollable menu content

### Phase 2: Add to all mobile pages

Add `<script src="/public/js/mobile-hamburger.js"></script>` to all 19 mobile pages (same as mobile-nav.js pattern).

### Phase 3: Test

- Test on all pages
- Verify menu opens/closes
- Verify correct page highlighted
- Verify links work (including cross-service maintenance link)
- Test on iOS Safari, Chrome

---

## Technical Design

### CSS Approach

```css
/* Hamburger button - fixed top-left */
.hamburger-btn {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 200;
    padding: 16px;
    padding-top: calc(16px + env(safe-area-inset-top));
    background: transparent;
    border: none;
    font-size: 24px;
    cursor: pointer;
}

/* Slide-out menu */
.hamburger-menu {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    background: #FFFFFF;
    z-index: 300;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    overflow-y: auto;
    padding-top: calc(16px + env(safe-area-inset-top));
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.hamburger-menu.open {
    transform: translateX(0);
}

/* Backdrop */
.hamburger-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 250;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
}

.hamburger-backdrop.visible {
    opacity: 1;
    pointer-events: auto;
}
```

### Menu Structure

```html
<div class="hamburger-menu">
    <a href="..." class="menu-item menu-home active">🏠 Home</a>

    <div class="menu-group-label">BOAT STATUS</div>
    <a href="..." class="menu-item">Current Status</a>
    <a href="..." class="menu-item">Power System</a>
    <a href="..." class="menu-item">AIS Tracking</a>
    <a href="..." class="menu-item">Position Monitor</a>

    <div class="menu-group-label">NAVIGATION</div>
    <!-- ... -->
</div>
```

### Interaction

- Tap ☰ → menu slides in, backdrop appears
- Tap backdrop → menu slides out
- Tap menu item → navigate to page
- Swipe left on menu → close (stretch goal)

---

## Considerations

### Replacing back arrows
Most pages have a ← back button (`.back-button` or `.back-btn`) in their header. The hamburger replaces these:
- `mobile-hamburger.js` automatically hides existing back buttons on init
- The hamburger ☰ appears in the same top-left position
- Users navigate "back" by opening the menu and tapping the parent page

Pages with back arrows (11 pages):
- `boat-now.html` → was linking to unified-mobile.html
- `supplies.html` → was linking to unified-mobile.html
- `trips.html` → was linking to unified-mobile.html
- `trip-detail.html` → was linking to /trips
- `season-recap.html` → was linking to other-links.html
- `weather-area-view.html` → was linking to weather-areas.html
- `anchorages.html` → was linking to unified-mobile.html
- `ais.html` → was linking to unified-mobile.html
- `other-links.html` → was linking to unified-mobile.html
- `chat-mobile.html` → was using history.back()
- `position-monitor.html` → TBD

### Maintenance cross-service link
Same logic as mobile-nav.js - detect hostname and build correct URL for port 3001.

### Z-index layering
```
z-index: 300  → hamburger menu
z-index: 250  → backdrop
z-index: 200  → hamburger button
z-index: 100  → bottom nav (existing)
```

---

## Complexity & Risk

| Factor | Assessment |
|--------|------------|
| Complexity | Low - Same pattern as mobile-nav.js |
| Risk | Low - Additive only, no existing code changes |
| Rollback | Remove script tag from pages |
| Testing | Manual on each page |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Create hamburger component | 1-2 hours |
| Add to all pages | 30 min |
| Testing | 1 hour |
| **Total** | **3-4 hours** |

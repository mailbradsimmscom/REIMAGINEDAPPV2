# Code Update #45: Custom Domains, Mobile Nav, and Victron MQTT Discovery

**Date:** 2025-11-18
**Session Duration:** ~3 hours
**Status:** ✅ Partial Complete - Victron MQTT investigation ongoing

---

## Overview

This session covered three main areas:
1. Custom domain setup for Render services
2. Enterprise-standard mobile navigation component for main app
3. Victron Cerbo GX MQTT discovery and data exploration

---

## Part 1: Custom Domain Setup

### Domains Configured

| Domain | Service | Render URL | Status |
|--------|---------|------------|--------|
| chat.catamaranos.com | Main App | boatos-main.onrender.com | ✅ Verified + SSL |
| admin.catamaranos.com | Maintenance Agent | boatos-maintenance.onrender.com | ✅ Verified + SSL |

### DNS Records Added (GoDaddy)

```
Type: CNAME
Name: chat
Value: boatos-main.onrender.com
TTL: 1 Hour

Type: CNAME
Name: admin
Value: boatos-maintenance.onrender.com
TTL: 1 Hour
```

### Notes
- Python Sidecar (boatos-python) does NOT need custom domain - internal service only
- SSL certificates auto-provisioned by Render (Let's Encrypt)
- Verification took 1-5 minutes per domain

---

## Part 2: Render Tier Upgrades

### Previous Setup (Free Tier)
- All 3 services on free tier
- 40-second cold starts on maintenance agent
- 116-second chat response times
- Potential memory issues on Python sidecar

### New Setup (Paid Tier - $39/month)

| Service | Tier | Cost | RAM | Benefits |
|---------|------|------|-----|----------|
| Main App | Starter | $7/mo | 512MB | Always-on, no cold starts |
| Python Sidecar | Standard | $25/mo | 2GB | Always-on, 4x RAM for LLM processing |
| Maintenance Agent | Starter | $7/mo | 512MB | Always-on, no cold starts |

### Expected Improvements
- Task loading: 40s → <1s
- Chat response: 116s → 10-20s
- No cold starts on any service
- No memory crashes on Python

---

## Part 3: Enterprise Mobile Navigation Component

### Problem
- `unified-mobile.html` had no bottom navigation
- `anchor-watch-admin.html` had no navigation at all
- Users couldn't navigate between pages on mobile

### Solution
Created shared mobile navigation component following enterprise pattern from maintenance agent (#43).

### Files Created

**`/src/public/js/mobile-nav.js`** (149 lines)
- Self-contained IIFE pattern
- Injects CSS and HTML for bottom nav bar
- 4 navigation icons: Home, Anchor, Maintenance, Chat
- Environment detection for all deployment scenarios:
  - Production domains (chat.catamaranos.com)
  - Render URLs (boatos-main.onrender.com)
  - Localhost (localhost:3000)
  - Local IP (192.168.x.x)
- Auto-highlights active page
- iOS safe area support
- Touch feedback (scale on tap)

### Files Modified

**`/src/public/unified-mobile.html`**
- Added: `<script src="/public/js/mobile-nav.js"></script>`
- Removed: Old simple footer (`<div class="footer">BoatOS Mobile v2.0</div>`)
- Removed: Unused `.footer` CSS

**`/src/public/anchor-watch-admin.html`**
- Added: `<script src="/public/js/mobile-nav.js"></script>`
- Now has bottom navigation (previously had none)

### Navigation Structure

```
┌─────────────────────────────────────────────────┐
│  🏠 Home       → /public/unified-mobile.html    │
│  ⚓ Anchor     → /public/anchor-watch-admin.html│
│  🔧 Maintenance → admin.catamaranos.com (port 3001) │
│  💬 Chat       → /public/index-mobile.html      │
└─────────────────────────────────────────────────┘
```

### Commits

```
6825865 - Add enterprise-standard mobile navigation to main app
ff4cc77 - Fix mobile navigation script path (/js/ → /public/js/)
```

---

## Part 4: Victron Cerbo GX MQTT Discovery

### Connection Details

```
MQTT Broker:    192.168.20.193
MQTT Port:      1883
Protocol:       Plain TCP (no SSL)
Authentication: None required
Portal ID:      c0619ab4402a
Topic Pattern:  N/c0619ab4402a/{device_type}/{instance}/{field}
```

### Equipment Inventory Discovered

#### Batteries (2)
| ID | Name | Voltage | Notes |
|----|------|---------|-------|
| 1 | 48V Battery Bank (Main) | 52.9V | Primary bank |
| 278 | Secondary Battery | 27V | Smaller/auxiliary |

#### Solar Chargers (9 MPPT Controllers)
| IDs | Count |
|-----|-------|
| 289, 290, 291, 292, 293, 294, 295, 296, 297 | 9 |

#### Inverter/Chargers (2 MultiPlus Units)
| ID | Output Voltage | Power | Role |
|----|----------------|-------|------|
| 276 | 230V | 1.3kW | Main inverter |
| 288 | 125V | 45W | Secondary inverter |

#### Tank Sensors (4 configured, 3 publishing)
| Tank ID | Name | Capacity | Cerbo Display | MQTT Status |
|---------|------|----------|---------------|-------------|
| 20 | Port Diesel | 500L | 95% (479/500L) | ⚠️ Only RawValue, no % |
| 21 | Port Water | 370L | 80% (298/370L) | ⚠️ Wrong % (29.8%) |
| 22 | Starboard Diesel | 500L | 96% (480/500L) | ❌ NOT PUBLISHING |
| 23 | Starboard Water | 370L | 79% (295/370L) | ⚠️ Wrong % (29.6%) |

#### Temperature Sensors (1)
| ID | Field | Raw Value |
|----|-------|-----------|
| 27 | RawValue | 4.67 |

### Sample MQTT Data

```javascript
// Battery
N/c0619ab4402a/battery/1/Soc                    {"value":74.56999969482422}
N/c0619ab4402a/battery/1/Dc/0/Voltage           {"value":52.939998626708984}
N/c0619ab4402a/battery/1/Dc/0/Current           {"value":-34.900001525878906}
N/c0619ab4402a/battery/1/Dc/0/Power             {"value":-1847}
N/c0619ab4402a/battery/1/TimeToGo               {"value":39960}
N/c0619ab4402a/battery/1/ConsumedAmphours       {"value":-154.3000030517578}

// System Overview
N/c0619ab4402a/system/0/Dc/Battery/Voltage      {"value":52.939998626708984}
N/c0619ab4402a/system/0/Dc/Battery/Current      {"value":-34.900001525878906}
N/c0619ab4402a/system/0/Dc/Battery/Power        {"value":-1847}
N/c0619ab4402a/system/0/Dc/Battery/Soc          {"value":74.56999969482422}
N/c0619ab4402a/system/0/Dc/Battery/TimeToGo     {"value":39780}
N/c0619ab4402a/system/0/Ac/Consumption/L1/Power {"value":1307}

// Inverter
N/c0619ab4402a/vebus/276/Ac/Out/L1/V            {"value":230.19000244140625}
N/c0619ab4402a/vebus/276/Ac/Out/L1/P            {"value":1307}
N/c0619ab4402a/vebus/276/Ac/Out/L1/I            {"value":5.78000020980835}
N/c0619ab4402a/vebus/276/Dc/0/Power             {"value":-1307}

// Solar (nighttime - minimal output)
N/c0619ab4402a/solarcharger/291/Pv/V            {"value":0.05}
N/c0619ab4402a/solarcharger/291/Dc/0/Voltage    {"value":52.93}
N/c0619ab4402a/system/0/Dc/Pv/Power             {"value":-21.17}

// Tanks (PROBLEM - wrong percentages)
N/c0619ab4402a/tank/21/Remaining                {"value":0.297766774892807}
N/c0619ab4402a/tank/21/RawValue                 {"value":145.02084350585938}
N/c0619ab4402a/tank/23/Remaining                {"value":0.2959249019622803}
N/c0619ab4402a/tank/20/RawValue                 {"value":172.2046661376953}
```

### Known Issues with Tank Data

#### Issue 1: Tank 22 (Starboard Diesel) Not Publishing
- Shows correctly on Cerbo display (96%)
- No MQTT messages received for tank/22/*
- **Needs investigation:** Why is this tank excluded from MQTT?

#### Issue 2: Wrong Percentage Values
- **Port Water (21):** Cerbo shows 80%, MQTT shows 29.8%
- **Starboard Water (23):** Cerbo shows 79%, MQTT shows 29.6%
- **Note:** 100% - 29.8% = 70.2% (still wrong, not inverted)

#### Issue 3: Missing Fields
- Tank 20 only publishes `RawValue`, no `Remaining` percentage
- Need to check if `Level` or `Capacity` fields exist
- According to Victron MQTT spec, should have:
  ```
  N/{VRM_ID}/tank/{instance}/Level      ← Percentage 0-100
  N/{VRM_ID}/tank/{instance}/Remaining  ← Fraction 0.0-1.0
  N/{VRM_ID}/tank/{instance}/Capacity   ← Total capacity in m³
  N/{VRM_ID}/tank/{instance}/FluidType  ← 0=Fuel, 1=Fresh water, etc.
  ```

### Test Script Created

**`/scripts/victron_mqtt_test.py`** (160 lines)
- Connects to Cerbo MQTT broker
- Subscribes to all Victron topics (N/#)
- Prints timestamped messages for 30 seconds
- Handles graceful shutdown (Ctrl+C)
- Shows message rate summary

**`/scripts/requirements.txt`**
```
paho-mqtt==1.6.1
```

### Message Rate
- Initial burst: ~50 messages/second
- Steady state: "Send on change" mode - only publishes when values change
- Need to enable "Keep alive" setting on Cerbo for continuous updates

---

## Next Steps

### Victron MQTT Integration (Priority)
1. **Resolve tank data issues:**
   - Find why Tank 22 not publishing
   - Find correct field for percentage (`Level` vs `Remaining`)
   - Check VRM portal for available MQTT fields

2. **Create Supabase table** for energy data:
   - Battery voltage, current, SOC, power
   - Solar production
   - AC consumption
   - Tank levels (once fixed)

3. **Build production MQTT script** for Raspberry Pi:
   - Store data in Supabase
   - Run as systemd service
   - Handle reconnection

4. **Create BoatOS energy dashboard:**
   - Real-time battery status
   - Solar production charts
   - Tank level displays
   - Historical trends

### iOS App (Future)
- Capacitor wrapper for TestFlight distribution
- Hybrid approach (WebView loads from Render)
- Native plugins for GPS, notifications
- $99 Apple Developer account already available

---

## Technical Notes

### MQTT Topics Structure

```
N/{portal_id}/{device_type}/{instance}/{path}

Examples:
N/c0619ab4402a/system/0/Dc/Battery/Voltage
N/c0619ab4402a/battery/1/Soc
N/c0619ab4402a/solarcharger/291/Yield/Power
N/c0619ab4402a/vebus/276/Ac/Out/L1/P
N/c0619ab4402a/tank/21/Remaining
```

### Common Device Types
- `system` - Overall system metrics
- `battery` - Battery monitors (BMV, SmartShunt)
- `solarcharger` - MPPT solar controllers
- `vebus` - MultiPlus/Quattro inverter-chargers
- `tank` - Tank sensors
- `temperature` - Temperature sensors
- `gps` - GPS position (if enabled)

### State Codes
- **Battery State:** 0=Idle, 1=Charging, 2=Discharging
- **Solar State:** 0=Off, 3=Bulk, 4=Absorption, 5=Float
- **Inverter State:** 0=Off, 3=Bulk, 4=Absorption, 5=Float, 9=Inverting

---

## Git Commits This Session

```
6825865 - Add enterprise-standard mobile navigation to main app
ff4cc77 - Fix mobile navigation script path
```

---

## References

- **Victron MQTT Documentation:** https://github.com/victronenergy/dbus-mqtt
- **VRM Portal:** https://vrm.victronenergy.com
- **Previous Session:** `/code updates/44d Telegram and SMS Alert Integration for Anchor Watch.md`
- **Render Deployment Guide:** `/code updates/44 Render Deployment Guide - Complete Production Setup.md`

---

## Status Summary

| Task | Status |
|------|--------|
| Custom domains (chat.catamaranos.com, admin.catamaranos.com) | ✅ Complete |
| Render tier upgrades ($39/mo) | ✅ Complete |
| Mobile navigation component | ✅ Complete |
| Victron MQTT connection | ✅ Working |
| Equipment discovery | ✅ Complete |
| Tank data accuracy | ⚠️ Issues - needs investigation |
| Supabase energy table | ⏳ Next step |
| Production MQTT script | ⏳ Next step |
| Energy dashboard UI | ⏳ Future |

---

**Session Notes:** Victron MQTT connection is working and we discovered all equipment. Main blocker is tank data not matching Cerbo display - need to find correct MQTT field for tank percentages or investigate Cerbo configuration.

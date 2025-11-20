# Code Update #46: Victron Telemetry Mobile Dashboard

**Date:** 2025-11-18
**Status:** IMPLEMENTED
**Author:** Claude Code

---

## Overview

Created a mobile-optimized dashboard for viewing live Victron telemetry data from the boat's electrical system. The dashboard displays battery banks, solar chargers, alternators, AC consumption, temperature, and tank levels with real-time updates.

**Key Features:**
- iOS-native styling matching existing mobile pages
- Auto-refresh every 15 seconds
- Detailed breakdowns by device category
- Sparkline history graphs for tanks
- Percentage calculations for solar yield vs battery capacity

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Supabase (telemetry_current_state + telemetry_agg_1h)      │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Supabase Client
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Repository: telemetry.repository.js                        │
│  - getCurrentState() - filtered to dashboard metrics        │
│  - getTankHistory() - 1h aggregates for sparklines          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Service: telemetry.service.js                              │
│  - getCurrentTelemetry() - groups, formats, adds sparklines │
│  - extractSummary() - extracts key metrics by category      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Route: /admin/api/telemetry/current                        │
│  - Returns formatted JSON with all telemetry data           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ fetch() with x-admin-token
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: victron-mobile.html                              │
│  - Renders cards for each category                          │
│  - Generates SVG sparklines                                 │
│  - Auto-refreshes every 15 seconds                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `src/repositories/telemetry.repository.js` | Supabase queries for telemetry data |
| `src/services/telemetry.service.js` | Business logic, formatting, grouping |
| `src/routes/admin/telemetry.route.js` | API endpoints |
| `src/public/victron-mobile.html` | Mobile dashboard UI |

### Modified Files

| File | Changes |
|------|---------|
| `src/routes/admin/index.js` | Registered telemetry router |

---

## API Endpoints

All endpoints require `x-admin-token` header.

### GET /admin/api/telemetry/current

Returns all current telemetry data grouped by category.

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "battery_soc": 43,
      "battery_voltage": 52.9,
      "battery_current": 15.5,
      "battery_power": 820,
      "solar_power": 2048,
      "ac_consumption": 139,
      "temperature": 4.68,
      "battery_capacity_kwh": 26.45,
      "batteries": [...],
      "solar_chargers": [...],
      "alternators": [...],
      "tanks": [...]
    },
    "categories": {...},
    "last_updated": "2025-11-18T15:30:00Z"
  },
  "requestId": "..."
}
```

### GET /admin/api/telemetry/battery

Returns detailed battery information.

### GET /admin/api/telemetry/solar

Returns solar charger information with total power.

### GET /admin/api/telemetry/tanks

Returns tank level information.

---

## Dashboard Sections

### 1. Battery Banks

Displays all battery banks with:
- **Name** (48V Battery Bank, 24V Service Batt, 12V Service Batt)
- **SOC** (State of Charge percentage)
- **Voltage** (V)
- **Current** (A)
- **Power** (W)

Sorted by voltage descending (48V first).

### 2. Solar Chargers

Displays all 9 solar panels with:
- **Total Power** (W) - sum of all chargers
- **Today's Yield** (kWh) - sum of daily yield
- **% of Battery Capacity** - yield as percentage of 48V bank capacity
- **Per Charger:**
  - Name (Davit Mid, Davit Port, etc.)
  - Yield today (kWh)
  - Percentage of total yield
  - Current power (W)

Sorted alphabetically by name.

### 3. Alternators

Displays both Integrel generators with:
- **Total Power** (W) - sum of both alternators
- **Per Alternator:**
  - Name (Integrel Port, Integrel Starboard)
  - Engine RPM
  - Engine Temperature (°C)
  - Power output (W)

### 4. AC Consumption

Displays:
- **L1 Power** (W)

### 5. Temperature

Displays:
- **Cabin** temperature in °C and °F

### 6. Tanks

Displays all 4 tanks with:
- **Name** (Port Water, Stbd Water, Port Diesel, Stbd Diesel)
- **Level** (percentage)
- **Progress bar** (blue for water, orange for diesel)
- **Sparkline** (7-day history for diesel, 2-day for water)

Sorted with water tanks first, then diesel.

---

## Device Mappings

### Battery Banks

| Device ID | Display Name |
|-----------|--------------|
| battery/1 | 48V Battery Bank |
| battery/278 | 24V Service Batt |
| battery/279 | 12V Service Batt |

### Solar Chargers

| Device ID | Display Name |
|-----------|--------------|
| solarcharger/289 | Stb Fwd |
| solarcharger/290 | Davit Stb |
| solarcharger/291 | Port Aft |
| solarcharger/292 | Port Fwd |
| solarcharger/293 | Port Mid Fwd |
| solarcharger/294 | Port Mid Aft |
| solarcharger/295 | Davit Port |
| solarcharger/296 | Stb Aft |
| solarcharger/297 | Davit Mid |

### Alternators

| Device ID | Display Name |
|-----------|--------------|
| alternator/0 | Integrel Starboard |
| alternator/1 | Integrel Port |

### Tanks

| Device ID | Display Name | Type |
|-----------|--------------|------|
| tank/20 | Port Diesel | fuel |
| tank/21 | Port Water | water |
| tank/22 | Stbd Diesel | fuel |
| tank/23 | Stbd Water | water |

---

## Metrics Collected

The repository filters to only dashboard-relevant metrics to avoid hitting Supabase's 1000-row default limit:

### Battery Metrics
- `Soc` - State of charge (%)
- `Dc/0/Voltage` - Voltage (V)
- `Dc/0/Current` - Current (A)
- `Dc/0/Power` - Power (W)
- `TimeToGo` - Remaining time
- `Capacity` - Capacity (Ah)

### Solar Metrics
- `Yield/Power` - Current power (W)
- `Yield/User` - Cumulative yield (kWh)
- `Pv/V` - PV voltage (V)
- `History/Daily/0/Yield` - Today's yield (kWh)

### Tank Metrics
- `Level` - Level (0-100)
- `Remaining` - Remaining (0-1 fraction)
- `RawValue` - Raw sensor value

### System Metrics
- `Dc/Battery/Soc` - System battery SOC
- `Dc/Battery/Voltage` - System voltage
- `Dc/Battery/Current` - System current
- `Dc/Battery/Power` - System power
- `Dc/Pv/Power` - Total PV power
- `Ac/Consumption/L1/Power` - AC consumption

### Alternator Metrics
- `Engine/Speed` - RPM
- `Engine/Temperature` - Engine temp (°C)
- (Also uses `Dc/0/Voltage`, `Dc/0/Current`, `Dc/0/Power`)

### Temperature Metrics
- `RawValue` - Temperature (°C)

---

## Sparklines Implementation

Tank sparklines show level history:
- **Diesel tanks**: 7 days of history
- **Water tanks**: 2 days of history
- **Sampling**: Every 2 hours from `telemetry_agg_1h`

### SVG Generation

```javascript
function generateSparkline(data, type) {
    // Filter nulls, calculate min/max
    // Map values to SVG coordinates
    // Return SVG path element
}
```

The sparkline scales to fit the data range and renders as a simple line chart without axes.

---

## Styling

Uses iOS-native design system:
- `--primary-color: #007AFF`
- `--success-color: #34C759`
- `--warning-color: #FF9500`
- `--danger-color: #FF3B30`

### Color Coding

- **Battery SOC < 20%**: Red (danger)
- **Battery SOC < 40%**: Orange (warning)
- **Solar producing**: Green (success)
- **Tank level < 20%**: Red (danger)
- **Tank level < 40%**: Orange (warning)
- **Water tank bar**: Blue
- **Diesel tank bar**: Orange

---

## Auto-Refresh

The page auto-refreshes every 15 seconds:
- Uses `setInterval` for periodic updates
- Pauses when page is hidden (`visibilitychange` event)
- Resumes immediately when page becomes visible
- Shows spinning refresh icon during load

---

## Authentication

Uses the same admin token pattern as other mobile pages:
1. Check `localStorage.getItem('adminToken')`
2. Check URL parameter `?token=...`
3. Store token in localStorage for persistence
4. Remove token from URL for security
5. Send token in `x-admin-token` header

---

## Access URL

```
https://boatos-main.onrender.com/public/victron-mobile.html
```

---

## Known Issues / Notes

1. **Tank 22 (Stbd Diesel)**: May not publish to MQTT consistently - this is a Victron/Cerbo configuration issue

2. **Daily Yield (`History/Daily/0/Yield`)**: Not all chargers may have this metric captured yet

3. **Battery Capacity**: Calculated as `Ah × Voltage / 1000` to get kWh

4. **Tank Level Format**: Some tanks report 0-1 fraction, others 0-100 percentage. Code auto-detects based on value > 1

5. **Temperature Sensor**: Uses `RawValue` metric, displays in both °C and °F

---

## Future Enhancements

1. **VE.Bus data**: Add inverter/charger status from vebus/276 and vebus/288

2. **Historical charts**: Full-page charts for detailed history analysis

3. **Alerts**: Visual indicators for alarm states

4. **Link from home**: Add action card on unified-mobile.html

5. **Device display names**: Could pull from Victron `CustomName` field if available in DB

6. **Fronius integration**: Add grid-tie inverter data (fronius/0)

---

## Testing

### Verify API
```bash
curl -H "x-admin-token: YOUR_TOKEN" \
  https://boatos-main.onrender.com/admin/api/telemetry/current
```

### Check Device Count
```sql
SELECT category, COUNT(*)
FROM telemetry_devices
GROUP BY category
ORDER BY category;
```

### Check Metric Count
```sql
SELECT COUNT(*) FROM telemetry_current_state;
```

---

## Dependencies

- **Supabase tables**: `telemetry_current_state`, `telemetry_metrics`, `telemetry_devices`, `telemetry_agg_1h`
- **Pi Agent**: Must be running to populate telemetry data
- **pg_cron jobs**: Must be running for aggregation tables

---

## Related Documentation

- **Telemetry System Design**: `/pi/home/brad/Code/code updates/01 Telemetry System Design - Victron MQTT to Supabase.md`
- **Main App Architecture**: `/CLAUDE.md`
- **Mobile Dashboard**: `/src/public/unified-mobile.html`

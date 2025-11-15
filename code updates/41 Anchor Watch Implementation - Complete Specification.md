# 41 Anchor Watch Implementation - Complete Specification

**Date:** 2024-11-15
**Author:** Claude Opus 4.1
**Status:** 🔵 READY FOR IMPLEMENTATION
**Target Implementer:** Claude Sonnet 4.5

---

## 🎯 OBJECTIVE

Implement a complete Anchor Watch system for the REIMAGINEDAPPV2 catamaran operating system. This feature monitors GPS position to detect anchor drag and alert when the vessel moves outside a defined safe zone.

**CRITICAL:** This document contains ALL decisions, patterns, and specifications. NO assumptions should be made. Follow this document exactly.

---

## 📋 PROJECT CONTEXT

### Existing Architecture
- **Main App:** Node.js/Express on port 3000 (ESM only)
- **Maintenance Agent:** Separate Node.js app on port 3001 (has WebSocket support)
- **Python Sidecar:** FastAPI on port 8000
- **Database:** Supabase (PostgreSQL)
- **Frontend:** Vanilla JS with inline styles/scripts (no build step)

### Compliance Requirements (MUST READ)
- **`.cursorrules`**: Strict layered architecture (routes → services → repositories)
- **`claude.md`**: No code changes without approval, detailed planning required
- **Admin Pattern:** All admin routes under `/admin/api/*` with `x-admin-token` header
- **Error Handling:** Use existing `logger.js`, return standard envelope format
- **NO CommonJS:** ESM only, use `import` not `require`

### GPS Data Source
- **External:** Raspberry Pi pushes GPS data directly to Supabase
- **Table:** `gps_position` (created by RPi, NOT our migration)
- **Update Frequency:** Every 10 seconds
- **Boat ID:** Currently single boat (use default value if needed)

---

## 🗄️ DATABASE SCHEMA

### GPS Position Table (EXISTS - Created by RPi)
```sql
-- This table already exists, created by Raspberry Pi
-- DO NOT create this table, only read from it
gps_position:
  - id: uuid (primary key)
  - boat_id: text
  - latitude: double precision
  - longitude: double precision
  - altitude: double precision
  - speed_over_ground: double precision
  - course_over_ground: double precision
  - timestamp: timestamp with time zone
  - created_at: timestamp with time zone
```

### New Tables (TO BE CREATED)

#### Migration File: `/scripts/migrations/020_create_anchor_watch_tables.sql`

```sql
-- Anchor Watch Zones Table
CREATE TABLE IF NOT EXISTS anchor_watch_zones (
    zone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN DEFAULT false,
    center_lat DECIMAL(10, 8) NOT NULL,
    center_lng DECIMAL(11, 8) NOT NULL,
    radius_meters DECIMAL(10, 2) NOT NULL,
    activated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one active zone at a time
CREATE UNIQUE INDEX idx_one_active_anchor
ON anchor_watch_zones(is_active)
WHERE is_active = true;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_anchor_watch_zones_updated_at
BEFORE UPDATE ON anchor_watch_zones
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Anchor Watch Alerts Table
CREATE TABLE IF NOT EXISTS anchor_watch_alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID REFERENCES anchor_watch_zones(zone_id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('anchor_drag', 'zone_warning', 'gps_lost')),
    position_lat DECIMAL(10, 8) NOT NULL,
    position_lng DECIMAL(11, 8) NOT NULL,
    distance_meters DECIMAL(10, 2),
    details JSONB,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding unacknowledged alerts quickly
CREATE INDEX idx_unacknowledged_alerts
ON anchor_watch_alerts(acknowledged, created_at DESC)
WHERE acknowledged = false;

-- Grant permissions (adjust based on your Supabase roles)
GRANT ALL ON anchor_watch_zones TO authenticated;
GRANT ALL ON anchor_watch_alerts TO authenticated;
GRANT ALL ON anchor_watch_zones TO service_role;
GRANT ALL ON anchor_watch_alerts TO service_role;
```

---

## 🔧 ENVIRONMENT VARIABLES

Add to `.env` file:
```bash
# Anchor Watch Configuration
ANCHOR_WATCH_SAFE_RATIO=0.7          # Within 70% of radius = safe
ANCHOR_WATCH_WARNING_RATIO=0.9       # 70-90% = warning, >90% = dragging
ANCHOR_WATCH_CENTROID_SAMPLES=20     # Number of positions for centroid calculation
ANCHOR_WATCH_STALE_THRESHOLD_SEC=300 # GPS data older than 5 min is stale
```

Add to `/src/config/env.js` (around line 46, before the refine):
```javascript
// Anchor Watch Configuration
ANCHOR_WATCH_SAFE_RATIO: z.string().optional().default('0.7'),
ANCHOR_WATCH_WARNING_RATIO: z.string().optional().default('0.9'),
ANCHOR_WATCH_CENTROID_SAMPLES: z.string().optional().default('20'),
ANCHOR_WATCH_STALE_THRESHOLD_SEC: z.string().optional().default('300'),
```

---

## 📁 FILE STRUCTURE

```
src/
├── repositories/
│   └── gps.repository.js                 [NEW - GPS data access]
├── services/
│   └── anchor-watch.service.js           [NEW - Business logic]
├── routes/
│   └── admin/
│       └── anchor-watch.route.js         [NEW - API endpoints]
├── public/
│   └── anchor-watch-admin.html           [NEW - Admin UI]
└── config/
    └── env.js                            [MODIFY - Add env vars]

scripts/
└── migrations/
    └── 020_create_anchor_watch_tables.sql [NEW - Database schema]
```

---

## 🏗️ BACKEND IMPLEMENTATION

### 1. GPS Repository (`/src/repositories/gps.repository.js`)

```javascript
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Repository for accessing GPS position data from RPi
 */
class GpsRepository {
  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Get the most recent GPS position
   * @returns {Promise<Object|null>} Latest position or null if none/error
   */
  async getCurrentPosition() {
    try {
      const { data, error } = await this.supabase
        .from('gps_position')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          requestLogger.warn('No GPS positions available');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      requestLogger.error('Error fetching current GPS position', { error: error.message });
      throw error;
    }
  }

  /**
   * Get recent GPS positions
   * @param {number} limit - Number of positions to retrieve
   * @returns {Promise<Array>} Array of positions
   */
  async getRecentPositions(limit = 20) {
    try {
      const { data, error } = await this.supabase
        .from('gps_position')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching recent GPS positions', { error: error.message });
      throw error;
    }
  }

  /**
   * Get positions within a time range
   * @param {Date} startTime - Start of time range
   * @param {Date} endTime - End of time range
   * @returns {Promise<Array>} Array of positions
   */
  async getPositionsInRange(startTime, endTime) {
    try {
      const { data, error } = await this.supabase
        .from('gps_position')
        .select('*')
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching GPS positions in range', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const gpsRepository = new GpsRepository();
```

### 2. Anchor Watch Service (`/src/services/anchor-watch.service.js`)

```javascript
import { gpsRepository } from '../repositories/gps.repository.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

const env = getEnv();
const requestLogger = logger.createRequestLogger();

class AnchorWatchService {
  constructor() {
    this.supabase = getSupabaseClient();
    this.safeRatio = parseFloat(env.ANCHOR_WATCH_SAFE_RATIO);
    this.warningRatio = parseFloat(env.ANCHOR_WATCH_WARNING_RATIO);
    this.centroidSamples = parseInt(env.ANCHOR_WATCH_CENTROID_SAMPLES);
    this.staleThresholdSec = parseInt(env.ANCHOR_WATCH_STALE_THRESHOLD_SEC);
  }

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Calculate centroid of recent positions
   * @returns {Promise<Object>} Centroid {latitude, longitude, sample_size}
   */
  async calculateCentroid() {
    try {
      const positions = await gpsRepository.getRecentPositions(this.centroidSamples);

      if (!positions || positions.length === 0) {
        throw new Error('No GPS positions available for centroid calculation');
      }

      // Calculate average of all positions
      const sum = positions.reduce((acc, pos) => ({
        lat: acc.lat + pos.latitude,
        lon: acc.lon + pos.longitude
      }), { lat: 0, lon: 0 });

      return {
        latitude: sum.lat / positions.length,
        longitude: sum.lon / positions.length,
        sample_size: positions.length
      };
    } catch (error) {
      requestLogger.error('Error calculating centroid', { error: error.message });
      throw error;
    }
  }

  /**
   * Determine anchor watch status based on distance
   * @param {number} distanceMeters - Distance from anchor in meters
   * @param {number} radiusMeters - Anchor zone radius in meters
   * @returns {string} 'safe', 'warning', or 'dragging'
   */
  determineStatus(distanceMeters, radiusMeters) {
    const ratio = distanceMeters / radiusMeters;
    if (ratio <= this.safeRatio) return 'safe';
    if (ratio <= this.warningRatio) return 'warning';
    return 'dragging';
  }

  /**
   * Get current anchor watch status
   * @returns {Promise<Object>} Current status with all calculated fields
   */
  async getStatus() {
    try {
      // Get active zone
      const { data: zone, error: zoneError } = await this.supabase
        .from('anchor_watch_zones')
        .select('*')
        .eq('is_active', true)
        .single();

      if (zoneError && zoneError.code !== 'PGRST116') {
        throw zoneError;
      }

      if (!zone) {
        // No active anchor watch
        return {
          active: false,
          anchor_lat: null,
          anchor_lon: null,
          radius_meters: null,
          current_lat: null,
          current_lon: null,
          distance_meters: null,
          status: 'inactive',
          last_updated: null
        };
      }

      // Get current position
      const currentPosition = await gpsRepository.getCurrentPosition();

      if (!currentPosition) {
        return {
          active: true,
          anchor_lat: zone.center_lat,
          anchor_lon: zone.center_lng,
          radius_meters: parseFloat(zone.radius_meters),
          current_lat: null,
          current_lon: null,
          distance_meters: null,
          status: 'gps_lost',
          last_updated: null
        };
      }

      // Check if GPS data is stale
      const positionAge = (Date.now() - new Date(currentPosition.timestamp).getTime()) / 1000;
      if (positionAge > this.staleThresholdSec) {
        requestLogger.warn('GPS data is stale', { age_seconds: positionAge });
      }

      // Calculate distance from anchor
      const distance = this.calculateDistance(
        currentPosition.latitude,
        currentPosition.longitude,
        parseFloat(zone.center_lat),
        parseFloat(zone.center_lng)
      );

      // Determine status
      const status = this.determineStatus(distance, parseFloat(zone.radius_meters));

      // Check if we need to create an alert
      if (status === 'dragging') {
        await this.createAlertIfNeeded(zone.zone_id, 'anchor_drag', currentPosition, distance);
      }

      return {
        active: true,
        anchor_lat: parseFloat(zone.center_lat),
        anchor_lon: parseFloat(zone.center_lng),
        radius_meters: parseFloat(zone.radius_meters),
        current_lat: currentPosition.latitude,
        current_lon: currentPosition.longitude,
        distance_meters: Math.round(distance * 100) / 100,
        status: status,
        last_updated: currentPosition.timestamp
      };
    } catch (error) {
      requestLogger.error('Error getting anchor watch status', { error: error.message });
      throw error;
    }
  }

  /**
   * Get recent positions with distance from anchor calculated
   * @param {number} limit - Number of positions to retrieve
   * @returns {Promise<Object>} Positions with calculated distances
   */
  async getPositionsWithDistance(limit = 20) {
    try {
      // Get active zone
      const { data: zone } = await this.supabase
        .from('anchor_watch_zones')
        .select('*')
        .eq('is_active', true)
        .single();

      // Get recent positions
      const positions = await gpsRepository.getRecentPositions(limit);

      // If no active zone, return positions without distances
      if (!zone) {
        return {
          positions: positions.map(pos => ({
            latitude: pos.latitude,
            longitude: pos.longitude,
            timestamp: pos.timestamp,
            distance_from_anchor: null,
            status: 'inactive'
          }))
        };
      }

      // Calculate distance for each position
      const centerLat = parseFloat(zone.center_lat);
      const centerLng = parseFloat(zone.center_lng);
      const radiusMeters = parseFloat(zone.radius_meters);

      return {
        positions: positions.map(pos => {
          const distance = this.calculateDistance(
            pos.latitude,
            pos.longitude,
            centerLat,
            centerLng
          );
          const status = this.determineStatus(distance, radiusMeters);

          return {
            latitude: pos.latitude,
            longitude: pos.longitude,
            timestamp: pos.timestamp,
            distance_from_anchor: Math.round(distance * 100) / 100,
            status: status
          };
        })
      };
    } catch (error) {
      requestLogger.error('Error getting positions with distance', { error: error.message });
      throw error;
    }
  }

  /**
   * Activate anchor watch with specified center and radius
   * @param {number} latitude - Anchor latitude
   * @param {number} longitude - Anchor longitude
   * @param {number} radiusMeters - Watch radius in meters
   * @returns {Promise<Object>} Created zone
   */
  async activate(latitude, longitude, radiusMeters) {
    try {
      // Deactivate any existing zones
      await this.deactivate();

      // Create new active zone
      const { data: zone, error } = await this.supabase
        .from('anchor_watch_zones')
        .insert({
          center_lat: latitude,
          center_lng: longitude,
          radius_meters: radiusMeters,
          is_active: true,
          activated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      requestLogger.info('Anchor watch activated', {
        lat: latitude,
        lng: longitude,
        radius: radiusMeters
      });

      return zone;
    } catch (error) {
      requestLogger.error('Error activating anchor watch', { error: error.message });
      throw error;
    }
  }

  /**
   * Deactivate anchor watch
   * @returns {Promise<void>}
   */
  async deactivate() {
    try {
      const { error } = await this.supabase
        .from('anchor_watch_zones')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
        .eq('is_active', true);

      if (error) throw error;

      requestLogger.info('Anchor watch deactivated');
    } catch (error) {
      requestLogger.error('Error deactivating anchor watch', { error: error.message });
      throw error;
    }
  }

  /**
   * Update anchor watch radius
   * @param {number} radiusMeters - New radius in meters
   * @returns {Promise<Object>} Updated zone
   */
  async updateRadius(radiusMeters) {
    try {
      const { data: zone, error } = await this.supabase
        .from('anchor_watch_zones')
        .update({ radius_meters: radiusMeters })
        .eq('is_active', true)
        .select()
        .single();

      if (error) throw error;

      requestLogger.info('Anchor watch radius updated', { radius: radiusMeters });
      return zone;
    } catch (error) {
      requestLogger.error('Error updating anchor watch radius', { error: error.message });
      throw error;
    }
  }

  /**
   * Create alert if needed (prevents duplicate alerts)
   * @private
   */
  async createAlertIfNeeded(zoneId, alertType, position, distance) {
    try {
      // Check for recent unacknowledged alert of same type
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentAlert } = await this.supabase
        .from('anchor_watch_alerts')
        .select('alert_id')
        .eq('zone_id', zoneId)
        .eq('alert_type', alertType)
        .eq('acknowledged', false)
        .gte('created_at', fiveMinutesAgo)
        .single();

      if (recentAlert) {
        // Alert already exists
        return;
      }

      // Create new alert
      const { error } = await this.supabase
        .from('anchor_watch_alerts')
        .insert({
          zone_id: zoneId,
          alert_type: alertType,
          position_lat: position.latitude,
          position_lng: position.longitude,
          distance_meters: distance,
          details: {
            speed_over_ground: position.speed_over_ground,
            course_over_ground: position.course_over_ground
          }
        });

      if (error) throw error;

      requestLogger.warn('Anchor watch alert created', {
        type: alertType,
        distance: distance
      });
    } catch (error) {
      requestLogger.error('Error creating alert', { error: error.message });
      // Don't throw - alert creation failure shouldn't break status check
    }
  }
}

// Export singleton instance
export const anchorWatchService = new AnchorWatchService();
```

### 3. Anchor Watch Route (`/src/routes/admin/anchor-watch.route.js`)

```javascript
import express from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { anchorWatchService } from '../../services/anchor-watch.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Schemas
const StatusResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    active: z.boolean(),
    anchor_lat: z.number().nullable(),
    anchor_lon: z.number().nullable(),
    radius_meters: z.number().nullable(),
    current_lat: z.number().nullable(),
    current_lon: z.number().nullable(),
    distance_meters: z.number().nullable(),
    status: z.string(),
    last_updated: z.string().nullable()
  }).optional(),
  error: z.string().optional()
});

const PositionsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('20')
});

const PositionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    positions: z.array(z.object({
      latitude: z.number(),
      longitude: z.number(),
      timestamp: z.string(),
      distance_from_anchor: z.number().nullable(),
      status: z.string()
    }))
  }).optional(),
  error: z.string().optional()
});

const InferResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    latitude: z.number(),
    longitude: z.number(),
    sample_size: z.number()
  }).optional(),
  error: z.string().optional()
});

const ActivateBodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_meters: z.number().min(10).max(1000)
});

const UpdateRadiusBodySchema = z.object({
  radius_meters: z.number().min(10).max(1000)
});

// Apply response validation to all routes
router.use(validateResponse(StatusResponseSchema));

// GET /admin/api/anchor-watch/status
router.get('/status', async (req, res, next) => {
  try {
    const status = await anchorWatchService.getStatus();

    return res.json({
      success: true,
      data: status
    });
  } catch (error) {
    requestLogger.error('Error getting anchor watch status', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get anchor watch status'
    });
  }
});

// GET /admin/api/anchor-watch/positions
router.get('/positions',
  validate(PositionsQuerySchema, 'query'),
  validateResponse(PositionsResponseSchema),
  async (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit);
      const result = await anchorWatchService.getPositionsWithDistance(limit);

      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      requestLogger.error('Error getting positions', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get GPS positions'
      });
    }
  }
);

// POST /admin/api/anchor-watch/infer
router.post('/infer',
  validateResponse(InferResponseSchema),
  async (req, res, next) => {
    try {
      const centroid = await anchorWatchService.calculateCentroid();

      return res.json({
        success: true,
        data: centroid
      });
    } catch (error) {
      requestLogger.error('Error calculating centroid', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to calculate anchor position. Ensure GPS data is available.'
      });
    }
  }
);

// POST /admin/api/anchor-watch/activate
router.post('/activate',
  validate(ActivateBodySchema, 'body'),
  async (req, res, next) => {
    try {
      const { latitude, longitude, radius_meters } = req.body;
      await anchorWatchService.activate(latitude, longitude, radius_meters);

      return res.json({
        success: true,
        data: { message: 'Anchor watch activated' }
      });
    } catch (error) {
      requestLogger.error('Error activating anchor watch', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to activate anchor watch'
      });
    }
  }
);

// POST /admin/api/anchor-watch/deactivate
router.post('/deactivate', async (req, res, next) => {
  try {
    await anchorWatchService.deactivate();

    return res.json({
      success: true,
      data: { message: 'Anchor watch deactivated' }
    });
  } catch (error) {
    requestLogger.error('Error deactivating anchor watch', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to deactivate anchor watch'
    });
  }
});

// PUT /admin/api/anchor-watch/radius
router.put('/radius',
  validate(UpdateRadiusBodySchema, 'body'),
  async (req, res, next) => {
    try {
      const { radius_meters } = req.body;
      await anchorWatchService.updateRadius(radius_meters);

      return res.json({
        success: true,
        data: { message: 'Radius updated' }
      });
    } catch (error) {
      requestLogger.error('Error updating radius', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to update radius'
      });
    }
  }
);

export default router;
```

### 4. Register Route in Admin Index (`/src/routes/admin/index.js`)

**ADD** this line around line 20-30 (with other imports):
```javascript
import anchorWatchRouter from './anchor-watch.route.js';
```

**ADD** this line around line 50-60 (with other route registrations):
```javascript
router.use('/anchor-watch', anchorWatchRouter);
```

---

## 🎨 FRONTEND IMPLEMENTATION

### Admin Page (`/src/public/anchor-watch-admin.html`)

Create this file with the following content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <title>Anchor Watch Administration</title>

    <!-- Leaflet CSS -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
            background: #F2F2F7;
            min-height: 100vh;
            min-height: 100dvh;
            -webkit-font-smoothing: antialiased;
            overscroll-behavior: none;
        }

        .header {
            background: white;
            padding: max(env(safe-area-inset-top), 16px) 16px 16px 16px;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .back-button {
            width: 40px;
            height: 40px;
            border-radius: 20px;
            background: #F2F2F7;
            display: flex;
            align-items: center;
            justify-content: center;
            text-decoration: none;
            color: #007AFF;
            font-size: 20px;
            transition: background 0.2s;
        }

        .back-button:active {
            background: #E5E5EA;
        }

        .header h1 {
            font-size: 20px;
            font-weight: 600;
            color: #000;
        }

        .status-badge {
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-badge.active {
            background: #34C759;
            color: white;
        }

        .status-badge.inactive {
            background: #8E8E93;
            color: white;
        }

        .map-container {
            width: 100%;
            height: 400px;
            background: white;
            position: relative;
        }

        #map {
            width: 100%;
            height: 100%;
        }

        .map-loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #8E8E93;
        }

        .card {
            background: white;
            margin: 16px;
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }

        .card-title {
            font-size: 18px;
            font-weight: 600;
            color: #000;
            margin-bottom: 16px;
        }

        .status-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #F2F2F7;
        }

        .status-row:last-child {
            border-bottom: none;
        }

        .status-label {
            color: #8E8E93;
            font-size: 14px;
        }

        .status-value {
            font-size: 14px;
            font-weight: 500;
            color: #000;
        }

        .status-value.safe {
            color: #34C759;
        }

        .status-value.warning {
            color: #FF9500;
        }

        .status-value.dragging {
            color: #FF3B30;
            font-weight: 600;
        }

        .controls-section {
            margin: 16px 0;
        }

        .button {
            width: 100%;
            padding: 14px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            transition: opacity 0.2s;
            margin-bottom: 12px;
        }

        .button:active:not(:disabled) {
            opacity: 0.8;
        }

        .button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .button-primary {
            background: #007AFF;
            color: white;
        }

        .button-danger {
            background: #FF3B30;
            color: white;
        }

        .button-secondary {
            background: #8E8E93;
            color: white;
        }

        .slider-container {
            margin: 16px 0;
        }

        .slider-label {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }

        .slider-label span {
            font-size: 14px;
            color: #000;
        }

        .slider-value {
            font-weight: 600;
            color: #007AFF;
        }

        .slider {
            width: 100%;
            -webkit-appearance: none;
            appearance: none;
            height: 4px;
            border-radius: 2px;
            background: #E5E5EA;
            outline: none;
        }

        .slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: #007AFF;
            cursor: pointer;
        }

        .slider::-moz-range-thumb {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: #007AFF;
            cursor: pointer;
            border: none;
        }

        .table-container {
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th {
            text-align: left;
            padding: 8px;
            font-size: 12px;
            color: #8E8E93;
            font-weight: 600;
            text-transform: uppercase;
            border-bottom: 1px solid #E5E5EA;
        }

        td {
            padding: 8px;
            font-size: 14px;
            color: #000;
            border-bottom: 1px solid #F2F2F7;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr.safe {
            background: rgba(52, 199, 89, 0.05);
        }

        tr.warning {
            background: rgba(255, 149, 0, 0.05);
        }

        tr.dragging {
            background: rgba(255, 59, 48, 0.1);
        }

        .empty-state {
            text-align: center;
            padding: 32px;
            color: #8E8E93;
        }

        .error-message {
            background: #FF3B30;
            color: white;
            padding: 12px;
            border-radius: 8px;
            margin: 16px;
            font-size: 14px;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: #8E8E93;
        }

        @media (max-width: 600px) {
            .table-container {
                font-size: 12px;
            }

            th, td {
                padding: 6px;
                font-size: 12px;
            }
        }
    </style>
</head>
<body>
    <!-- Header -->
    <div class="header">
        <div class="header-left">
            <a href="/public/unified-mobile.html" class="back-button">←</a>
            <h1>Anchor Watch</h1>
        </div>
        <span id="statusBadge" class="status-badge inactive">Inactive</span>
    </div>

    <!-- Map -->
    <div class="map-container">
        <div id="map">
            <div class="map-loading">Loading map...</div>
        </div>
    </div>

    <!-- Current Status -->
    <div class="card">
        <h2 class="card-title">Current Status</h2>
        <div id="statusContent">
            <div class="loading">Loading...</div>
        </div>
    </div>

    <!-- Anchor Watch Controls -->
    <div class="card">
        <h2 class="card-title">Anchor Watch Controls</h2>
        <div id="controlsContent">
            <div class="loading">Loading...</div>
        </div>
    </div>

    <!-- Recent Positions -->
    <div class="card">
        <h2 class="card-title">Recent Positions</h2>
        <div id="positionsContent">
            <div class="loading">Loading...</div>
        </div>
    </div>

    <!-- Leaflet JS -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <script>
        // Configuration
        const API_BASE = '/admin/api/anchor-watch';
        const ADMIN_TOKEN = localStorage.getItem('adminToken') || '';
        const REFRESH_INTERVAL = 20000; // 20 seconds

        // State
        let map = null;
        let markers = {
            boat: null,
            anchor: null,
            zone: null,
            trail: null
        };
        let anchorWatchState = {
            active: false,
            anchor_lat: null,
            anchor_lon: null,
            radius_meters: null
        };
        let refreshTimer = null;

        // Helper function for API calls
        async function apiCall(endpoint, options = {}) {
            try {
                const response = await fetch(API_BASE + endpoint, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Token': ADMIN_TOKEN,
                        ...options.headers
                    }
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'API request failed');
                }

                return data;
            } catch (error) {
                console.error('API Error:', error);
                throw error;
            }
        }

        // Initialize map
        function initMap() {
            // Default center (will be updated with actual position)
            const defaultCenter = [18.4567, -64.1234]; // Caribbean

            map = L.map('map').setView(defaultCenter, 15);

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);

            // Initialize boat marker (blue dot)
            markers.boat = L.circleMarker(defaultCenter, {
                radius: 8,
                fillColor: '#007AFF',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map);
        }

        // Update map with current data
        function updateMap(status, positions) {
            if (!map) return;

            // Update boat position
            if (status.current_lat && status.current_lon) {
                const boatPos = [status.current_lat, status.current_lon];
                markers.boat.setLatLng(boatPos);
            }

            // Update anchor and zone if active
            if (status.active && status.anchor_lat && status.anchor_lon) {
                const anchorPos = [status.anchor_lat, status.anchor_lon];

                // Add/update anchor marker
                if (!markers.anchor) {
                    markers.anchor = L.marker(anchorPos, {
                        icon: L.divIcon({
                            html: '⚓',
                            iconSize: [30, 30],
                            className: 'anchor-icon'
                        })
                    }).addTo(map);
                } else {
                    markers.anchor.setLatLng(anchorPos);
                }

                // Add/update zone circle
                const zoneColor = status.status === 'safe' ? '#34C759' :
                                 status.status === 'warning' ? '#FF9500' : '#FF3B30';

                if (!markers.zone) {
                    markers.zone = L.circle(anchorPos, {
                        radius: status.radius_meters,
                        fillColor: zoneColor,
                        fillOpacity: 0.1,
                        color: zoneColor,
                        weight: 2
                    }).addTo(map);
                } else {
                    markers.zone.setLatLng(anchorPos);
                    markers.zone.setRadius(status.radius_meters);
                    markers.zone.setStyle({ color: zoneColor, fillColor: zoneColor });
                }

                // Center map on anchor
                map.setView(anchorPos, map.getZoom());
            } else {
                // Remove anchor and zone if inactive
                if (markers.anchor) {
                    map.removeLayer(markers.anchor);
                    markers.anchor = null;
                }
                if (markers.zone) {
                    map.removeLayer(markers.zone);
                    markers.zone = null;
                }
            }

            // Update trail with recent positions
            if (positions && positions.length > 0) {
                const trail = positions.map(p => [p.latitude, p.longitude]);

                if (markers.trail) {
                    map.removeLayer(markers.trail);
                }

                markers.trail = L.polyline(trail, {
                    color: '#007AFF',
                    weight: 2,
                    opacity: 0.4,
                    dashArray: '5, 10'
                }).addTo(map);
            }
        }

        // Render current status
        function renderStatus(status) {
            const statusBadge = document.getElementById('statusBadge');
            const statusContent = document.getElementById('statusContent');

            // Update badge
            if (status.active) {
                statusBadge.textContent = 'Active';
                statusBadge.className = 'status-badge active';
            } else {
                statusBadge.textContent = 'Inactive';
                statusBadge.className = 'status-badge inactive';
            }

            // Update status content
            if (!status.active) {
                statusContent.innerHTML = '<div class="empty-state">Anchor watch is not active</div>';
                return;
            }

            const statusClass = status.status === 'safe' ? 'safe' :
                               status.status === 'warning' ? 'warning' : 'dragging';

            const statusText = status.status === 'safe' ? 'Within safe zone' :
                              status.status === 'warning' ? 'Approaching limit' :
                              status.status === 'dragging' ? 'DRAGGING DETECTED' :
                              status.status === 'gps_lost' ? 'GPS SIGNAL LOST' : 'Unknown';

            statusContent.innerHTML = `
                <div class="status-row">
                    <span class="status-label">Distance from Anchor</span>
                    <span class="status-value">${status.distance_meters ? status.distance_meters + ' m' : 'N/A'}</span>
                </div>
                <div class="status-row">
                    <span class="status-label">Current Position</span>
                    <span class="status-value">${status.current_lat ? status.current_lat.toFixed(6) + ', ' + status.current_lon.toFixed(6) : 'N/A'}</span>
                </div>
                <div class="status-row">
                    <span class="status-label">Status</span>
                    <span class="status-value ${statusClass}">${statusText}</span>
                </div>
                <div class="status-row">
                    <span class="status-label">Last Updated</span>
                    <span class="status-value">${status.last_updated ? new Date(status.last_updated).toLocaleTimeString() : 'N/A'}</span>
                </div>
            `;
        }

        // Render controls
        function renderControls(status) {
            const controlsContent = document.getElementById('controlsContent');

            if (!status.active) {
                // Inactive - show activation controls
                controlsContent.innerHTML = `
                    <div class="controls-section">
                        <button id="inferBtn" class="button button-secondary" onclick="inferAnchorPosition()">
                            Infer Anchor Position
                        </button>
                        <div class="slider-container">
                            <div class="slider-label">
                                <span>Radius</span>
                                <span class="slider-value" id="radiusValue">50 m</span>
                            </div>
                            <input type="range" class="slider" id="radiusSlider"
                                   min="10" max="200" value="50" step="5"
                                   oninput="updateRadiusDisplay(this.value)">
                        </div>
                        <button id="activateBtn" class="button button-primary" disabled onclick="activateAnchorWatch()">
                            Activate Anchor Watch
                        </button>
                    </div>
                `;
            } else {
                // Active - show deactivation and adjustment controls
                controlsContent.innerHTML = `
                    <div class="controls-section">
                        <div class="status-row">
                            <span class="status-label">Anchor Position</span>
                            <span class="status-value">${status.anchor_lat.toFixed(6)}, ${status.anchor_lon.toFixed(6)}</span>
                        </div>
                        <div class="status-row">
                            <span class="status-label">Watch Radius</span>
                            <span class="status-value">${status.radius_meters} m</span>
                        </div>
                        <div class="slider-container">
                            <div class="slider-label">
                                <span>Adjust Radius</span>
                                <span class="slider-value" id="radiusValue">${status.radius_meters} m</span>
                            </div>
                            <input type="range" class="slider" id="radiusSlider"
                                   min="10" max="200" value="${status.radius_meters}" step="5"
                                   oninput="updateRadiusDisplay(this.value)">
                        </div>
                        <button class="button button-secondary" onclick="updateRadius()">
                            Update Radius
                        </button>
                        <button class="button button-danger" onclick="deactivateAnchorWatch()">
                            Deactivate Anchor Watch
                        </button>
                    </div>
                `;
            }
        }

        // Render positions table
        function renderPositions(positions) {
            const positionsContent = document.getElementById('positionsContent');

            if (!positions || positions.length === 0) {
                positionsContent.innerHTML = '<div class="empty-state">No GPS positions available</div>';
                return;
            }

            let tableHtml = `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Position</th>
                                <th>Distance</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            positions.forEach(pos => {
                const time = new Date(pos.timestamp).toLocaleTimeString();
                const latLon = `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`;
                const distance = pos.distance_from_anchor ? pos.distance_from_anchor + ' m' : '-';
                const rowClass = pos.status || '';

                tableHtml += `
                    <tr class="${rowClass}">
                        <td>${time}</td>
                        <td>${latLon}</td>
                        <td>${distance}</td>
                    </tr>
                `;
            });

            tableHtml += '</tbody></table></div>';
            positionsContent.innerHTML = tableHtml;
        }

        // Update radius display
        function updateRadiusDisplay(value) {
            document.getElementById('radiusValue').textContent = value + ' m';
        }

        // Infer anchor position
        async function inferAnchorPosition() {
            const btn = document.getElementById('inferBtn');
            btn.disabled = true;
            btn.textContent = 'Calculating...';

            try {
                const result = await apiCall('/infer', { method: 'POST' });

                // Store inferred position
                anchorWatchState.anchor_lat = result.data.latitude;
                anchorWatchState.anchor_lon = result.data.longitude;

                // Enable activate button
                document.getElementById('activateBtn').disabled = false;

                // Update button text
                btn.textContent = `Position Set (${result.data.sample_size} samples)`;

                // Show on map
                const anchorPos = [result.data.latitude, result.data.longitude];
                if (!markers.anchor) {
                    markers.anchor = L.marker(anchorPos, {
                        icon: L.divIcon({
                            html: '📍',
                            iconSize: [30, 30],
                            className: 'anchor-icon'
                        })
                    }).addTo(map);
                } else {
                    markers.anchor.setLatLng(anchorPos);
                }
                map.setView(anchorPos, 16);

            } catch (error) {
                alert('Failed to calculate anchor position: ' + error.message);
                btn.textContent = 'Infer Anchor Position';
            } finally {
                btn.disabled = false;
            }
        }

        // Activate anchor watch
        async function activateAnchorWatch() {
            if (!anchorWatchState.anchor_lat || !anchorWatchState.anchor_lon) {
                alert('Please infer anchor position first');
                return;
            }

            const radius = parseInt(document.getElementById('radiusSlider').value);
            const btn = document.getElementById('activateBtn');
            btn.disabled = true;

            try {
                await apiCall('/activate', {
                    method: 'POST',
                    body: JSON.stringify({
                        latitude: anchorWatchState.anchor_lat,
                        longitude: anchorWatchState.anchor_lon,
                        radius_meters: radius
                    })
                });

                // Refresh display
                await loadData();
                alert('Anchor watch activated successfully');

            } catch (error) {
                alert('Failed to activate anchor watch: ' + error.message);
            } finally {
                btn.disabled = false;
            }
        }

        // Update radius
        async function updateRadius() {
            const radius = parseInt(document.getElementById('radiusSlider').value);

            try {
                await apiCall('/radius', {
                    method: 'PUT',
                    body: JSON.stringify({ radius_meters: radius })
                });

                await loadData();
                alert('Radius updated successfully');

            } catch (error) {
                alert('Failed to update radius: ' + error.message);
            }
        }

        // Deactivate anchor watch
        async function deactivateAnchorWatch() {
            if (!confirm('Are you sure you want to deactivate anchor watch?')) {
                return;
            }

            try {
                await apiCall('/deactivate', { method: 'POST' });

                // Clear stored state
                anchorWatchState = {
                    active: false,
                    anchor_lat: null,
                    anchor_lon: null,
                    radius_meters: null
                };

                await loadData();
                alert('Anchor watch deactivated');

            } catch (error) {
                alert('Failed to deactivate: ' + error.message);
            }
        }

        // Load all data
        async function loadData() {
            try {
                // Fetch status and positions in parallel
                const [statusResult, positionsResult] = await Promise.all([
                    apiCall('/status'),
                    apiCall('/positions?limit=20')
                ]);

                const status = statusResult.data;
                const positions = positionsResult.data.positions;

                // Update state
                anchorWatchState = {
                    active: status.active,
                    anchor_lat: status.anchor_lat,
                    anchor_lon: status.anchor_lon,
                    radius_meters: status.radius_meters
                };

                // Update display
                renderStatus(status);
                renderControls(status);
                renderPositions(positions);
                updateMap(status, positions);

            } catch (error) {
                console.error('Failed to load data:', error);
                document.getElementById('statusContent').innerHTML =
                    '<div class="error-message">Failed to load status data</div>';
            }
        }

        // Start auto-refresh
        function startAutoRefresh() {
            if (refreshTimer) {
                clearInterval(refreshTimer);
            }
            refreshTimer = setInterval(loadData, REFRESH_INTERVAL);
        }

        // Initialize on page load
        document.addEventListener('DOMContentLoaded', () => {
            // Check for admin token
            if (!ADMIN_TOKEN) {
                alert('Admin token not found. Please log in.');
                window.location.href = '/public/unified-mobile.html';
                return;
            }

            // Initialize map
            initMap();

            // Load initial data
            loadData();

            // Start auto-refresh
            startAutoRefresh();
        });

        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            if (refreshTimer) {
                clearInterval(refreshTimer);
            }
        });
    </script>
</body>
</html>
```

---

## 🧪 TESTING CHECKLIST

### Backend Testing (Use curl or Postman)

1. **Test GPS Repository**
   ```bash
   # Check if GPS data exists
   SELECT * FROM gps_position ORDER BY timestamp DESC LIMIT 1;
   ```

2. **Test API Endpoints**
   ```bash
   # Get status (should return inactive initially)
   curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:3000/admin/api/anchor-watch/status

   # Get positions
   curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:3000/admin/api/anchor-watch/positions

   # Infer centroid
   curl -X POST -H "X-Admin-Token: YOUR_TOKEN" http://localhost:3000/admin/api/anchor-watch/infer

   # Activate (use values from infer)
   curl -X POST -H "X-Admin-Token: YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"latitude": 18.4567, "longitude": -64.1234, "radius_meters": 50}' \
     http://localhost:3000/admin/api/anchor-watch/activate

   # Update radius
   curl -X PUT -H "X-Admin-Token: YOUR_TOKEN" -H "Content-Type: application/json" \
     -d '{"radius_meters": 75}' \
     http://localhost:3000/admin/api/anchor-watch/radius

   # Deactivate
   curl -X POST -H "X-Admin-Token: YOUR_TOKEN" http://localhost:3000/admin/api/anchor-watch/deactivate
   ```

### Frontend Testing

1. **Page Load**
   - [ ] Page loads at http://localhost:3000/public/anchor-watch-admin.html
   - [ ] Map displays correctly
   - [ ] Status shows "Inactive" initially
   - [ ] No console errors

2. **Activation Flow**
   - [ ] "Infer Anchor Position" calculates centroid
   - [ ] Radius slider works (10-200m)
   - [ ] "Activate" enables anchor watch
   - [ ] Map shows anchor marker and zone circle

3. **Active State**
   - [ ] Status updates every 20 seconds
   - [ ] Distance from anchor displays correctly
   - [ ] Zone color changes (green/yellow/red) based on distance
   - [ ] Recent positions table shows data

4. **Deactivation**
   - [ ] Deactivate button works
   - [ ] Confirmation dialog appears
   - [ ] Zone and anchor removed from map

5. **Error Handling**
   - [ ] Graceful handling if no GPS data
   - [ ] Error messages display properly
   - [ ] Admin token required

---

## 🚨 CRITICAL REMINDERS

1. **MUST READ** `.cursorrules` and `claude.md` before implementing
2. **FOLLOW** routes → services → repositories pattern strictly
3. **USE** existing error handling patterns with logger.js
4. **TEST** backend APIs before frontend
5. **NO** external dependencies except Leaflet (CDN)
6. **MAINTAIN** standard envelope format for all API responses
7. **CHECK** that gps_position table exists before testing
8. **ENSURE** admin token is in localStorage before accessing page

---

## 📋 IMPLEMENTATION ORDER

1. ✅ Run Supabase migration (SQL provided above)
2. ✅ Update .env with new variables
3. ✅ Update src/config/env.js with new schema fields
4. ✅ Create src/repositories/gps.repository.js
5. ✅ Create src/services/anchor-watch.service.js
6. ✅ Create src/routes/admin/anchor-watch.route.js
7. ✅ Register route in src/routes/admin/index.js
8. ✅ Test all backend endpoints with curl
9. ✅ Create src/public/anchor-watch-admin.html
10. ✅ Test frontend functionality
11. ✅ Add link to anchor-watch-admin.html from unified-mobile.html (optional)

---

## 🎯 SUCCESS CRITERIA

- [ ] All API endpoints return correct data format
- [ ] Frontend displays GPS position on map
- [ ] Anchor zone displays correctly when active
- [ ] Distance calculations are accurate
- [ ] Status (safe/warning/dragging) updates correctly
- [ ] Auto-refresh works every 20 seconds
- [ ] Mobile responsive design works
- [ ] No regression errors in existing code
- [ ] Follows all project patterns and standards

---

**END OF SPECIFICATION**

This document is complete and ready for implementation. No assumptions needed - everything is specified.
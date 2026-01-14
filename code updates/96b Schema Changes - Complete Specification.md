# 96b Schema Changes - Complete Specification

**Date:** 2026-01-13
**Parent Document:** 96 Document Foundation Crisis
**Status:** PLANNING - Not yet implemented

---

## Overview

This document specifies ALL database schema changes discussed in Sessions 1-3 of the Document Foundation Crisis work.

**Categories:**
1. Reference Tables (NEW)
2. Systems Table Changes
3. Instances Table (clarify usage)
4. System Photos Table (NEW)
5. DIP Staging Tables (NEW)
6. OEM Tracking

---

## What Belongs in the Systems Table

**YES - Track these (have manuals, maintenance, troubleshooting):**
- Engines, saildrives, controllers
- Electronics (chartplotters, autopilots, radars, VHF)
- Electrical systems (inverters, MPPT, batteries, BMS)
- Pumps (water, bilge, watermaker)
- Climate (AC, refrigeration, water heaters)
- Windlasses, electric winches

**NO - Don't track these (simple hardware, no manuals needed):**
- Fairleads, blocks, clutches, cam cleats
- Shackles, turnbuckles, thimbles
- Rope, chain, anchor swivels
- Basic plumbing fittings

**Rule of thumb:** If it has a manual with specs, maintenance procedures, or troubleshooting - it's a system. If it's just hardware you install and forget - it's not.

---

## 1. Reference Tables (NEW)

### 1.1 ref_manufacturers

Lookup table for equipment manufacturers/brands.

```sql
CREATE TABLE ref_manufacturers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "B&G", "Yanmar", "Victron"
  display_name TEXT,                      -- "B&G (Navico)" for display
  website TEXT,                           -- "https://www.bandg.com"
  logo_url TEXT,                          -- URL to logo image
  parent_company TEXT,                    -- "Navico", "Garmin" (for corporate ownership)
  is_oem BOOLEAN DEFAULT false,           -- true if primarily an OEM (Airmar, Hy-ProDrive)
  notes TEXT,                             -- Any relevant notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX idx_ref_manufacturers_name ON ref_manufacturers(name);
```

**Initial data migration:**
```sql
-- Populate from existing systems.manufacturer_norm
INSERT INTO ref_manufacturers (name)
SELECT DISTINCT manufacturer_norm
FROM systems
WHERE manufacturer_norm IS NOT NULL
ON CONFLICT (name) DO NOTHING;
```

**Known OEM relationships to add:**
| Branded | OEM |
|---------|-----|
| B&G (transducers) | Airmar |
| B&G (autopilot rams) | Hy-ProDrive |
| Raymarine (autopilot rams) | Hy-ProDrive |
| Garmin (autopilot rams) | Hy-ProDrive |

---

### 1.2 ref_product_types

Lookup table for product types (universal across manufacturers).

```sql
CREATE TABLE ref_product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "Transducer", "Autopilot Computer", "Engine"
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX idx_ref_product_types_name ON ref_product_types(name);
```

**Initial data - common product types:**
```sql
INSERT INTO ref_product_types (name) VALUES
  ('Engine'),
  ('Saildrive'),
  ('Transducer'),
  ('Autopilot Computer'),
  ('Autopilot Ram'),
  ('Rudder Feedback'),
  ('Chartplotter/MFD'),
  ('Radar'),
  ('GPS Antenna'),
  ('VHF Radio'),
  ('AIS'),
  ('Solar Panel'),
  ('MPPT Controller'),
  ('Battery'),
  ('Inverter/Charger'),
  ('Battery Monitor'),
  ('BMS'),
  ('DC-DC Converter'),
  ('Watermaker'),
  ('Windlass'),
  ('Winch'),
  ('Refrigeration'),
  ('Air Conditioner'),
  ('Water Heater'),
  ('Bilge Pump'),
  ('Fresh Water Pump'),
  ('Toilet/Head'),
  ('Fuel Filter'),
  ('Camera'),
  ('Lighting'),
  ('Anchor'),
  ('Network Switch'),
  ('Gateway/Bridge'),
  ('Display/Instrument')
ON CONFLICT (name) DO NOTHING;
```

---

### 1.3 ref_system_categories

Lookup table for functional system categories (what it DOES).

```sql
CREATE TABLE ref_system_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "Navigation", "Propulsion", "Electrical (DC)"
  description TEXT,
  display_order INTEGER,                  -- For UI sorting
  icon TEXT,                              -- Icon name for UI
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ref_system_categories_name ON ref_system_categories(name);
```

**Initial data from existing system_norm values:**
```sql
INSERT INTO ref_system_categories (name, display_order) VALUES
  ('Propulsion', 1),
  ('Navigation', 2),
  ('Electrical (DC)', 3),
  ('Communications', 4),
  ('Control/automation', 5),
  ('Hull/Plumbing', 6),
  ('Rigging/Deck', 7),
  ('Interior/Comfort', 8),
  ('Safety', 9)
ON CONFLICT (name) DO NOTHING;
```

---

### 1.4 ref_subsystem_categories

Lookup table for functional subsystem categories.

```sql
CREATE TABLE ref_subsystem_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id UUID REFERENCES ref_system_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- "Autopilot", "Engines", "Batteries"
  description TEXT,
  display_order INTEGER,
  UNIQUE(system_id, name),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ref_subsystem_categories_system ON ref_subsystem_categories(system_id);
CREATE INDEX idx_ref_subsystem_categories_name ON ref_subsystem_categories(name);
```

**Initial data - examples per system:**
```sql
-- Get system IDs first, then insert subsystems
-- Propulsion
INSERT INTO ref_subsystem_categories (system_id, name)
SELECT id, unnest(ARRAY['Engines', 'Saildrive', 'Controls', 'Alternators/regulator', 'Tender'])
FROM ref_system_categories WHERE name = 'Propulsion';

-- Navigation
INSERT INTO ref_subsystem_categories (system_id, name)
SELECT id, unnest(ARRAY['Autopilot', 'GPS/gnss', 'Radar', 'Displays/mfds', 'Instruments', 'Compass', 'Sonar/forwardscan', 'Camera', 'Networking'])
FROM ref_system_categories WHERE name = 'Navigation';

-- Electrical (DC)
INSERT INTO ref_subsystem_categories (system_id, name)
SELECT id, unnest(ARRAY['Batteries', 'Solar/mppt', 'Inverter/charger', 'BMS', 'Monitoring', 'Distribution/busbars', 'Converters'])
FROM ref_system_categories WHERE name = 'Electrical (DC)';

-- etc. for other systems
```

---

## 2. Systems Table Changes

### 2.1 New Columns

```sql
-- Add FK columns for reference tables
ALTER TABLE systems ADD COLUMN manufacturer_id UUID REFERENCES ref_manufacturers(id);
ALTER TABLE systems ADD COLUMN product_type_id UUID REFERENCES ref_product_types(id);
ALTER TABLE systems ADD COLUMN system_category_id UUID REFERENCES ref_system_categories(id);
ALTER TABLE systems ADD COLUMN subsystem_category_id UUID REFERENCES ref_subsystem_categories(id);

-- Add OEM tracking
ALTER TABLE systems ADD COLUMN oem_manufacturer_id UUID REFERENCES ref_manufacturers(id);
ALTER TABLE systems ADD COLUMN oem_model TEXT;
ALTER TABLE systems ADD COLUMN oem_part_number TEXT;

-- Add serial number (for single-instance systems)
ALTER TABLE systems ADD COLUMN serial_number TEXT;

-- Indexes
CREATE INDEX idx_systems_manufacturer ON systems(manufacturer_id);
CREATE INDEX idx_systems_product_type ON systems(product_type_id);
CREATE INDEX idx_systems_system_category ON systems(system_category_id);
CREATE INDEX idx_systems_subsystem_category ON systems(subsystem_category_id);
CREATE INDEX idx_systems_oem_manufacturer ON systems(oem_manufacturer_id);
```

### 2.2 Data Migration

```sql
-- Migrate manufacturer_norm to manufacturer_id
UPDATE systems s
SET manufacturer_id = m.id
FROM ref_manufacturers m
WHERE s.manufacturer_norm = m.name;

-- Migrate system_norm to system_category_id
UPDATE systems s
SET system_category_id = c.id
FROM ref_system_categories c
WHERE s.system_norm = c.name;

-- Migrate subsystem_norm to subsystem_category_id
UPDATE systems s
SET subsystem_category_id = c.id
FROM ref_subsystem_categories c
WHERE s.subsystem_norm = c.name;
```

### 2.3 Columns to Keep

| Column | Status | Notes |
|--------|--------|-------|
| asset_uid | KEEP | Primary key |
| manufacturer_norm | DEPRECATE | Keep during migration, drop later |
| model_norm | KEEP | Actual model number (clean up data) |
| system_norm | DEPRECATE | Keep during migration, drop later |
| subsystem_norm | DEPRECATE | Keep during migration, drop later |
| canonical_model_id | REVIEW | May not be needed with new structure |
| description | KEEP | Human description |
| manual_url | KEEP | External manual link |
| oem_page | KEEP | OEM product page |
| manual | KEEP | Boolean flag |
| local_manual_file_name | KEEP | Local file reference |

### 2.4 Final Systems Table Structure

```sql
-- After migration complete
systems:
  asset_uid UUID PRIMARY KEY

  -- Identity (what it IS)
  manufacturer_id UUID REFERENCES ref_manufacturers(id)
  product_type_id UUID REFERENCES ref_product_types(id)
  model_norm TEXT                         -- Specific model number

  -- OEM info (nullable)
  oem_manufacturer_id UUID REFERENCES ref_manufacturers(id)
  oem_model TEXT
  oem_part_number TEXT

  -- Functional category (what it DOES)
  system_category_id UUID REFERENCES ref_system_categories(id)
  subsystem_category_id UUID REFERENCES ref_subsystem_categories(id)

  -- Details
  description TEXT
  serial_number TEXT                      -- For single-instance items

  -- Manual references
  manual_url TEXT
  oem_page TEXT
  manual BOOLEAN
  local_manual_file_name TEXT

  -- Metadata
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ
```

---

## 3. Instances Table (Existing - Clarify Usage)

The `instances` table already exists for tracking multiple physical items of the same type.

### 3.1 Current Structure

```sql
instances:
  instance_uid UUID PRIMARY KEY
  asset_uid UUID REFERENCES systems(asset_uid)  -- FK to system type
  serial_number TEXT
  location TEXT                           -- "Port", "Stbd", "Salon", etc.
  instance_index INTEGER                  -- 1, 2, 3 for numbering
```

### 3.2 Usage Pattern

| Scenario | systems rows | instances rows |
|----------|--------------|----------------|
| Single engine | 1 (Yanmar 4JH80) | 0 (use systems.serial_number) |
| Twin engines | 1 (Yanmar 4JH80) | 2 (Port S/N xxx, Stbd S/N yyy) |
| Single chartplotter | 1 (Zeus S 16) | 0 |
| Multiple batteries | 1 (Victron LiFePO4 200Ah) | 4 (Bank 1-4) |

### 3.3 Rule

- If you have ONE of something → serial_number on systems table
- If you have MULTIPLE of same thing → use instances table

---

## 4. System Photos Table (NEW)

For attaching photos to systems (from photo-based discovery).

```sql
CREATE TABLE system_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  instance_uid UUID REFERENCES instances(instance_uid) ON DELETE CASCADE,  -- nullable, for instance-specific photos

  -- Photo info
  photo_path TEXT NOT NULL,               -- Storage path
  photo_type TEXT,                        -- 'nameplate', 'installed', 'serial', 'overview'
  photo_filename TEXT,                    -- Original filename

  -- Vision extraction results
  extracted_text JSONB,                   -- Raw Vision output
  extracted_manufacturer TEXT,            -- Parsed manufacturer
  extracted_model TEXT,                   -- Parsed model
  extracted_serial TEXT,                  -- Parsed serial number
  extraction_confidence NUMERIC,          -- Vision confidence

  -- Metadata
  captured_at TIMESTAMPTZ,                -- When photo was taken (from EXIF)
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_system_photos_asset ON system_photos(asset_uid);
CREATE INDEX idx_system_photos_instance ON system_photos(instance_uid);
CREATE INDEX idx_system_photos_type ON system_photos(photo_type);
```

---

## 5. DIP Staging Tables (NEW)

### 5.1 staging_troubleshooting

For symptom → cause → resolution mappings extracted from manuals.

```sql
CREATE TABLE staging_troubleshooting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,

  -- System link
  asset_uid UUID REFERENCES systems(asset_uid),

  -- Troubleshooting content
  symptom TEXT NOT NULL,                  -- "Engine won't start"
  symptom_variations TEXT[],              -- ["won't start", "no start", "fails to start"]
  symptom_category TEXT,                  -- 'wont_start', 'overheating', 'noise', 'leak', 'error_code'

  cause TEXT NOT NULL,                    -- "Battery isolator off"
  check_action TEXT,                      -- "Check battery isolator switch position"
  resolution TEXT,                        -- "Turn battery isolator to ON"

  -- Source tracking
  source_type TEXT,                       -- 'troubleshooting_table', 'procedure_prerequisite', 'safety_warning'
  source_ref TEXT,                        -- Page number, section reference

  -- Cross-system linking (KEY FEATURE)
  related_system_uid UUID REFERENCES systems(asset_uid),
  related_system_name TEXT,               -- "Battery Isolator" (denormalized for display)
  relationship_type TEXT,                 -- 'requires', 'affects', 'blocks'

  -- Model applicability
  models TEXT[],                          -- ["4JH45", "4JH57", "4JH80", "4JH110"]

  -- Processing
  priority INTEGER,                       -- For ordering troubleshooting steps
  status TEXT DEFAULT 'pending',          -- 'pending', 'approved', 'rejected'
  processing_run_id UUID,

  -- Metadata
  manufacturer_norm TEXT,
  model_norm TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_staging_troubleshooting_doc ON staging_troubleshooting(doc_id);
CREATE INDEX idx_staging_troubleshooting_asset ON staging_troubleshooting(asset_uid);
CREATE INDEX idx_staging_troubleshooting_status ON staging_troubleshooting(status);
CREATE INDEX idx_staging_troubleshooting_symptom ON staging_troubleshooting(symptom_category);
CREATE INDEX idx_staging_troubleshooting_related ON staging_troubleshooting(related_system_uid);
```

### 5.2 staging_system_relationships

For DIP-extracted relationships between systems (families emerge from this).

```sql
CREATE TABLE staging_system_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,

  -- Relationship
  source_system_uid UUID REFERENCES systems(asset_uid),
  target_system_uid UUID REFERENCES systems(asset_uid),

  relationship_type TEXT NOT NULL,        -- 'controls', 'powers', 'feeds', 'monitors', 'connects_to'
  relationship_text TEXT,                 -- Original text from manual

  -- Directionality
  is_bidirectional BOOLEAN DEFAULT false,

  -- Context
  context TEXT,                           -- Where in the manual this was found
  source_ref TEXT,                        -- Page/section reference

  -- Processing
  confidence NUMERIC,
  status TEXT DEFAULT 'pending',          -- 'pending', 'approved', 'rejected'
  processing_run_id UUID,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_staging_relationships_source ON staging_system_relationships(source_system_uid);
CREATE INDEX idx_staging_relationships_target ON staging_system_relationships(target_system_uid);
CREATE INDEX idx_staging_relationships_status ON staging_system_relationships(status);
CREATE INDEX idx_staging_relationships_type ON staging_system_relationships(relationship_type);

-- Prevent duplicate relationships
CREATE UNIQUE INDEX idx_staging_relationships_unique
ON staging_system_relationships(source_system_uid, target_system_uid, relationship_type)
WHERE status = 'approved';
```

### 5.3 Production Relationship Table

After DIP agent approves relationships:

```sql
CREATE TABLE system_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  target_system_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  relationship_text TEXT,
  is_bidirectional BOOLEAN DEFAULT false,
  source_doc_id TEXT,                     -- Which document this came from
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source_system_uid, target_system_uid, relationship_type)
);

CREATE INDEX idx_system_relationships_source ON system_relationships(source_system_uid);
CREATE INDEX idx_system_relationships_target ON system_relationships(target_system_uid);
```

---

## 6. Documents Table Updates

Add model coverage tracking:

```sql
ALTER TABLE documents ADD COLUMN models_covered TEXT[];  -- ["4JH45", "4JH57", "4JH80"]
ALTER TABLE documents ADD COLUMN is_oem_manual BOOLEAN DEFAULT false;
ALTER TABLE documents ADD COLUMN oem_for_asset_uid UUID REFERENCES systems(asset_uid);
```

---

## 7. Summary of All Changes

### New Tables (6)

| Table | Purpose |
|-------|---------|
| ref_manufacturers | Manufacturer lookup |
| ref_product_types | Product type lookup (universal) |
| ref_system_categories | Functional system categories |
| ref_subsystem_categories | Functional subsystem categories |
| system_photos | Photos attached to systems |
| staging_troubleshooting | DIP-extracted troubleshooting |
| staging_system_relationships | DIP-extracted relationships |
| system_relationships | Approved relationships (production) |

### Modified Tables (2)

| Table | Changes |
|-------|---------|
| systems | Add FKs to reference tables, add OEM columns, add serial_number |
| documents | Add models_covered[], is_oem_manual, oem_for_asset_uid |

### Deprecated Columns (to drop after migration)

| Table | Column | Replaced By |
|-------|--------|-------------|
| systems | manufacturer_norm | manufacturer_id |
| systems | system_norm | system_category_id |
| systems | subsystem_norm | subsystem_category_id |

---

## 8. Migration Order

```
1. Create reference tables (ref_*)
2. Populate reference tables from existing data
3. Add new columns to systems table
4. Migrate data to new FK columns
5. Create system_photos table
6. Create staging_troubleshooting table
7. Create staging_system_relationships table
8. Create system_relationships table
9. Update documents table
10. Verify all data migrated
11. Drop deprecated columns (future)
```

---

## 9. Data Cleanup Required

Before or during migration:

| Issue | Current Value | Should Be |
|-------|---------------|-----------|
| systems.model_norm | "Port_Stbd_Engine" | "4JH80" |
| systems.model_norm | "mixer_tap" | Actual model number |
| systems.model_norm | "marine_water_heater" | Actual model number |
| Missing OEM links | B&G DST810 | Add Airmar as OEM |
| Missing OEM links | B&G T2 Ram | Add Hy-ProDrive as OEM |

---

## 10. Relationship Types Reference

Standard relationship types for `staging_system_relationships`:

| Type | Example |
|------|---------|
| `controls` | NAC-3 controls T2 Ram |
| `powers` | Battery powers Chartplotter |
| `monitors` | BMS monitors Battery |
| `feeds` | Solar Panel feeds MPPT |
| `connects_to` | VHF connects to AIS Splitter |
| `provides_feedback` | RF25N provides feedback to NAC-3 |
| `requires` | Engine requires Battery Isolator ON |
| `cools` | Raw Water Pump cools Engine |

---

## 11. Comprehensive Synonym System

Synonyms are critical for query expansion and matching. They exist at every level of the hierarchy.

### 11.1 Schema Updates for Synonyms

```sql
-- Add synonyms to all reference tables
ALTER TABLE ref_manufacturers ADD COLUMN synonyms TEXT[] DEFAULT '{}';
ALTER TABLE ref_product_types ADD COLUMN synonyms TEXT[] DEFAULT '{}';
ALTER TABLE ref_system_categories ADD COLUMN synonyms TEXT[] DEFAULT '{}';
ALTER TABLE ref_subsystem_categories ADD COLUMN synonyms TEXT[] DEFAULT '{}';

-- Systems table - add model synonyms (synonyms_human already exists)
ALTER TABLE systems ADD COLUMN model_synonyms TEXT[] DEFAULT '{}';

-- Centroids have synonyms (from section 10)
-- centroids.synonyms TEXT[]
```

### 11.2 Synonym Matching Function

```sql
-- Function to check if search term matches value or any synonym
CREATE OR REPLACE FUNCTION matches_with_synonyms(
  search_term TEXT,
  target_value TEXT,
  target_synonyms TEXT[]
) RETURNS BOOLEAN AS $$
BEGIN
  -- Exact match on value (case-insensitive)
  IF lower(trim(target_value)) = lower(trim(search_term)) THEN
    RETURN TRUE;
  END IF;

  -- Match in synonyms array (case-insensitive)
  IF target_synonyms IS NOT NULL AND array_length(target_synonyms, 1) > 0 THEN
    IF lower(trim(search_term)) = ANY(
      SELECT lower(trim(unnest(target_synonyms)))
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to expand a term to all its synonyms
CREATE OR REPLACE FUNCTION expand_synonyms(
  search_term TEXT,
  table_name TEXT
) RETURNS TEXT[] AS $$
DECLARE
  result TEXT[];
BEGIN
  -- This would need dynamic SQL based on table_name
  -- Simplified version - returns array including original term
  result := ARRAY[search_term];

  -- Look up synonyms from appropriate table
  -- Implementation depends on table structure

  RETURN result;
END;
$$ LANGUAGE plpgsql;
```

### 11.3 Seed Data: Manufacturer Synonyms

```sql
UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Brookes and Gatehouse', 'B and G', 'BandG', 'B+G', 'Navico B&G'
] WHERE name = 'B&G';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Yanmar Marine', 'Yanmar Diesel', 'Yanmar Engine'
] WHERE name = 'Yanmar';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Victron Energy', 'Victron Power'
] WHERE name = 'Victron';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Harken Marine', 'Harken Inc'
] WHERE name = 'Harken';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Blue Sea Systems', 'BlueSea'
] WHERE name = 'Blue Sea';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Airmar Technology', 'Airmar Transducers'
] WHERE name = 'Airmar';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Hy-ProDrive', 'Hydraulic Projects', 'HyPro', 'Hy-Pro'
] WHERE name = 'Hy-ProDrive';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Isotherm', 'Indel Webasto Marine'
] WHERE name = 'Isotemp';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Spinlock Performance', 'Spinlock Rig-Sense'
] WHERE name = 'Spinlock';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Raymarine', 'Ray Marine', 'Flir Raymarine'
] WHERE name = 'Raymarine';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Garmin Marine', 'Garmin Navionics'
] WHERE name = 'Garmin';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Simrad Yachting', 'Simrad Marine'
] WHERE name = 'Simrad';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Lewmar Marine', 'Lewmar Winches'
] WHERE name = 'Lewmar';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Antal S.r.l.', 'Antal Italy'
] WHERE name = 'Antal';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'CZone Digital Switching', 'Mastervolt CZone'
] WHERE name = 'CZone';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Mastervolt Power', 'Master Volt'
] WHERE name = 'Mastervolt';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Quick Nautical Equipment', 'Quick Windlass'
] WHERE name = 'Quick';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Vetus Maxwell', 'VETUS'
] WHERE name = 'Vetus';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Peplink Pepwave', 'Pepwave Mobile'
] WHERE name = 'Peplink';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Schenker Watermakers', 'Schenker Italy'
] WHERE name = 'Schenker';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Racor Filtration', 'Parker Racor'
] WHERE name = 'Racor';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Frigomar SpA', 'Frigomar AC'
] WHERE name = 'Frigomar';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Marco SpA', 'Marco Pumps'
] WHERE name = 'Marco';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Integrel Energy', 'Integrel Solutions'
] WHERE name = 'Integrel';

UPDATE ref_manufacturers SET synonyms = ARRAY[
  'Cyclops Marine Tech', 'Cyclops SmartRigging'
] WHERE name = 'Cyclops Marine';
```

### 11.4 Seed Data: Product Type Synonyms

```sql
-- Propulsion
UPDATE ref_product_types SET synonyms = ARRAY[
  'motor', 'diesel', 'main engine', 'inboard', 'diesel engine',
  'propulsion engine', 'marine engine', 'boat engine'
] WHERE name = 'Engine';

UPDATE ref_product_types SET synonyms = ARRAY[
  'sail drive', 'leg', 'drive leg', 'stern drive', 'S-drive',
  'transmission', 'drive unit'
] WHERE name = 'Saildrive';

-- Navigation
UPDATE ref_product_types SET synonyms = ARRAY[
  'DST', 'depth sensor', 'speed sensor', 'thru-hull sensor',
  'through-hull sensor', 'depth sounder', 'paddlewheel', 'paddle wheel',
  'triducer', 'multi-sensor', 'hull sensor', 'log', 'speedo'
] WHERE name = 'Transducer';

UPDATE ref_product_types SET synonyms = ARRAY[
  'AP', 'auto pilot', 'autopilot brain', 'pilot computer',
  'autopilot processor', 'course computer', 'helm controller'
] WHERE name = 'Autopilot Computer';

UPDATE ref_product_types SET synonyms = ARRAY[
  'autopilot drive', 'hydraulic ram', 'linear drive', 'actuator',
  'pilot ram', 'steering ram', 'AP drive', 'hydraulic actuator'
] WHERE name = 'Autopilot Ram';

UPDATE ref_product_types SET synonyms = ARRAY[
  'rudder sensor', 'feedback unit', 'rudder position', 'RFU',
  'rudder reference', 'helm position sensor'
] WHERE name = 'Rudder Feedback';

UPDATE ref_product_types SET synonyms = ARRAY[
  'MFD', 'plotter', 'display', 'chart display', 'navigation display',
  'multifunction display', 'chart plotter', 'nav screen'
] WHERE name = 'Chartplotter/MFD';

UPDATE ref_product_types SET synonyms = ARRAY[
  'dome radar', 'open array', 'scanner', 'broadband radar',
  'pulse radar', 'doppler radar', 'marine radar'
] WHERE name = 'Radar';

UPDATE ref_product_types SET synonyms = ARRAY[
  'GPS receiver', 'GNSS', 'GPS dome', 'position sensor',
  'satellite antenna', 'GPS antenna', 'chartplotter GPS'
] WHERE name = 'GPS Antenna';

UPDATE ref_product_types SET synonyms = ARRAY[
  'heading sensor', 'fluxgate', 'electronic compass', 'gyro compass',
  'attitude sensor', '9-axis compass', 'AHRS'
] WHERE name = 'Compass';

-- Communications
UPDATE ref_product_types SET synonyms = ARRAY[
  'VHF', 'marine radio', 'DSC radio', 'handheld radio',
  'fixed VHF', 'VHF transceiver', 'two-way radio'
] WHERE name = 'VHF Radio';

UPDATE ref_product_types SET synonyms = ARRAY[
  'transponder', 'AIS transceiver', 'class B AIS', 'class A AIS',
  'AIS receiver', 'automatic identification'
] WHERE name = 'AIS';

-- Electrical
UPDATE ref_product_types SET synonyms = ARRAY[
  'house battery', 'start battery', 'bank', 'battery bank',
  'lithium battery', 'LiFePO4', 'AGM', 'gel battery', 'cells'
] WHERE name = 'Battery';

UPDATE ref_product_types SET synonyms = ARRAY[
  'inverter', 'charger', 'combi', 'inverter charger',
  'shore charger', 'battery charger', 'AC charger', 'multiplus',
  'quattro'
] WHERE name = 'Inverter/Charger';

UPDATE ref_product_types SET synonyms = ARRAY[
  'shunt', 'battery monitor', 'coulomb counter', 'SOC monitor',
  'state of charge', 'amp hour meter', 'smartshunt'
] WHERE name = 'Battery Monitor';

UPDATE ref_product_types SET synonyms = ARRAY[
  'battery management', 'cell balancer', 'lithium BMS',
  'protection circuit', 'battery manager'
] WHERE name = 'BMS';

UPDATE ref_product_types SET synonyms = ARRAY[
  'solar controller', 'charge controller', 'MPPT',
  'maximum power point', 'solar regulator', 'PV controller'
] WHERE name = 'MPPT Controller';

UPDATE ref_product_types SET synonyms = ARRAY[
  'PV panel', 'photovoltaic', 'solar module', 'solar array',
  'deck solar', 'bimini solar', 'flexible solar'
] WHERE name = 'Solar Panel';

UPDATE ref_product_types SET synonyms = ARRAY[
  'buck converter', 'boost converter', 'voltage converter',
  'DC converter', 'step down', 'step up', 'Orion'
] WHERE name = 'DC-DC Converter';

UPDATE ref_product_types SET synonyms = ARRAY[
  'isolator', 'battery switch', 'disconnect', 'kill switch',
  'master switch', 'battery cutoff', 'main switch', 'RBS'
] WHERE name = 'Battery Switch';

-- Rigging/Deck
UPDATE ref_product_types SET synonyms = ARRAY[
  'bullseye', 'deck organizer', 'line guide', 'rope guide',
  'turning block', 'lead block', 'deck lead'
] WHERE name = 'Fairlead';

UPDATE ref_product_types SET synonyms = ARRAY[
  'self-tailing', 'ST winch', 'electric winch', 'powered winch',
  'halyard winch', 'sheet winch', 'drum winch', 'reel'
] WHERE name = 'Winch';

UPDATE ref_product_types SET synonyms = ARRAY[
  'anchor winch', 'ground tackle', 'anchor windlass',
  'vertical windlass', 'horizontal windlass', 'capstan'
] WHERE name = 'Windlass';

UPDATE ref_product_types SET synonyms = ARRAY[
  'clutch', 'rope clutch', 'line stopper', 'jammer',
  'cam cleat', 'rope jammer', 'XTS', 'XCS'
] WHERE name = 'Rope Clutch';

UPDATE ref_product_types SET synonyms = ARRAY[
  'turning block', 'cheek block', 'snatch block', 'fiddle block',
  'ratchet block', 'sheave', 'pulley'
] WHERE name = 'Block';

UPDATE ref_product_types SET synonyms = ARRAY[
  'main anchor', 'kedge', 'stern anchor', 'lunch hook',
  'CQR', 'Delta', 'Rocna', 'Mantus', 'plow anchor'
] WHERE name = 'Anchor';

-- Plumbing
UPDATE ref_product_types SET synonyms = ARRAY[
  'desal', 'desalinator', 'reverse osmosis', 'RO',
  'water maker', 'freshwater maker', 'desalination'
] WHERE name = 'Watermaker';

UPDATE ref_product_types SET synonyms = ARRAY[
  'toilet', 'marine head', 'MSD', 'holding tank toilet',
  'macerator toilet', 'vacuum toilet', 'electric head'
] WHERE name = 'Toilet/Head';

UPDATE ref_product_types SET synonyms = ARRAY[
  'water pump', 'pressure pump', 'accumulator pump',
  'freshwater pump', 'demand pump', 'potable water pump'
] WHERE name = 'Fresh Water Pump';

UPDATE ref_product_types SET synonyms = ARRAY[
  'fuel water separator', 'Racor filter', 'primary filter',
  'fuel strainer', 'diesel filter', 'fuel separator'
] WHERE name = 'Fuel Filter';

UPDATE ref_product_types SET synonyms = ARRAY[
  'hot water tank', 'calorifier', 'water heater tank',
  'HW heater', 'engine heated water', 'immersion heater'
] WHERE name = 'Water Heater';

-- Climate
UPDATE ref_product_types SET synonyms = ARRAY[
  'AC', 'air con', 'marine AC', 'climate control',
  'air conditioning', 'chiller', 'reverse cycle'
] WHERE name = 'Air Conditioner';

UPDATE ref_product_types SET synonyms = ARRAY[
  'fridge', 'freezer', 'icebox', 'refrigerator',
  'cold storage', 'cooler', 'marine fridge'
] WHERE name = 'Refrigeration';

-- Safety
UPDATE ref_product_types SET synonyms = ARRAY[
  'EPIRB', 'PLB', 'emergency beacon', 'distress beacon',
  'satellite beacon', '406 beacon', 'rescue beacon'
] WHERE name = 'Emergency Beacon';

UPDATE ref_product_types SET synonyms = ARRAY[
  'life jacket', 'PFD', 'lifevest', 'buoyancy aid',
  'personal flotation', 'auto-inflate'
] WHERE name = 'Life Jacket';
```

### 11.5 Seed Data: System Category Synonyms

```sql
UPDATE ref_system_categories SET synonyms = ARRAY[
  'engine', 'motor', 'drive', 'drivetrain', 'power plant',
  'main engine', 'propulsion system'
] WHERE name = 'Propulsion';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'nav', 'electronics', 'instruments', 'helm electronics',
  'navigation system', 'nav electronics'
] WHERE name = 'Navigation';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'electrical', 'power', 'DC power', 'battery system',
  '12V', '24V', '48V', 'house power', 'DC electrical'
] WHERE name = 'Electrical (DC)';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'comms', 'radio', 'communication', 'VHF', 'satellite',
  'wifi', 'cellular', 'connectivity'
] WHERE name = 'Communications';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'automation', 'switching', 'digital switching', 'CZone',
  'controls', 'smart switching'
] WHERE name = 'Control/automation';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'plumbing', 'water system', 'tanks', 'pumps',
  'freshwater', 'blackwater', 'greywater', 'sanitation'
] WHERE name = 'Hull/Plumbing';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'deck', 'rigging', 'running rigging', 'standing rigging',
  'deck hardware', 'sail handling', 'ground tackle'
] WHERE name = 'Rigging/Deck';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'interior', 'cabin', 'comfort', 'galley', 'living',
  'accommodation', 'creature comforts'
] WHERE name = 'Interior/Comfort';

UPDATE ref_system_categories SET synonyms = ARRAY[
  'safety equipment', 'lifesaving', 'emergency',
  'fire safety', 'rescue equipment'
] WHERE name = 'Safety';
```

### 11.6 Seed Data: Centroid Synonyms

```sql
INSERT INTO centroids (name, synonyms, description) VALUES
('Engine Starting (Port)',
 ARRAY['start port engine', 'port engine start', 'starting port motor',
       'port diesel start', 'left engine start'],
 'Systems involved in starting the port engine'),

('Engine Starting (Stbd)',
 ARRAY['start starboard engine', 'stbd engine start', 'starting stbd motor',
       'starboard diesel start', 'right engine start'],
 'Systems involved in starting the starboard engine'),

('Autopilot (Primary)',
 ARRAY['AP', 'auto pilot', 'self steering', 'autopilot system',
       'helm autopilot', 'course keeping'],
 'Primary autopilot system components'),

('Charging (Underway)',
 ARRAY['engine charging', 'alternator charging', 'running charge',
       'underway power', 'integrel charging'],
 'Systems that charge batteries while underway'),

('Charging (Shore)',
 ARRAY['shore power', 'dock power', 'marina power', 'landline',
       'shorepower charging', 'AC charging'],
 'Systems for charging from shore power'),

('Charging (Solar)',
 ARRAY['solar charging', 'PV charging', 'solar power', 'panel charging',
       'sun charging'],
 'Solar charging system components'),

('House Power',
 ARRAY['house bank', 'domestic power', 'cabin power', 'living power',
       'hotel load', '12V power', '24V power'],
 'Systems providing power for house loads'),

('Navigation (Primary)',
 ARRAY['main navigation', 'helm nav', 'primary nav', 'chartplotter',
       'navigation electronics'],
 'Primary navigation system components'),

('Anchor System',
 ARRAY['anchoring', 'ground tackle', 'anchor gear', 'windlass system',
       'mooring', 'anchor setup'],
 'Anchoring and ground tackle components'),

('Freshwater System',
 ARRAY['water system', 'drinking water', 'potable water', 'freshwater',
       'domestic water', 'water supply'],
 'Freshwater storage and distribution'),

('Black Water System',
 ARRAY['sewage', 'holding tank', 'waste water', 'toilet system',
       'sanitation', 'MSD'],
 'Waste water and toilet systems'),

('Refrigeration System',
 ARRAY['fridge system', 'cold storage', 'galley cooling', 'food storage',
       'freezer system'],
 'Refrigeration and freezer components'),

('Air Conditioning',
 ARRAY['AC system', 'climate control', 'cabin cooling', 'air con',
       'HVAC', 'cabin climate'],
 'Air conditioning system components'),

('Communications',
 ARRAY['radio system', 'comms', 'VHF system', 'satellite comms',
       'connectivity', 'internet'],
 'Communication and connectivity systems'),

('Safety Systems',
 ARRAY['life safety', 'emergency systems', 'rescue equipment',
       'fire systems', 'MOB', 'distress'],
 'Safety and emergency equipment');
```

### 11.7 Query Expansion Example

```sql
-- Function to get all systems matching a user query with synonym expansion
CREATE OR REPLACE FUNCTION search_systems_with_synonyms(
  query_manufacturer TEXT,
  query_product_type TEXT,
  query_model TEXT DEFAULT NULL
) RETURNS TABLE (
  asset_uid UUID,
  manufacturer TEXT,
  product_type TEXT,
  model TEXT,
  match_type TEXT,
  match_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH expanded AS (
    -- Get manufacturer matches
    SELECT m.id as mfr_id, m.name as mfr_name,
           CASE
             WHEN lower(m.name) = lower(query_manufacturer) THEN 1.0
             WHEN lower(query_manufacturer) = ANY(SELECT lower(unnest(m.synonyms))) THEN 0.9
             ELSE 0
           END as mfr_score
    FROM ref_manufacturers m
    WHERE lower(m.name) = lower(query_manufacturer)
       OR lower(query_manufacturer) = ANY(SELECT lower(unnest(m.synonyms)))
  ),
  product_matches AS (
    -- Get product type matches
    SELECT pt.id as pt_id, pt.name as pt_name,
           CASE
             WHEN lower(pt.name) = lower(query_product_type) THEN 1.0
             WHEN lower(query_product_type) = ANY(SELECT lower(unnest(pt.synonyms))) THEN 0.9
             ELSE 0
           END as pt_score
    FROM ref_product_types pt
    WHERE lower(pt.name) = lower(query_product_type)
       OR lower(query_product_type) = ANY(SELECT lower(unnest(pt.synonyms)))
  )
  SELECT
    s.asset_uid,
    rm.name as manufacturer,
    rp.name as product_type,
    s.model_norm as model,
    CASE
      WHEN e.mfr_score = 1.0 AND pm.pt_score = 1.0 THEN 'exact'
      WHEN e.mfr_score > 0 AND pm.pt_score > 0 THEN 'synonym'
      WHEN e.mfr_score > 0 THEN 'manufacturer_only'
      ELSE 'partial'
    END as match_type,
    (COALESCE(e.mfr_score, 0) + COALESCE(pm.pt_score, 0)) / 2.0 as match_score
  FROM systems s
  JOIN ref_manufacturers rm ON s.manufacturer_id = rm.id
  JOIN ref_product_types rp ON s.product_type_id = rp.id
  LEFT JOIN expanded e ON s.manufacturer_id = e.mfr_id
  LEFT JOIN product_matches pm ON s.product_type_id = pm.pt_id
  WHERE e.mfr_score > 0 OR pm.pt_score > 0
  ORDER BY match_score DESC;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT * FROM search_systems_with_synonyms('victron', 'inverter');
-- Returns matches with match_type indicating quality of match
```

### 11.8 Admin UI Requirements for Synonyms

**Screens needed:**

1. **Manufacturer Synonym Editor**
   - List all manufacturers
   - Edit synonym array for each
   - Bulk import from CSV
   - LLM generate suggestions button

2. **Product Type Synonym Editor**
   - List all product types
   - Edit synonym array for each
   - Show which systems use each type
   - LLM generate suggestions button

3. **Centroid Synonym Editor**
   - List all centroids
   - Edit synonym array for each
   - Show member systems
   - LLM generate suggestions button

4. **Synonym Conflict Detector**
   - Find synonyms that appear in multiple categories
   - "motor" in both Engine and Winch?
   - Resolve or mark as intentional

5. **Synonym Usage Analytics**
   - Which synonyms are being matched
   - Which queries fail to match
   - Suggestions for new synonyms based on failed searches

---

## 12. Files to Create

### 12.1 Migration Scripts

| File | Purpose |
|------|---------|
| `scripts/migrations/027_reference_tables.sql` | Create ref_* tables with synonyms |
| `scripts/migrations/028_systems_table_updates.sql` | Add columns to systems |
| `scripts/migrations/029_system_photos.sql` | Create system_photos |
| `scripts/migrations/030_staging_troubleshooting.sql` | Create staging table |
| `scripts/migrations/031_staging_relationships.sql` | Create staging + production tables |
| `scripts/migrations/032_documents_updates.sql` | Add columns to documents |
| `scripts/migrations/033_centroids.sql` | Create centroids + members tables |
| `scripts/migrations/034_synonym_functions.sql` | Create synonym matching functions |

### 12.2 Data Migration Scripts

| File | Purpose |
|------|---------|
| `scripts/migrate-manufacturers.cjs` | Populate ref_manufacturers from existing data |
| `scripts/migrate-product-types.cjs` | Populate ref_product_types |
| `scripts/migrate-system-categories.cjs` | Populate ref_system_categories |
| `scripts/migrate-systems-fks.cjs` | Migrate systems to use FKs |
| `scripts/seed-synonyms.cjs` | Run all synonym seed SQL |

### 12.3 LLM Generation Scripts

| File | Purpose |
|------|---------|
| `scripts/generate-manufacturer-synonyms.cjs` | LLM generates manufacturer synonyms |
| `scripts/generate-product-type-synonyms.cjs` | LLM generates product type synonyms |
| `scripts/generate-centroids.cjs` | LLM creates operational centroids |
| `scripts/generate-relationships.cjs` | LLM infers system relationships |

### 12.4 Admin API Routes (Future)

| Route | Purpose |
|-------|---------|
| `GET /admin/api/synonyms/manufacturers` | List manufacturer synonyms |
| `PUT /admin/api/synonyms/manufacturers/:id` | Update manufacturer synonyms |
| `GET /admin/api/synonyms/product-types` | List product type synonyms |
| `PUT /admin/api/synonyms/product-types/:id` | Update product type synonyms |
| `GET /admin/api/centroids` | List centroids with members |
| `POST /admin/api/centroids/generate` | Trigger LLM centroid generation |
| `GET /admin/api/relationships` | List system relationships |
| `POST /admin/api/relationships/generate` | Trigger LLM relationship inference |

---

*This document is a sub-document of 96 Document Foundation Crisis. See 96a for purge scope.*

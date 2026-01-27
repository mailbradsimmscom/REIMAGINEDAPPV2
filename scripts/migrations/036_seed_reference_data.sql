-- Migration 036: Seed Reference Data
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- Populates reference tables with initial data and synonyms
--
-- PREREQUISITE: Run migrations 029-035 first
-- Run in Supabase SQL Editor

-- ============================================
-- 1. SEED MANUFACTURERS (from existing systems + additions)
-- ============================================

-- First, import existing manufacturers from systems table
INSERT INTO ref_manufacturers (name)
SELECT DISTINCT manufacturer_norm
FROM systems
WHERE manufacturer_norm IS NOT NULL
  AND manufacturer_norm != ''
ON CONFLICT (name) DO NOTHING;

-- Add known OEM manufacturers that may not be in systems table
INSERT INTO ref_manufacturers (name, is_oem, notes) VALUES
  ('Airmar', true, 'OEM for B&G, Raymarine, Garmin transducers'),
  ('Hy-ProDrive', true, 'OEM for B&G, Raymarine autopilot rams')
ON CONFLICT (name) DO UPDATE SET is_oem = EXCLUDED.is_oem;

-- Add manufacturer synonyms
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

-- ============================================
-- 2. SEED PRODUCT TYPES
-- ============================================

INSERT INTO ref_product_types (name, synonyms) VALUES
  -- Propulsion
  ('Engine', ARRAY['motor', 'diesel', 'main engine', 'inboard', 'diesel engine', 'propulsion engine', 'marine engine', 'boat engine']),
  ('Saildrive', ARRAY['sail drive', 'leg', 'drive leg', 'stern drive', 'S-drive', 'transmission', 'drive unit']),
  ('Propeller', ARRAY['prop', 'screw', 'blade', 'folding prop', 'feathering prop']),

  -- Navigation
  ('Transducer', ARRAY['DST', 'depth sensor', 'speed sensor', 'thru-hull sensor', 'through-hull sensor', 'depth sounder', 'paddlewheel', 'triducer', 'multi-sensor', 'hull sensor', 'log', 'speedo']),
  ('Autopilot Computer', ARRAY['AP', 'auto pilot', 'autopilot brain', 'pilot computer', 'autopilot processor', 'course computer', 'helm controller', 'NAC']),
  ('Autopilot Ram', ARRAY['autopilot drive', 'hydraulic ram', 'linear drive', 'actuator', 'pilot ram', 'steering ram', 'AP drive', 'hydraulic actuator']),
  ('Rudder Feedback', ARRAY['rudder sensor', 'feedback unit', 'rudder position', 'RFU', 'rudder reference', 'helm position sensor']),
  ('Chartplotter/MFD', ARRAY['MFD', 'plotter', 'display', 'chart display', 'navigation display', 'multifunction display', 'chart plotter', 'nav screen', 'Zeus']),
  ('Radar', ARRAY['dome radar', 'open array', 'scanner', 'broadband radar', 'pulse radar', 'doppler radar', 'marine radar', 'Halo']),
  ('GPS Antenna', ARRAY['GPS receiver', 'GNSS', 'GPS dome', 'position sensor', 'satellite antenna', 'chartplotter GPS']),
  ('Compass', ARRAY['heading sensor', 'fluxgate', 'electronic compass', 'gyro compass', 'attitude sensor', '9-axis compass', 'AHRS', 'Precision-9']),
  ('Sonar/ForwardScan', ARRAY['forward scan', 'forward looking sonar', 'FLS', 'structure scan', '3D sonar']),

  -- Communications
  ('VHF Radio', ARRAY['VHF', 'marine radio', 'DSC radio', 'handheld radio', 'fixed VHF', 'VHF transceiver', 'two-way radio']),
  ('AIS', ARRAY['transponder', 'AIS transceiver', 'class B AIS', 'class A AIS', 'AIS receiver', 'automatic identification']),
  ('Satellite Phone', ARRAY['sat phone', 'Iridium', 'satcom', 'satellite communicator']),
  ('WiFi/Cellular Router', ARRAY['router', 'mobile router', 'LTE router', '4G router', '5G router', 'Pepwave', 'cellular modem']),

  -- Electrical
  ('Battery', ARRAY['house battery', 'start battery', 'bank', 'battery bank', 'lithium battery', 'LiFePO4', 'AGM', 'gel battery', 'cells']),
  ('Inverter/Charger', ARRAY['inverter', 'charger', 'combi', 'inverter charger', 'shore charger', 'battery charger', 'AC charger', 'multiplus', 'quattro']),
  ('Battery Monitor', ARRAY['shunt', 'battery monitor', 'coulomb counter', 'SOC monitor', 'state of charge', 'amp hour meter', 'smartshunt', 'BMV']),
  ('BMS', ARRAY['battery management', 'cell balancer', 'lithium BMS', 'protection circuit', 'battery manager']),
  ('MPPT Controller', ARRAY['solar controller', 'charge controller', 'MPPT', 'maximum power point', 'solar regulator', 'PV controller', 'SmartSolar']),
  ('Solar Panel', ARRAY['PV panel', 'photovoltaic', 'solar module', 'solar array', 'deck solar', 'bimini solar', 'flexible solar']),
  ('DC-DC Converter', ARRAY['buck converter', 'boost converter', 'voltage converter', 'DC converter', 'step down', 'step up', 'Orion']),
  ('Battery Switch', ARRAY['isolator', 'battery isolator', 'disconnect', 'kill switch', 'master switch', 'battery cutoff', 'main switch', 'RBS']),
  ('Galvanic Isolator', ARRAY['zinc saver', 'galvanic protection', 'shore power isolator']),

  -- Rigging/Deck
  ('Fairlead', ARRAY['bullseye', 'deck organizer', 'line guide', 'rope guide', 'turning block', 'lead block', 'deck lead']),
  ('Winch', ARRAY['self-tailing', 'ST winch', 'electric winch', 'powered winch', 'halyard winch', 'sheet winch', 'drum winch', 'reel']),
  ('Windlass', ARRAY['anchor winch', 'ground tackle', 'anchor windlass', 'vertical windlass', 'horizontal windlass', 'capstan']),
  ('Rope Clutch', ARRAY['clutch', 'rope clutch', 'line stopper', 'jammer', 'cam cleat', 'rope jammer', 'XTS', 'XCS']),
  ('Block', ARRAY['turning block', 'cheek block', 'snatch block', 'fiddle block', 'ratchet block', 'sheave', 'pulley']),
  ('Anchor', ARRAY['main anchor', 'kedge', 'stern anchor', 'lunch hook', 'CQR', 'Delta', 'Rocna', 'Mantus', 'plow anchor']),

  -- Plumbing
  ('Watermaker', ARRAY['desal', 'desalinator', 'reverse osmosis', 'RO', 'water maker', 'freshwater maker', 'desalination']),
  ('Toilet/Head', ARRAY['toilet', 'marine head', 'MSD', 'holding tank toilet', 'macerator toilet', 'vacuum toilet', 'electric head']),
  ('Fresh Water Pump', ARRAY['water pump', 'pressure pump', 'accumulator pump', 'freshwater pump', 'demand pump', 'potable water pump']),
  ('Bilge Pump', ARRAY['bilge', 'automatic bilge', 'bilge blower', 'dewatering pump']),
  ('Fuel Filter', ARRAY['fuel water separator', 'Racor filter', 'primary filter', 'fuel strainer', 'diesel filter', 'fuel separator']),
  ('Water Heater', ARRAY['hot water tank', 'calorifier', 'water heater tank', 'HW heater', 'engine heated water', 'immersion heater']),

  -- Climate
  ('Air Conditioner', ARRAY['AC', 'air con', 'marine AC', 'climate control', 'air conditioning', 'chiller', 'reverse cycle']),
  ('Refrigeration', ARRAY['fridge', 'freezer', 'icebox', 'refrigerator', 'cold storage', 'cooler', 'marine fridge']),

  -- Safety
  ('Emergency Beacon', ARRAY['EPIRB', 'PLB', 'emergency beacon', 'distress beacon', 'satellite beacon', '406 beacon', 'rescue beacon']),
  ('Life Jacket', ARRAY['life jacket', 'PFD', 'lifevest', 'buoyancy aid', 'personal flotation', 'auto-inflate']),
  ('Fire Extinguisher', ARRAY['fire suppression', 'extinguisher', 'CO2 extinguisher', 'dry chemical']),

  -- Networking
  ('Network Switch', ARRAY['ethernet switch', 'marine switch', 'NMEA switch']),
  ('Gateway/Bridge', ARRAY['NMEA gateway', 'protocol converter', 'data bridge', 'interface box']),
  ('Display/Instrument', ARRAY['instrument display', 'gauge', 'repeater', 'data display'])
ON CONFLICT (name) DO UPDATE SET synonyms = EXCLUDED.synonyms;

-- ============================================
-- 3. SEED SYSTEM CATEGORIES
-- ============================================

INSERT INTO ref_system_categories (name, description, display_order, synonyms) VALUES
  ('Propulsion', 'Engine, saildrive, and propeller systems', 1,
   ARRAY['engine', 'motor', 'drive', 'drivetrain', 'power plant', 'main engine', 'propulsion system']),

  ('Navigation', 'Chartplotters, autopilot, radar, and navigation instruments', 2,
   ARRAY['nav', 'electronics', 'instruments', 'helm electronics', 'navigation system', 'nav electronics']),

  ('Electrical (DC)', 'Batteries, solar, charging, and DC power distribution', 3,
   ARRAY['electrical', 'power', 'DC power', 'battery system', '12V', '24V', '48V', 'house power', 'DC electrical']),

  ('Communications', 'VHF, AIS, satellite, and connectivity systems', 4,
   ARRAY['comms', 'radio', 'communication', 'VHF', 'satellite', 'wifi', 'cellular', 'connectivity']),

  ('Control/Automation', 'Digital switching, monitoring, and automation', 5,
   ARRAY['automation', 'switching', 'digital switching', 'CZone', 'controls', 'smart switching']),

  ('Hull/Plumbing', 'Water systems, tanks, pumps, and through-hulls', 6,
   ARRAY['plumbing', 'water system', 'tanks', 'pumps', 'freshwater', 'blackwater', 'greywater', 'sanitation']),

  ('Rigging/Deck', 'Winches, windlass, blocks, and deck hardware', 7,
   ARRAY['deck', 'rigging', 'running rigging', 'standing rigging', 'deck hardware', 'sail handling', 'ground tackle']),

  ('Interior/Comfort', 'Refrigeration, air conditioning, galley, and interior systems', 8,
   ARRAY['interior', 'cabin', 'comfort', 'galley', 'living', 'accommodation', 'creature comforts']),

  ('Safety', 'Life-saving equipment, fire systems, and safety gear', 9,
   ARRAY['safety equipment', 'lifesaving', 'emergency', 'fire safety', 'rescue equipment'])
ON CONFLICT (name) DO UPDATE SET
  synonyms = EXCLUDED.synonyms,
  display_order = EXCLUDED.display_order;

-- ============================================
-- 4. SEED SUBSYSTEM CATEGORIES
-- ============================================

-- Propulsion subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Engines', 'Saildrive', 'Controls', 'Alternators/Regulator', 'Tender']), generate_series(1, 5)
FROM ref_system_categories WHERE name = 'Propulsion'
ON CONFLICT (system_id, name) DO NOTHING;

-- Navigation subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Autopilot', 'GPS/GNSS', 'Radar', 'Displays/MFDs', 'Instruments', 'Compass', 'Sonar/ForwardScan', 'Cameras', 'Networking']), generate_series(1, 9)
FROM ref_system_categories WHERE name = 'Navigation'
ON CONFLICT (system_id, name) DO NOTHING;

-- Electrical subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Batteries', 'Solar/MPPT', 'Inverter/Charger', 'BMS', 'Monitoring', 'Distribution/Busbars', 'Converters', 'Shore Power']), generate_series(1, 8)
FROM ref_system_categories WHERE name = 'Electrical (DC)'
ON CONFLICT (system_id, name) DO NOTHING;

-- Communications subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['VHF', 'AIS', 'Satellite', 'WiFi/Cellular', 'Intercom']), generate_series(1, 5)
FROM ref_system_categories WHERE name = 'Communications'
ON CONFLICT (system_id, name) DO NOTHING;

-- Control/Automation subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Digital Switching', 'Tank Monitoring', 'Alarm Systems', 'Remote Access']), generate_series(1, 4)
FROM ref_system_categories WHERE name = 'Control/Automation'
ON CONFLICT (system_id, name) DO NOTHING;

-- Hull/Plumbing subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Freshwater', 'Black Water', 'Grey Water', 'Fuel System', 'Bilge', 'Through-Hulls', 'Watermaker']), generate_series(1, 7)
FROM ref_system_categories WHERE name = 'Hull/Plumbing'
ON CONFLICT (system_id, name) DO NOTHING;

-- Rigging/Deck subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Ground Tackle', 'Winches', 'Running Rigging', 'Standing Rigging', 'Davits/Crane']), generate_series(1, 5)
FROM ref_system_categories WHERE name = 'Rigging/Deck'
ON CONFLICT (system_id, name) DO NOTHING;

-- Interior/Comfort subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Refrigeration', 'Air Conditioning', 'Heating', 'Galley', 'Entertainment', 'Lighting']), generate_series(1, 6)
FROM ref_system_categories WHERE name = 'Interior/Comfort'
ON CONFLICT (system_id, name) DO NOTHING;

-- Safety subsystems
INSERT INTO ref_subsystem_categories (system_id, name, display_order)
SELECT id, unnest(ARRAY['Life-Saving', 'Fire Systems', 'Man Overboard', 'First Aid', 'Signaling']), generate_series(1, 5)
FROM ref_system_categories WHERE name = 'Safety'
ON CONFLICT (system_id, name) DO NOTHING;

-- ============================================
-- 5. SEED CENTROIDS (Operational Groupings)
-- ============================================

INSERT INTO centroids (name, description, synonyms, display_order) VALUES
  ('Engine Starting (Port)',
   'Systems involved in starting the port engine',
   ARRAY['start port engine', 'port engine start', 'starting port motor', 'port diesel start', 'left engine start'],
   1),

  ('Engine Starting (Stbd)',
   'Systems involved in starting the starboard engine',
   ARRAY['start starboard engine', 'stbd engine start', 'starting stbd motor', 'starboard diesel start', 'right engine start'],
   2),

  ('Autopilot (Primary)',
   'Primary autopilot system components',
   ARRAY['AP', 'auto pilot', 'self steering', 'autopilot system', 'helm autopilot', 'course keeping'],
   3),

  ('Charging (Underway)',
   'Systems that charge batteries while underway',
   ARRAY['engine charging', 'alternator charging', 'running charge', 'underway power', 'integrel charging'],
   4),

  ('Charging (Shore)',
   'Systems for charging from shore power',
   ARRAY['shore power', 'dock power', 'marina power', 'landline', 'shorepower charging', 'AC charging'],
   5),

  ('Charging (Solar)',
   'Solar charging system components',
   ARRAY['solar charging', 'PV charging', 'solar power', 'panel charging', 'sun charging'],
   6),

  ('House Power',
   'Systems providing power for house loads',
   ARRAY['house bank', 'domestic power', 'cabin power', 'living power', 'hotel load', '12V power', '24V power'],
   7),

  ('Navigation (Primary)',
   'Primary navigation system components',
   ARRAY['main navigation', 'helm nav', 'primary nav', 'chartplotter', 'navigation electronics'],
   8),

  ('Anchor System',
   'Anchoring and ground tackle components',
   ARRAY['anchoring', 'ground tackle', 'anchor gear', 'windlass system', 'mooring', 'anchor setup'],
   9),

  ('Freshwater System',
   'Freshwater storage and distribution',
   ARRAY['water system', 'drinking water', 'potable water', 'freshwater', 'domestic water', 'water supply'],
   10),

  ('Black Water System',
   'Waste water and toilet systems',
   ARRAY['sewage', 'holding tank', 'waste water', 'toilet system', 'sanitation', 'MSD'],
   11),

  ('Refrigeration System',
   'Refrigeration and freezer components',
   ARRAY['fridge system', 'cold storage', 'galley cooling', 'food storage', 'freezer system'],
   12),

  ('Air Conditioning',
   'Air conditioning system components',
   ARRAY['AC system', 'climate control', 'cabin cooling', 'air con', 'HVAC', 'cabin climate'],
   13),

  ('Communications',
   'Communication and connectivity systems',
   ARRAY['radio system', 'comms', 'VHF system', 'satellite comms', 'connectivity', 'internet'],
   14),

  ('Safety Systems',
   'Safety and emergency equipment',
   ARRAY['life safety', 'emergency systems', 'rescue equipment', 'fire systems', 'MOB', 'distress'],
   15)
ON CONFLICT (name) DO UPDATE SET
  synonyms = EXCLUDED.synonyms,
  description = EXCLUDED.description;

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  mfr_count INTEGER;
  pt_count INTEGER;
  cat_count INTEGER;
  sub_count INTEGER;
  cent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mfr_count FROM ref_manufacturers;
  SELECT COUNT(*) INTO pt_count FROM ref_product_types;
  SELECT COUNT(*) INTO cat_count FROM ref_system_categories;
  SELECT COUNT(*) INTO sub_count FROM ref_subsystem_categories;
  SELECT COUNT(*) INTO cent_count FROM centroids;

  RAISE NOTICE 'Migration 036 complete: Reference data seeded';
  RAISE NOTICE '  - ref_manufacturers: % rows', mfr_count;
  RAISE NOTICE '  - ref_product_types: % rows', pt_count;
  RAISE NOTICE '  - ref_system_categories: % rows', cat_count;
  RAISE NOTICE '  - ref_subsystem_categories: % rows', sub_count;
  RAISE NOTICE '  - centroids: % rows', cent_count;
END $$;

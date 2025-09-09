-- Create test system for end-to-end validation
-- This allows document upload to work for testing

INSERT INTO systems (
  asset_uid,
  manufacturer_norm,
  model_norm,
  system_norm,
  subsystem_norm,
  description
) VALUES (
  gen_random_uuid(),
  'Acr',
  'epirb_beacon_programming_certificate',
  'Acr',
  'epirb_beacon_programming_certificate',
  'Test system for end-to-end validation'
) ON CONFLICT (manufacturer_norm, model_norm) DO NOTHING;

-- Verify the system was created
SELECT 
  asset_uid,
  manufacturer_norm,
  model_norm,
  system_norm,
  subsystem_norm
FROM systems 
WHERE manufacturer_norm = 'Acr' 
  AND model_norm = 'epirb_beacon_programming_certificate';

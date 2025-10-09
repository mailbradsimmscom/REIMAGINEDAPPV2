-- Add trigger to automatically update systems.updated_at on every UPDATE
-- This uses the existing update_updated_at_column() function already in the database

CREATE TRIGGER update_systems_updated_at
BEFORE UPDATE ON systems
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

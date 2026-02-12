/**
 * Validation Utilities
 *
 * Reusable validation functions for system management.
 * Pure functions with no I/O.
 */

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL or empty
 */
export function isValidUrl(url) {
  if (!url || url.trim() === '') return true; // Empty is OK

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate JSON string
 * @param {string} jsonString - JSON to validate
 * @returns {boolean} True if valid JSON or empty
 */
export function isValidJson(jsonString) {
  if (!jsonString || jsonString.trim() === '') return true; // Empty is OK

  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate required field
 * @param {any} value - Value to check
 * @returns {boolean} True if not null/undefined/empty string
 */
export function isRequired(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/**
 * Sanitize text field (trim and convert empty to null)
 * @param {string} value - Text to sanitize
 * @returns {string|null} Trimmed string or null
 */
export function sanitizeText(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validate system data for CREATE/UPDATE (v5 schema)
 * @param {Object} data - System data to validate
 * @param {boolean} isUpdate - True if updating existing system
 * @returns {Object} { valid: boolean, errors: Object }
 */
export function validateSystemData(data, isUpdate = false) {
  const errors = {};

  // Required FK fields (v5 schema)
  if (!isRequired(data.manufacturer_id)) {
    errors.manufacturer_id = 'Manufacturer is required';
  }

  if (!isRequired(data.model_norm)) {
    errors.model_norm = 'Model is required';
  }

  if (!isRequired(data.product_type_id)) {
    errors.product_type_id = 'Product Type is required';
  }

  if (!isRequired(data.system_category_id)) {
    errors.system_category_id = 'System Category is required';
  }

  if (!isRequired(data.subsystem_category_id)) {
    errors.subsystem_category_id = 'Subsystem Category is required';
  }

  // asset_uid required for updates
  if (isUpdate && !isRequired(data.asset_uid)) {
    errors.asset_uid = 'Asset UID is required for updates';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate instance data
 * @param {Object} data - Instance data to validate
 * @returns {Object} { valid: boolean, errors: Object }
 */
export function validateInstanceData(data) {
  const errors = {};

  // asset_uid is required
  if (!isRequired(data.asset_uid)) {
    errors.asset_uid = 'Asset UID is required';
  }

  // serial_number and location are optional, no validation needed

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Sanitize system data before DB insert/update (v5 schema)
 * @param {Object} data - Raw system data
 * @returns {Object} Sanitized data
 */
export function sanitizeSystemData(data) {
  const sanitized = {
    // Required FK fields (v5)
    manufacturer_id: data.manufacturer_id || null,
    product_type_id: data.product_type_id || null,
    system_category_id: data.system_category_id || null,
    subsystem_category_id: data.subsystem_category_id || null,

    // Text fields
    manufacturer_norm: sanitizeText(data.manufacturer_norm),
    model_norm: sanitizeText(data.model_norm),
    system_norm: sanitizeText(data.system_norm),
    subsystem_norm: sanitizeText(data.subsystem_norm),
    description: sanitizeText(data.description),

    // OEM fields (optional)
    oem_manufacturer_id: data.oem_manufacturer_id || null,
    oem_model: sanitizeText(data.oem_model),
    oem_part_number: sanitizeText(data.oem_part_number),

    // Source tracking (v5)
    source: data.source || 'manual_entry',
    detected_from_doc_id: data.detected_from_doc_id || null,

    // User display name (v2 detection)
    user_display_name: sanitizeText(data.user_display_name)
  };

  // Handle model_synonyms array (comma-separated string → array)
  if (data.model_synonyms) {
    if (typeof data.model_synonyms === 'string') {
      // Split by comma, trim each, filter empty
      sanitized.model_synonyms = data.model_synonyms
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    } else if (Array.isArray(data.model_synonyms)) {
      sanitized.model_synonyms = data.model_synonyms;
    }
  } else {
    sanitized.model_synonyms = [];
  }

  // Include asset_uid for updates
  if (data.asset_uid) {
    sanitized.asset_uid = data.asset_uid;
  }

  return sanitized;
}

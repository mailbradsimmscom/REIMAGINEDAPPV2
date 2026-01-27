import { getSystemSvc } from './systems.service.js';
import * as repo from '../repositories/system-management.repository.js';
import { logger } from '../utils/logger.js';
import { validateSystemData, validateInstanceData, sanitizeSystemData } from '../utils/validation.js';
import { randomUUID } from 'crypto';
import { generateAndSaveKeywordsSynonyms } from './keywords-synonyms-generation.service.js';

/**
 * System Management Service
 *
 * Business logic for system management feature.
 * Follows cursor rules: Business logic only, no direct DB access.
 */

/**
 * Get list of all manufacturers
 * @returns {Promise<Object>} { success, manufacturers?, error? }
 */
export async function getManufacturersList() {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching manufacturers list');
    const manufacturers = await repo.getManufacturers();
    return { success: true, manufacturers };

  } catch (error) {
    requestLogger.error('Service error getting manufacturers', {
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Get models for a manufacturer
 * @param {string} manufacturer - Manufacturer name
 * @returns {Promise<Object>} { success, models?, error? }
 */
export async function getModelsForManufacturer(manufacturer) {
  const requestLogger = logger.createRequestLogger();

  if (!manufacturer) {
    return { success: false, error: 'manufacturer is required' };
  }

  try {
    requestLogger.info('Fetching models', { manufacturer });
    const models = await repo.getModelsByManufacturer(manufacturer);
    return { success: true, models };

  } catch (error) {
    requestLogger.error('Service error getting models', {
      error: error.message,
      manufacturer
    });
    return { success: false, error: error.message };
  }
}

/**
 * Search for a system by manufacturer and model
 * @param {string} manufacturer - Manufacturer name
 * @param {string} model - Model name
 * @returns {Promise<Object>} { success, systems?, error? }
 */
export async function searchSystem(manufacturer, model) {
  const requestLogger = logger.createRequestLogger();

  if (!manufacturer || !model) {
    return { success: false, error: 'manufacturer and model are required' };
  }

  try {
    requestLogger.info('Searching for system', { manufacturer, model });
    const systems = await repo.findSystemByManufacturerModel(manufacturer, model);
    return { success: true, systems };

  } catch (error) {
    requestLogger.error('Service error searching system', {
      error: error.message,
      manufacturer,
      model
    });
    return { success: false, error: error.message };
  }
}

/**
 * Get full system details with instances
 * Uses existing getSystemSvc + queries instances
 *
 * @param {string} assetUid - System asset UID
 * @returns {Promise<Object>} { success, system?, error? }
 */
export async function getSystemWithInstances(assetUid) {
  const requestLogger = logger.createRequestLogger();

  if (!assetUid) {
    return { success: false, error: 'assetUid is required' };
  }

  try {
    requestLogger.info('Fetching system details', { assetUid });

    // Call existing service (NOT modifying it - just calling)
    const systemData = await getSystemSvc(assetUid);

    // Get instances from repository
    const instances = await repo.getInstancesByAssetUid(assetUid);

    return {
      success: true,
      system: {
        ...systemData,
        instances
      }
    };

  } catch (error) {
    requestLogger.error('Service error getting system with instances', {
      error: error.message,
      assetUid
    });
    return { success: false, error: error.message };
  }
}

/**
 * Create a new system
 * @param {Object} systemData - System data to create
 * @returns {Promise<Object>} { success, data?, error?, validationErrors? }
 */
export async function createSystem(systemData) {
  const requestLogger = logger.createRequestLogger();

  try {
    // Validate input
    const validation = validateSystemData(systemData, false);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Validation failed',
        validationErrors: validation.errors
      };
    }

    // Sanitize and prepare data
    const sanitized = sanitizeSystemData(systemData);

    // Generate UUID for new system
    const assetUid = randomUUID();
    sanitized.asset_uid = assetUid;

    requestLogger.info('Creating system', { assetUid });

    // Create in database
    const created = await repo.createSystem(sanitized);

    // Generate keywords and synonyms (synchronous - user waits)
    requestLogger.info('Generating keywords and synonyms', { assetUid });
    const generationResult = await generateAndSaveKeywordsSynonyms(assetUid);

    if (!generationResult.success) {
      requestLogger.warn('Failed to generate keywords/synonyms for new system', {
        assetUid,
        error: generationResult.error
      });
      // Don't fail the system creation - just log the warning
    } else {
      requestLogger.info('Keywords and synonyms generated successfully', {
        assetUid,
        duration: generationResult.duration
      });
    }

    return {
      success: true,
      data: {
        asset_uid: created.asset_uid,
        message: 'System created successfully'
      }
    };

  } catch (error) {
    requestLogger.error('Service error creating system', {
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Update an existing system
 * @param {string} assetUid - System asset UID
 * @param {Object} systemData - System data to update
 * @returns {Promise<Object>} { success, data?, error?, validationErrors? }
 */
export async function updateSystem(assetUid, systemData) {
  const requestLogger = logger.createRequestLogger();

  if (!assetUid) {
    return { success: false, error: 'assetUid is required' };
  }

  try {
    // Add assetUid to data for validation
    const dataWithUid = { ...systemData, asset_uid: assetUid };

    // Validate input
    const validation = validateSystemData(dataWithUid, true);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Validation failed',
        validationErrors: validation.errors
      };
    }

    // Sanitize and prepare data (exclude asset_uid from update)
    const sanitized = sanitizeSystemData(systemData);
    delete sanitized.asset_uid; // Never update the primary key

    requestLogger.info('Updating system', { assetUid });

    // Update in database
    const updated = await repo.updateSystem(assetUid, sanitized);

    return {
      success: true,
      data: {
        asset_uid: updated.asset_uid,
        message: 'System updated successfully'
      }
    };

  } catch (error) {
    requestLogger.error('Service error updating system', {
      error: error.message,
      assetUid
    });
    return { success: false, error: error.message };
  }
}

/**
 * Delete a system and archive its instances
 * @param {string} assetUid - System asset UID
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function deleteSystem(assetUid) {
  const requestLogger = logger.createRequestLogger();

  if (!assetUid) {
    return { success: false, error: 'assetUid is required' };
  }

  try {
    requestLogger.info('Deleting system', { assetUid });

    // First, archive all instances for this system
    const instances = await repo.getInstancesByAssetUid(assetUid);

    for (const instance of instances) {
      await repo.archiveInstance(instance.instance_uid);
    }

    // Then delete the system
    await repo.deleteSystem(assetUid);

    return {
      success: true,
      data: {
        message: 'System deleted successfully',
        archivedInstances: instances.length
      }
    };

  } catch (error) {
    requestLogger.error('Service error deleting system', {
      error: error.message,
      assetUid
    });
    return { success: false, error: error.message };
  }
}

/**
 * Create a new instance
 * @param {Object} instanceData - Instance data to create
 * @param {Object} [denormalizedFields] - Optional denormalized fields (manufacturer_norm, model_norm, system_norm, subsystem_norm)
 * @returns {Promise<Object>} { success, data?, error?, validationErrors? }
 */
export async function createInstance(instanceData, denormalizedFields = {}) {
  const requestLogger = logger.createRequestLogger();

  try {
    // Validate input
    const validation = validateInstanceData(instanceData);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Validation failed',
        validationErrors: validation.errors
      };
    }

    // Generate UUID for new instance
    const instanceUid = randomUUID();

    // Get next instance_index if not provided
    let instanceIndex = instanceData.instance_index;
    if (!instanceIndex) {
      instanceIndex = await repo.getNextInstanceIndex(instanceData.asset_uid);
    }

    // Prepare instance data with optional denormalized fields
    const instance = {
      instance_uid: instanceUid,
      asset_uid: instanceData.asset_uid,
      serial_number: instanceData.serial_number || null,
      location: instanceData.location || null,
      instance_index: instanceIndex,
      // Include denormalized fields if provided (for document-ingest flow)
      ...(denormalizedFields.manufacturer_norm && { manufacturer_norm: denormalizedFields.manufacturer_norm }),
      ...(denormalizedFields.model_norm && { model_norm: denormalizedFields.model_norm }),
      ...(denormalizedFields.system_norm && { system_norm: denormalizedFields.system_norm }),
      ...(denormalizedFields.subsystem_norm && { subsystem_norm: denormalizedFields.subsystem_norm })
    };

    requestLogger.info('Creating instance', { instanceUid, assetUid: instanceData.asset_uid });

    // Create in database
    const created = await repo.createInstance(instance);

    return {
      success: true,
      data: created  // Return full instance data for downstream use
    };

  } catch (error) {
    requestLogger.error('Service error creating instance', {
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Update an existing instance
 * @param {string} instanceUid - Instance UID
 * @param {Object} instanceData - Instance data to update
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function updateInstance(instanceUid, instanceData) {
  const requestLogger = logger.createRequestLogger();

  if (!instanceUid) {
    return { success: false, error: 'instanceUid is required' };
  }

  try {
    // Prepare update data (only allow updating specific fields)
    const updateData = {};

    if (instanceData.serial_number !== undefined) {
      updateData.serial_number = instanceData.serial_number || null;
    }

    if (instanceData.location !== undefined) {
      updateData.location = instanceData.location || null;
    }

    if (instanceData.instance_index !== undefined) {
      updateData.instance_index = instanceData.instance_index;
    }

    requestLogger.info('Updating instance', { instanceUid });

    // Update in database
    const updated = await repo.updateInstance(instanceUid, updateData);

    return {
      success: true,
      data: {
        instance_uid: updated.instance_uid,
        message: 'Instance updated successfully'
      }
    };

  } catch (error) {
    requestLogger.error('Service error updating instance', {
      error: error.message,
      instanceUid
    });
    return { success: false, error: error.message };
  }
}

/**
 * Delete an instance (archive it)
 * @param {string} instanceUid - Instance UID
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function deleteInstance(instanceUid) {
  const requestLogger = logger.createRequestLogger();

  if (!instanceUid) {
    return { success: false, error: 'instanceUid is required' };
  }

  try {
    requestLogger.info('Archiving instance', { instanceUid });

    // Archive (soft delete)
    await repo.archiveInstance(instanceUid);

    return {
      success: true,
      data: {
        message: 'Instance archived successfully'
      }
    };

  } catch (error) {
    requestLogger.error('Service error archiving instance', {
      error: error.message,
      instanceUid
    });
    return { success: false, error: error.message };
  }
}

// ============================================
// Reference Table Services (v5 schema)
// ============================================

/**
 * Get list of all manufacturers from ref_manufacturers
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function getRefManufacturersList() {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching ref_manufacturers list');
    const data = await repo.getRefManufacturers();
    return { success: true, data };

  } catch (error) {
    requestLogger.error('Service error getting ref_manufacturers', {
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Get list of all product types from ref_product_types
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function getRefProductTypesList() {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching ref_product_types list');
    const data = await repo.getRefProductTypes();
    return { success: true, data };

  } catch (error) {
    requestLogger.error('Service error getting ref_product_types', {
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Get list of all system categories from ref_system_categories
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function getRefSystemCategoriesList() {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching ref_system_categories list');
    const data = await repo.getRefSystemCategories();
    return { success: true, data };

  } catch (error) {
    requestLogger.error('Service error getting ref_system_categories', {
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Get list of subsystem categories, optionally filtered by parent category
 * @param {string|null} categoryId - Optional parent category ID
 * @returns {Promise<Object>} { success, data?, error? }
 */
export async function getRefSubsystemCategoriesList(categoryId = null) {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching ref_subsystem_categories list', { categoryId });
    const data = await repo.getRefSubsystemCategories(categoryId);
    return { success: true, data };

  } catch (error) {
    requestLogger.error('Service error getting ref_subsystem_categories', {
      error: error.message,
      categoryId
    });
    return { success: false, error: error.message };
  }
}

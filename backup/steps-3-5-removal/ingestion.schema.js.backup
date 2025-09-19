/**
 * Ingestion schemas for DIP (Document Intelligence Packet) and Suggestions
 * Provides validation for document analysis results and admin suggestions
 */

import { z } from 'zod';

// ============================================================================
// DIP (Document Intelligence Packet) Schema
// ============================================================================

export const DIPSchema = z.object({
  doc_id: z.string().min(1, 'Document ID is required'),
  timestamp: z.string().datetime().optional(),
  
  // Document metadata
  metadata: z.object({
    filename: z.string().optional(),
    size: z.number().int().min(0).optional(),
    mime_type: z.string().optional(),
    uploaded_at: z.string().datetime().optional(),
    processed_at: z.string().datetime().optional()
  }).optional(),
  
  // Extracted entities and their aliases
  entities: z.object({
    manufacturers: z.array(z.string()).default([]),
    models: z.array(z.string()).default([]),
    systems: z.array(z.string()).default([]),
    components: z.array(z.string()).default([]),
    aliases: z.record(z.string(), z.array(z.string())).default({})
  }).default({
    manufacturers: [],
    models: [],
    systems: [],
    components: [],
    aliases: {}
  }),
  
  // Technical specifications found
  specifications: z.object({
    pressure: z.array(z.object({
      value: z.number(),
      unit: z.string(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).default([]),
    power: z.array(z.object({
      value: z.number(),
      unit: z.string(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).default([]),
    flow: z.array(z.object({
      value: z.number(),
      unit: z.string(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).default([]),
    temperature: z.array(z.object({
      value: z.number(),
      unit: z.string(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).default([]),
    dimensions: z.array(z.object({
      value: z.number(),
      unit: z.string(),
      dimension: z.string(), // length, width, height, etc.
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).default([])
  }).default({
    pressure: [],
    power: [],
    flow: [],
    temperature: [],
    dimensions: []
  }),
  
  // Maintenance information
  maintenance: z.object({
    intervals: z.array(z.object({
      task: z.string(),
      interval: z.string(),
      confidence: z.number().min(0).max(1).optional()
    })).default([]),
    procedures: z.array(z.object({
      task: z.string(),
      steps: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1).optional()
    })).default([]),
    warnings: z.array(z.string()).default([]),
    cautions: z.array(z.string()).default([])
  }).default({
    intervals: [],
    procedures: [],
    warnings: [],
    cautions: []
  }),
  
  // Quality metrics
  quality: z.object({
    confidence_score: z.number().min(0).max(1).optional(),
    completeness_score: z.number().min(0).max(1).optional(),
    accuracy_score: z.number().min(0).max(1).optional(),
    processing_time_ms: z.number().int().min(0).optional()
  }).optional(),
  
  // Raw analysis data (optional, for debugging)
  raw_analysis: z.any().optional()
});

// ============================================================================
// Suggestions Schema
// ============================================================================

export const SuggestionsSchema = z.object({
  doc_id: z.string().min(1, 'Document ID is required'),
  timestamp: z.string().datetime().optional(),
  
  // Entity suggestions - new aliases to add
  entities: z.object({
    add_aliases: z.record(z.string(), z.array(z.string())).default({})
  }).default({
    add_aliases: {}
  }),
  
  // Entity linking suggestions
  entity_linker: z.object({
    map: z.array(z.object({
      asset_uid: z.string(),
      doc_id: z.string(),
      confidence: z.number().min(0).max(1)
    })).default([])
  }).default({
    map: []
  }),
  
  // Playbook suggestions - maintenance and operational improvements
  playbooks: z.record(z.string(), z.object({
    boost_add: z.array(z.string()).default([]),
    filters_add: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).optional()
  })).default({}),
  
  // Intent detection improvements
  intents: z.object({
    hints: z.array(z.object({
      intent: z.string(),
      raise_to: z.number().min(0).max(1),
      reason: z.string().optional()
    })).default([])
  }).default({
    hints: []
  }),
  
  // Test case suggestions
  tests: z.object({
    seed_goldens: z.array(z.string()).max(10).default([])
  }).default({
    seed_goldens: []
  }),
  
  // Risk assessment (optional)
  risk: z.object({
    level: z.enum(['low', 'medium', 'high']).optional(),
    concerns: z.array(z.string()).default([]),
    mitigations: z.array(z.string()).default([])
  }).optional(),
  
  // Unit normalization suggestions
  units: z.object({
    suggest_add: z.array(z.object({
      alias: z.string(),
      suggestedGroup: z.string(),
      evidence: z.string().optional(),
      count: z.number().int().min(1)
    })).default([])
  }).default({
    suggest_add: []
  }),
  
  // Quality metrics for suggestions
  suggestion_quality: z.object({
    confidence_score: z.number().min(0).max(1).optional(),
    impact_score: z.number().min(0).max(1).optional(),
    risk_score: z.number().min(0).max(1).optional()
  }).optional()
});

// ============================================================================
// Apply Request Schema (for admin apply endpoint)
// ============================================================================

export const ApplyRequestSchema = z.object({
  doc_id: z.string().min(1, 'Document ID is required'),
  
  // Accepted suggestions (subset of SuggestionsSchema)
  accepted: SuggestionsSchema.partial(),
  
  // Apply options
  options: z.object({
    create_snapshot: z.boolean().default(true),
    dry_run: z.boolean().default(false),
    notify_on_completion: z.boolean().default(false)
  }).default({
    create_snapshot: true,
    dry_run: false,
    notify_on_completion: false
  })
});

// ============================================================================
// Apply Response Schema
// ============================================================================

export const ApplyResponseSchema = z.object({
  success: z.boolean(),
  snapshot_id: z.string().optional(),
  applied_changes: z.object({
    entities: z.number().int().min(0).default(0),
    playbooks: z.number().int().min(0).default(0),
    intents: z.number().int().min(0).default(0),
    units: z.number().int().min(0).default(0),
    tests: z.number().int().min(0).default(0)
  }).default({
    entities: 0,
    playbooks: 0,
    intents: 0,
    units: 0,
    tests: 0
  }),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  timestamp: z.string().datetime()
});

// ============================================================================
// Rollback Request Schema
// ============================================================================

export const RollbackRequestSchema = z.object({
  snapshot_id: z.string().min(1, 'Snapshot ID is required'),
  confirm: z.boolean().default(false)
});

// ============================================================================
// Rollback Response Schema
// ============================================================================

export const RollbackResponseSchema = z.object({
  success: z.boolean(),
  snapshot_id: z.string(),
  restored_files: z.array(z.string()).default([]),
  timestamp: z.string().datetime(),
  errors: z.array(z.string()).default([])
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a DIP object
 * @param {any} obj - Object to validate
 * @returns {Object} Validation result with success flag and data/error
 */
export function validateDIP(obj) {
  const result = DIPSchema.safeParse(obj);
  return result.success 
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Validate a Suggestions object
 * @param {any} obj - Object to validate
 * @returns {Object} Validation result with success flag and data/error
 */
export function validateSuggestions(obj) {
  const result = SuggestionsSchema.safeParse(obj);
  return result.success 
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Validate an Apply Request object
 * @param {any} obj - Object to validate
 * @returns {Object} Validation result with success flag and data/error
 */
export function validateApplyRequest(obj) {
  const result = ApplyRequestSchema.safeParse(obj);
  return result.success 
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Validate a Rollback Request object
 * @param {any} obj - Object to validate
 * @returns {Object} Validation result with success flag and data/error
 */
export function validateRollbackRequest(obj) {
  const result = RollbackRequestSchema.safeParse(obj);
  return result.success 
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a default DIP structure
 * @param {string} docId - Document ID
 * @returns {Object} Default DIP structure
 */
export function createDefaultDIP(docId) {
  return {
    doc_id: docId,
    timestamp: new Date().toISOString(),
    entities: {
      manufacturers: [],
      models: [],
      systems: [],
      components: [],
      aliases: {}
    },
    specifications: {
      pressure: [],
      power: [],
      flow: [],
      temperature: [],
      dimensions: []
    },
    maintenance: {
      intervals: [],
      procedures: [],
      warnings: [],
      cautions: []
    }
  };
}

/**
 * Create a default Suggestions structure
 * @param {string} docId - Document ID
 * @returns {Object} Default Suggestions structure
 */
export function createDefaultSuggestions(docId) {
  return {
    doc_id: docId,
    timestamp: new Date().toISOString(),
    entities: {
      add_aliases: {}
    },
    entity_linker: {
      map: []
    },
    playbooks: {},
    intents: {
      hints: []
    },
    tests: {
      seed_goldens: []
    },
    units: {
      suggest_add: []
    }
  };
}

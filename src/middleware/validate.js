import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Validation middleware factory
 * Creates a middleware function that validates request data against a Zod schema
 * 
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {string} target - Where to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
export function validate(schema, target = 'body') {
  return (req, res, next) => {
    try {
      const data = req[target];
      
      // Handle empty query/params gracefully
      if (target === 'query' && (!data || Object.keys(data).length === 0)) {
        // For empty query, use default values from schema
        const result = schema.safeParse({});
        if (result.success) {
          req[target] = result.data;
          return next();
        }
      }
      
      const result = schema.safeParse(data);
      
      if (!result.success) {
        const errors = result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));
        
        logger.warn('Validation failed', {
          target,
          errors,
          data: target === 'body' ? '[REDACTED]' : data
        });
        
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: errors
        });
      }
      
      // Replace the data with validated data
      req[target] = result.data;
      next();
      
    } catch (error) {
      logger.error('Validation middleware error', {
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Internal validation error'
      });
    }
  };
}

/**
 * Optional validation - only validates if data exists
 * Useful for optional fields or partial updates
 */
export function validateOptional(schema, target = 'body') {
  return (req, res, next) => {
    const data = req[target];
    
    // Skip validation if no data
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
      return next();
    }
    
    return validate(schema, target)(req, res, next);
  };
}

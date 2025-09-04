import { z } from 'zod';
import { enforceResponse } from './enforceResponse.js';
import { ERR } from '../constants/errorCodes.js';

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
      const data = req[target] ?? {};
      
      const result = schema.safeParse(data);
      
      if (!result.success) {
        // Get the issues array safely
        let issuesArray = [];
        if (result.error.errors && Array.isArray(result.error.errors)) {
          issuesArray = result.error.errors;
        } else if (result.error.issues && Array.isArray(result.error.issues)) {
          issuesArray = result.error.issues;
        } else if (result.error && Array.isArray(result.error)) {
          // Handle case where error itself is the issues array
          issuesArray = result.error;
        }
        
        // Normalize Zod issues for the envelope
        const issues = issuesArray.map(e => ({
          path: e.path.join('.'),
          code: e.code,
          message: e.message,
        }));
        
        return enforceResponse(res, {
          success: false,
          data: null,
          error: { 
            code: ERR.BAD_REQUEST, 
            message: 'Validation failed', 
            details: issues 
          },
        }, 400);
      }
      
      // Store validated data for route handlers
      (req.validated ??= {})[target] = result.data;
      next();
      
    } catch (err) {
      if (err instanceof z.ZodError) {
        return enforceResponse(res, {
          success: false,
          data: null,
          error: { 
            code: ERR.BAD_REQUEST, 
            message: 'Validation failed', 
            details: err.issues 
          },
        }, 400);
      }
      return next(err);
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

import { z } from 'zod';

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
          // Store validated data for route handlers
          req.validatedData = result.data;
          next();
        } else {
          // If validation fails for empty query, pass error to error handler
          const error = new Error('Invalid request data');
          error.status = 400;
          error.code = 'VALIDATION_ERROR';
          error.details = result.error.errors ? result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code
          })) : [{ field: 'unknown', message: 'Validation failed', code: 'invalid_type' }];
          return next(error);
        }
      }
      
      const result = schema.safeParse(data);
      
      if (!result.success) {
        const error = new Error('Invalid request data');
        error.status = 400;
        error.code = 'VALIDATION_ERROR';
        error.details = result.error.errors ? result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        })) : [{ field: 'unknown', message: 'Validation failed', code: 'invalid_type' }];
        return next(error);
      }
      
      // Store validated data for route handlers
      req.validatedData = result.data;
      next();
      
    } catch (error) {
      const internalError = new Error('Internal validation error');
      internalError.status = 500;
      internalError.code = 'INTERNAL_ERROR';
      return next(internalError);
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

// Test the validate middleware directly
import express from 'express';
import { z } from 'zod';

// Simple test schema
const testSchema = z.object({
  q: z.string().min(2)
});

// Simple validate middleware
function validate(schema, target = 'body') {
  return (req, res, next) => {
    try {
      const data = req[target];
      console.log('Validating data:', data);
      
      const result = schema.safeParse(data);
      console.log('Validation result:', result);
      
      if (!result.success) {
        console.log('Validation failed, returning 400');
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: result.error.errors
        });
      }
      
      console.log('Validation passed, calling next');
      req[target] = result.data;
      next();
      
    } catch (error) {
      console.log('Middleware error:', error);
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Internal validation error'
      });
    }
  };
}

const app = express();
app.use(express.json());

app.get('/test', 
  validate(testSchema, 'query'),
  (req, res) => {
    res.json({ success: true, data: req.query });
  }
);

app.listen(3001, () => {
  console.log('Test server running on 3001');
});

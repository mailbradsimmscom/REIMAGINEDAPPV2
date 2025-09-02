import 'dotenv/config';
import express from 'express';
import { validate } from './src/middleware/validate.js';
import { systemsListQuerySchema } from './src/schemas/systems.schema.js';

const app = express();

// Basic middleware
app.use(express.json());

// Mock service (no async, no errors)
const mockListSystemsSvc = (options) => {
  return {
    systems: [
      { asset_uid: 'test-1', name: 'Test System 1' },
      { asset_uid: 'test-2', name: 'Test System 2' }
    ],
    nextCursor: null
  };
};

// Simple test route
app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

// Systems route with validation and mock service
app.get('/systems', 
  (req, res, next) => {
    console.log('Before validation - req.query:', req.query);
    next();
  },
  validate(systemsListQuerySchema, 'query'),
  (req, res, next) => {
    console.log('After validation - req.query:', req.query);
    next();
  },
  (req, res, next) => {
    try {
      const { limit, cursor } = req.query;
      
      const result = mockListSystemsSvc({ limit, cursor });
      const responseData = {
        success: true,
        data: result
      };

      res.json(responseData);
    } catch (error) {
      console.error('Mock service error:', error.message);
      next(error);
    }
  }
);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: err.message
  });
});

// Start server
app.listen(3001, () => {
  console.log('Validation + mock service test server running on port 3001');
  console.log('Test routes:');
  console.log('- GET /test');
  console.log('- GET /systems');
});

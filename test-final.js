import 'dotenv/config';
import express from 'express';
import { validate } from './src/middleware/validate.js';
import { systemsListQuerySchema } from './src/schemas/systems.schema.js';

const app = express();

// Basic middleware
app.use(express.json());

// Simple test route
app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

// Systems route with validation only (no service import)
app.get('/systems', 
  (req, res, next) => {
    console.log('Before validation - req.query:', req.query);
    next();
  },
  validate(systemsListQuerySchema, 'query'),
  (req, res, next) => {
    console.log('After validation - req.query:', req.query);
    // Return mock data to simulate the service response
    const mockData = {
      systems: [
        { asset_uid: 'test-1', name: 'Test System 1', description: 'Test description' },
        { asset_uid: 'test-2', name: 'Test System 2', description: 'Another test' }
      ],
      nextCursor: null
    };
    
    const responseData = {
      success: true,
      data: mockData
    };

    res.json(responseData);
  }
);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error handler caught:', err.message);
  res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: err.message
  });
});

// Start server
app.listen(3001, () => {
  console.log('Validation test server running on port 3001');
  console.log('Test routes:');
  console.log('- GET /test');
  console.log('- GET /systems');
});

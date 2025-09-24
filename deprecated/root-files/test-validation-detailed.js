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

// Systems route with validation and real service (with detailed error handling)
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
  async (req, res, next) => {
    try {
      console.log('About to import systems service...');
      const { listSystemsSvc } = await import('./src/services/systems.service.js');
      console.log('Systems service imported successfully');
      
      const { limit, cursor } = req.query;
      console.log('Calling listSystemsSvc with:', { limit, cursor });
      
      const result = await listSystemsSvc({ limit, cursor });
      console.log('Service returned:', result);
      
      const responseData = {
        success: true,
        data: result
      };

      console.log('Sending response:', responseData);
      res.json(responseData);
    } catch (error) {
      console.error('Detailed service error:', {
        message: error.message,
        stack: error.stack,
        context: error.context
      });
      next(error);
    }
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
  console.log('Validation + real service test server running on port 3001');
  console.log('Test routes:');
  console.log('- GET /test');
  console.log('- GET /systems');
});

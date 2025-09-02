import express from 'express';

const router = express.Router();

// GET /health - Health check endpoint
router.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptimeSeconds: Math.floor(process.uptime()) 
  });
});

export default router;

import express from 'express';
import { normalizeQuery } from '../services/query-normalizer.js';

const router = express.Router();

router.post('/', (req, res) => {
  try {
    const { text } = req.body;
    const normalized = normalizeQuery(text);
    
    res.json({
      success: true,
      data: {
        original: text,
        normalized: normalized
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

export default router;

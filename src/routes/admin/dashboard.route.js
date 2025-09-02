import express from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { adminGate } from '../../middleware/admin.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin - Admin dashboard page
router.get('/', async (req, res, next) => {
  try {
    const adminHtmlPath = join(process.cwd(), 'src/public/admin.html');
    const content = await fs.readFile(adminHtmlPath);
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Admin dashboard not found' });
  }
});

export default router;

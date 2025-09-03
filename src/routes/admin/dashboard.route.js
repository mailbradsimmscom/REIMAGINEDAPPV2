import express from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const router = express.Router();

// GET /admin - Admin dashboard page (no auth required for HTML)
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

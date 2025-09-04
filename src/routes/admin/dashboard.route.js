import express from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import { z } from 'zod';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(EnvelopeSchema));

// Admin dashboard query schema
const adminDashboardQuerySchema = z.object({}).passthrough();

// GET /admin - Admin dashboard page (no auth required for HTML)
router.get('/', 
  validate(adminDashboardQuerySchema, 'query'),
  async (req, res, next) => {
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

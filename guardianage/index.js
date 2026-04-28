/**
 * Guardianage App — Self-contained Express router
 *
 * Mount point: app.use('/guardianage', guardianageRouter) in src/app.js
 *
 * All guardianage routes, middleware, and static assets are served from here.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { guardianageAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import monthsRoutes from './routes/months.js';
import tasksRoutes from './routes/tasks.js';
import notesRoutes from './routes/notes.js';
import suppliesRoutes from './routes/supplies.js';
import adminRoutes from './routes/admin.js';

const router = express.Router();

// Cookie parser for session cookies
router.use(cookieParser());

// Auth middleware — checks session on all routes except login and static assets
router.use(guardianageAuth);

// --- Static pages ---

router.get('/login', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/login.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Login page not found' });
  }
});

router.get('/', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/dashboard.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Dashboard page not found' });
  }
});

router.get('/month/:monthId', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/month.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Month page not found' });
  }
});

router.get('/task/:taskId', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/task.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Task page not found' });
  }
});

// Admin pages
router.get('/admin/users', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/admin-users.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Admin users page not found' });
  }
});

router.get('/admin/templates', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/admin-templates.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Admin templates page not found' });
  }
});

router.get('/admin/audit', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'guardianage/public/admin-audit.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Admin audit page not found' });
  }
});

// Static assets (JS, CSS)
router.use('/public', express.static(join(process.cwd(), 'guardianage/public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    }
  }
}));

// --- API routes ---

router.use('/api/auth', authRoutes);
router.use('/api/dashboard', dashboardRoutes);
router.use('/api/months', monthsRoutes);
router.use('/api/tasks', tasksRoutes);
router.use('/api/months', notesRoutes);
router.use('/api/supplies', suppliesRoutes);
// Also mount month-scoped supplies
router.use('/api/months', suppliesRoutes);
router.use('/api/admin', adminRoutes);

export default router;

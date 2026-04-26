/**
 * Guardianage Auth Routes
 * Login and logout endpoints.
 */

import express from 'express';
import { z } from 'zod';
import { login, logout, hashToken } from '../services/auth.service.js';

const router = express.Router();

const LoginSchema = z.object({
  login_id: z.string().min(1, 'Login ID is required'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/login', async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid input',
      });
    }

    const { login_id, password } = parsed.data;
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await login(login_id, password, { ipAddress, userAgent });

    if (!result.success) {
      return res.status(401).json({ success: false, error: result.error });
    }

    // Set httpOnly session cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('guardianage_session', result.sessionToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/guardianage',
    });

    return res.json({
      success: true,
      data: { user: result.user },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const sessionToken = req.cookies?.guardianage_session;
    if (sessionToken) {
      const tokenHash = hashToken(sessionToken);
      await logout(tokenHash);
    }

    res.clearCookie('guardianage_session', { path: '/guardianage' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.clearCookie('guardianage_session', { path: '/guardianage' });
    return res.json({ success: true });
  }
});

export default router;

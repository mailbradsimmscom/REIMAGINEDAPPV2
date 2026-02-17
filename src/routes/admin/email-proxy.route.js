import express from 'express';
import nodemailer from 'nodemailer';
import { getEnv } from '../../config/env.js';

const router = express.Router();

const env = getEnv();

const transporter = nodemailer.createTransport({
  host: 'plus.smtp.mail.yahoo.com',
  port: 465,
  secure: true,
  auth: {
    user: env.YAHOO_EMAIL,
    pass: env.YAHOO_PASSWORD,
  },
});

router.post('/send', async (req, res) => {
  const { from, to, cc, subject, text } = req.body;

  if (!to || !subject || !text) {
    return res.json({ success: false, error: 'Missing required fields: to, subject, text' });
  }

  try {
    await transporter.sendMail({
      from: from || env.YAHOO_EMAIL,
      to,
      cc,
      subject,
      text,
    });

    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

export default router;

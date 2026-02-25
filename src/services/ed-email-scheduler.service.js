// src/services/ed-email-scheduler.service.js
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

let cronTask = null;
let sending = false;

// Build transporter lazily (env may not be ready at import time)
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const env = getEnv();
  transporter = nodemailer.createTransport({
    host: 'plus.smtp.mail.yahoo.com',
    port: 465,
    secure: true,
    auth: {
      user: env.YAHOO_EMAIL,
      pass: env.YAHOO_PASSWORD,
    },
  });
  return transporter;
}

async function resolveLocation() {
  const supabase = await getSupabaseClient();
  if (!supabase) return 'on the boat';

  const { data, error } = await supabase
    .from('gps_position')
    .select('latitude, longitude')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.latitude || !data?.longitude) {
    return 'on the boat';
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${data.latitude}&lon=${data.longitude}&format=json&zoom=14`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'boatos-email-scheduler/1.0' },
    });
    const geo = await res.json();

    if (!geo.address) return 'on the boat';

    const town = geo.address.town || geo.address.city || geo.address.village || geo.address.municipality || '';
    const state = geo.address.state || '';
    const country = geo.address.country || '';

    const caribbeanTerritories = ['Guadeloupe', 'Martinique', 'Saint Martin', 'Saint Barthélemy'];
    const territory = caribbeanTerritories.find(t =>
      [state, geo.address.county, geo.address.region].some(v => v && v.includes(t))
    );

    if (territory) return [town, territory].filter(Boolean).join(', ');
    if (country === 'United States') return [town, state].filter(Boolean).join(', ');
    return [town, country].filter(Boolean).join(', ') || 'on the boat';
  } catch {
    return 'on the boat';
  }
}

function getNowEST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

async function checkAndSend() {
  if (sending) return;
  sending = true;
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) return;

    const { data, error } = await supabase
      .from('EDemail')
      .select('content, send_time, last_sent_at, to_emails, cc_emails')
      .eq('id', 1)
      .single();

    if (error || !data?.content || !data?.send_time) return;

    const now = getNowEST();
    const currentHHMM = now.toTimeString().slice(0, 5); // "HH:MM"

    if (currentHHMM !== data.send_time) return;

    // Check if already sent today (compare dates in EST)
    if (data.last_sent_at) {
      const lastSent = new Date(new Date(data.last_sent_at).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      if (
        lastSent.getFullYear() === now.getFullYear() &&
        lastSent.getMonth() === now.getMonth() &&
        lastSent.getDate() === now.getDate()
      ) {
        return; // Already sent today
      }
    }

    logger.info('Ed email scheduler: sending daily email');

    const today = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const location = await resolveLocation();
    const emailContent = data.content.replace(/\{\{location\}\}/g, location);
    const fullContent = `Hello Ed,\nToday is ${today}\n\n${emailContent}`;

    const toEmails = data.to_emails || 'edsimms12@gmail.com';
    const ccEmails = data.cc_emails || 'mail@bradsimms.com, ryansimms@gmail.com';

    await getTransporter().sendMail({
      from: getEnv().YAHOO_EMAIL,
      to: toEmails,
      cc: ccEmails,
      subject: 'Email from Ryan and Brad about your day',
      text: fullContent,
    });

    await supabase
      .from('EDemail')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('id', 1);

    logger.info('Ed email scheduler: email sent successfully', { to: toEmails });
  } catch (err) {
    logger.error('Ed email scheduler: send failed', { error: err.message });
  } finally {
    sending = false;
  }
}

export function startEdEmailScheduler() {
  if (cronTask) return;

  // Run every minute
  cronTask = cron.schedule('* * * * *', () => {
    checkAndSend();
  });

  // Log next send info
  getSupabaseClient().then(async (supabase) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('EDemail')
      .select('send_time')
      .eq('id', 1)
      .single();
    if (data?.send_time) {
      logger.info(`Ed email scheduler started — daily send at ${data.send_time} EST`);
    }
  }).catch(() => {});
}

export function stopEdEmailScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}

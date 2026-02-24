# Ed Email Scheduler — DO NOT TOUCH

## What This Is

A **separate side project** that sends a daily email to Ed (Brad's dad). It has nothing to do with BoatOS core functionality (chat, documents, equipment, maintenance, etc.).

BoatOS hosts the scheduler only because it runs 24/7 on Render, unlike the ed-email service which sleeps on the free tier.

---

## DO NOT modify, refactor, or "improve" any of these files

| File | Purpose |
|------|---------|
| `src/services/ed-email-scheduler.service.js` | Cron job (every minute) that checks if it's time to send the daily email |
| `src/start.js` (the `startEdEmailScheduler` / `stopEdEmailScheduler` lines only) | Starts and stops the scheduler with the server |
| `src/routes/admin/email-proxy.route.js` | Nodemailer SMTP proxy used by the scheduler and by the ed-email "Send Now" button |

### External repo (separate project, separate Render service)

| File | Purpose |
|------|---------|
| `~/code/ed-email/server.js` | Web UI for editing email content, recipients, and send time. Deployed at `https://ed-email.onrender.com` |

---

## How It Works

1. **ed-email UI** (`ed-email.onrender.com`) lets users edit the email body, set a send time (EST), and configure To/CC recipients. All saved to the `EDemail` table in Supabase.

2. **BoatOS scheduler** (`ed-email-scheduler.service.js`) runs a node-cron job every minute:
   - Reads `send_time`, `last_sent_at`, `content`, `to_emails`, `cc_emails` from the `EDemail` table
   - If current EST time `HH:MM` matches `send_time` AND email hasn't been sent today, it sends
   - Resolves the boat's current location via `gps_position` table + Nominatim reverse geocoding
   - Replaces `{{location}}` placeholder in the email body
   - Sends directly via nodemailer (Yahoo SMTP), same transporter as `email-proxy.route.js`
   - Updates `last_sent_at` after successful send

3. **"Send Now" button** in the ed-email UI calls `POST /api/send` on the ed-email service, which proxies through BoatOS's `/admin/api/email-proxy/send` endpoint.

---

## Database

**Table:** `EDemail` (Supabase)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | int | Always 1 (single-row table) |
| `content` | text | Email body (supports `{{location}}` placeholder) |
| `send_time` | text | Daily send time in `HH:MM` format (EST) |
| `to_emails` | text | Comma-separated To recipients |
| `cc_emails` | text | Comma-separated CC recipients |
| `last_sent_at` | timestamp | When the last email was sent |
| `updated_at` | timestamp | When content was last saved |

---

## Environment Variables Used

| Variable | Where | Purpose |
|----------|-------|---------|
| `YAHOO_EMAIL` | BoatOS `.env` | SMTP sender address |
| `YAHOO_PASSWORD` | BoatOS `.env` | SMTP app password |

These are already in the BoatOS env schema (`src/config/env.js`) and on Render.

---

## Why This Lives in BoatOS

The ed-email Render service runs on the free tier and sleeps after inactivity. cron-job.org was used to wake it up and trigger sends, but this was unreliable. BoatOS runs 24/7 on a paid Render plan, so the scheduler was moved here.

**This is purely a hosting convenience. The email feature is not part of BoatOS.**

---

## If Something Breaks

- Check BoatOS logs for `Ed email scheduler:` prefixed messages
- Verify the `EDemail` table has a row with `id = 1`
- Verify `YAHOO_EMAIL` and `YAHOO_PASSWORD` are set in the environment
- The scheduler silently skips if Supabase is unavailable or content is empty

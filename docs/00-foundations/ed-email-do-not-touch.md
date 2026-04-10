# Ed Email Scheduler — DO NOT TOUCH

## What This Is

A **separate side project** that sends a daily email to Ed (Brad's dad). It has nothing to do with BoatOS core functionality (chat, documents, equipment, maintenance, etc.).

BoatOS hosts the scheduler only because it runs 24/7 on Render, unlike the ed-email service which sleeps on the free tier. cron-job.org is no longer used.

**This is purely a hosting convenience. The email feature is not part of BoatOS.**

---

## DO NOT modify, refactor, or "improve" any of these files

### BoatOS files (this repo)

| File | Purpose |
|------|---------|
| `src/services/ed-email-scheduler.service.js` | Cron job (every minute) that checks if it's time to send the daily email. Sends directly via nodemailer (Yahoo SMTP). Has in-memory `sending` lock to prevent overlapping sends. |
| `src/start.js` (the `startEdEmailScheduler` / `stopEdEmailScheduler` lines only) | Starts scheduler on server boot, stops on SIGTERM/SIGINT. Production only (`NODE_ENV=production`). |
| `src/routes/admin/email-proxy.route.js` | Nodemailer SMTP proxy. Used by the ed-email "Send Now" button (not by the scheduler — scheduler sends directly). |
| `src/public/other-links.html` | Contains the "Email to Ed" link pointing to `https://ed-email.onrender.com`. |

### External repo (separate project, separate Render service)

| File | Purpose |
|------|---------|
| `~/code/ed-email/server.js` | Web UI for editing email content, recipients, and send time. PIN-protected. Deployed at `https://ed-email.onrender.com`. |

---

## How It Works

### Daily scheduled send (BoatOS scheduler)

`ed-email-scheduler.service.js` runs a node-cron job every minute:

1. Reads `send_time`, `last_sent_at`, `content`, `to_emails`, `cc_emails` from the `EDemail` table (row `id = 1`)
2. Compares current EST time `HH:MM` to `send_time` — exits if no match
3. Checks `last_sent_at` — exits if already sent today (EST date comparison)
4. Acquires in-memory `sending` lock (prevents duplicate sends if cron ticks overlap)
5. Resolves the boat's current location via `gps_position` table + Nominatim reverse geocoding
6. Replaces `{{location}}` placeholder in the email body
7. Builds email: `Hello Ed,\nToday is {date}\n\n{content}`
8. Sends directly via nodemailer (Yahoo SMTP at `plus.smtp.mail.yahoo.com:465`)
9. Updates `last_sent_at` in the database
10. Releases `sending` lock

**Recipient resolution:**
- **To:** `ED_EMAIL_TO` env var (if set) > `to_emails` column > fallback `edsimms12@gmail.com`
- **CC:** Hardcoded to `mail@bradsimms.com, ryansimms@gmail.com`
- **Subject:** `Email from Ryan and Brad about your day`

### "Send Now" button (ed-email service)

`POST /api/send` on the ed-email service:

1. Reads `content`, `to_emails`, `cc_emails` from the `EDemail` table
2. Replaces `{{location}}` with `"on the boat"` (does NOT resolve GPS — no location lookup)
3. Proxies through BoatOS's `/admin/api/email-proxy/send` endpoint (not direct SMTP)
4. Updates `last_sent_at` after successful send

### ed-email UI

The web interface at `ed-email.onrender.com`:

- PIN-protected login (cookie-based auth, 30-day expiry)
- **Fields:** Email content (textarea), Send time (time picker), To (text), CC (text)
- **Buttons:** Save (persists all fields to DB), Send Now (sends immediately)
- **Save** calls `POST /api/save` — upserts all fields to the `EDemail` table
- **Send Now** calls `POST /api/send` — reads from DB and sends via BoatOS proxy

---

## Two Send Paths — Key Differences

| | **Scheduled send** (BoatOS) | **Send Now** (ed-email) |
|---|---|---|
| Trigger | Cron every minute, time match | Manual button click + confirm dialog |
| Location | Resolved from GPS + Nominatim | Hardcoded `"on the boat"` |
| SMTP | Direct nodemailer | Proxied through BoatOS email-proxy |
| CC | Hardcoded in scheduler | Read from DB |
| To | `ED_EMAIL_TO` env > DB > fallback | DB > fallback |
| Dedup | `last_sent_at` + `sending` lock | None (manual only) |

---

## Database

**Table:** `EDemail` (Supabase) — single-row table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | int | Always `1` |
| `content` | text | Email body. Supports `{{location}}` placeholder. |
| `send_time` | text | Daily send time in `HH:MM` format (EST) |
| `to_emails` | text | Comma-separated To recipients |
| `cc_emails` | text | Comma-separated CC recipients |
| `last_sent_at` | timestamptz | When the last email was sent (used for dedup) |
| `updated_at` | timestamptz | When content was last saved from the UI |

---

## Environment Variables

### BoatOS (.env + Render)

| Variable | Purpose |
|----------|---------|
| `YAHOO_EMAIL` | SMTP sender address (Yahoo) |
| `YAHOO_PASSWORD` | SMTP app password (Yahoo) |
| `ED_EMAIL_TO` | Optional override for To recipient (takes priority over DB value) |

These are in the BoatOS env schema (`src/config/env.js`).

### ed-email (.env + Render)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Database connection |
| `SUPABASE_SERVICE_KEY` | Database auth |
| `BOATOS_URL` | BoatOS base URL for email-proxy calls |
| `BOATOS_ADMIN_TOKEN` | Auth token for BoatOS admin API |
| `PIN` | Login PIN for the web UI |
| `COOKIE_SECRET` | Signed cookie secret |

---

## Render Services

| Service | URL | Tier | Purpose |
|---------|-----|------|---------|
| **boatos-main** | `boatos-main.onrender.com` | Paid (24/7) | Hosts the scheduler |
| **ed-email** | `ed-email.onrender.com` | Free (sleeps) | Hosts the UI only |

The scheduler runs on BoatOS because the ed-email service sleeps on the free tier and was unreliable with cron-job.org wake-up triggers.

---

## Why This Lives in BoatOS

The ed-email Render service runs on the free tier and sleeps after inactivity. cron-job.org was previously used to wake it up and trigger sends, but this was unreliable (service failed to wake, emails missed). BoatOS runs 24/7 on a paid Render plan, so the scheduler was moved here.

---

## If Something Breaks

- Check BoatOS logs for `Ed email scheduler:` prefixed messages
- Verify the `EDemail` table has a row with `id = 1` and `content` is not empty
- Verify `YAHOO_EMAIL` and `YAHOO_PASSWORD` are set in the environment
- Verify `send_time` is set (e.g., `08:20`)
- The scheduler silently skips if Supabase is unavailable or content/send_time is empty
- If email sends twice: check that only BoatOS scheduler is sending (no stale cron-job.org jobs)
- The `sending` lock prevents overlapping sends within the same process but does not persist across restarts

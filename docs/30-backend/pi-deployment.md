# Pi Deployment

## Overview

The Raspberry Pi runs on the boat for always-on anchor monitoring. It has its own codebase separate from the main app.

**Hardware:** Raspberry Pi (on boat)
**Purpose:** Anchor alarm, GPS monitoring, Telegram alerts

## What Runs on Pi

| Function | Description |
|----------|-------------|
| Anchor Watch | Continuous GPS position monitoring |
| Drift Detection | Alert when boat exceeds swing radius |
| Telegram Alerts | Send notifications when dragging |
| Position Logging | Log GPS positions to database |

## Pi Code Location

> **NOTE:** The Pi code directory (`pi/`) does not currently exist in this repository. The anchor alarm functionality runs on the main Node.js backend (`src/services/anchor-watch.service.js`) and Telegram alerts are sent via `src/services/telegram.service.js`. The Pi deployment documented here is for future always-on monitoring when the boat is offline.

**Expected structure when implemented:**
```
/Users/brad/code/REIMAGINEDAPPV2/pi/
├── CLAUDE.md       # Pi-specific instructions
├── .cursorrules    # Pi coding standards
├── .env            # Pi environment (not in git)
└── scripts/        # Monitoring scripts
```

## Differences from Main App

| Aspect | Main App | Pi |
|--------|----------|-----|
| Runtime | Node.js + Python | Python mainly |
| Database | Direct Supabase | Direct Supabase |
| UI | Web-based | Headless |
| Network | Always on | May be intermittent |
| Power | Server | Battery/shore power |

## Setup

### Hardware Requirements

- Raspberry Pi 3B+ or newer
- USB GPS receiver
- Power supply
- Network (WiFi or cellular)

### Software Setup

1. Install Python 3.9+
2. Clone code to Pi
3. Create virtual environment
4. Install dependencies
5. Configure .env
6. Set up systemd service

### Environment Variables (Pi)

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
GPS_DEVICE=/dev/ttyUSB0
```

## Monitoring Script

The anchor watch script:

1. Reads GPS position from USB device
2. Compares to set anchor point
3. Calculates drift distance
4. Updates status in Supabase
5. Sends Telegram alert if dragging

## Deployment

### Manual Deployment

```bash
# SSH to Pi
ssh brad@pi-hostname

# Pull latest code
cd ~/Code
git pull

# Restart service
sudo systemctl restart anchor-watch
```

### Systemd Service

```ini
[Unit]
Description=Anchor Watch Monitor
After=network.target

[Service]
Type=simple
User=brad
WorkingDirectory=/home/brad/Code
ExecStart=/home/brad/Code/venv/bin/python anchor_watch.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Telegram Integration

Alerts sent via Telegram bot:

```
⚠️ ANCHOR ALARM

Status: DRAGGING
Drift: 45m (limit: 30m)
Position: 25.7617° N, 80.1918° W
Time: 2025-01-15 03:42:15 UTC

Check anchor immediately!
```

## Troubleshooting

### GPS Not Reading

```bash
# Check if GPS device connected
ls /dev/ttyUSB*

# Check GPS output
cat /dev/ttyUSB0
```

### Service Not Running

```bash
# Check status
sudo systemctl status anchor-watch

# View logs
journalctl -u anchor-watch -f
```

### Network Issues

```bash
# Check connectivity
ping google.com

# Check Supabase reachability
curl -I https://your-project.supabase.co
```

## Files & Locations

| Purpose | Path (on Pi) |
|---------|--------------|
| Main code | `/home/brad/Code/` |
| Virtual env | `/home/brad/Code/venv/` |
| Logs | `/home/brad/Code/logs/` |
| Systemd service | `/etc/systemd/system/anchor-watch.service` |

## Security Notes

1. Keep Pi updated (`apt update && apt upgrade`)
2. Use SSH keys, not passwords
3. Don't expose Pi directly to internet
4. Keep `.env` secure

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Pi runs full BoatOS" | **No.** Only anchor monitoring |
| "Pi has web UI" | **No.** Headless, uses Telegram |
| "Pi syncs with main app" | **No.** Direct Supabase access |
| "Pi is required" | **No.** Main app has anchor watch too |

## Related Docs

- [Anchor Alarm](../10-user-features/anchor-alarm.md) - Feature overview
- [Environments](../00-foundations/environments.md) - All environments

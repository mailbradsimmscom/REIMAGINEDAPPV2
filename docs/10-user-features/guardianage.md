# Guardianage — Off-Season Vessel Care Management

## Overview

Mobile-first operational app for managing off-season boat care for REIMAGINED. Built as a self-contained module at `/guardianage/`, mounted in `src/app.js` with one line.

**Season:** May 1 – November 8 2026 (7 months, 32 weeks, 304 task instances, 31 templates)

## Architecture

```
/guardianage/
  index.js           ← Express router (mount point)
  routes/
    auth.js           ← Login/logout
    dashboard.js      ← Season overview API
    months.js         ← Month list + detail
    tasks.js          ← Task detail, complete, reopen, photos
    notes.js          ← Monthly notes with revision history
    supplies.js       ← Supply tracking with receipts
    admin.js          ← User mgmt, template mgmt, audit views
  services/
    auth.service.js   ← Login, session validation, password hashing
    photo.service.js  ← Upload to Supabase Storage, URL resolution
  repositories/
    auth.repository.js ← User/session DB operations
    supabase.js       ← Re-exports main app Supabase client
  middleware/
    auth.js           ← Session cookie validation, requireAdmin
  public/
    login.html, dashboard.html, month.html, task.html
    admin-users.html, admin-templates.html, admin-audit.html
    css/guardianage.css
  migrations/         ← SQL migrations (001-004)
  scripts/            ← seed-season.mjs, seed-tasks.mjs
  tests/              ← 41 tests (auth, tasks, notes, supplies, overdue, isolation)
```

**Mount:** `app.use('/guardianage', guardianageRouter)` in `src/app.js`

**Environment:** Runs on boatos-main (same Render service, same Supabase). Two env vars: `GUARDIANAGE_SESSION_SECRET`, `GUARDIANAGE_ADMIN_PASSWORD`.

## Auth Model

- Own user table (`guardianage_users`) separate from main app
- bcrypt password hashing (salt rounds 10)
- httpOnly session cookies (30-day TTL, refreshed on activity)
- Session tokens: 32 random bytes, stored as SHA-256 hash
- Cookie flags: HttpOnly, Secure (production), SameSite=Lax, path=/guardianage
- Login rate limiting: 5 failed attempts → 30-min lockout
- Complete isolation from main app auth (x-admin-token is irrelevant)

## User Roles

| Role | Capabilities |
|------|-------------|
| `team_user` | View tasks, complete/reopen weekly+monthly, upload photos, add notes/supplies |
| `admin` | All team capabilities + reopen major items, delete photos, manage users/templates, view audit/revisions |

## Task Model

Three task types:
- **Weekly recurring** — due within a specific week (8 templates)
- **Monthly recurring** — due within a month (4 templates)
- **Monthly major** — large one-off jobs per month (varies)

**Status:** `open` → `complete` (via reopen → `open` cycle). `cancelled` for deactivated templates. `overdue` is derived (not stored).

**Overdue rule:** `status = 'open'` AND `today (AST) > due_end_date`

## Pages

| URL | Page | Auth |
|-----|------|------|
| `/guardianage/login` | Login | Public |
| `/guardianage/` | Dashboard | Authenticated |
| `/guardianage/month/:id` | Month view | Authenticated |
| `/guardianage/task/:id` | Task detail | Authenticated |
| `/guardianage/admin/users` | User management | Admin only |
| `/guardianage/admin/templates` | Template management | Admin only |
| `/guardianage/admin/audit` | Audit & activity | Admin only |

## API Endpoints

### Auth
- `POST /guardianage/api/auth/login` — Login (Zod validated)
- `POST /guardianage/api/auth/logout` — Logout

### Dashboard
- `GET /guardianage/api/dashboard` — Season overview, current month/week, task summaries

### Months
- `GET /guardianage/api/months` — List all months
- `GET /guardianage/api/months/:monthId` — Month detail with grouped tasks

### Tasks
- `GET /guardianage/api/tasks/:taskId` — Task detail with events + photos
- `POST /guardianage/api/tasks/:taskId/complete` — Mark complete (Zod validated)
- `POST /guardianage/api/tasks/:taskId/reopen` — Reopen (major items: admin only)
- `POST /guardianage/api/tasks/:taskId/photos` — Upload photos (multer, max 10 files, 2MB each, 40 per task)
- `DELETE /guardianage/api/tasks/:taskId/photos/:photoId` — Soft-delete photo (admin only)

### Notes
- `GET /guardianage/api/months/:monthId/notes` — Current note + "last saved by"
- `POST /guardianage/api/months/:monthId/notes/save` — Save note, creates revision (Zod validated)
- `GET /guardianage/api/months/:monthId/notes/revisions` — Revision history (admin only)

### Supplies
- `GET /guardianage/api/months/:monthId/supplies` — List with receipts
- `POST /guardianage/api/months/:monthId/supplies` — Create (Zod validated)
- `PATCH /guardianage/api/supplies/:supplyId` — Update (Zod validated, creates revision)
- `POST /guardianage/api/supplies/:supplyId/receipt` — Upload receipt photo (multer)

### Admin (all require admin role)
- `GET/POST /guardianage/api/admin/users` — List/create users
- `PATCH /guardianage/api/admin/users/:userId` — Update user
- `POST /guardianage/api/admin/users/:userId/reset-password` — Reset + revoke sessions
- `PATCH /guardianage/api/admin/users/:userId/deactivate` — Deactivate + revoke sessions
- `GET/POST /guardianage/api/admin/templates` — List/create templates (auto-propagation)
- `PATCH /guardianage/api/admin/templates/:templateId` — Update template
- `POST /guardianage/api/admin/templates/:templateId/deactivate` — Soft-cancel future instances
- `GET /guardianage/api/admin/audit` — Audit log (paginated, filterable)
- `GET /guardianage/api/admin/task-events` — All task events (paginated)

## Database Tables

| Table | Purpose |
|-------|---------|
| `guardianage_seasons` | Season definitions |
| `guardianage_months` | Months within a season |
| `guardianage_weeks` | Weeks within months |
| `guardianage_users` | App-specific users (login_id, password_hash, role) |
| `guardianage_user_sessions` | Session tokens (hashed), TTL, revocation |
| `guardianage_task_templates` | Recurring task definitions |
| `guardianage_tasks` | Concrete task instances |
| `guardianage_task_events` | Append-only task lifecycle history |
| `guardianage_task_photos` | Task photo metadata (soft-delete) |
| `guardianage_month_notes` | Current note per month |
| `guardianage_month_note_revisions` | Every note save revision |
| `guardianage_month_supplies` | Supply purchases |
| `guardianage_month_supply_revisions` | Supply edit history |
| `guardianage_month_supply_receipts` | Receipt photo metadata |
| `guardianage_audit_log` | Cross-domain audit events |

No DB-level FK constraints (application-level only).

## Storage

Photos stored in Supabase Storage `documents` bucket:
- Task photos: `guardianage/task-photos/`
- Receipt photos: `guardianage/receipt-photos/`

Public URLs resolved at read time (not persisted).

Client-side image resize before upload: 1920px long edge, JPEG 85% quality.

## Testing

Run: `npm run test:guardianage`

41 tests covering: auth (10), tasks (7), notes (6), supplies (6), overdue (6), isolation (6).

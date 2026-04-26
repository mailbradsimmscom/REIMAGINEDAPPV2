# Off-Season Guardianage Team App Plan

## Purpose

Build a mobile-first, app-style web surface inside the existing REIMAGINED app stack for managing the off-season guardianage operation for the single vessel `REIMAGINED`.

This feature set will live at its own URL/page entry point and must be operationally isolated from the rest of the app:

- team users can log in only to this guardianage area
- team users must have no access to the rest of the main app
- admin access for this area is separate in practice, even if implemented in the same codebase
- the experience should feel like a focused field-operations app, not a generic admin form set

This is not a fleet product.

- vessel count: `1`
- vessel name: `REIMAGINED`
- season count for MVP: `1 active upcoming season`
- season window: `May 1` through `November 8`
- team user count for MVP: `3`

---

## Product Summary

The app supports a seasonal operating model organized by:

- `Season`
- `Month`
- `Week`
- `Task`

The planning model includes three different task classes:

1. `Weekly recurring tasks`
   - tasks that must be completed within a specific week
2. `Monthly recurring tasks`
   - tasks that must be completed sometime within a specific month
3. `Monthly major items`
   - one or two larger jobs assigned to a given month

The app must support:

- individual task completion
- photo evidence on tasks
- monthly notes with revision history on every save
- monthly supplies purchased with price and receipt image
- admin visibility into all activity
- basic user management for this app only

---

## Core Rules

## Operational Rules

- there is only one vessel in scope: `REIMAGINED`
- there is one active season in MVP: `May 1` to `November 8`
- every task is completed individually
- no bulk "complete the week" or "complete the month" action
- week and month status are derived from underlying task completion
- monthly notes must preserve every save revision
- monthly supplies are tracked separately from task proof photos

## Access Rules

- guardianage team users can access only the guardianage pages
- guardianage team users cannot navigate to or use the rest of the main app
- admin can monitor activity and manage users/passwords for this feature
- no public signup
- no social login
- simple assigned user ID + password login only

## Technical Rules

- remain in the current app stack
- use the existing Node/ESM/Vanilla JS architecture patterns already used in the app
- use Supabase tables for persistence
- all guardianage table reads and writes must go through Node routes/services/repositories only
- browser clients must not access guardianage Supabase tables directly
- reuse existing Supabase Storage upload patterns where possible
- prefer the existing `documents` bucket pattern already used for supply photos unless there is a strong reason to create a new bucket
- passwords must be stored only as strong one-way hashes, never plaintext
- guardianage auth must use a dedicated session model for this area
- client-side image compression/resizing is part of MVP, not a later enhancement
- all due dates and overdue calculations use AST (`UTC-4`)
- all timestamps should be stored in UTC, with operational windows computed using the configured vessel timezone
- foreign key relationships are application-level only — no DB-level FK constraints for MVP
- keep the data model simple and avoid over-engineering for a small-scale operational app

---

## Users And Roles

## 1. Team User

Primary field operator / guardianage worker.

Permissions:

- log in to guardianage area
- view current month/week tasks
- open task details
- mark task complete
- add completion notes
- upload task photos
- add monthly notes
- save monthly note revisions
- add monthly supplies purchased
- upload receipt photos

Restrictions:

- cannot access the rest of the main app
- cannot manage users
- cannot change system configuration
- cannot alter season templates unless later explicitly allowed

## 2. Admin

Owner/operator administrative role.

Permissions:

- all team user capabilities
- view all months, weeks, tasks, notes, expenses, and uploads
- view complete audit trail for note revisions and operational activity
- add/edit/deactivate users
- reset user passwords
- configure recurring weekly tasks
- configure recurring monthly tasks
- assign monthly major items
- review operational completeness month by month

MVP assumption:

- one admin user is sufficient initially

---

## Primary User Flows

## 1. Team Login

1. user visits guardianage URL
2. user sees dedicated login screen for this operational area
3. user enters assigned `user ID` and `password`
4. app authenticates against guardianage user store
5. app opens into the guardianage dashboard, not the main app

Success criteria:

- fast login
- simple UI
- no path into unrelated app surfaces

## 2. Complete A Weekly Task

1. user opens current month
2. user sees weekly buckets
3. user opens the relevant week
4. user selects a task
5. user reviews instructions/checklist
6. user adds optional note
7. user uploads one or more photos
8. user marks task complete
9. app records timestamp, actor, notes, and media

Success criteria:

- clear outstanding/completed states
- easy photo upload on mobile
- proof of work retained

## 3. Complete A Monthly Task

1. user opens current month
2. user sees month-level recurring tasks
3. user opens a task
4. user uploads photos and/or note
5. user marks it complete

Success criteria:

- monthly tasks are visually distinct from weekly tasks
- completion remains at task level

## 4. Work A Major Monthly Item

1. user opens month
2. user sees one or two major monthly items
3. user opens item detail
4. user reviews work scope
5. user uploads photos and adds notes as work is done
6. user marks item complete

## 5. Add Monthly Notes

1. user opens month
2. user enters text into notes area
3. user saves
4. system creates a distinct revision record
5. user later edits the visible text
6. user saves again
7. system stores a new full revision snapshot

Required behavior:

- every save is retained
- backend/admin can inspect all revisions
- delete/clear actions must also be preserved as an event or versioned save state

## 6. Add Supplies Purchased

1. user opens month
2. user opens `Supplies Purchased`
3. user adds item name, price, date, optional vendor/category/note
4. user uploads receipt photo
5. user saves

Success criteria:

- expenses are easy to log in the field
- receipt image is retained
- entries can be linked to month and optionally a task/major item

## 7. Admin User Management

1. admin logs in
2. admin opens users screen
3. admin adds a user ID and password
4. admin assigns role
5. admin may later deactivate or reset password

MVP behavior:

- simple manual provisioning is acceptable

---

## Information Architecture

The guardianage area should be an isolated route namespace, for example:

- `/guardianage/login`
- `/guardianage`
- `/guardianage/month/:id`
- `/guardianage/admin/users`

Exact route names can change, but the isolation principle should remain.

Recommended MVP choice:

- route path namespace: `/guardianage`
- visible product label: `Reimagined Guardianage`

## Team-Facing Pages

## 1. Login

Purpose:

- dedicated entry point into the guardianage system

Content:

- brand/context
- user ID field
- password field
- sign-in action

## 2. Dashboard

Purpose:

- immediate operational overview

Content:

- current season summary
- current month
- current week
- tasks due this week
- monthly tasks still open
- major monthly items still open
- quick links to add notes and supplies

## 3. Month View

Purpose:

- primary operating screen

Sections:

- month summary/status
- weekly task groups by week
- monthly recurring tasks
- monthly major items
- supplies purchased
- notes

This should likely be the most important screen in the app.

## 4. Task Detail

Purpose:

- complete one task with evidence

Content:

- task title
- task type
- due window
- instructions/checklist
- status
- completion note field
- photo upload area
- completion action

## 5. Supplies Purchased

Purpose:

- capture monthly expenses and receipt proof

Content:

- list of entries for the selected month
- add entry form
- amount
- purchase date
- vendor
- note
- receipt image

## 6. Month Notes

Purpose:

- operational notes journal with version history

Content:

- editable current note text
- save action
- latest saved timestamp
- optional history preview later

## Admin Pages

## 7. Admin Dashboard

Purpose:

- see operational state across the season

Content:

- completion metrics
- overdue items
- recent uploads
- recent note revisions
- recent supplies
- user activity

## 8. User Management

Purpose:

- create and maintain team access

Content:

- list users
- add user
- edit role
- reset password
- deactivate user

## 9. Task Template Management

Purpose:

- manage recurring weekly and recurring monthly templates

Content:

- weekly task template list
- monthly recurring task template list
- create/edit/deactivate templates

## 10. Monthly Major Item Management

Purpose:

- assign month-specific larger jobs

Content:

- month selector
- create/edit/remove major items for that month

## 11. Audit / Activity

Purpose:

- backend/admin visibility into all save events and operational actions

Content:

- note revision history
- task completion events
- photo upload events
- supply entry events
- user management events

---

## Data Model

This is an MVP-oriented relational model for Supabase/Postgres.

## Core Planning Tables

### `guardianage_seasons`

Represents a season window.

Suggested fields:

- `id`
- `name`
- `vessel_name`
- `start_date`
- `end_date`
- `status` (`planned`, `active`, `closed`)
- `created_at`
- `updated_at`

MVP seed:

- one row for `REIMAGINED 2026 Guardianage Season`

### `guardianage_months`

Represents each month within a season.

Suggested fields:

- `id`
- `season_id`
- `month_key` (`2026-05`, `2026-06`, etc.)
- `month_start_date`
- `month_end_date`
- `display_name`
- `sort_order`
- `created_at`
- `updated_at`

### `guardianage_weeks`

Represents week windows within a month.

Suggested fields:

- `id`
- `month_id`
- `week_number_in_month`
- `week_start_date`
- `week_end_date`
- `display_name`
- `sort_order`
- `created_at`
- `updated_at`

Note:

- weeks should be explicit rows, not inferred only in frontend logic
- this simplifies task instancing and auditability
- weeks are operational blocks contained entirely inside the month
- weeks do not spill across month boundaries

MVP week rule:

- if a date falls in a month, it belongs to a week row in that same month
- example for May 2026:
  - `May 1-7`
  - `May 8-14`
  - `May 15-21`
  - `May 22-28`
  - `May 29-31`

Validation rules:

- seeded week rows must not overlap
- seeded week rows must fully cover the month
- every date in the month must belong to exactly one week row

## User Tables

### `guardianage_users`

App-specific users for this surface.

Suggested fields:

- `id`
- `login_id`
- `password_hash`
- `display_name`
- `role` (`team_user`, `admin`)
- `is_active`
- `created_at`
- `updated_at`
- `last_login_at`

Design note:

- use app-specific auth/session logic if this surface must remain separated from the main app experience
- do not rely on "hidden links" as access control
- `password_hash` means a proper password hash, never plaintext
- use `login_id` rather than `user_id` to avoid confusion with the primary key id

Password recommendation:

- use `argon2id` if it fits cleanly in the current stack
- otherwise use `bcrypt`
- minimum password length: 4 characters
- no complexity requirements

### `guardianage_user_sessions`

Required session table for guardianage-specific auth.

Suggested fields:

- `id`
- `user_id` (FK to `guardianage_users.id`, not the login_id)
- `session_token_hash`
- `created_at`
- `expires_at`
- `revoked_at`
- `ip_address`
- `user_agent`

MVP auth decision:

- use `httpOnly` session cookies for mobile web
- validate every guardianage request against this session table
- keep guardianage auth separate from the main app's admin token pattern
- use a mobile-friendly session TTL

Recommended MVP session duration:

- sessions expire after `30 days` unless revoked earlier
- activity can refresh expiry if desired, but long-lived mobile sessions are preferred over frequent re-login friction

Cookie/session security policy:

- cookie must be `HttpOnly`
- cookie must be `Secure` in production
- cookie should use `SameSite=Lax` for MVP unless a cross-site requirement appears
- absolute session timeout: `30 days`
- idle timeout should refresh on activity for MVP
- rotate session token on login
- revoke all active guardianage sessions for that user on password reset
- add login rate limiting: 5 failed attempts triggers 30-minute lockout

## Task Template Tables

### `guardianage_task_templates`

Defines recurring task rules and major task blueprints.

Suggested fields:

- `id`
- `title`
- `description`
- `task_type` (`weekly_recurring`, `monthly_recurring`, `monthly_major`)
- `is_active`
- `default_instructions`
- `has_photo_upload`
- `display_order`
- `created_at`
- `updated_at`

MVP template strategy:

- keep templates simple
- seed concrete task instances directly for the active season
- do not add a separate scheduling table in MVP
- admin can adjust templates and add task instances after launch

Future option:

- if future seasons need auto-generation, add schedule metadata later

Mid-season template change rule:

- if admin adds a new weekly recurring template mid-season, create task instances for the current week and all future weeks in the active season
- if admin adds a new monthly recurring template mid-season, create task instances for the current month and all future months in the active season
- do not create retroactive task instances for past weeks or past months
- this propagation must happen automatically in the service layer when the template is saved — no separate "propagate" action

Template deactivation rule:

- when admin deactivates a template, existing task instances in past weeks/months are preserved and remain visible
- open task instances in the current week/month and all future weeks/months are set to `status = 'cancelled'` (soft-cancel, not hard-delete)
- completed task instances are never modified regardless of timing
- cancelled tasks are hidden from team-facing views but remain in the database for audit purposes
- cancelled tasks retain any associated events, photos, and notes
- this avoids orphan risk since there are no DB-level FK constraints

## Task Instance Tables

### `guardianage_tasks`

Concrete task instances shown to users.

Suggested fields:

- `id`
- `season_id`
- `month_id`
- `week_id` nullable
- `task_template_id` nullable
- `task_type` (`weekly_recurring`, `monthly_recurring`, `monthly_major`)
- `title`
- `description`
- `instructions`
- `status` (`open`, `complete`, `cancelled`)
- `due_start_date`
- `due_end_date`
- `completed_at` nullable
- `completed_by_user_id` nullable
- `display_order`
- `created_at`
- `updated_at`

Rules:

- weekly tasks must have a `week_id`
- monthly recurring tasks should have `month_id` and no `week_id`
- monthly major items should have `month_id` and usually no `week_id`
- current task state lives here, but history should be preserved separately in event rows

Explicit state transitions:

- `completed` event sets `guardianage_tasks.status = 'complete'`
- `reopened` event sets `guardianage_tasks.status = 'open'`
- derived week/month completion must always use the current task status
- `reopened` clears `completed_at` and `completed_by_user_id`
- reopen cycles are unlimited, with full append-only history retained

Task assignment rule:

- tasks are unassigned — any team user can complete any task
- there is no task assignment or ownership model in MVP

Task completion rule:

- photos are never required to complete a task
- photos can be added before, during, or after completion (including via reopen-then-add)
- some tasks may not need photos at all

Photo limits:

- maximum 40 photos per task
- backend must enforce this limit

Photo deletion permissions:

- only admin can soft-delete task photos
- team users cannot delete photos

Reopening permissions:

- any team user can reopen a completed `weekly_recurring` or `monthly_recurring` task
- only admin can reopen a completed `monthly_major` task
- reopening creates an append-only event row and resets task status to open

Post-completion photo additions:

- team users can add photos to a completed major task without reopening it
- this creates a `photo_added` event on the completed task — status stays `complete`
- no other edits (notes, status) are allowed on a completed major task by team users

Month navigation:

- team users can navigate to and view all months and weeks in the active season
- no restriction to current or past months only

### `guardianage_task_events`

Captures all task lifecycle history as append-only events.

Suggested fields:

- `id`
- `task_id`
- `actor_user_id`
- `event_type` (`completed`, `reopened`, `note_updated`, `photo_added`, `photo_removed`, `metadata_updated`)
- `note_text` nullable
- `event_metadata_json` nullable
- `occurred_at`
- `created_at`

Design note:

- task history must be append-only
- editing after completion should create a new event row, not delete/replace prior history
- reopening after completion should create a new event row
- `guardianage_tasks` stores current state while `guardianage_task_events` stores full audit history
- `photo_added` and `photo_removed` are valid event types and should not require task completion to exist first

### `guardianage_task_photos`

Stores work-proof images for tasks.

Suggested fields:

- `id`
- `task_id`
- `task_event_id` nullable
- `storage_bucket`
- `storage_path`
- `original_filename`
- `mime_type`
- `file_size_bytes`
- `is_deleted`
- `deleted_at` nullable
- `deleted_by_user_id` nullable
- `uploaded_by_user_id`
- `uploaded_at`
- `created_at`

Design notes:

- photos may be uploaded before task completion, so `task_event_id` remains nullable by design
- `task_id` is the required relationship
- `task_event_id` is optional linkage to a specific event when relevant
- photo removal should be soft-delete only, not hard-delete (admin only)
- a `photo_removed` task event should accompany photo soft deletion
- do not persist `public_url` in guardianage media tables
- resolve media URLs at read time from `storage_bucket` + `storage_path` using public URLs
- maximum 40 photos per task, enforced at the backend

## Monthly Notes Tables

### `guardianage_month_notes`

Represents the current visible note document per month.

Suggested fields:

- `id`
- `month_id`
- `current_text`
- `last_saved_by_user_id`
- `last_saved_at`
- `created_at`
- `updated_at`

### `guardianage_month_note_revisions`

Required audit history for every save.

Suggested fields:

- `id`
- `month_note_id`
- `month_id`
- `revision_number`
- `full_text`
- `action_type` (`created`, `updated`, `cleared`, `deleted`)
- `saved_by_user_id`
- `saved_at`
- `created_at`

Critical requirement:

- every save creates a new revision row
- backend/admin can inspect the full revision timeline
- team users should see only the current note state, not the revision history UI
- admin users should be able to inspect the revision history

Concurrent editing rule:

- last-write-wins — no locking
- the UI must show "Last saved by [name] at [time]" above the note editor before the user starts editing
- this gives the user awareness if someone else recently saved, reducing accidental overwrites

## Supplies Tables

### `guardianage_month_supplies`

Represents purchases made in a given month.

Suggested fields:

- `id`
- `month_id`
- `purchase_date`
- `item_name`
- `category` nullable
- `vendor` nullable
- `amount`
- `currency_code`
- `note` nullable
- `related_task_id` nullable
- `entered_by_user_id`
- `created_at`
- `updated_at`

MVP currency rule:

- store the user-entered amount and currency directly
- supported currencies: `USD` and `XCD` only (ISO 4217)
- UI should present these as a dropdown, not free text
- if unified reporting is needed later, add a normalized reporting amount separately rather than forcing conversion at entry time

Supply category rule:

- `category` is free-text entry — no predefined list
- user can type whatever they want

Supply edit/delete rule:

- team users can edit a supply entry after creation
- supply entries cannot be deleted by any user
- every edit creates a revision row in `guardianage_month_supply_revisions` (append-only, same pattern as month notes)

### `guardianage_month_supply_revisions`

Append-only edit history for supply entries.

Suggested fields:

- `id`
- `month_supply_id`
- `revision_number`
- `item_name`
- `category`
- `vendor`
- `amount`
- `currency_code`
- `note`
- `action_type` (`created`, `updated`)
- `saved_by_user_id`
- `saved_at`
- `created_at`

Design note:

- every save (including initial creation) creates a revision row
- the current values live on `guardianage_month_supplies`, revisions capture prior state
- follows the same pattern as `guardianage_month_note_revisions`

### `guardianage_month_supply_receipts`

Stores receipt image metadata.

Suggested fields:

- `id`
- `month_supply_id`
- `storage_bucket`
- `storage_path`
- `original_filename`
- `mime_type`
- `file_size_bytes`
- `uploaded_by_user_id`
- `uploaded_at`
- `created_at`

Design note:

- as with task photos, resolve receipt URLs at read time using public URLs
- a supply can have multiple receipt photos — no hard limit
- receipts cannot be deleted

## Audit Table

### `guardianage_audit_log`

Required for MVP.

Suggested fields:

- `id`
- `actor_user_id`
- `entity_type`
- `entity_id`
- `action_type`
- `summary`
- `metadata_json`
- `created_at`

Suggested events:

- login success/failure
- user created/updated/deactivated
- month note saved
- supply added
- receipt uploaded

Canonical event ownership:

- `guardianage_task_events` is the canonical event stream for task lifecycle activity
- task completion, reopen, task note updates, and task photo add/remove events should be written to `guardianage_task_events`
- `guardianage_audit_log` is for cross-domain, security, and administrative actions
- login success/failure, user management, admin configuration changes, and other non-task operational actions should be written to `guardianage_audit_log`
- admin views should not double-count task-domain activity by treating both tables as equivalent sources for the same event
- month note revision history is canonical in `guardianage_month_note_revisions` — full text and revision detail lives there only
- `guardianage_audit_log` should only record a lightweight summary signal for note saves (e.g., "month note saved for June by user X") — never duplicate the full note text or revision detail
- if admin needs note history, read from `guardianage_month_note_revisions`, not the audit log

---

## Media Strategy

Photos are expected to be high volume.

That affects the architecture immediately.

## Reuse Existing Pattern

The current app already has a Supabase Storage pattern in:

- `documents` bucket
- service-level upload helpers
- existing supply-photo upload flow

Relevant existing implementation:

- `src/services/supplies/photo-storage.service.js`

Recommendation:

- reuse the same bucket strategy and upload service pattern
- create guardianage-specific folders inside the existing bucket unless a separate bucket is required later for policy reasons

Suggested folders:

- `guardianage/task-photos/`
- `guardianage/receipt-photos/`

This keeps the storage approach consistent with the existing app and minimizes infrastructure sprawl.

## Upload Considerations

- mobile-first capture
- multiple photos per task
- client-side image compression/resizing is required in MVP
- avoid full-resolution raw mobile uploads
- prefer `multipart/form-data` to the backend over base64-heavy transport for this feature
- keep the same storage destination pattern even if transport is improved

Recommended MVP upload behavior:

- resize image on client before upload
- target long edge around `1600-1920px`
- preserve enough quality for receipts and work-proof photos
- send compressed file via multipart upload
- store uploaded file in Supabase Storage and persist metadata in Postgres
- guardianage routes must use a `10MB` multipart body limit (separate from the main app's default limits)
- assume up to 10 photos may be uploaded in a single request
- backend must reject individual files larger than `2MB` after compression — if a file exceeds this, the client-side resize failed and the upload should be rejected with a clear error
- frontend must validate file size before sending and show a user-friendly error if resize fails

Media delivery rule:

- store only storage references and metadata in the database
- generate public URLs in the backend/service layer at read time
- no signed URLs for MVP — public URLs are sufficient for private vessel task proof photos

---

## Security And Isolation Model

This feature lives inside the current app codebase but must be isolated in behavior.

## Isolation Requirements

- dedicated route namespace
- dedicated login page
- dedicated session/auth middleware
- team users blocked from unrelated routes
- no shared navigation with the main app
- no assumption that hiding links is sufficient

## Recommended Approach

1. create dedicated guardianage routes under a unique namespace
2. create dedicated guardianage auth middleware
3. gate every guardianage route with that middleware
4. ensure guardianage users have no authorization path to other app sections
5. keep admin capability for guardianage scoped to this system

Implementation note:

- this does not require a separate deployment
- it does require explicit route and session separation

---

## UI/UX Direction

The UI is mobile-first and should feel like an operational app.

## UX Priorities

- low-friction login
- fast access to current work
- large tap targets
- prominent task state
- clear "complete" actions
- simple camera/photo workflow
- notes and supplies easy to add from the field

## Visual Priorities

- not a generic desktop admin screen shrunk to mobile
- dashboard should emphasize what is due now
- month view should emphasize:
  - weekly tasks
  - monthly recurring tasks
  - monthly major items
  - supplies purchased
  - notes

## Suggested State Language

- `Open`
- `Complete`
- `Overdue`

MVP status model:

- persisted status values: `open`, `complete`, `cancelled`
- `overdue` is a derived visual state, not a stored primary status

---

## Derived Status Logic

Derived status is preferable to manual week/month completion.

## Task Overdue Rule

A task is overdue when:

- `now() > due_end_date`
- and `status != 'complete'`

Timezone rule:

- all due windows, end-of-day cutoffs, and overdue calculations use AST (`UTC-4`)
- this applies to both team-facing and admin-facing views

Overdue must be highlighted in:

- team dashboard
- month view
- admin dashboard
- admin audit/operations views

## Week Status

A week can be displayed as:

- `complete` if all weekly tasks in that week are complete
- `incomplete` if any remain open
- `empty` if no tasks exist

## Month Status

A month can be displayed as:

- `complete` if all weekly tasks, monthly recurring tasks, and major monthly items are complete
- `incomplete` if any remain open
- `attention` if overdue items exist

This keeps accountability on the task level while still enabling higher-level summaries.

## Seed Integrity Rules

Task seeding for the active season must be idempotent.

Rules:

- weekly task seeding must not create duplicate task instances for the same template and week
- monthly task seeding must not create duplicate task instances for the same template and month
- seed scripts should check for existing rows before insert
- schema-level uniqueness protection should also be added for template-backed task rows

Recommended uniqueness constraints:

- unique `(task_template_id, week_id)` for weekly template-backed tasks
- unique `(task_template_id, month_id)` for monthly template-backed tasks

Implementation note:

- apply these only where `task_template_id` is not null
- manually created ad hoc tasks can remain outside those template-backed uniqueness rules

---

## API Shape

Maintain the current app response envelope:

- `{ success, data?, error?, requestId? }`

Suggested API groups:

- auth
- months
- weeks
- tasks
- notes
- supplies
- admin users
- admin templates
- admin audit

Example route groups:

- `POST /guardianage/api/auth/login`
- `POST /guardianage/api/auth/logout`
- `GET /guardianage/api/dashboard`
- `GET /guardianage/api/months/:monthId`
- `GET /guardianage/api/tasks/:taskId`
- `POST /guardianage/api/tasks/:taskId/complete`
- `POST /guardianage/api/tasks/:taskId/reopen`
- `POST /guardianage/api/tasks/:taskId/photos`
- `GET /guardianage/api/months/:monthId/notes`
- `POST /guardianage/api/months/:monthId/notes/save`
- `GET /guardianage/api/months/:monthId/supplies`
- `POST /guardianage/api/months/:monthId/supplies`
- `POST /guardianage/api/month-supplies/:supplyId/receipt`
- `GET /guardianage/api/admin/users`
- `POST /guardianage/api/admin/users`

Exact routes can change. The grouping and separation matter more than the final path names.

---

## Backend Architecture Mapping

Stay aligned with the existing project rules:

- routes are thin
- services hold business logic
- repositories handle Supabase/storage/database I/O

### Code location

All guardianage code lives in a self-contained top-level directory:

```
/guardianage/
  index.js           ← single Express router export (mount point)
  routes/
    auth.js
    dashboard.js
    months.js
    tasks.js
    notes.js
    supplies.js
    admin.js
  services/
  repositories/
  middleware/          ← guardianage auth middleware
  public/              ← static HTML/JS/CSS for guardianage UI
```

### Mount point

One line in `src/app.js`:

```javascript
app.use('/guardianage', guardianageRouter);
```

No guardianage code inside `src/`. The main app only touches guardianage through this single import and mount.

### Why top-level

- Follows the existing repo pattern (`maintenance-agent/`, `python-sidecar/`, `rpi/`)
- Clean separation — all guardianage code in one place
- If guardianage ever needs to move to its own service, it's already packaged
- Avoids scattering guardianage files through `src/routes/`, `src/services/`, `src/repositories/`

### Environment

- Runs on `boatos-main` (same Render service, same Express process)
- Branch: `Stable-v4-Working`
- Same Supabase project and credentials
- One new env var: `GUARDIANAGE_SESSION_SECRET` for cookie signing
- Guardianage routes use a dedicated `10MB` multipart body limit (configured at mount, not global)

---

## MVP Scope

The MVP should focus on operational usefulness, not completeness.

## Must Have

- dedicated guardianage URL
- dedicated login
- guardianage-only access control
- dashboard
- month view
- weekly recurring tasks
- monthly recurring tasks
- monthly major items
- individual task completion
- task photo uploads
- monthly notes with revision history
- monthly supplies purchased with receipt photo
- admin user management
- Supabase persistence
- auditability for note revisions and task completions

## Should Have

- task `in_progress` state (deferred — not in MVP)
- admin audit/activity screen
- simple completion metrics
- links from supply purchases to related tasks

## Season Boundary Behavior

The season runs through `November 8` (one week in November for recommissioning) and remains operationally open after that until explicitly closed.

Rules:

- team users can still log in after `November 8`
- team users can still complete overdue or remaining tasks after `November 8`
- the season status should remain open/active until you decide to close it administratively
- a future `closed` season status may later restrict editing, but that is not the MVP operational rule

Dashboard outside-season behavior:

- if today falls outside the season window, the dashboard should show the nearest month (first month if before season, last month if after)
- the dashboard should never show a blank or error state

## Can Wait

- notifications/reminders
- offline mode
- push alerts
- advanced role granularity
- analytics/report exports
- multi-vessel support
- multi-season comparison

---

## Build Sequence

Recommended implementation order:

## Phase 1. Functional Specification Lock — COMPLETE

- finalize recurring weekly tasks ✅
- finalize recurring monthly tasks ✅
- finalize monthly major items by month ✅
- confirm `httpOnly` cookie + session-table auth implementation ✅
- confirm multipart upload + client-side compression implementation ✅
- resolve all 20 implementation assumptions ✅

## Phase 2. Data And Auth Foundation — COMPLETE

- create Supabase tables ✅ (`001_guardianage_foundation.sql`, `002_guardianage_tasks.sql`)
- create app-specific user/password model with bcrypt ✅
- create guardianage auth/session middleware with httpOnly cookies ✅
- login rate limiting: 5 attempts / 30-min lockout ✅
- session TTL: 30 days, refresh on activity ✅
- mount guardianage router in `src/app.js` ✅
- seed season/month/week structure ✅ (7 months, 32 weeks)
- seed initial task instances for the active season ✅ (31 templates, 304 task instances)
- admin user `brad` created ✅

Implementation notes:
- No DB-level FK constraints (application-level only as decided)
- Session lookup uses two queries instead of Supabase join (no FK = no `!inner()`)
- Task seed uses check-then-insert (conditional unique indexes don't support `upsert onConflict`)
- `cookie-parser` and `bcrypt` npm packages added

## Phase 3. Core Team Experience — COMPLETE

- login page ✅ (completed in Phase 2)
- dashboard ✅ (completed in Phase 2, updated with month/task links)
- month view ✅ (weekly buckets, monthly recurring, major items, prev/next navigation, derived status)
- task detail ✅ (type badge, status badge, overdue detection, due window, instructions, event history)
- task completion ✅ (sets status, records append-only event with optional note)
- task reopen ✅ (weekly/monthly: any user; major items: admin only; clears completion fields)
- task event history persistence ✅ (append-only, complete→reopen cycles preserved)
- task photo upload ✅ (completed in Step 5)
- client-side photo compression/resizing ✅ (completed in Step 5)

Implementation notes:
- `guardianage/routes/months.js` — list all months, full month detail with grouped tasks
- `guardianage/routes/tasks.js` — task detail, complete, reopen, photo upload/delete
- `guardianage/public/month.html` — month view with week sections, status badges, navigation
- `guardianage/public/task.html` — task detail with complete/reopen actions, event history
- Overdue derivation uses AST (UTC-4) throughout
- Dashboard tasks now link to task detail, month card links to month view

Output:

- team can log in, view tasks, complete them, reopen them, see history

## Phase 4. Monthly Operations Additions — COMPLETE

- month notes ✅ (save, read, "last saved by" indicator)
- note revision history ✅ (append-only, admin-only revision view endpoint)
- concurrent note editing ✅ (last-write-wins with "last saved by X at time" indicator)
- supplies purchased ✅ (create, edit, list, no delete, USD/XCD dropdown, free-text category)
- supply revision history ✅ (append-only, every create/edit creates revision)
- receipt uploads ✅ (completed in Step 5)
- audit log entries ✅ (note_saved, supply_created, receipt_uploaded — lightweight summaries only)
- task completion returns to month view ✅

Implementation notes:
- `guardianage/routes/notes.js` — get notes, save with revision, admin revision history
- `guardianage/routes/supplies.js` — create, edit (PATCH), list with receipts, receipt upload
- `guardianage/migrations/003_guardianage_notes_supplies.sql` — 5 new tables
- Notes UI integrated into month view with textarea + save button
- Supplies UI integrated into month view with add/edit form, currency dropdown

Output:

- monthly recordkeeping complete

## Step 5. Photo Uploads — COMPLETE

- task photo upload ✅ (multipart via multer, up to 10 per request, 40 per task)
- client-side image resize ✅ (canvas resize to 1920px long edge, JPEG 85% quality)
- 2MB per-file backend rejection ✅
- public URL resolution at read time ✅ (Supabase Storage public URLs)
- photo_added / photo_removed task events ✅
- admin-only photo soft-delete ✅ (is_deleted, deleted_at, deleted_by_user_id)
- post-completion photo add for major items ✅ (team can add without reopening)
- receipt photo upload ✅ (multipart, stored in guardianage/receipt-photos/)
- receipt URLs resolved at read time in supply list ✅
- click photo to open full size ✅

Implementation notes:
- `guardianage/services/photo.service.js` — upload to Supabase Storage, metadata persistence, URL resolution, soft-delete
- `guardianage/migrations/004_guardianage_photos.sql` — guardianage_task_photos table
- Storage folders: `guardianage/task-photos/`, `guardianage/receipt-photos/` in `documents` bucket
- multer with memoryStorage, 2MB fileSize limit, image-only filter
- `npm install multer` not needed (already in dependencies)

Output:

- full photo workflow for tasks and receipts

---

## REMAINING WORK — Steps 6-9

The following steps should be completed in a new conversation. Read this plan file first for full context.

---

## Step 6. Admin Surface

### 6a. User Management

Create `guardianage/routes/admin.js` with these endpoints:

- `GET /api/admin/users` — list all guardianage users (id, login_id, display_name, role, is_active, last_login_at)
- `POST /api/admin/users` — create new user
  - Accepts: `login_id` (unique), `password` (min 4 chars), `display_name`, `role` (team_user or admin)
  - Hash password with bcrypt before storing
  - Write audit log entry (user_created)
- `PATCH /api/admin/users/:userId` — update user (display_name, role, is_active)
  - Write audit log entry (user_updated)
- `POST /api/admin/users/:userId/reset-password` — reset password
  - Hash new password, update `password_hash`
  - Revoke all active sessions for that user (`revokeAllUserSessions` from auth.repository.js)
  - Write audit log entry (password_reset)
- `PATCH /api/admin/users/:userId/deactivate` — set `is_active = false`
  - Revoke all active sessions
  - Write audit log entry (user_deactivated)

All admin routes must use `requireAdmin` middleware from `guardianage/middleware/auth.js`.

Create `guardianage/public/admin-users.html`:
- Table of users with role, status, last login
- Add user form (login_id, password, display_name, role dropdown)
- Edit button per user row
- Reset password button
- Deactivate button with confirm

Add page route in `guardianage/index.js`:
```
router.get('/admin/users', ...) → guardianage/public/admin-users.html
```

### 6b. Template Management

Add to `guardianage/routes/admin.js`:

- `GET /api/admin/templates` — list all templates with task_type, is_active
- `POST /api/admin/templates` — create template
  - After creating, auto-propagate: create task instances for current + future weeks/months in the active season
  - Use the same check-then-insert logic from seed-tasks.mjs
- `PATCH /api/admin/templates/:templateId` — update template (title, description, instructions)
- `POST /api/admin/templates/:templateId/deactivate` — deactivate template
  - Soft-cancel open future/current task instances (set `status = 'cancelled'`)
  - Preserve completed and past instances
  - Write audit log entry

Create `guardianage/public/admin-templates.html`:
- List templates grouped by type (weekly, monthly, major)
- Add template form
- Edit/deactivate buttons

### 6c. Audit / Activity View

Add to `guardianage/routes/admin.js`:

- `GET /api/admin/audit` — list audit log entries (paginated, newest first)
  - Query params: `limit` (default 50), `offset`, `entity_type` filter, `action_type` filter
  - Resolve actor user names
- `GET /api/admin/task-events` — list all task events across all tasks (paginated, newest first)
  - Resolve actor user names and task titles

Create `guardianage/public/admin-audit.html`:
- Two tabs or sections: "Activity" (audit_log) and "Task History" (task_events)
- Filter by type
- Show actor name, action, summary, timestamp

### 6d. Admin Navigation

Add an admin nav bar or menu to admin pages:
- Users | Templates | Audit
- Link back to main guardianage dashboard

Add admin link to dashboard for admin users only (check `req.guardianageUser.role`):
- The dashboard API already returns user info — surface it in the frontend

---

## Step 7. Hardening

### 7a. Input Validation

Review all existing routes and ensure Zod validation at every route edge:
- `POST /api/auth/login` ✅ (already has LoginSchema)
- `POST /api/tasks/:taskId/complete` ✅ (already has CompleteSchema)
- `POST /api/months/:monthId/notes/save` ✅ (already has SaveNoteSchema)
- `POST /api/months/:monthId/supplies` ✅ (already has CreateSupplySchema)
- `PATCH /api/supplies/:supplyId` ✅ (already has UpdateSupplySchema)
- New admin routes: add Zod schemas for user create/update, template create/update, password reset

### 7b. Tests

Create `guardianage/tests/` with these test files:

**auth.test.js:**
- Login success with valid credentials
- Login failure with wrong password
- Login failure with unknown user
- Login lockout after 5 failed attempts
- Session validation with valid cookie
- Session rejection after revocation
- Guardianage user blocked from main app routes (e.g., GET /admin/api/health returns 401 or redirect)

**tasks.test.js:**
- Complete a weekly task → status becomes 'complete', event created
- Reopen a weekly task → status becomes 'open', completed_at cleared, event created
- Reopen a monthly_major as team_user → 403 rejected
- Reopen a monthly_major as admin → success
- Photo upload → photo metadata saved, event created, count enforced at 40
- Photo delete as team_user → 403 rejected
- Photo delete as admin → soft-delete, event created

**notes.test.js:**
- Save note creates revision
- Second save creates revision 2
- Admin can view revisions, team user cannot (403)

**supplies.test.js:**
- Create supply with revision
- Edit supply creates new revision
- Supply cannot be deleted (no DELETE endpoint)

**overdue.test.js:**
- Task with due_end_date in the past and status 'open' → is_overdue = true
- Task with due_end_date in the past and status 'complete' → is_overdue = false
- Verify AST (UTC-4) boundary: a task due at 2026-05-07 should be overdue after midnight AST on May 8

**isolation.test.js:**
- Guardianage session cookie does not grant access to /admin/api routes
- Main app admin token does not grant access to /guardianage/api routes
- Unauthenticated request to /guardianage/api/dashboard returns 401
- Unauthenticated request to /guardianage returns redirect to login

### 7c. Security Review

- Verify password hashing uses bcrypt with salt rounds >= 10
- Verify session tokens are 32 random bytes, stored as SHA-256 hash
- Verify cookies are httpOnly, Secure in production, SameSite=Lax, path=/guardianage
- Verify login rate limiting works (5 attempts / 30-min lockout)
- Verify photo upload rejects non-image files
- Verify 2MB per-file limit is enforced
- Verify admin-only routes reject team_user role

### 7d. Documentation

Create `docs/10-user-features/guardianage.md`:
- Feature overview, user flows, API reference, database tables
- Follow the same format as `docs/10-user-features/trips.md`

Update `docs/auto/` if `npm run docs:all` supports route scanning for the new mount.

### 7e. Week Seeding Validation

Add a check to the seed script or a test that verifies:
- No week date overlaps within a month
- Every date in the month belongs to exactly one week
- Week start/end dates don't exceed month boundaries

---

## Step 8. Deploy to Render

- Add `GUARDIANAGE_SESSION_SECRET` and `GUARDIANAGE_ADMIN_PASSWORD` to Render env vars for boatos-main
- Push to `Stable-v4-Working`
- Verify login works on production URL
- Create team user accounts for the guardianage workers
- Test full flow on mobile: login → dashboard → month → task → complete → photo → notes → supplies

---

## Step 9. Pre-Season Checklist

Before May 1:
- All 3 team user accounts created
- Admin (Brad) has verified login and full workflow on mobile
- Team users have been walked through the app
- Season status confirmed as 'active'
- Verify all 304 task instances are present and status = 'open'
- Test photo upload from actual mobile devices used by team
- Verify Supabase Storage bucket permissions allow public read for guardianage folders

---

## Testing Strategy

This surface is operationally important and mobile-first, so smoke coverage matters.

## Minimum Test Areas

- login success/failure
- guardianage user blocked from rest of app
- dashboard load
- month view load
- weekly task completion
- monthly task completion
- major item completion
- task photo upload
- monthly note save creates revision
- month note second save creates additional revision
- month supply creation
- receipt upload
- admin creates/deactivates user

## Backend Test Areas

- auth/session validation
- role enforcement
- task completion persistence
- task reopen semantics including clearing completion fields
- note revision persistence
- receipt/task photo storage metadata persistence
- derived month/week status calculations
- overdue derivation in AST (`UTC-4`) including boundary-time cases
- week seeding validation: no overlaps and full-month coverage

---

## Risks And Design Watchouts

## 1. Auth Isolation Risk

If auth/session boundaries are weak, team users could accidentally gain access to unrelated app surfaces.

Mitigation:

- separate guardianage auth middleware
- route-level protection
- test access denial explicitly

## 2. High Photo Volume Risk

Photos are central to the workflow and likely numerous.

Mitigation:

- reuse proven storage flow
- use multipart upload rather than base64-heavy transport
- require client-side image resizing/compression in MVP
- store metadata cleanly

## 3. Notes Audit Risk

If notes are stored as a single mutable blob, required history is lost.

Mitigation:

- always create revision rows on save
- never overwrite history

## 4. Over-Generalization Risk

Trying to support many vessels or many season types now will slow delivery.

Mitigation:

- hard-scope MVP to one vessel and one active season

## 5. UI Complexity Risk

The month view could become cluttered on mobile.

Mitigation:

- prioritize current week and open work
- separate sections cleanly
- keep forms short and direct

---

## Open Decisions To Resolve Before Coding

All open decisions have been resolved.

Decisions made:

- no `in_progress` in MVP
- task completion can be edited/reopened, but changes must create new history records rather than overwrite prior history
- team users see only current month notes, while admin can see note revision history
- route namespace: `/guardianage`
- visible label: `Reimagined Guardianage`
- upload: reuse the same Supabase storage pattern, but use compressed multipart uploads rather than keeping a base64-heavy flow unchanged
- admin exists as a row in `guardianage_users` with role `admin` and logs in via `/guardianage/login` like all team users — one auth model, no dual-auth complexity
- the main app "others" page links to `/guardianage/login` for convenience (admin only)
- weekly task list: defined (8 tasks)
- monthly task list: defined (4 tasks)
- monthly major items: defined for May, July, August, September, October, November
- login rate limiting: 5 attempts, 30-minute lockout
- password rules: minimum 4 characters, no complexity requirements
- tasks are unassigned — any team user can complete any task
- photos are never required to close a task
- max 40 photos per task
- only admin can delete photos
- any team user can reopen completed weekly/monthly recurring tasks; only admin can reopen major items
- team users can navigate all months/weeks
- concurrent notes: last-write-wins with "last saved by" indicator
- supply entries can be edited but not deleted
- multiple receipts per supply allowed
- template deactivation soft-cancels forward open instances (`status = 'cancelled'`), preserves past/completed instances
- currencies: USD and XCD only, dropdown
- supply category: free text
- guardianage multipart body limit: 10MB
- FK enforcement: application-level only
- media URLs: public, resolved at read time

---

## Immediate Recommendation

All blocking decisions have been resolved. Task lists are defined. The spec is ready for Phase 2 implementation.

## Compliance Checklist

Any implementation PR for this feature should include:

- SQL migration(s) for Supabase/Postgres schema changes
- Zod validation at the route edge for request payloads
- tests for new backend behavior and key UI flows
- docs updates for the new feature surface

Repo-rule alignment:

- schema/data change ships with migration + Zod + tests + docs in the same PR
- if frontend routes/pages are added, update relevant docs and UI coverage
- if media upload behavior differs from existing flows, document the contract clearly

## Working Task List

Current agreed starting set:

### Weekly Recurring Tasks

- Interior moisture check
- Check dehumidifier is running correctly
- Bilge water check
- Quick interior wipe/check for mildew, insects, leaks, or odor
- Exterior visual inspection
- Check lines, covers, and visible deck hardware
- Check lockers and forward locker for moisture or pests
- Window/foil/covering condition check

### Monthly Recurring Tasks

- Exterior cleaning wash down
- DampRid replenishment
- Insect trap / pest-control refresh
- Storage verification for sails, sail bag, and dinghy batteries

### Monthly Major One-Off Tasks

#### May

- Remove water in bilges, clean bilges with vinegar, wipe down surfaces, clean port forward locker, wipe lockers
- Install desiccant pots and hangers
- Install roach and ant traps
- Foil all windows
- Block all through-hulls to prevent insects from getting in
- Protective care: acid wash entire boat, wax and polish smooth surfaces including decks, hulls, below boat, transom
- Engine decommissioning service: fresh water flush engines, change oil and oil filter, fuel filter, decommission engines
- Clean engine compartment
- Wash/clean sail lines

#### June

- No major one-off items defined yet

#### July

- Wax and polish smooth surfaces including decks, hulls, below boat, transom

#### August

- Sea safety check: EPIRB check, fire extinguisher inspection, Dan buoy survey
- Service sail drive lower unit, change lower seals, change O-ring, change oil, clean/service propellers
- 500-hour Yanmar service `TBD / conditional`

#### September

- Service all winches
- Service windlass, tighten loose bolts/mechanism, check oil level, clean corrosion

#### October

- Strip, clean, sand, and prep propellers for Propspeed application
- Strip, sand, and prep sail drive leg for Propspeed application
- Wax and polish smooth surfaces including decks, hulls, below boat, transom
- Bottom paint: water sand, scrape barnacles, prep and apply 2.5 coats of Micron CSC Black; sand dagger boards with VC17; paint rudders with Micron CSC Shark White

#### November (Nov 1–8, one week only)

- Recommission Boat

# Ortho Rounds — self-hosted patient tracker

A small orthopedic ward rounds app. Patient data is stored in a single
**SQLite database on your own machine** and reached over your network by
**URL**, so every browser and device on the same Wi-Fi sees the same data.
The app also works **offline** (local cache) and **syncs** automatically when
the connection returns. You can **export/import** JSON backups any time.

- **Local by default.** With SQLite, data never leaves the computer running
  the server, and no npm dependencies are required (built-in Node modules only).
- **Optional MongoDB backend** for persistent cloud hosting — set `MONGODB_URI`
  and patients, X-rays and login config live in a managed database that
  survives redeploys. (This is the one optional dependency.)
- **Per-user accounts** — each PG logs in with their own username and
  password, so plan edits, milestones, and complications are attributed to a
  real person, not a shared login.

## Requirements

- [Node.js](https://nodejs.org) **v22.5 or newer** (uses the built-in
  `node:sqlite` module). Check with `node --version`.

## Run it

From this folder:

```bash
npm start
```

On first run (no accounts exist yet), one admin account is created
automatically and its credentials are printed once:

```
>> First run — created admin account "admin"
>>     bone-plate-1234
>> Write it down. It is not shown again.
```

Set your own admin credentials instead of the generated ones with
`ORTHO_ADMIN_USERNAME` / `ORTHO_ADMIN_PASSWORD`:

```bash
ORTHO_ADMIN_USERNAME="chief" ORTHO_ADMIN_PASSWORD="choose-a-password" npm start
```

On startup the console prints the URLs, for example:

```
On this computer:  http://localhost:3000
On the network:    http://192.168.1.42:3000
```

Open the **network URL** on your phone, tablet, or another computer on the
same Wi-Fi and log in with the admin account. From there, open **More →
Manage users** to add an account for each PG — the admin panel shows a
one-time password for each new user to share with them directly.

### Accounts

- Each person has their own username + password — there is no shared
  ward login anymore.
- Admins can add/disable users and reset passwords from **More → Manage
  users**, no server access needed after the first run.
- Disabling a user immediately invalidates any device they're logged in on.
- Lost your own phone? **More → Manage users → Log out everywhere** logs out
  every device signed in as you, so you can re-login from one you still hold.
- Login attempts are rate-limited per username to resist brute-forcing.

### Change the port

```bash
PORT=4000 npm start
```

## How data is stored

By default the server uses **SQLite**:

- Server database file: `data/ortho.db`. Back it up by copying this file, or
  use the in-app **Export** button. This is also where user accounts live
  (a `users` table alongside patients).
- Token signing secret: `data/config.json`.
- The `data/` folder is git-ignored so patient data and secrets are never
  committed.
- By default `data/` sits next to `server.js`. To point it at a mounted
  volume elsewhere, set `ORTHO_DATA_DIR=/path/to/volume`.

> **Patients disappear after a redeploy?** With SQLite this is almost always a
> hosting problem: the `data/` directory was **not** on a persistent
> disk/volume, so the redeploy started with an empty `ortho.db` (the server
> prints a loud `starting EMPTY` warning when this happens). Either mount a
> persistent disk at `data/`, or use the **MongoDB backend** below, which
> persists independently of the app host. As a safety net, any device that
> still holds its local cache automatically re-uploads its records on the next
> sync, repopulating the server — so log in from a recently-used device before
> wiping anything.

### Use MongoDB instead (persistent cloud storage)

For cloud hosting without managing a disk, point the app at MongoDB (for
example a free [MongoDB Atlas](https://www.mongodb.com/atlas) M0 cluster):

```bash
MONGODB_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/ortho" \
ORTHO_ADMIN_PASSWORD="choose-a-password" npm start
```

- When `MONGODB_URI` is set, **all** data — patients, X-ray images, user
  accounts, and the token secret — is stored in MongoDB. Nothing is written
  to `data/`, and the database survives every redeploy.
- The database name is taken from the URI path (`/ortho` above); it defaults
  to `ortho` if omitted. Collections used: `patients`, `images`, `config`, `users`.
- Install the driver first with `npm install` (it is the project's only
  dependency and is only needed for this backend).
- On the host (Railway/Render/etc.), set `MONGODB_URI` and
  `ORTHO_ADMIN_PASSWORD` as environment variables. With MongoDB you do
  **not** need a persistent disk.
- Atlas setup: create a free cluster, add a database user, allow your host's
  IP (or `0.0.0.0/0` for managed hosts with dynamic IPs), then copy the
  **Drivers** connection string into `MONGODB_URI`.

### Reset a password

- Any admin can reset another user's password from **More → Manage users**
  (shows a new one-time password to share with them).
- Locked out entirely (no working admin account)? Delete the `users`
  table/collection (SQLite: `data/ortho.db`, table `users`; Mongo: the
  `users` collection) and restart — a fresh admin account is created and
  printed once, same as a first run.

## How it works

```
Browser / phone ──HTTP──> Node server ──> SQLite (data/ortho.db)
   (offline cache:                 ▲
    IndexedDB + service worker)     └─ /api/sync  (field-aware merge)
```

- The frontend (`public/`) keeps a local IndexedDB cache and a service worker,
  so it loads and works without a connection.
- Changes are pushed to `/api/sync` and merged intelligently: checklist items
  merge by milestone id (per-item timestamps), while plan and status use
  field-level timestamps when available.
- Existing browser-only data from the previous version is migrated to the
  server automatically on first connect.

### Server backup endpoint

While logged in, download the raw SQLite file:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/backup -o ortho.db
```

The server also keeps rolling copies in `data/backups/` (last 7).

### X-ray storage

New X-rays uploaded while online are stored under `data/images/` on the server
(URL reference) instead of embedding base64 in the database. Older images
embedded as base64 continue to work.

## AI assistants (optional)

The app can draft daily plans, polish presentation scripts, and generate unit
handover notes using OpenAI. AI is **opt-in** — without a key, the app works
exactly as before.

```bash
OPENAI_API_KEY="sk-..." OPENAI_MODEL="gpt-4o-mini" npm start
```

Environment variables:

- `OPENAI_API_KEY` — required to enable AI (set on the server, never in the browser)
- `OPENAI_MODEL` — optional, defaults to `gpt-4o-mini`
- `OPENAI_MAX_TOKENS` — optional, defaults to `350`

`GET /api/health` reports `ai.enabled` so clients hide AI buttons when
unconfigured.

### Privacy

- Patient snapshots sent to OpenAI **exclude images and UHID**
- AI output is a **draft only** — PGs must review before saving
- Recommend hospital IT review before using with real patient data on a cloud API

## Deploy to Railway (optional cloud)

For access off the ward Wi‑Fi, you can host the same app on
[Railway](https://railway.app) with a **persistent volume** mounted at `/app/data`.

1. Create a new project from this repo (or deploy with `railway up`).
2. Add a **Volume** and mount it at `/app/data` (must contain `ortho.db`,
   `config.json`, and `images/`).
3. Set environment variables:
   - `ORTHO_ADMIN_PASSWORD` — first admin account's password (optional; a
     random one is printed on first boot if you skip this)
   - `PORT` — Railway sets this automatically
4. Use the generated HTTPS URL on phones (Add to Home Screen still works).

**Important:** Without a volume, patient data is lost on every redeploy.
The free tier is limited; expect ~$5/month for a small always-on service with
storage.

For HTTPS behind a reverse proxy, the app serves static files and JSON API only;
no special proxy headers are required for basic use.

## Security notes

- Intended for a **trusted local network**. It serves plain HTTP. Do not
  expose it directly to the public internet without putting it behind HTTPS.
- Each person has their own account (see **Accounts** above); disabling a
  user immediately revokes their access, including any device already
  logged in. Login attempts are rate-limited to resist brute-forcing.
- Keep `data/config.json` and `data/ortho.db` private.

## Project layout

```
server.js                 Node HTTP server + REST API
auth.js                   Accounts: password hashing, tokens, login rate limit, bootstrap
merge.js                  Sync merge logic + server-side attribution stamping
ai.js                     OpenAI proxy for AI assistants
storage.js                Pluggable storage backends (SQLite / MongoDB)
package.json              Scripts + optional mongodb dependency
tests/                    node:test unit + integration tests (`npm test`)
public/
  index.html              UI
  app.js                  Client logic, offline cache, sync, login
  sw.js                   Service worker (offline app shell)
  manifest.webmanifest    PWA metadata
data/                     SQLite DB + config (runtime, git-ignored; unused with MongoDB)
```

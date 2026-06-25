# Ortho Rounds — self-hosted patient tracker

A small orthopedic ward rounds app. Patient data is stored in a single
**SQLite database on your own machine** and reached over your network by
**URL**, so every browser and device on the same Wi-Fi sees the same data.
The app also works **offline** (local cache) and **syncs** automatically when
the connection returns. You can **export/import** JSON backups any time.

- **No cloud.** Data never leaves the computer running the server.
- **No npm dependencies.** Uses only built-in Node modules.
- **Login** with a single shared password.

## Requirements

- [Node.js](https://nodejs.org) **v22.5 or newer** (uses the built-in
  `node:sqlite` module). Check with `node --version`.

## Run it

From this folder:

```bash
# Optional: set your own password (otherwise one is generated and printed)
ORTHO_PASSWORD="choose-a-password" npm start
```

or simply:

```bash
npm start
```

On startup the console prints the URLs, for example:

```
On this computer:  http://localhost:3000
On the network:    http://192.168.1.42:3000
```

Open the **network URL** on your phone, tablet, or another computer on the
same Wi-Fi. Enter the password once per device.

### Change the port

```bash
PORT=4000 npm start
```

## How data is stored

- Server database file: `data/ortho.db` (SQLite). Back it up by copying this
  file, or use the in-app **Export** button.
- Login config (password hash + token secret): `data/config.json`.
- The `data/` folder is git-ignored so patient data and secrets are never
  committed.

### Reset the password

- Set `ORTHO_PASSWORD` (it overrides the stored one), **or**
- Delete `data/config.json` and restart — a new password is generated and
  printed once.

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

## Deploy to Railway (optional cloud)

For access off the ward Wi‑Fi, you can host the same app on
[Railway](https://railway.app) with a **persistent volume** mounted at `/app/data`.

1. Create a new project from this repo (or deploy with `railway up`).
2. Add a **Volume** and mount it at `/app/data` (must contain `ortho.db`,
   `config.json`, and `images/`).
3. Set environment variables:
   - `ORTHO_PASSWORD` — ward login password
   - `PORT` — Railway sets this automatically
4. Use the generated HTTPS URL on phones (Add to Home Screen still works).

**Important:** Without a volume, patient data is lost on every redeploy.
The free tier is limited; expect ~$5/month for a small always-on service with
storage.

For HTTPS behind a reverse proxy, the app serves static files and JSON API only;
no special proxy headers are required for basic use.

## Security notes

- Intended for a **trusted local network**. It serves plain HTTP and uses a
  single shared password. Do not expose it directly to the public internet
  without putting it behind HTTPS and stronger authentication.
- Keep `data/config.json` and `data/ortho.db` private.

## Project layout

```
server.js                 Zero-dependency Node server + REST API + SQLite
package.json              Scripts (npm start)
public/
  index.html              UI
  app.js                  Client logic, offline cache, sync, login
  sw.js                   Service worker (offline app shell)
  manifest.webmanifest    PWA metadata
data/                     Created at runtime (DB + config) — git-ignored
```

# Ortho Rounds

Self-hosted orthopedic ward-rounds patient tracker. A vanilla-JS PWA (`public/`) served by a dependency-light Node HTTP server (`server.js`, `storage.js`, `auth.js`, `ai.js`, …). No framework, no build step.

## Cursor Cloud specific instructions

- Requires **Node ≥ 22.5** (uses the built-in `node:sqlite` module). The sandbox Node satisfies this.
- Run the server with `npm start` (prod-like) or `npm run dev` (`node --watch`, hot reload) — see `package.json`. Default port `3000`, override with `PORT`. There is no separate frontend server; `public/` is served by `server.js`.
- **Storage backend is chosen at runtime**: if `MONGODB_URI` is set it uses MongoDB, otherwise it falls back to embedded SQLite at `data/ortho.db`. Confirm which one is live via `GET /api/health` (`storage` field) or `GET /api/diag` (auth required). On Render/Cloud, prefer `MONGODB_URI` (or a persistent disk at `data/`) so users and patients survive redeploys.
- **Accounts (not a shared password):** first boot with zero users creates one admin (`ORTHO_ADMIN_USERNAME` default `admin`, password from `ORTHO_ADMIN_PASSWORD` or a generated value printed once). Login is `POST /api/login { username, password }` → bearer token with `tokenVersion`. All other `/api/*` endpoints need `Authorization: Bearer <token>`. Admins manage users at `/api/admin/users` (create / disable / enable / reset-password). Any logged-in user can `POST /api/account/change-password` or `POST /api/account/revoke-sessions`.
- Patients are created/updated through `POST /api/sync` (field-aware merge), not a REST create endpoint. The UI does this automatically.
- **AI features** (draft plan, polish, handover, discharge, ward brief, risk flags, scribe, admission parse) are opt-in via `OPENAI_API_KEY` and hidden when unset; `GET /api/health` reports `ai.enabled`.
- **Push reminders** need HTTPS (Render provides this) plus `web-push`; VAPID keys live in config. Toggle is hidden on plain HTTP LAN.
- **OT list:** pre-op patients with `surgeryDate` appear on the OT list tab. Export Word via `POST /api/ot-list/docx` (auth required; uses `docx` package). Default OT doctors: DR MAHESH / DR BALAKRISHNA / DR JACOB / DR DEEPAK.
- **Tests:** `npm test` (Node's built-in test runner). CI runs via `.github/workflows/test.yml`. Install deps with `npm install` first (`mongodb`, `web-push`, and `docx` are required for those code paths / tests).

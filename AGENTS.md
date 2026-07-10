# Ortho Rounds

Self-hosted orthopedic ward-rounds patient tracker. A vanilla-JS PWA (`public/`) served by a dependency-light Node HTTP server (`server.js`, `storage.js`, `ai.js`). No framework, no build step.

## Cursor Cloud specific instructions

- Requires **Node ≥ 22.5** (uses the built-in `node:sqlite` module). The sandbox Node satisfies this.
- Run the server with `npm start` (prod-like) or `npm run dev` (`node --watch`, hot reload) — see `package.json`. Default port `3000`, override with `PORT`. There is no separate frontend server; `public/` is served by `server.js`.
- **Storage backend is chosen at runtime**: if `MONGODB_URI` is set it uses MongoDB, otherwise it falls back to embedded SQLite at `data/ortho.db` (zero external deps). Confirm which one is live via `GET /api/health` (`storage` field) or `GET /api/diag` (auth required). In this environment a `MONGODB_URI` secret is present, so the app talks to a **shared/real MongoDB** — treat its data as real and clean up any test records you create.
- **Login**: single shared password. Set `ORTHO_PASSWORD` to a known value before starting so you can log in; otherwise the server generates a random one and prints it once at startup. Login is `POST /api/login {password}` → returns a bearer token; all other `/api/*` endpoints need `Authorization: Bearer <token>`.
- Patients are created/updated through `POST /api/sync` (field-aware merge), not a REST create endpoint. The UI does this automatically.
- **AI features** (draft plan / polish / handover) are opt-in via `OPENAI_API_KEY` and hidden when unset; `GET /api/health` reports `ai.enabled`.
- No test suite, linter, or build step exists in this repo.

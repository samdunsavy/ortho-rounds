# Backward-Compatibility & Deprecation Policy

This document is the commitment referenced in `ROADMAP.md`. It exists so anyone
running Ortho Rounds today — on a laptop, a hospital server, or a Railway
deploy — has something concrete to point to, not just a verbal promise.

## What this guarantees, starting now (v2.0.0)

1. **Self-hosted SQLite and MongoDB modes are permanent, first-class deployment
   options.** They are not a legacy path being phased out in favor of a hosted
   product. Anyone can run `npm start` against their own `data/` directory or
   their own `MONGODB_URI` for as long as they want, with no expiration date
   and no feature gate that requires a hosted account.

2. **Data export is never locked behind a paid tier.** The in-app Export
   button, the `/api/backup` endpoint, and the raw SQLite file stay available
   in every deployment mode, forever.

3. **The `/api/sync` contract is versioned, not silently changed.** The
   current sync request/response shape is `v1` (`GET/POST /api/sync` and
   `/api/sync/v1` are the same handler). If a future change would break how
   an existing client reads or writes that shape, it ships as `/api/sync/v2`
   running alongside `v1` — `v1` keeps working, unmodified, for existing
   clients. `v1` will not be removed with less than 6 months' public notice.

4. **No feature removal without 6 months' notice.** If a feature currently in
   the product (AI drafting, WhatsApp intake, presentation mode, push
   notifications, etc.) is ever deprecated, that will be announced in the
   README and CHANGELOG at least 6 months before it's removed, with a
   documented migration path if one is needed.

5. **New, cloud-only features are additive and flagged, not default-on.**
   Anything built for the hosted multi-tenant product (billing, org
   management, AI usage metering, data pooling) is gated behind an explicit
   feature flag (see `flags.js`) that defaults OFF. A self-hosted install
   that sets no flags behaves identically to how it does today, release over
   release, unless this document says otherwise.

## What this does not guarantee

- New features may be hosted-only if they genuinely require infrastructure a
  self-hosted single-server install can't reasonably provide (e.g.
  cross-hospital data pooling). These will always be opt-in and clearly
  marked as hosted-tier in the README.
- Security fixes are the one exception to the notice period above — a
  vulnerability gets patched immediately, even if it technically changes
  behavior, and gets documented after the fact.

## How to check what you're running

- `GET /api/health` reports `apiVersion` and the active `flags` object, so
  you can always confirm what contract version and feature set your
  deployment is on.

## Changes to this policy

Any change loosening a guarantee above requires a version bump of this
document and a note in the README changelog — this policy doesn't get quietly
edited.

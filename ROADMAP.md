# Ortho Rounds — Company Roadmap

**From:** self-hosted ward-rounds tool (v2.0.0, single hospital)
**To:** multi-tenant rounds-management platform for surgical residency programs

## Guiding principle

Nobody currently running this in a ward loses anything. Every phase below is additive. The self-hosted SQLite/Mongo deploy that exists today keeps working, keeps its `npm start` workflow, and keeps its data on the customer's own disk for as long as anyone wants to run it that way. The company gets built *around* that install base, not by migrating it against its will.

Three commitments hold for the life of the roadmap:

1. **No forced migration.** Self-host stays a first-class, indefinitely supported mode — it's the free/open on-ramp, not a legacy path being sunset.
2. **Data portability, always.** Export/import and the raw SQLite backup endpoint stay one click away, in every tier, forever.
3. **No breaking API/schema changes without a version bump and a migration script.** `/api/sync` and the patient record shape are the contract every existing client depends on.

## Current state (baseline)

What's shipped today, and what the roadmap is built on top of:

- Offline-first PWA, field-aware sync merge, per-user accounts with rate-limited login and revocation
- Pluggable storage: SQLite (default, zero-dependency) or MongoDB (persistent cloud)
- AI assistant suite (OpenAI, opt-in): draft plan, presentation polish, handover summary, discharge summary, ward brief, proactive risk-flagging, WhatsApp admission parsing, voice scribe
- Presentation mode, milestone checklists, labs trend view, push notifications, rolling local backups
- Single organization, single ward, one deployment per hospital — this is the constraint the roadmap exists to remove

---

## Phase 0 — Stabilize & protect (Weeks 0–6) — ✅ DONE

**Goal:** freeze a stable contract so every later phase can build without breaking today's users.

- [x] Version the sync API (`/api/sync/v1`) so future schema changes are additive, never destructive
- [x] Add a feature-flag layer (`flags.js`) so cloud-only features (billing, org management) never appear in self-host builds
- [x] Formal backward-compatibility policy written into the repo (`POLICY.md`)
- [x] Opt-in, anonymized usage telemetry (`telemetry.js`, `GET /api/admin/telemetry`) — local-only unless an operator explicitly double-opts-in to export
- [x] Written deprecation policy published: nothing removed with less than 6 months' notice

**Stays working:** everything, unchanged. Verified: full test suite (89 tests) green, live smoke test of `/api/health`, `/api/sync`, `/api/sync/v1`, and `/api/admin/telemetry` against a running instance.

---

## Polish sprint — before resuming Phase 1

Deliberate pause here: rather than jumping straight into the highest-risk
Phase 1 item (auth/sync scoping), we're first working through a prioritized
punch list on the current product — see `POLISH.md`. Top of that list:
standing up real frontend test coverage (currently zero, despite `app.js`
being the most actively changed file in the codebase), then the
desktop/tablet responsive layout, a deliberate device-testing pass on touch
gestures, presentation-mode readability, and a contrast/print audit.
Phase 1's auth/sync scoping resumes once this list is worked through.

## Phase 1 — Multi-tenant foundation (Months 1–4) — 🟡 IN PROGRESS (paused for polish sprint)

**Goal:** one codebase serves both the existing single-hospital self-host deploys *and* a new hosted multi-tenant product — a hospital shouldn't need its own server anymore unless it wants one.

- [x] Org → hospital → ward hierarchy schema (additive tables/columns, both SQLite and MongoDB — see `DESIGN-multitenant.md`), inert until the `MULTI_TENANT` flag is used
- [x] Verified an existing pre-Phase-1 database upgrades automatically (new columns added, no destructive migration, existing rows unaffected — covered by a regression test)
- [x] Auth + sync scoping by ward/org, built and tested with `MULTI_TENANT` both on and off — shipped 2026-07-22: see docs/superpowers/specs/2026-07-22-auth-sync-scoping-design.md
- [x] Org/department admin console + provisioning (shipped 2026-07-22 — see docs/superpowers/specs/2026-07-22-admin-console-design.md)
- [ ] Build a one-way migration tool: existing SQLite/Mongo instance → hosted multi-tenant backend, run by the customer, on demand, reversible via the existing export
- [ ] Org-scoped roles (admin/attending/PG) layered on top of the current auth system, not replacing it
- [ ] Billing scaffold (Stripe) wired but dormant — no charges yet, just plumbing
- [x] Self-host install path untouched: same `npm start`, same `data/` directory, same admin bootstrap flow

**Stays working:** self-hosted SQLite and MongoDB modes, exactly as documented in the current README. Multi-tenant is a new deployment option, not a replacement. Verified: 89/89 tests pass, including a simulated upgrade of a database created before this schema existed.

---

## Phase 2 — Compliance & AI monetization (Months 4–8)

**Goal:** make this sellable to a hospital administrator, and make the AI features pay for themselves.

- Audit logging (who viewed/edited what, when) — extends existing attribution stamping in `merge.js`
- Encryption at rest for the hosted tier; document the security posture for the self-host tier as-is
- Move to a BAA-eligible AI vendor path (or Azure OpenAI) for hosted customers handling real PHI; self-host keeps bring-your-own-key exactly as today
- Meter AI usage per org; ship the first paid tier (per-active-user or per-bed, hospital-wide rollout, admin console, audit logs)
- Independent security review before the first paid hospital contract

**Stays working:** self-host AI remains opt-in with your own `OPENAI_API_KEY`, free, no metering — metering only applies to the hosted product.

---

## Phase 3 — Specialty expansion & AI data flywheel (Months 8–14)

**Goal:** turn "ortho ward tool" into "rounds platform," and start building the data moat.

- Generalize the milestone/status template system so general surgery, neurosurgery, and medicine wards run on the same substrate as new templates, not forks
- Consented, de-identified data pooling across hosted orgs to improve risk-flagging and length-of-stay predictions — opt-in per hospital, off by default
- Ward benchmarking features (only for hospitals that opted into pooling)
- Mobile app polish pass on the existing PWA (this is where the "best out there" perception gets won or lost)

**Stays working:** ortho remains the fully-supported default template; no hospital is forced into data pooling to keep using the product.

---

## Phase 4 — Enterprise & scale (Month 14+)

**Goal:** graduate from "tool residents smuggle in" to "system the hospital signs a contract for."

- Read-only EHR integration (Epic/Cerner) — pulls context in, doesn't ask anyone to rip out their EHR
- SSO/SAML for hospital IT, high-availability infra for the hosted tier
- International compliance variants (HIPAA, India's DPDP Act, GDPR) as the customer base expands geographically
- Dedicated enterprise support tier

---

## Next 30 days (concrete)

1. ~~Ship API versioning and the feature-flag layer (Phase 0)~~ ✅ done
2. ~~Stand up opt-in telemetry~~ ✅ done — `GET /api/admin/telemetry` is live; let it run and check back before committing further Phase 1 engineering time to features that turn out to be unused
3. ~~Write and publish the backward-compatibility/deprecation policy~~ ✅ done — `POLICY.md`
4. ~~Scope the org/hospital/ward data model addition~~ ✅ done — schema shipped and tested, see `DESIGN-multitenant.md`
5. **Next:** wire auth + `/api/sync` scoping to the new hierarchy behind `MULTI_TENANT`, tested with the flag both on and off — this is the highest-risk single change in the roadmap and deserves its own focused pass rather than being bundled into schema work

## Success metrics by phase

| Phase | Primary metric |
|---|---|
| 0 | Zero regressions reported by existing self-host users |
| 1 | First hospital running hosted multi-tenant, self-host migration tool used successfully at least once |
| 2 | First paid hospital-wide contract signed |
| 3 | 3+ specialty templates live, first opted-in data-pooling cohort |
| 4 | First EHR-integrated enterprise customer |

## Risks & mitigations

- **Rearchitecting under a live install base breaks someone's ward mid-shift.** Mitigation: feature flags, versioned API, staging rollout, and the Phase 0 freeze before touching anything load-bearing.
- **Compliance becomes a blocker to the first paid deal.** Mitigation: sequence Phase 2 compliance work *before* enterprise sales conversations start, not after a customer asks.
- **Data pooling erodes trust with existing users.** Mitigation: opt-in only, off by default, and self-host users are never part of the pool unless they explicitly choose the hosted product and opt in.

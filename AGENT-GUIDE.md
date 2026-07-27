# Agent Guide — Ortho Rounds

**Read this before touching anything.** It is the operating contract for any agent (or human) working this repo. `AGENTS.md` tells you how to *run* the app; this tells you how to *change* it without causing harm.

---

## 1. What this is and what is at stake

A rounds-management system for orthopaedic ward teams: offline-first vanilla-JS PWA (`public/`) on a dependency-light Node HTTP server. **It is in daily clinical use.** A regression does not show up as a failed build — it shows up as a checklist tick that silently vanished, a plan update lost between two phones, or a patient missing from a worklist at 2am. There is no QA team between you and that.

Two consequences that shape everything below:

1. **Silent data loss is the worst possible bug class here**, worse than a crash. A crash gets noticed. A dropped merge does not.
2. **Boring and correct beats clever.** The codebase is deliberately plain: no framework, no build step, three runtime dependencies. That is a feature.

---

## 2. Where truth lives

Read in this order. Later documents override earlier ones on their own subject.

| Document | Authority on |
|---|---|
| `POLICY.md` | **Non-negotiable.** Backward-compatibility and deprecation promises. Overrides everything. |
| `AGENT-GUIDE.md` (this) | How to work: conventions, workflow, definition of done |
| `BACKLOG.md` | What to build, in dependency order, with acceptance criteria |
| `UPGRADE-PLAN.md` | Why that order. Stage gates, exit criteria, the stop-list |
| `MARKET-POSITION.md` | Competitive evidence and the scorecard progress is measured against |
| `AGENTS.md` | How to run the app, env vars, backends |
| `docs/superpowers/specs/` + `plans/` | Per-feature design and implementation history — **check for an existing spec before designing anything** |
| `ROADMAP.md` | Historical. **Superseded by `UPGRADE-PLAN.md` on sequencing.** |
| `POLISH.md` | Open product-quality debt, with useful post-mortems on bugs already found |

---

## 3. The five non-negotiables

Violating any of these is a revert, regardless of how good the feature is.

1. **Never break the self-host path.** SQLite and MongoDB self-host are permanent, first-class modes (`POLICY.md` §1). Same `npm start`, same `data/` directory, same admin bootstrap. If your change requires cloud infrastructure, it goes behind a flag that defaults off.
2. **Never break the sync contract.** `/api/sync` and the patient record shape are what every deployed client depends on. Breaking changes ship as `/api/sync/v2` alongside `v1` (`POLICY.md` §3). The golden test (`tests/server-sync-golden.test.js`) asserts the flag-off response is byte-identical — if you changed it, you broke a contract.
3. **New cloud/multi-tenant features default OFF.** Add flags to `flags.js`, gate the code path, and test **both** states. A self-host that sets no flags must behave identically release over release.
4. **Data portability is permanent.** Export, import and `/api/backup` work in every mode, in every tier, forever (`POLICY.md` §2).
5. **No patient data leaves the server without explicit consent.** AI snapshots exclude images and UHID (`ai.js: sanitizePatientSnapshot`). The lab-photo flow is the one exception and it is a known compliance liability — see `BACKLOG.md` T6. Do not add a second exception.

---

## 4. Architecture map

**Server** (ESM, `type: module`, Node ≥ 22.5)

| File | Lines | Responsibility |
|---|---:|---|
| `server.js` | 1,290 | HTTP routing, all `/api/*` handlers, static serving. The big one. |
| `storage.js` | 666 | `createStore()` → SQLite or MongoDB. **Every backend change must be mirrored in both.** |
| `merge.js` | — | Sync merge + server-side attribution stamping |
| `auth.js` | 132 | scrypt hashing, HMAC tokens, login rate limit, admin bootstrap |
| `scope.js` | — | `resolveScope` / `canRead` / `decideWrite` — multi-tenant access decisions |
| `hierarchy.js`, `structure.js`, `admin.js` | — | Org tree resolution, structural ops, admin operations |
| `ai.js` | 437 | OpenAI proxy, 9 endpoints, snapshot sanitisation, rate limiting |
| `flags.js` | — | Feature flags, all default off |
| `telemetry.js` | — | Opt-in local usage counters |
| `ot-list.js` | — | `.docx` generation |
| `notifications.js` | — | Web push |

**Client** (plain scripts, no modules, no bundler)

| File | Lines | Responsibility |
|---|---:|---|
| `public/app.js` | 9,073 | Everything: views, sync, offline cache, login. **Being split — see T8.** |
| `public/index.html` | 2,435 | Markup + all CSS (design tokens live here) |
| `public/milestones.js` | 628 | POD arithmetic and milestone bucketing. **The model to imitate:** pure logic, fully tested. |
| `public/admin-console.js` + `admin-{orgs,people,structure}.js` | ~1,630 | Admin console, file-local scope |
| `public/sw.js` | 83 | Service worker, offline shell |

**The hierarchy:** `org → hospital → department → unit → ward`. Ward sits *below* unit and is optional. Patients pin to a **unit** carrying denormalised ancestry; users assign to **any node** and are scoped to that node's subtree. Visibility is node-based — **per-patient assignment is explicitly not wanted.**

---

## 5. Conventions

Match the surrounding code. When in doubt, grep for how it is already done.

**JavaScript**

- Server: ESM, `import`/`export`. Client: plain scripts, function declarations. Cross-boundary sharing uses the bridge-file pattern (`admission-bridge.js`, `clinical-normalize-bridge.js`).
- **No new runtime dependencies without explicit approval.** Three exist (`docx`, `mongodb`, `web-push`); each earns its place. Node built-ins first, always.
- No build step. No transpilation. No JSX.
- Timestamps are epoch milliseconds. Dates are local `YYYY-MM-DD` strings built from `getFullYear/getMonth/getDate` — **never** `toISOString()`, which shifts the day in `Asia/Calcutta` (see §7).

**UI**

- `escapeHTML()` on every interpolated value — used 225 times in `app.js`. HTML injection here is a patient-data leak.
- Icons via `uiIcon(name)` (app) / `icon(name, cls)` (admin console). Output must be **self-contained** — explicit `width`/`height`/`fill`/`stroke` on the `<svg>`, never relying on external CSS, because print/export popups have isolated stylesheets. This was a real bug; don't reintroduce it.
- Colours **only** from CSS custom properties (`var(--accent)`, `var(--good-bg)`, …). No literal hex outside the token block in `index.html`.
- Touch targets ≥ 44px. Verified by tests; they will fail you.
- Contrast ≥ 4.5:1 for normal text, **computed** with the WCAG relative-luminance formula, not eyeballed. Precedent in `POLISH.md` Priority 5.
- Copy is sentence case. Not Title Case.
- Mobile is the primary target — phone first, then tablet/desktop. There is no read-only mobile gate; phones get full write access.

**Storage**

- Any new entity gets mirrored CRUD in **both** SQLite and Mongo backends, following the existing pattern in `storage.js`.
- Schema changes are **additive only**: `addColumnIfMissing()`, never a destructive migration. A pre-existing `data/ortho.db` must upgrade silently — there is a regression test for exactly this.

**Git**

- Conventional prefixes, actual repo distribution: `feat:` `fix:` `docs:` `test:` `refactor:` `chore:`
- Reference the backlog ID: `feat(T1): audit log write path`
- Small, coherent commits. The suite must be green at every commit, not just at the end.

---

## 6. Workflow

Follow this for anything larger than a one-line fix.

1. **Pick from `BACKLOG.md`, top-down.** Do not start an item with open dependencies. Do not start a Stage N+1 item while Stage N has open exit criteria. If you think the order is wrong, say so with reasoning — do not silently reorder.
2. **Search for prior art.** `docs/superpowers/specs/` and `plans/` hold 33 documents. Someone has probably already designed the thing next to yours.
3. **Write a design doc** in `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`: problem, approach, alternatives rejected and why, flag-off behaviour, test strategy, rollback path.
4. **Write an implementation plan** in `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`: ordered tasks, each independently verifiable.
5. **Tests first.** Write the failing test, watch it fail for the right reason, then implement. This is not ceremony — see §7 for three real cases where the test harness lied convincingly.
6. **Implement**, keeping the suite green throughout.
7. **Verify.** §8. Evidence before claims.
8. **Update the docs you invalidated** — `BACKLOG.md` status, README if behaviour changed, the spec if the approach changed mid-flight.

---

## 7. Testing — and the traps in this harness

```bash
npm test                                    # full suite: 579 tests / 167 suites (>5 min, see T9)
node --test tests/scope.test.js             # single file — do this while iterating
node --test tests/frontend-*.test.js        # front-end jsdom suites
```

**Current state:** 579 test cases, 167 suites, CI on push and PR via `.github/workflows/test.yml`. Backend modules are well covered. **~7,300 lines of `app.js` are not.** No E2E layer exists.

**Front-end harness:** `tests/helpers/frontend-env.js` loads the real `index.html` + `app.js` into jsdom. No headless Chromium — this environment lacks the system graphics libraries and cannot install them. Behavioural testing of pure logic is available; pixel testing is not.

### Three traps that have already burned someone

Each cost real debugging time and produced tests that passed while asserting nothing. Read them before writing a front-end test.

1. **Seeding module-level state needs `initScript`.** `collectWorklistData()` and `collectStartHereItems()` read the module-level `let patients` directly. A second `window.eval('patients = [...]')` after the harness loads `app.js` **silently writes to an unrelated global the closures never see** — jsdom does not share top-level `let`/`const` bindings across separate `eval()` calls. Pass `initScript` so your statements are appended to `app.js`'s source before the single eval. First attempt at `frontend-worklist.test.js` had every assertion silently seeing an empty list.

2. **jsdom-realm arrays are not reference-equal to Node-realm arrays.** `assert.deepEqual` on an array returned from jsdom fails despite identical contents. Copy into the local realm first: `[...arr]`.

3. **`toISOString()` shifts the date by a day.** This environment runs `Asia/Calcutta` (UTC+5:30), so local midnight is still the previous day in UTC. `calcPOD()` parses `YYYY-MM-DDT00:00:00` as *local*. A test helper building dates via `toISOString()` will be off by one and look plausible. Build from local components. (Production `todayISO()` is already correct — verified, not assumed.)

**Non-negotiable coverage requirements**

- Anything touching sync/merge needs a test for the two-devices-edited-the-same-patient case
- Anything touching a flag needs tests with it **on and off**
- Anything touching scoping needs a cross-tenant negative assertion (`BACKLOG.md` T10)
- Anything touching storage needs the test run against **both** backends
- Anything touching schema needs the upgrade-from-old-database regression case

---

## 8. Definition of done

Do not report an item complete until every line is true and you have **run the command and read the output.** "Should pass" is not a verification.

- [ ] Full suite green — command run, output read, count noted
- [ ] New tests actually fail without the change (verified by reverting or breaking it)
- [ ] Flag-off behaviour unchanged; golden sync test untouched
- [ ] Both storage backends exercised, if storage was touched
- [ ] Cross-tenant isolation asserted, if scoping was touched
- [ ] No new runtime dependency (or explicitly approved)
- [ ] Every interpolated value escaped
- [ ] Touch targets ≥ 44px, contrast computed, tokens used for colour
- [ ] Offline path considered — what happens on a phone that has been disconnected for a week?
- [ ] Audit-logged, if the change touches patient data (once T1 lands)
- [ ] `BACKLOG.md` status updated; docs invalidated by the change corrected
- [ ] Commit messages reference the backlog ID

**If you cannot honestly tick a line, say which one and why.** A partially-done item reported honestly is useful. A partially-done item reported as complete is how the ward finds the bug instead of you.

---

## 9. The stop-list

Do not do these. If a task appears to require one, stop and raise it.

1. **No admin-console visual polish.** Four consecutive passes have shipped. Bug fixes only, and only user-reported ones.
2. **No new AI features.** Nine endpoints exist. Abridge has ~$812M raised and 250+ health systems in that lane; extending here is unwinnable and invites a losing comparison. Keep the nine working; add none.
3. **No FHIR before a crude integration works.** `BACKLOG.md` I2 precedes X1 deliberately.
4. **No framework or bundler.** Three dependencies is an asset.
5. **No vitals, MAR, or order entry.** That is being an EHR. Integrate; don't replace.
6. **No hosted multi-tenant customer before S2.** The in-memory tenant filter (`server.js:926`) is a PHI-leak vector.
7. **No refactor bundled into a feature.** Separate commits, ideally separate tasks. A refactor hidden inside a feature diff is unreviewable.
8. **No silent scope expansion.** Build the ticket. Log what you noticed; don't fix it in passing.

---

## 10. Known landmines

Live issues. Do not be surprised by them; do not make them worse.

| Location | Issue |
|---|---|
| `server.js:920–926` | Scoped sync loads **every** changed row instance-wide, then filters tenants in application memory. Scale wall and a one-regression-from-PHI-leak isolation risk. → `BACKLOG.md` S2 |
| `patients` table | Only `(id, updatedAt, deleted, data)`. `orgId`/`unitId` live in the JSON blob — unindexed, unqueryable. → S1 |
| `server.js:183` | `?token=` bearer fallback. Tokens reach logs, history, `Referer`. → T4 |
| `auth.js:10` | Rate-limit buckets in a process-local `Map`. Breaks under horizontal scaling. → S3 |
| `ai.js` lab-photo flow | Sends identifiable patient images to OpenAI. **Fails a DPDP review as-is.** → T6 |
| Everywhere | No audit log. → T1 |
| Hosted path | No encryption at rest. → T7 |
| `public/app.js` | 9,073 lines, ~7,300 untested, and the most frequently changed file in the repo. → T8 |
| Test suite | Exceeds 5 minutes; four `frontend-admin-*` jsdom suites dominate. → T9 |
| Repo-wide | Security headers entirely absent. → T3 |
| Roles | Only `admin` and `member` exist. Nurse (ward-scoped) is a known future need. → E3 |

---

## 11. When to stop and ask

Decide and proceed on engineering and sequencing calls — that is delegated. **Stop and ask** for:

- Anything irreversible: data migration without rollback, deletion, key rotation affecting live users
- Pricing commitments, vendor contracts, or a public compliance claim
- Anything that would breach `POLICY.md`, even for a good reason
- A change requiring a forced logout, a forced migration, or client downtime
- A new runtime dependency
- Design-partner or customer communication
- Discovering that a backlog item's premise is wrong — raise it, don't silently substitute your own

**How to raise it:** state the decision needed, the options with trade-offs, your recommendation and why, and what you will do absent an answer.

---

## 12. How success is measured

Not by commits. By movement on the `MARKET-POSITION.md` scorecard.

Current: **product 65.2% · company 27.4% · blended ~28%.** Each backlog item exists to move a named dimension; `UPGRADE-PLAN.md` says which.

**The trap to internalise:** this repo produced 240 commits in 32 days. That velocity is real, and it is also why three consecutive weeks went into admin-console visual polish while interoperability (0.5/10), compliance (1/10) and external-user count (zero) did not move at all. High output on the wrong axis reads as progress and is not.

Before starting anything, ask: **which scorecard dimension does this move, and is it the highest-leverage one currently open?** If the answer is "none," it is not the task — no matter how satisfying it would be to build.

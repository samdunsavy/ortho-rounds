# Deploy Runbook — Phase 2 Deep Hierarchy (agent-executable)

**Audience:** an autonomous agent (or engineer) performing the production cutover from the Phase-1 build (flag ON, `wardId` scoping) to the Phase-2 build (unit hierarchy) on Render + MongoDB.

**Read this whole file before doing anything. Execute phases in order. Do not skip a GATE.**

---

## 0. Context & ground truth (verified 2026-07-23)

Production is currently on the **Phase-1 build with `ORTHO_FLAG_MULTI_TENANT` already ON**, backed by MongoDB (not SQLite). The Phase-2 build is merged to local `main` but **not yet pushed or deployed**. Nothing is broken right now.

Verified production state (from `scripts/inspect-prod.js`):

- Organizations: **1**. Hospitals: **1**. Old `wards` collection: **2** docs (these are Phase-1 *departments*). `departments`/`units`: 0.
- Users: **5** — `xavier` (instance admin, no orgId → unrestricted), `Amit` / `DrAbhishek` / `Drsushithsonu` (members, nothing set), `xavier1` (org admin of a test org, legacy `wardId` set, no Phase-2 assignment).
- Active patients: **33**, all with **no `unitId` and no `wardId`** (created by the instance admin). Free-text labels: ward ∈ {blank×10, 7MOW×12, 7FOW×5, 3SPW×3, 3MOW×3}; unit ∈ {blank×11, IV×22}.

**Why this needs care:** Phase-2 scoping keys on `unitId` / user `assignment` with **no `wardId` fallback**. If the Phase-2 build goes live with the flag ON *before* a backfill, every non-admin sees an empty list. The procedure below removes that risk by cutting over with the flag OFF, backfilling, verifying, then turning the flag back ON.

### The safety net (know this cold)

`ORTHO_FLAG_MULTI_TENANT` is a **reversible visibility gate, not a data mutation**. Setting it to `0` makes the app byte-identical single-tenant — **every user sees all 33 patients**, and no patient data is ever deleted by a deploy or the backfill (the backfill only *adds* `unitId`/ancestry + user assignments). **At any sign of trouble, set the flag to `0` and redeploy-safe.** This is the rollback for 90% of failure modes.

### Prerequisites

- The production `MONGODB_URI` (Render → service → Environment). Never paste it into chat or commit it.
- Render dashboard access to set env vars and trigger deploys.
- An instance-admin login (`xavier`) to exercise `/api/export` and smoke-test.
- A local checkout of this repo on `main` at or after commit `9de9736` (Phase-2 merged).

---

## Phase 1 — Back up (MANDATORY)

1. On the **current live deployment**, log in as `xavier` and download a full JSON backup:

   ```
   curl -H "Authorization: Bearer <XAVIER_TOKEN>" https://<app>.onrender.com/api/export -o phase2-preflight-backup.json
   ```

   Confirm the file is non-empty and contains the 33 patients (`grep -c '"id"' phase2-preflight-backup.json` ≈ patient+related record count; at minimum the file is > 50 KB and valid JSON).

2. Record the current state for later comparison:

   ```
   MONGODB_URI="<prod uri>" node scripts/inspect-prod.js | tee phase2-inspect-before.txt
   ```

**GATE 1:** Do not proceed unless `phase2-preflight-backup.json` exists and is valid JSON, and `phase2-inspect-before.txt` shows **33 active patients**. If the numbers differ from Section 0, STOP and re-confirm which database `MONGODB_URI` points at.

---

## Phase 2 — Flip the flag OFF (on the current build)

Single org in prod ⇒ flag-off exposure is a non-issue.

1. Render → service → Environment → set `ORTHO_FLAG_MULTI_TENANT` = `0` (or remove it). Save (triggers redeploy).
2. Verify:

   ```
   curl https://<app>.onrender.com/api/health
   ```

   Expect `"flags":{...,"MULTI_TENANT":false,...}` and `"storage":"mongo"`.
3. Smoke test: `xavier` logs in, sees all 33 patients, can open/edit one, sync succeeds.

**GATE 2:** `/api/health` reports `MULTI_TENANT:false` and the app is usable with all 33 patients visible. If not, STOP.

---

## Phase 3 — Deploy the Phase-2 build (flag still OFF)

Flag-off Phase-2 is byte-identical to Phase-1's flag-off behavior, so this is a safe code swap with no scoping or schema change.

1. Push `main` to origin (from a machine with GitHub credentials):

   ```
   git push origin main
   ```

2. Trigger the Render deploy of the new build (auto on push, or manual "Deploy latest commit"). Wait for healthy.
3. Verify:

   ```
   curl https://<app>.onrender.com/api/health
   ```

   Expect `MULTI_TENANT:false`, `storage:"mongo"`, and an `apiVersion` present.
4. Smoke test again as `xavier`: all 33 patients load; create/edit/sync works; the patient form still shows the **legacy free-text** ward/unit inputs (correct while the flag is off).

**GATE 3:** New build is live, healthy, `MULTI_TENANT:false`, 33 patients visible, sync works. If any check fails, roll back the deploy to the previous build (Render → Rollback) — data is untouched.

---

## Phase 4 — Backfill the hierarchy (flag still OFF)

Run the **tested, idempotent** backfill against production Mongo. It reconstructs `Default org → Default hospital → Ortho dept → wards → units` from the free-text labels, stamps every active patient a `unitId` + full ancestry, and assigns every non-instance-admin user to the org root so nobody is stranded. `xavier` (instance admin) is intentionally skipped.

1. Run it (from local checkout or the Render shell, with the prod URI):

   ```
   MONGODB_URI="<prod uri>" node scripts/backfill-hierarchy.js
   ```

   It prints a summary: `{ orgId, created:{hospitals,departments,wards,units}, stamped, assignedUsers }`. Expect `stamped: 33` and `assignedUsers: 4` (the 3 members + `xavier1`).

2. Verify against the "before" snapshot:

   ```
   MONGODB_URI="<prod uri>" node scripts/inspect-prod.js | tee phase2-inspect-after.txt
   ```

   Required in `phase2-inspect-after.txt`:
   - active patients **with Phase-2 unitId == 33** (i.e. `withUnitId` equals the active count — **zero stranded patients**).
   - users **with Phase-2 assignment == 4** (`Amit`, `DrAbhishek`, `Drsushithsonu`, `xavier1`); `xavier` still has no assignment (correct — unrestricted).
   - `wards` and `units` collections now populated (wards ≈ {7MOW, 7FOW, 3SPW, 3MOW, General}; units include IV + General).

3. Idempotency check (optional but recommended): run the backfill a second time; the summary must show `created` all `0` and `assignedUsers: 0`.

**GATE 4 (hard):** `withUnitId` **must equal** the active-patient count (33). If even one active patient lacks a `unitId`, DO NOT proceed to Phase 5 — the flag would strand it. Investigate (usually a patient whose `data` failed to parse); fix and re-run the (idempotent) backfill until 33/33.

---

## Phase 5 — Reconcile `xavier1` / test org  (HUMAN CHECKPOINT)

The backfill assigned `xavier1` to the new `Default` org root, but `xavier1.orgId` still points at the old test org, and the old test org + its 2 departments (in the `wards` collection) are now orphaned. This is cosmetic (scoping works), but resolve it before finishing:

Present these options to the human owner (Xavier) and **wait for a decision — do not guess**:

- **(a) Delete `xavier1`** — it duplicates the `xavier` instance admin. Simplest.
- **(b) Keep `xavier1`, make it consistent** — set its `orgId` to the new `Default` org id (from Phase 4 output) so it lists correctly in the console.
- **(c) Leave as-is** — works, but the console user list will look inconsistent.

Optional cleanup (safe, do after Phase 6 if desired): set the 3 members' `orgId` to the new org id (so an org admin sees them in the console), and drop the orphaned test org + its hospital + the 2 stale docs in the `wards` collection. None of this affects scoping or patient visibility.

**GATE 5:** A decision on `xavier1` is recorded and applied (or explicitly deferred by the owner).

---

## Phase 6 — Flip the flag ON

1. Render → Environment → set `ORTHO_FLAG_MULTI_TENANT` = `1`. Save (redeploy).
2. Verify:

   ```
   curl https://<app>.onrender.com/api/health
   ```

   Expect `MULTI_TENANT:true`.

---

## Phase 7 — Post-cutover verification (the real test)

1. **Instance admin:** `xavier` logs in → sees all 33 patients.
2. **Member:** `Amit` (or another member) logs in → `GET /api/me/scope` returns the org tree; the worklist shows patients (org-root assignment ⇒ sees all 33 for now). **Must not be empty.**
3. **Patient form:** opening the add-patient form as a member shows the cascading Department → Ward → Unit picker (not free-text), pre-filled if the member is scoped to a single unit.
4. Create a test patient as a member, confirm it syncs and appears with the correct derived ward/unit labels; then delete it.

**GATE 7 (hard):** If ANY clinician sees an empty list, **immediately set `ORTHO_FLAG_MULTI_TENANT=0`** (instant full-visibility rollback), then diagnose. An empty list means a user without a valid assignment or a patient without a `unitId` slipped through Phase 4 — re-run the backfill and re-verify before turning the flag back on.

---

## Rollback reference (any phase)

- **Fastest, covers most failures:** set `ORTHO_FLAG_MULTI_TENANT=0`. App becomes single-tenant; all 33 patients visible to everyone; no data lost. The backfill's additions (`unitId`, ancestry, assignments) are simply ignored while off.
- **Bad Phase-2 code deploy:** Render → Rollback to the previous (Phase-1) build. Mongo data is untouched and forward-compatible (extra fields are ignored by older code paths).
- **Data corruption (should not happen — backfill is additive & idempotent):** restore `phase2-preflight-backup.json` via `POST /api/import` as the instance admin.

## Guardrails for the executing agent

- Never run the backfill or migration without confirming `MONGODB_URI` points at the intended database (check `inspect-prod.js` counts match Section 0 first).
- The backfill is idempotent — re-running is safe and is the correct response to a partial result.
- Do not delete the old test org / `wards` docs until after Phase 7 passes and the owner approves (Phase 5 option).
- Do not proceed past any GATE that fails. When in doubt, flag OFF and stop.

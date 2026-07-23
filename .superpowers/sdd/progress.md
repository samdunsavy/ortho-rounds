Task 1: complete (commits dc21b19..7301463, review clean)
  Minor (deferred to final review): known-key entries inside explicit otherLabs array not filtered -> possible duplicate display; dedupe key computed post-truncation; coverage exactly brief's cases.
Task 2: complete (commits 7301463..c9fafb3, review clean)
  Minor (deferred): prompt says name max 30 chars vs sanitizer cap 40 (intentional slack, but note).
Task 3: complete (commits c9fafb3..768ed1f, review clean)
  Minor (deferred): phosphate/alp not round-tripped in save test (only existence-checked); labValueClass explicit-key-list dispatch fragile for future keys.
Task 4: complete (commits 768ed1f..b2fa480, fix round for 2 Important findings, re-review clean)
  Fixed: bindAiEvents reverted to harness-side; formatLabsLine(p,{includeOtherLabs:false}) at getPatientFlags site + regression test.
  Minor (deferred): mergePendingOtherLabs doesn't re-enforce 40/20 char caps client-side (upstream extractOtherLabs does); toast extraCount counts value-updates as new; modal seed not re-capped to 12.
Task 5: complete (commits b2fa480..0396aad, review clean)
  Note: merge.js merges labs per-key, so otherLabs survives cross-client merges (better than spec worst case); regression test added.
Final review: Ready to merge (opus whole-branch review). One required fix applied: known-key filter in explicit otherLabs array (6f5affe, 212/212 green). Accepted-as-is minors triaged in final review report.
Phase1 auth/sync scoping: BASE 561e92f
P1 Task 1: complete (commits 561e92f..f27b347, review clean)
  Minor (deferred): no test for instance-admin update path, org-admin vs unassigned patient, null-actor inputs.
P1 Task 2: complete (commits f27b347..2d48833, fix round for 3 Important harness gaps, re-review clean)
  Minor (deferred): seed() failure leaks temp dataDir; stderr 4KB bound approximate; no process-exit guard for orphaned children.
P1 Task 3: complete (commits 2d48833..09c02c6, bootstrapAdmin deviation reverted mid-task, review clean)
  Minor (deferred): harness root-admin id collision unguarded; stale first-round concern note in report.
  Note for hosted pilot: bootstrapAdmin no-ops when ANY user exists -- hosted instance with only org-scoped users gets no root admin; deliberate decision needed later.
P1 Task 4: complete (commits 09c02c6..9884f87, opus review clean)
  Minor (deferred): decision.wardId!==undefined branch unreachable-defensive; no write-layer cross-org-move rejection test; ordered shared-state tests; actor shape verified only cross-task.
P1 Task 5: complete (commits 9884f87..ccf4e46, review clean)
  Minor (deferred): guard expression duplicated x3 (requireInstanceAdmin helper candidate).
P1 Final review: Ready to merge after fixes (opus). Critical fix applied: /api/diag gated instance-admin-only + isInstanceAdmin helper x4 (0580738). Verified by controller: 248/248 green.
Pre-hosted-pilot TODO: bootstrapAdmin cannot create root admin once org-scoped users exist; add provisioning check. Grep-audit rule: any handler reading patients store-wide must be scope-filtered or instance-admin-gated.
Admin console: BASE b45b87d
AC Task 1: complete (commits b45b87d..e359cf5, review clean)
  Minor (deferred): listUsersByOrg multi-user ordering unasserted.
AC Task 2: complete (commits e359cf5..46ff575, review clean)
  Minor (deferred): report overstated assertion counts (report-only inaccuracy).
AC Task 3: complete (commits 46ff575..fdb1f95, review clean)
  Minor (deferred): buildOrgRollups O(N orgs x active patients) rescan per org.
AC Task 4: complete (commits fdb1f95..5f2a379, opus security review clean)
  Minor (deferred): org admin can create org-scoped admins via POST users (lateral, not escalation -- spec ambiguity); 404-vs-403 existence oracle on user routes (UUIDs, negligible).
AC Task 5: complete (commits 5f2a379..536b4a3, fix round: More-sheet z-index + real CSS tokens, re-review clean)
  Minor (deferred): attribute-selector strings built from unescaped dataset ids (UUIDs, low risk); pre-existing undefined --bg/--muted elsewhere in codebase (project-wide cleanup candidate).
AC Task 6: complete (commits 536b4a3..04fb794, review clean)
  Minor (deferred): adminView.hidden half of flag-off test vacuously true.
AC Final review: Ready to merge with fixes (opus). Fixed: idempotent bootstrapAdmin self-heal (disabled-admin reactivation, e385e40) + assign-select revert on failure. Verified by controller: 268/268 green.
Pre-scale notes: buildOrgRollups per-org rescan; unassigned pilot ops via console only.
Phase 2 hierarchy: BASE 9bf177b726527ce9221f820bc7540d59b1f11b11
Task 1: complete (commits 9bf177b..9014910, review clean). Follow-up for Task 7: public/app.js add-department POST still hits /api/admin/wards (now /api/admin/departments).
Task 2: complete (commits 9014910..3b8ece2, review clean). 269/269 green.
Task 3: complete (commits 3b8ece2..bf0f10c, review clean). 274/274 green.
Task 4: complete (commits bf0f10c..a18c0ac, review clean). scope.test.js 18/18; full suite intentionally red (11 server sync/scoping failures) until Task 5 updates the server.js call site.
Task 5: complete (commits a18c0ac..4654430, incl. fix round for 1 Critical [client-overridable ancestry] + 1 Important [weakened test]; re-review clean). 273/273 green. Fix: decideWrite re-stamps server-truth ancestry on edits + server strips client ancestry keys.
Task 6: complete (commits 4654430..038f730, review clean). 275/275 green. Minor (deferred to final): buildOrgTree sequential await N+1 (pre-existing pattern); instance-admin cross-org assign 403 path sound but untested.
Task 7: complete (commits 038f730..a029b85, incl. add-department path fix + GET /api/admin/users assignment fields fix; review clean). 276/276 green.
Task 8: complete (commits a029b85..b9b18a5, review clean). 284/284 green. Note: patient modal rendered from JS templates in app.js (not static index.html); picker landed in app.js. Minor (deferred): openPatientModal now async (harmless); server.js:401 reimplements resolveScope node formula (dup).
Task 9: complete (commits b9b18a5..e3837ad, review clean, idempotency verified). 289/289 green. Minor (deferred): dead-code if(row.deleted) after getActive filter (harmless).
Task 10: complete (commits e3837ad..c009b04, review clean). 292/292 green. All 10 tasks done.
Final review (opus whole-branch): Ready after fixes. Fixed 1 Important merge-blocker: backfill now assigns existing non-admin users to org root so nobody is stranded on flag flip (commit 9de9736, +no-stranding resolveScope test). Deferred Minors accepted (buildOrgTree N+1; untested instance-admin cross-org assign; async openPatientModal; /api/me/scope duplicates resolveScope node formula — keep in lockstep; dead deleted-guard). 294/294 green. Branch phase2-hierarchy ready to merge.
Structural ops (Spec 1): BASE 5c620d44c282be5d138831a223b94a42f1bb1b92
SO Task 1: complete (commits 5c620d4..b20ba79, review clean). 295/295 green.
SO Task 2: complete (commits b20ba79..f1447a3, review clean). 299/299 green. CARRY TO TASK 6: getPatientRaw returns only {updatedAt,data} (no id/deleted) — rehome must source rows from getActive() so restampPatient gets correct id/deleted and only active patients are rehomed.
SO Task 3: complete (commits f1447a3..6764d1b, review clean). 307/307 green.
SO Task 4: complete (commits 6764d1b..93fdb2b, review clean). 312/312 green. Minor (deferred): O(n) active-patient scan per delete (consistent w/ restampUnits).
SO Task 5: complete (commits 6764d1b..d394efb wait->93fdb2b..d394efb, review clean). 317/317 green. Note: wrong-type parent returns 404 (looked up as expected type) not 400 — ruled sound. Cycles structurally impossible (moves only go up-levels).
SO Task 6: complete (commits d394efb..29a675a, review clean). 321/321 green. Rehome sourced from getActive() (id/deleted correct, active-only). Minor (deferred): assign-bulk node-not-found returns 403 not 404 (consistent w/ existing /assign).
SO Task 7: complete (commits 29a675a..c69833b, review clean). 329/329 green. All 7 tasks done.

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

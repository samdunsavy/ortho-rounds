# SDD ledger — plan: docs/superpowers/plans/2026-07-26-admin-patient-org-and-scope-view.md
Branch: feat/admin-patient-scope
Merge-base (main): d14fcc9f27a2b852100f3612816c7566aff316f6
Setup: pre-flight scan clean (plan authored this session; 3 tasks, TDD, flag-gated).
Task 1: complete (commits d14fcc9..d6af7aa, review clean — spec ✅, no findings; 4 new tests pass, full suite 404).
Task 2: minor (deferred): server-scoping.test.js "member cannot widen via activeScope" is vacuous (pg1 baseline already unit1) — strengthen to assert patients.length===0. Property still proven by intersectScope pure tests + admin-narrow test.
Task 2: complete (commits d6af7aa..f8ce482, review clean — spec ✅, no Critical/Important; 1 deferred minor; suite 410 pass).
Task 3: review clean — spec ✅, no Critical/Important. Minors: (1) LS_ACTIVE_SCOPE single-quote style; (2) no .scope-select CSS (cosmetic, deferred); (3) renderScopeSelector untested — matches brief (deferred); (4) logout doesn't clear LS_ACTIVE_SCOPE.
Task 3: controller elevated finding (4) to Important — shared-device deployment: member after admin logout keeps sending stale activeScope with no selector to reset. Entering fix round 1 (also fold in nit #1). #2/#3 deferred to final review.
Task 3: fix round 1/5 (2 addressed, 0 open — logout clears activeScope + quote nit; commits 6638bef..fb10979). Re-review clean, no new breakage. Suite 413.
Task 3: complete (commits f8ce482..fb10979, review clean after 1 fix round; deferred minors: no .scope-select CSS, renderScopeSelector untested).

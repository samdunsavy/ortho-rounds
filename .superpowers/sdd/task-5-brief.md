### Task 5: POLISH.md backlog note + full-suite verification

**Files:**
- Modify: `POLISH.md`
- Modify (if needed): none — this task is verification.

**Interfaces:** none.

- [ ] **Step 1: Add the deferred-milestones backlog note**

Append to the backlog section of `POLISH.md`:

```markdown
- Voice-round scribe: surface spoken-but-unmatched milestone actions as one-tap
  suggested checklist additions (deferred 2026-07-21 — labs capture-don't-drop
  prioritized; the ward template library already covers milestone customization).
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file green, no regressions in sync-merge, worklist, milestones, admission-format, or storage tests.

- [ ] **Step 3: Verify old-client compatibility claim from the spec**

Run: `npm test -- tests/frontend-sync-merge.test.js tests/merge.test.js`
Expected: PASS. Then confirm by inspection (`grep -n "labs" merge.js`) that the labs object merges as a unit (newer `updatedAt` wins whole-object) — meaning `otherLabs` rides along and an older client's labs write replaces it wholesale, the documented-acceptable behavior for any new lab key. If merge.js instead merges labs per-key, add a regression test asserting `otherLabs` survives a merge where the other side lacks it.

- [ ] **Step 4: Commit**

```bash
git add POLISH.md
git commit -m "chore: log deferred milestone voice-suggestions in POLISH backlog"
```


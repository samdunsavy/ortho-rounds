### Task 6: Flag-off UI/route goldens + docs tick + full verification

**Files:**
- Modify: `tests/frontend-admin-view.test.js` (flag-off UI assertions), `ROADMAP.md`, `DESIGN-multitenant.md`
- Test: full suite

- [ ] **Step 1: Add flag-off UI test**

Append to `tests/frontend-admin-view.test.js`:

```js
describe('flag OFF — zero admin UI', () => {
  test('admin entries stay hidden even for admins', () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.serverFlags = {};
    window.updateAccountUI();
    const btn = document.getElementById('moreAdminBtn');
    assert.ok(btn, 'button exists in DOM');
    assert.equal(btn.style.display, 'none');
    assert.equal(document.getElementById('adminView').hidden, true);
  });
});
```

Run: `npm test -- tests/frontend-admin-view.test.js` → PASS (if it fails, fix the `updateAccountUI` wiring, not the test).

- [ ] **Step 2: Docs**

- `ROADMAP.md` Phase 1 checklist: add `- [x] Org/department admin console + provisioning (shipped 2026-07-22 — see docs/superpowers/specs/2026-07-22-admin-console-design.md)` after the auth/sync scoping line.
- `DESIGN-multitenant.md`: mark "Org/ward admin console" item 3 done (`✅ done — 2026-07-22`); note the bootstrapAdmin self-heal under the rollout plan.

- [ ] **Step 3: Full suite + flag-off goldens**

Run: `npm test` — all pass. Confirm `tests/server-sync-golden.test.js` and the flag-off describe in `tests/server-admin-console.test.js` are green (these are the byte-identical guards).

- [ ] **Step 4: Commit**

```bash
git add tests/frontend-admin-view.test.js ROADMAP.md DESIGN-multitenant.md
git commit -m "chore: flag-off admin-UI golden, roadmap tick for admin console"
```

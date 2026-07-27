# Admin Console Premium Craft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the MULTI_TENANT admin console into a premium Master Control surface — cinematic Overview with live telemetry, instrument-dense working sections, expressive CSS motion, and finished empty states — without new dependencies or behavior regressions.

**Architecture:** Frontend-only craft on the existing sidebar shell. Admin-scoped CSS tokens + fonts under `#adminView`; `adminUI.telemetry` filled from existing `GET /api/health` inside `loadAdminView`; Overview builders gain Command header / HUD KPIs / alert-queue empty state; section builders gain instrument classes and empty markup; motion is CSS primitives + stagger `--i` hooks with `prefers-reduced-motion` kill-switch.

**Tech Stack:** Vanilla JS classic scripts (`public/admin-*.js`), CSS in `public/index.html`, Google Fonts (Plus Jakarta Sans + Fraunces + existing JetBrains Mono), `node:test` + jsdom (`tests/helpers/frontend-env.js`).

**Source spec:** `docs/superpowers/specs/2026-07-27-admin-console-premium-craft-design.md`.

## Global Constraints

- **Frontend-only.** Touch `public/index.html` and `public/admin-*.js` (+ matching `tests/frontend-admin-*.test.js`). No `server.js` / `admin.js` / API changes.
- **No new packages.** Nothing may be added to `package.json`. Fonts via Google Fonts link only.
- **Preserve behavior.** Every `data-*`, element `id`, delegated handler, mutation flow, `adminLoadSeq`, and soft busy lifecycle stays.
- **Touch targets ≥44px.** Do not shrink chips/controls for aesthetics.
- **`MULTI_TENANT` off** → console unreachable; `tests/server-sync-golden.test.js` stays green.
- **No motion libraries.** CSS `@keyframes` / transitions only; respect `prefers-reduced-motion: reduce`.
- **Classic scripts:** `let adminData` / `adminUI` are file-local lexical bindings shared across admin-*.js in one page eval — **not** `window.adminUI`. Tests drive via DOM / function-declaration globals / `loadAdminView`.
- **No purple neon / glow kitsch.** Teal family only; one soft elevated shadow for HUD panels.
- **Baseline:** run `npm test` before starting (expect green). Commit after every task with `feat:` / `fix:` / `test:` / `docs:`.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `public/index.html` | Fonts link; admin token + motion + shell/Overview/instrument CSS; Overview markup hooks (`#adminCommandHeader`, `#adminTelemetry`) | 1–6 |
| `public/admin-console.js` | `adminUI.telemetry`, `refreshAdminTelemetry()`, Master Control Overview render, stagger hooks, empty attention | 2–3 |
| `public/admin-structure.js` | Instrument classes + detail `admin-motion-slide-in` | 4 |
| `public/admin-people.js` | Instrument classes + empty / no-match markup | 5 |
| `public/admin-orgs.js` | Instrument classes + empty org list polish | 6 |
| `public/admin-audit.js` | Instrument classes + empty-state class hook | 6 |
| `tests/frontend-admin-console.test.js` | Tokens, shell, telemetry, Overview empty/stagger | 1–3 |
| `tests/frontend-admin-structure.test.js` | Detail slide-in class | 4 |
| `tests/frontend-admin-people.test.js` | Empty people state | 5 |
| `tests/frontend-admin-orgs.test.js` | Empty orgs state (if assertions needed) | 6 |
| Spec status line | Mark implemented when suite green | 7 |

---

### Task 1: Admin fonts, tokens, and motion primitives

**Files:**
- Modify: `public/index.html` (Google Fonts `<link>` ~line 16; admin CSS block ~710+)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: existing `#adminView.admin-view`, dark theme hooks
- Produces:
  - Fonts: Plus Jakarta Sans + Fraunces added to the existing Google Fonts URL (keep JetBrains Mono; DM Sans may remain for rounds)
  - Under `#adminView`: `--admin-font-ui`, `--admin-font-display`, `--admin-font-mono`, `--admin-paper`, `--admin-card`, `--admin-elevated`, `--admin-accent-soft`, `--admin-radius-lux`, `--admin-radius-tool`, `--admin-shadow-elev`
  - Motion classes: `.admin-motion-fade-rise`, `.admin-motion-slide-in`, `.admin-motion-stagger` (uses `--i`), `.admin-motion-pulse-soft`, `.admin-context-bar.is-shimmering` (or `#adminView.is-busy .admin-context-bar::after`)
  - `@media (prefers-reduced-motion: reduce)` disables animations/transitions for those classes

- [ ] **Step 1: Write the failing test**

Add to `tests/frontend-admin-console.test.js`:

```js
describe('admin premium craft: tokens and fonts', () => {
  test('#adminView declares admin font and surface tokens', () => {
    const { document } = loadFrontendEnv();
    const view = document.getElementById('adminView');
    assert.ok(view);
    // Tokens live in CSS; assert the stylesheet text includes the contract names.
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    for (const token of [
      '--admin-font-ui',
      '--admin-font-display',
      '--admin-font-mono',
      '--admin-paper',
      '--admin-card',
      '--admin-elevated',
      '--admin-radius-lux',
      '--admin-radius-tool',
      '--admin-shadow-elev'
    ]) {
      assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(css, /admin-motion-fade-rise/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

  test('document loads Plus Jakarta Sans and Fraunces', () => {
    const { document } = loadFrontendEnv();
    const href = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map(l => l.href || l.getAttribute('href') || '')
      .join(' ');
    assert.match(href, /Plus\+Jakarta\+Sans|Plus Jakarta Sans/);
    assert.match(href, /Fraunces/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="admin premium craft: tokens"`

Expected: FAIL (tokens / fonts not present)

- [ ] **Step 3: Update the Google Fonts link**

In `public/index.html`, replace the existing fonts stylesheet `href` so it includes Plus Jakarta Sans + Fraunces + JetBrains Mono (DM Sans may stay for rounds):

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,500;9..144,700&family=JetBrains+Mono:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 4: Add admin token + motion CSS**

At the start of the `/* ---------- admin console ---------- */` block in `public/index.html`, add (adapt hex only as teal-family steps derived from existing `--accent`; prefer referencing `var(--accent)` where possible):

```css
  #adminView{
    --admin-font-ui:"Plus Jakarta Sans",var(--font-sans);
    --admin-font-display:"Fraunces",Georgia,serif;
    --admin-font-mono:var(--mono);
    --admin-paper:var(--paper);
    --admin-card:var(--card);
    --admin-elevated:var(--card);
    --admin-accent-soft:var(--accent-soft);
    --admin-radius-lux:14px;
    --admin-radius-tool:8px;
    --admin-shadow-elev:var(--shadow-md);
    background:var(--admin-paper);
    font-family:var(--admin-font-ui);
    color:var(--ink);
  }
  #adminView .admin-view-title,
  #adminView .admin-stat-tile .n,
  #adminView .admin-command-title{
    font-family:var(--admin-font-display);
  }
  #adminView .admin-updated,
  #adminView .admin-telemetry-value,
  #adminView .admin-cc-crumb{
    font-family:var(--admin-font-mono);
  }
  @keyframes admin-fade-rise{
    from{opacity:0;transform:translateY(8px)}
    to{opacity:1;transform:none}
  }
  @keyframes admin-slide-in{
    from{opacity:0;transform:translateX(12px)}
    to{opacity:1;transform:none}
  }
  @keyframes admin-pulse-soft{
    0%,100%{opacity:1}
    50%{opacity:0.55}
  }
  @keyframes admin-shimmer{
    0%{transform:translateX(-100%)}
    100%{transform:translateX(100%)}
  }
  .admin-motion-fade-rise{animation:admin-fade-rise 0.35s ease both}
  .admin-motion-slide-in{animation:admin-slide-in 0.28s ease both}
  .admin-motion-stagger{animation:admin-fade-rise 0.4s ease both;animation-delay:calc(var(--i, 0) * 70ms)}
  .admin-motion-pulse-soft{animation:admin-pulse-soft 2.4s ease-in-out infinite}
  .admin-view.is-busy .admin-context-bar{position:relative;overflow:hidden}
  .admin-view.is-busy .admin-context-bar::after{
    content:"";position:absolute;left:0;right:0;bottom:0;height:2px;
    background:linear-gradient(90deg,transparent,var(--accent),transparent);
    animation:admin-shimmer 1.1s linear infinite;
  }
  @media (prefers-reduced-motion: reduce){
    .admin-motion-fade-rise,
    .admin-motion-slide-in,
    .admin-motion-stagger,
    .admin-motion-pulse-soft,
    .admin-view.is-busy .admin-context-bar::after{
      animation:none !important;transition:none !important;
    }
  }
```

Also set `.admin-sidebar{width:220px;}` (was 200px) and wire card surfaces to `var(--admin-card)` where admin panels already use `--card` if a one-line swap is clean — do not mass-rewrite every rule in this task beyond tokens + motion + sidebar width.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="admin premium craft: tokens"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/index.html tests/frontend-admin-console.test.js
git commit -m "$(cat <<'EOF'
feat: admin premium fonts, tokens, and CSS motion primitives

EOF
)"
```

---

### Task 2: Shell brand lockup + busy shimmer (verify)

**Files:**
- Modify: `public/index.html` (sidebar brand markup ~2174; back button copy/classes)
- Modify: `public/admin-console.js` only if brand is rendered from JS (prefer static HTML)
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: Task 1 shimmer CSS on `#adminView.is-busy .admin-context-bar::after`
- Produces: `.admin-sidebar-brand` markup showing “Ortho Rounds” + muted “Admin”; ghost-styled `#adminViewClose`

- [ ] **Step 1: Write the failing test**

```js
describe('admin premium craft: shell', () => {
  test('sidebar brand shows Ortho Rounds and Admin', () => {
    const { document } = loadFrontendEnv();
    const brand = document.querySelector('.admin-sidebar-brand');
    assert.ok(brand);
    assert.match(brand.textContent, /Ortho Rounds/);
    assert.match(brand.textContent, /Admin/);
  });

  test('busy state keeps Updating… and context bar for shimmer hook', async () => {
    const { window, document } = loadFrontendEnv();
    let resolveUsers;
    const usersPending = new Promise(r => { resolveUsers = r; });
    window.api = async (path) => {
      if(path === '/api/admin/users'){ await usersPending; return { users: [] }; }
      if(path === '/api/health') return { ok: true, storage: 'sqlite', ai: { enabled: false }, flags: { MULTI_TENANT: true } };
      if(path.startsWith('/api/admin/org')) return {
        org: { id: 'bfv2-org', name: 'Default', stats: { livePatients: 0, byStatus: {}, users: 0, lastActivity: null } },
        totals: { hospitals: 0, departments: 0, units: 0, wards: 0, usersActive: 0, usersDisabled: 0, livePatients: 0 },
        hospitals: []
      };
      return {};
    };
    // org-admin path: stub isInstanceAdminUser false via localStorage org id if needed
    window.localStorage.setItem('ortho_org_id', 'bfv2-org');
    document.getElementById('adminView').hidden = false;
    const p = window.loadAdminView();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.getElementById('adminView').classList.contains('is-busy'), true);
    assert.ok(document.querySelector('.admin-context-bar'));
    assert.equal(document.getElementById('adminBusyStatus').hidden, false);
    resolveUsers({ users: [] });
    await p;
  });
});
```

Adjust the busy stub to match how `orgAdminEnv()` / instance-admin helpers already work in this file — reuse `orgAdminEnv()` if it already stubs `api` and identity; the important assertions are brand copy + busy still toggles.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="admin premium craft: shell"`

Expected: FAIL on brand text

- [ ] **Step 3: Update sidebar brand markup**

Replace:

```html
<div class="admin-sidebar-brand"><span>Admin</span></div>
```

with:

```html
<div class="admin-sidebar-brand">
  <span class="admin-sidebar-brand-name">Ortho Rounds</span>
  <span class="admin-sidebar-brand-sub">Admin</span>
</div>
```

Add CSS:

```css
  .admin-sidebar-brand{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:4px 8px 14px;}
  .admin-sidebar-brand-name{font-weight:700;font-size:15px;color:var(--ink);letter-spacing:-0.02em;}
  .admin-sidebar-brand-sub{font-size:11px;font-weight:600;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.08em;font-family:var(--admin-font-mono);}
  .admin-sidebar-back{
    margin-top:auto;justify-content:flex-start;min-height:44px;
    background:transparent;border:0;color:var(--ink-soft);box-shadow:none;font-weight:500;
  }
  .admin-sidebar-back:hover{color:var(--ink);background:var(--admin-accent-soft);box-shadow:none;}
```

Keep button id `#adminViewClose` and accessible name (text can stay “← Back to rounds” or “Back to rounds” with icon — do not break the click handler in `app.js`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="admin premium craft: shell"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/index.html tests/frontend-admin-console.test.js
git commit -m "$(cat <<'EOF'
feat: premium admin shell brand lockup

EOF
)"
```

---

### Task 3: Telemetry + Master Control Overview

**Files:**
- Modify: `public/index.html` (Overview body markup ~2191–2202; Overview CSS)
- Modify: `public/admin-console.js` (`adminUI`, `loadAdminView`, `renderAdminOverviewSection`, `renderAdminStatTiles`, `renderAdminNeedsAttentionHTML`)
- Optionally modify: `public/app.js` `refreshServerFlags` to also stash storage — **prefer health fetch inside admin** so Overview does not depend on app.js cache
- Test: `tests/frontend-admin-console.test.js`

**Interfaces:**
- Consumes: `loadAdminView`, `setAdminBusy`, `adminLoadSeq`, existing tree/users fixtures
- Produces:
  - `adminUI.telemetry: { ok: boolean, ai: boolean|null, storage: string|null }` (default `{ ok:false, ai:null, storage:null }`)
  - `async function refreshAdminTelemetry(): Promise<void>` — `fetch('/api/health')`, sets `adminUI.telemetry`; on failure sets `{ ok:false, ai:null, storage:null }`
  - Markup: `#adminCommandHeader` with `.admin-command-title` and `#adminTelemetry.admin-telemetry`
  - Empty attention copy: exact string `All systems clear`
  - KPI tiles: classes `admin-stat-tile admin-motion-stagger` with `style="--i:N"`

- [ ] **Step 1: Write the failing tests**

```js
describe('admin premium craft: Master Control Overview', () => {
  test('loadAdminView fills telemetry from /api/health and Overview renders AI + storage', async () => {
    const { window, document } = orgAdminEnv();
    const prevApi = window.api;
    window.api = async (path, ...rest) => {
      if(path === '/api/health') return { ok: true, storage: 'mongo', ai: { enabled: true }, flags: { MULTI_TENANT: true } };
      return prevApi(path, ...rest);
    };
    // If refreshAdminTelemetry uses fetch, not api():
    window.fetch = async (url) => {
      if(String(url).includes('/api/health')){
        return { ok: true, json: async () => ({ ok: true, storage: 'mongo', ai: { enabled: true }, flags: { MULTI_TENANT: true } }) };
      }
      return { ok: false, json: async () => ({}) };
    };
    await window.loadAdminView();
    window.switchAdminSection('overview');
    const tel = document.getElementById('adminTelemetry');
    assert.ok(tel);
    assert.match(tel.textContent, /AI/i);
    assert.match(tel.textContent, /on/i);
    assert.match(tel.textContent, /mongo/i);
    assert.ok(document.querySelector('.admin-command-title'));
    assert.match(document.querySelector('.admin-command-title').textContent, /Command/);
  });

  test('health failure shows em dash for AI and storage', async () => {
    const { window, document } = orgAdminEnv();
    window.fetch = async () => { throw new Error('offline'); };
    await window.loadAdminView();
    window.switchAdminSection('overview');
    const tel = document.getElementById('adminTelemetry');
    assert.ok(tel);
    assert.match(tel.textContent, /—/);
  });

  test('empty needs-attention shows All systems clear', async () => {
    const { window, document } = orgAdminEnv();
    window.api = async (path) => {
      if(path === '/api/admin/users') return { users: [{ id: 'u1', username: 'fine1', role: 'member', active: true, orgId: 'bfv2-org', assignmentType: 'unit', assignmentId: 'u1' }] };
      if(path.startsWith('/api/admin/org')) return TREE; // TREE fixture already in file — ensure unit u1 exists
      return {};
    };
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, storage: 'sqlite', ai: { enabled: false } }) });
    await window.loadAdminView();
    window.switchAdminSection('overview');
    assert.match(document.getElementById('adminNeedsAttention').textContent, /All systems clear/);
  });

  test('stat tiles carry stagger motion hooks', async () => {
    const { window, document } = orgAdminEnv();
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, storage: 'sqlite', ai: { enabled: false } }) });
    await window.loadAdminView();
    const tiles = [...document.querySelectorAll('#adminStatTiles .admin-stat-tile')];
    assert.equal(tiles.length, 4);
    tiles.forEach((t, i) => {
      assert.ok(t.classList.contains('admin-motion-stagger'));
      assert.equal(t.style.getPropertyValue('--i').trim(), String(i));
    });
  });
});
```

Wire `orgAdminEnv` / `TREE` exactly as existing tests in this file do. If `refreshAdminTelemetry` uses `fetch`, stub `window.fetch`; if it uses `api('/api/health')`, stub `window.api` for that path. **Pick `fetch('/api/health')`** so it works without auth headers (health is public) — document that choice in the implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="Master Control Overview"`

Expected: FAIL

- [ ] **Step 3: Extend adminUI + refreshAdminTelemetry + loadAdminView**

In `public/admin-console.js`, add to `adminUI`:

```js
  telemetry: { ok: false, ai: null, storage: null },
```

Add:

```js
async function refreshAdminTelemetry(){
  try{
    const res = await fetch('/api/health');
    if(!res.ok) throw new Error('health ' + res.status);
    const data = await res.json();
    adminUI.telemetry = {
      ok: true,
      ai: !!(data.ai && data.ai.enabled),
      storage: typeof data.storage === 'string' ? data.storage : null
    };
  }catch{
    adminUI.telemetry = { ok: false, ai: null, storage: null };
  }
}
```

Inside `loadAdminView`, after a successful data load (before `setAdminBusy(false)` / render), `await refreshAdminTelemetry()` — still respect `loadToken !== adminLoadSeq` after the await. On the failure path of org/users fetch, skip telemetry or still refresh; either is fine as long as busy clears correctly.

- [ ] **Step 4: Overview markup + renderers**

In `public/index.html` inside `#adminOverviewBody`, prepend:

```html
        <header class="admin-command-header" id="adminCommandHeader">
          <h3 class="admin-command-title" id="adminCommandTitle">Command</h3>
          <div class="admin-telemetry" id="adminTelemetry" hidden></div>
        </header>
```

Update `renderAdminOverviewSection` to:
1. Set `#adminCommandTitle` text to `${orgName} · Command` (org from `adminData.tree.org.name`, fallback `Command`)
2. Fill `#adminTelemetry` via a small `renderAdminTelemetryHTML()` and unhide it
3. Keep existing tiles / status bar / attention / quick actions

`renderAdminTelemetryHTML` sketch:

```js
function renderAdminTelemetryHTML(){
  const t = adminUI.telemetry || { ok: false, ai: null, storage: null };
  const ai = t.ok ? (t.ai ? 'on' : 'off') : '—';
  const storage = t.ok && t.storage ? t.storage : '—';
  const pulse = t.ok && t.ai ? ' admin-motion-pulse-soft' : '';
  return `<span class="admin-telemetry-item${pulse}"><span class="admin-telemetry-label">AI</span> <span class="admin-telemetry-value">${ai}</span></span>` +
    `<span class="admin-telemetry-item"><span class="admin-telemetry-label">Storage</span> <span class="admin-telemetry-value">${escapeHTML(storage)}</span></span>`;
}
```

Update `renderAdminStatTiles`:

```js
  return tiles.map((t, i) =>
    `<div class="admin-stat-tile admin-motion-stagger" style="--i:${i}"><div class="admin-stat-icon">${icon(t.ic)}</div><div class="n">${t.n}</div><div class="l">${escapeHTML(t.l)}</div></div>`
  ).join('');
```

Update `renderAdminNeedsAttentionHTML` empty branch:

```js
  if(!groups.length){
    return `<div class="admin-systems-clear admin-motion-fade-rise"><span class="admin-motion-pulse-soft" aria-hidden="true"></span> All systems clear</div>`;
  }
  return `<h3 class="admin-alert-queue-title">Needs attention</h3>` + groups.map((g, gi) =>
    `<div class="admin-attention-group admin-motion-slide-in${g.urgent ? ' admin-attention-urgent' : ''}" style="--i:${gi}">…</div>`
  ).join('');
```

Preserve every `data-attention-*` attribute and row button structure from the current `row()` helper.

- [ ] **Step 5: Overview CSS (Master Control)**

Add CSS for `.admin-command-header`, `.admin-command-title`, `.admin-telemetry`, `.admin-stat-tile` elevated HUD (larger `.n`, `border-radius: var(--admin-radius-lux)`, `box-shadow: var(--admin-shadow-elev)`), `.admin-systems-clear`, denser `.admin-attention-group` as alert queue. Quick actions remain visually secondary (lower contrast / smaller weight).

- [ ] **Step 6: Run tests**

Run: `node --no-warnings --test tests/frontend-admin-console.test.js --test-name-pattern="Master Control|Overview|admin overview|soft busy|icon"`

Expected: PASS (update any brittle assertions that required empty string for empty attention)

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/admin-console.js tests/frontend-admin-console.test.js
git commit -m "$(cat <<'EOF'
feat: Master Control Overview with health telemetry

EOF
)"
```

---

### Task 4: Structure instrument + detail slide-in

**Files:**
- Modify: `public/admin-structure.js` (detail pane root class)
- Modify: `public/index.html` (instrument CSS for `.admin-cc-*`)
- Test: `tests/frontend-admin-structure.test.js`

**Interfaces:**
- Consumes: existing `renderAdminDetailPane` / selection flow
- Produces: detail root includes `admin-motion-slide-in` on each paint; rail/detail use `--admin-radius-tool` denser styles

- [ ] **Step 1: Write the failing test**

Find the existing test that selects a node and asserts detail content. Add:

```js
test('structure detail pane includes slide-in motion class after select', async () => {
  // Use the same env + selectAdminNode helper pattern as neighboring tests in this file
  const { window, document } = /* existing harness in this file */;
  // after selecting a unit/ward:
  const detail = document.getElementById('adminDetailPane');
  assert.ok(detail);
  assert.ok(
    detail.classList.contains('admin-motion-slide-in') ||
    detail.querySelector('.admin-motion-slide-in'),
    'expected slide-in class on detail pane or its inner root'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-admin-structure.test.js --test-name-pattern="slide-in"`

Expected: FAIL

- [ ] **Step 3: Add class on detail render**

In `public/admin-structure.js`, wherever the detail HTML is assigned to `#adminDetailPane`, ensure the pane element gets:

```js
const pane = document.getElementById('adminDetailPane');
pane.classList.remove('admin-motion-slide-in');
void pane.offsetWidth; // restart CSS animation on re-select
pane.classList.add('admin-motion-slide-in');
```

Or wrap inner HTML in `<div class="admin-cc-detail-inner admin-motion-slide-in">…</div>`. Prefer restarting animation on the pane so reselection retriggers.

Add instrument CSS (tighter rail rows, sharper selected rail, mono crumb already covered by Task 1 font rule).

- [ ] **Step 4: Run tests**

Run: `node --no-warnings --test tests/frontend-admin-structure.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/admin-structure.js public/index.html tests/frontend-admin-structure.test.js
git commit -m "$(cat <<'EOF'
feat: instrument Structure pane with slide-in motion

EOF
)"
```

---

### Task 5: People instrument + empty states

**Files:**
- Modify: `public/admin-people.js` (`renderAdminUsersPanelHTML`, optionally `applyAdminPeopleFilters`)
- Modify: `public/index.html` (People instrument CSS)
- Test: `tests/frontend-admin-people.test.js`

**Interfaces:**
- Consumes: existing people filter/search
- Produces:
  - When `state.users` is empty: `.admin-empty` block with copy `No people yet.` and visible Create affordance (existing create form is enough if present)
  - When filters hide all rows: show `#adminPeopleEmptyFilter` with `No people match.` (toggle in `applyAdminPeopleFilters`)

- [ ] **Step 1: Write the failing tests**

```js
test('empty users list shows No people yet', () => {
  const { window, document } = /* people harness */;
  document.getElementById('adminPeopleSection').innerHTML =
    window.renderAdminUsersPanelHTML({ tree: null, users: [], orgs: [] });
  assert.match(document.getElementById('adminPeopleSection').textContent, /No people yet/);
});

test('no filter matches shows No people match', () => {
  const { window, document } = /* harness with one user rendered */;
  // set search to impossible string, call applyAdminPeopleFilters
  window.adminUI.peopleSearch = 'zzz-no-match';
  window.applyAdminPeopleFilters();
  const empty = document.getElementById('adminPeopleEmptyFilter');
  assert.ok(empty);
  assert.equal(empty.hidden, false);
  assert.match(empty.textContent, /No people match/);
});
```

**Note:** `adminUI` is not on `window`. Drive search via the `#adminUserSearch` input + existing input listener, or expose nothing new — call `applyAdminPeopleFilters` after setting the input value and updating `adminUI.peopleSearch` through the same code path the UI uses. Prefer:

```js
const input = document.getElementById('adminUserSearch');
input.value = 'zzz-no-match';
input.dispatchEvent(new window.Event('input'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --no-warnings --test tests/frontend-admin-people.test.js --test-name-pattern="No people"`

Expected: FAIL

- [ ] **Step 3: Implement empty markup**

In `renderAdminUsersPanelHTML`, after building `rows`/`cards`:

```js
  const emptyList = !(state.users || []).length
    ? `<div class="admin-empty" id="adminPeopleEmpty">No people yet.</div>`
    : `<div class="admin-empty" id="adminPeopleEmptyFilter" hidden>No people match.</div>`;
```

Include `emptyList` below the table/cards. In `applyAdminPeopleFilters`, after applying display styles:

```js
  const filterEmpty = document.getElementById('adminPeopleEmptyFilter');
  if(filterEmpty){
    const anyVisible = [...document.querySelectorAll('[data-user-row]')].some(el => el.style.display !== 'none');
    filterEmpty.hidden = anyVisible || !(adminData.users || []).length;
  }
```

Tighten People CSS: denser chips, tool-strip bulk bar (`border-radius: var(--admin-radius-tool)`), sharper table header.

- [ ] **Step 4: Run tests**

Run: `node --no-warnings --test tests/frontend-admin-people.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/admin-people.js public/index.html tests/frontend-admin-people.test.js
git commit -m "$(cat <<'EOF'
feat: instrument People section with empty states

EOF
)"
```

---

### Task 6: Organizations + Audit instrument polish

**Files:**
- Modify: `public/admin-orgs.js`, `public/admin-audit.js`, `public/index.html`
- Test: `tests/frontend-admin-orgs.test.js` and/or audit assertions in `tests/frontend-admin-console.test.js` if audit tests live there — locate with `rg "No audit|admin-orgs|renderAdminOrgs" tests/`

**Interfaces:**
- Consumes: existing empty copy (`No organizations yet.`, `No audit entries match.`)
- Produces: those nodes gain class `admin-empty`; Orgs detail uses `admin-motion-slide-in` like Structure; shared `.admin-empty` CSS

- [ ] **Step 1: Write the failing tests**

```js
test('orgs empty state uses admin-empty class', () => {
  // render orgs section with zero orgs via existing harness
  assert.ok(document.querySelector('#adminOrgsSection .admin-empty'));
  assert.match(document.querySelector('#adminOrgsSection .admin-empty').textContent, /No organizations yet/);
});

test('audit no-match uses admin-empty class', () => {
  // drive audit list HTML with zero entries
  assert.ok(document.querySelector('.admin-empty'));
  assert.match(document.body.textContent, /No audit entries match/);
});
```

Adapt selectors to the real audit DOM ids in `admin-audit.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run the relevant frontend test files with `--test-name-pattern="admin-empty|No organizations|No audit"`

Expected: FAIL

- [ ] **Step 3: Implement**

- Orgs: change empty markup to `<div class="admin-empty">No organizations yet.</div>`; on detail paint, restart `admin-motion-slide-in` like Structure
- Audit: wrap `No audit entries match.` in `class="admin-empty"`
- CSS: `.admin-empty{padding:24px 8px;color:var(--ink-soft);font-size:14px;}` shared

- [ ] **Step 4: Run section tests**

Run: `node --no-warnings --test tests/frontend-admin-orgs.test.js tests/frontend-admin-console.test.js --test-name-pattern="org|audit|Admin"`

Expected: existing + new tests PASS (narrow if the name pattern is too broad)

- [ ] **Step 5: Commit**

```bash
git add public/admin-orgs.js public/admin-audit.js public/index.html tests/frontend-admin-orgs.test.js tests/frontend-admin-console.test.js
git commit -m "$(cat <<'EOF'
feat: instrument Orgs and Audit empty states

EOF
)"
```

---

### Task 7: Full suite + mark spec implemented

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-admin-console-premium-craft-design.md` (Status → Implemented)
- Test: full `npm test`

- [ ] **Step 1: Run full suite**

Run: `npm test`

Expected: all tests PASS. If any fail due to intentional markup (empty attention no longer `''`, brand text, font link), fix assertions minimally — do not weaken behavior tests.

- [ ] **Step 2: Mark spec implemented**

Change the spec header Status line to:

```markdown
**Status:** Implemented.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-27-admin-console-premium-craft-design.md
git commit -m "$(cat <<'EOF'
docs: mark admin premium craft spec implemented

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec section | Task |
|--------------|------|
| §1 Visual system (fonts, tokens, personality) | Task 1 |
| §2 Shell & navigation | Task 2 (+ sidebar width in Task 1) |
| §3 Master Control Overview + telemetry | Task 3 |
| §4 Structure / People / Orgs / Audit instrument | Tasks 4–6 |
| §5 Motion system + reduced-motion | Task 1 primitives; applied in 3–6 |
| §6–7 Architecture / errors | Task 3 telemetry failure → em dash; busy/seq untouched |
| §8 Testing | Per-task tests + Task 7 full suite |
| Non-goals (no new deps/APIs/libs) | Global Constraints |

No TBD placeholders. `adminUI.telemetry` / `refreshAdminTelemetry` / `All systems clear` / `No people yet.` / `No people match.` are consistent across tasks.

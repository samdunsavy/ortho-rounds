# T2 — Audit log read API + console view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the T1 audit log queryable via an admin filtered API (+ CSV) and a clinician-facing per-patient Activity trail in the patient modal.

**Architecture:** Extend `listAudit` with optional `actions[]`. Add `GET /api/admin/audit` + `.csv` (admin, org-clamped) and `GET /api/patients/:id/audit` (`canRead` + allowlisted actions). New `public/admin-audit.js` section; Activity block in `public/app.js` patient modal.

**Tech Stack:** Node ESM, existing SQLite/Mongo stores, `server-harness.js`, plain admin scripts (no bundler).

**Spec:** `docs/superpowers/specs/2026-07-27-audit-log-read-api-design.md`

## Global Constraints

- T1 write path must already be present (`audit.js`, `appendAudit`/`listAudit`, call sites).
- No update/delete on audit; no new runtime dependencies.
- `/api/sync` response shape unchanged — golden flag-off test must stay green.
- Org admin forced to own `orgId`; other org → 403.
- Patient endpoint: 403 out of scope, **no** audit row written for the probe.
- No admin-console visual polish — reuse People/Structure tokens and patterns.
- `escapeHTML` on every client-interpolated audit field.
- Commit messages reference `T2` (`feat(T2): …`).

## File map

| File | Responsibility |
|---|---|
| `storage.js` | Add `opts.actions` (`IN` clause) to SQLite + Mongo `listAudit` |
| `server.js` | Admin audit JSON/CSV handlers; patient audit handler; shared query parse helpers |
| `public/admin-audit.js` | Audit section UI (filters, list, detail, CSV) |
| `public/admin-console.js` | Nav entry + section switch wiring |
| `public/index.html` | `#adminAuditSection` shell + script tag |
| `public/app.js` | Patient modal Activity collapsible |
| `tests/storage-audit.test.js` | `actions[]` filter test |
| `tests/server-audit-read.test.js` | API filters, pagination, isolation, member path |
| `BACKLOG.md` | Mark T2 `[x]` |

---

### Task 1: `listAudit` — optional `actions[]` filter

**Files:**
- Modify: `storage.js` (SQLite `listAudit` ~398; Mongo `listAudit` ~726)
- Test: `tests/storage-audit.test.js`

**Interfaces:**
- Consumes: existing `listAudit(opts)`
- Produces: `listAudit({ actions?: string[], … })` — when `actions` is a non-empty array, restrict to `action IN (…)`; empty/omitted → no action filter. Single `action` string filter still works and AND-combines if both set (prefer: if `actions` present, ignore `action`).

- [ ] **Step 1: Write the failing test**

Append to `tests/storage-audit.test.js` inside the SQLite suite:

```js
test('listAudit filters by actions array (IN)', async () => {
  await store.appendAudit(sample({ id: 'act1', at: 600, action: 'patient.view' }));
  await store.appendAudit(sample({ id: 'act2', at: 700, action: 'login.success', subjectType: 'session', subjectId: 'u1' }));
  await store.appendAudit(sample({ id: 'act3', at: 800, action: 'patient.write' }));
  const rows = await store.listAudit({
    actions: ['patient.view', 'patient.write'],
    subjectId: 'p1',
    limit: 10
  });
  assert.deepEqual(rows.map(r => r.id).sort(), ['act1', 'act3']);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test tests/storage-audit.test.js
```

Expected: fail on `actions` ignored / wrong ids.

- [ ] **Step 3: Implement SQLite + Mongo**

SQLite — after existing `action` filter block, add:

```js
if(Array.isArray(opts.actions) && opts.actions.length){
  const list = opts.actions.filter(a => typeof a === 'string' && a);
  if(list.length){
    where.push(`action IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
} else if(opts.action){
  where.push('action = ?'); params.push(opts.action);
}
```

(Remove or gate the previous standalone `if(opts.action)` so it is not duplicated.)

Mongo:

```js
if(Array.isArray(opts.actions) && opts.actions.length){
  const list = opts.actions.filter(a => typeof a === 'string' && a);
  if(list.length) q.action = { $in: list };
} else if(opts.action){
  q.action = opts.action;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test tests/storage-audit.test.js
```

- [ ] **Step 5: Commit**

```bash
git add storage.js tests/storage-audit.test.js
git commit -m "$(cat <<'EOF'
feat(T2): listAudit actions IN filter for patient allowlist

EOF
)"
```

---

### Task 2: Admin audit JSON + CSV API

**Files:**
- Modify: `server.js` (add helpers near other admin helpers; routes after auth’d admin user routes, before or after `/api/diag`)
- Test: `tests/server-audit-read.test.js` (create)

**Interfaces:**
- Consumes: `store.listAudit`, `isInstanceAdmin`, `isEnabled('MULTI_TENANT')`
- Produces:
  - `parseAuditListQuery(params) → { ok, error?, filters }`
  - `resolveAuditOrgClamp(actor, requestedOrgId) → { ok, orgId?, status?, error? }`
  - `GET /api/admin/audit` → `{ entries, limit, offset }`
  - `GET /api/admin/audit.csv` → text/csv, max 5000 rows

- [ ] **Step 1: Write failing integration tests**

Create `tests/server-audit-read.test.js` with harness patterns from `tests/server-audit.test.js` (`startServer`, `login`, `authFetch`, `hashPassword` seed).

Minimum cases in one MULTI_TENANT `before` that seeds orgA/orgB, admins, and inserts audit rows via HTTP actions (login, sync, patient-view) **or** by opening the store after seed and `appendAudit` before boot — prefer append during seed for deterministic filters:

```js
// Inside seed(store), after users/orgs exist:
await store.appendAudit({
  id: 'row-a1', at: 1000, actorId: 'adminA', actorUsername: 'adminA',
  action: 'patient.write', subjectType: 'patient', subjectId: 'patA',
  orgId: 'orgA', ip: null, userAgent: null, detail: {}
});
await store.appendAudit({
  id: 'row-b1', at: 2000, actorId: 'adminB', actorUsername: 'adminB',
  action: 'patient.write', subjectType: 'patient', subjectId: 'patB',
  orgId: 'orgB', ip: null, userAgent: null, detail: {}
});
await store.appendAudit({
  id: 'row-a2', at: 1500, actorId: 'adminA', actorUsername: 'adminA',
  action: 'patient.view', subjectType: 'patient', subjectId: 'patA',
  orgId: 'orgA', ip: null, userAgent: null, detail: {}
});
```

Tests:

```js
test('non-admin gets 403 on /api/admin/audit', async () => {
  const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
  assert.equal((await authFetch(srv.baseUrl, tok, '/api/admin/audit')).status, 403);
});

test('org A admin cannot read org B entries (JSON)', async () => {
  const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
  const r = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=50');
  assert.equal(r.status, 200);
  assert.ok(r.json.entries.every(e => e.orgId === 'orgA'));
  assert.ok(!r.json.entries.some(e => e.subjectId === 'patB'));
});

test('org A admin requesting orgId=orgB gets 403', async () => {
  const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
  assert.equal((await authFetch(srv.baseUrl, tok, '/api/admin/audit?orgId=orgB')).status, 403);
});

test('filters: action, subjectId, actorId, from, to', async () => { /* assert each */ });

test('pagination limit/offset', async () => {
  const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
  const page1 = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=1&offset=0');
  const page2 = await authFetch(srv.baseUrl, tok, '/api/admin/audit?limit=1&offset=1');
  assert.equal(page1.json.entries.length, 1);
  assert.equal(page2.json.entries.length, 1);
  assert.notEqual(page1.json.entries[0].id, page2.json.entries[0].id);
});

test('CSV is org-clamped and includes header', async () => {
  const tok = (await login(srv.baseUrl, 'adminA', 'pw-adminA')).json.token;
  const res = await fetch(srv.baseUrl + '/api/admin/audit.csv', {
    headers: { Authorization: 'Bearer ' + tok }
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.startsWith('id,at,actorId,'));
  assert.ok(text.includes('patA'));
  assert.ok(!text.includes('patB'));
});
```

Also a small flag-off describe: admin can list without org clamp.

- [ ] **Step 2: Run — expect FAIL** (404 / missing routes)

```bash
node --test tests/server-audit-read.test.js
```

- [ ] **Step 3: Implement helpers + routes in `server.js`**

```js
function parseAuditListQuery(params, { defaultLimit, maxLimit }){
  const limitRaw = params.get('limit');
  const offsetRaw = params.get('offset');
  const limit = limitRaw == null || limitRaw === '' ? defaultLimit : Number(limitRaw);
  const offset = offsetRaw == null || offsetRaw === '' ? 0 : Number(offsetRaw);
  if(!Number.isFinite(limit) || limit < 1 || limit > maxLimit){
    return { ok: false, error: `limit must be 1–${maxLimit}` };
  }
  if(!Number.isFinite(offset) || offset < 0){
    return { ok: false, error: 'offset must be >= 0' };
  }
  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  const from = fromRaw == null || fromRaw === '' ? null : Number(fromRaw);
  const to = toRaw == null || toRaw === '' ? null : Number(toRaw);
  if(fromRaw != null && fromRaw !== '' && !Number.isFinite(from)) return { ok: false, error: 'from must be epoch ms' };
  if(toRaw != null && toRaw !== '' && !Number.isFinite(to)) return { ok: false, error: 'to must be epoch ms' };
  return {
    ok: true,
    filters: {
      actorId: params.get('actorId') || undefined,
      subjectId: params.get('subjectId') || undefined,
      action: params.get('action') || undefined,
      from: from == null ? undefined : from,
      to: to == null ? undefined : to,
      limit, offset
    },
    requestedOrgId: params.get('orgId') || null
  };
}

function resolveAuditOrgClamp(actor, requestedOrgId){
  if(!isEnabled('MULTI_TENANT')) return { ok: true, orgId: undefined };
  if(isInstanceAdmin(actor)){
    return { ok: true, orgId: requestedOrgId || undefined };
  }
  if(requestedOrgId && requestedOrgId !== actor.orgId){
    return { ok: false, status: 403, error: 'Not your organization' };
  }
  return { ok: true, orgId: actor.orgId || undefined };
}

function csvEscape(v){
  const s = v == null ? '' : String(v);
  if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
```

Route handlers (auth already established; require `actor.role === 'admin'`):

```js
if(pathname === '/api/admin/audit' && req.method === 'GET'){
  if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
  const qIdx = req.url.indexOf('?');
  const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '');
  const parsed = parseAuditListQuery(params, { defaultLimit: 50, maxLimit: 200 });
  if(!parsed.ok) return sendJSON(res, 400, { error: parsed.error });
  const clamp = resolveAuditOrgClamp(actor, parsed.requestedOrgId);
  if(!clamp.ok) return sendJSON(res, clamp.status, { error: clamp.error });
  const entries = await store.listAudit({ ...parsed.filters, orgId: clamp.orgId });
  return sendJSON(res, 200, { entries, limit: parsed.filters.limit, offset: parsed.filters.offset });
}

if(pathname === '/api/admin/audit.csv' && req.method === 'GET'){
  if(actor.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
  const qIdx = req.url.indexOf('?');
  const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '');
  const parsed = parseAuditListQuery(params, { defaultLimit: 5000, maxLimit: 5000 });
  if(!parsed.ok) return sendJSON(res, 400, { error: parsed.error });
  const clamp = resolveAuditOrgClamp(actor, parsed.requestedOrgId);
  if(!clamp.ok) return sendJSON(res, clamp.status, { error: clamp.error });
  const entries = await store.listAudit({
    ...parsed.filters, orgId: clamp.orgId, limit: 5000, offset: 0
  });
  const header = 'id,at,actorId,actorUsername,action,subjectType,subjectId,orgId,ip,userAgent,detail';
  const lines = entries.map(e => [
    e.id, e.at, e.actorId, e.actorUsername, e.action, e.subjectType, e.subjectId,
    e.orgId, e.ip, e.userAgent, JSON.stringify(e.detail || {})
  ].map(csvEscape).join(','));
  const body = [header, ...lines].join('\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="ortho_audit.csv"',
    'Cache-Control': 'no-store'
  });
  return res.end(body);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test tests/server-audit-read.test.js
node --test tests/server-sync-golden.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server-audit-read.test.js
git commit -m "$(cat <<'EOF'
feat(T2): admin audit list and CSV with org clamp

EOF
)"
```

---

### Task 3: Patient audit API

**Files:**
- Modify: `server.js` (near existing `/api/audit/patient-view`)
- Test: `tests/server-audit-read.test.js` (extend)

**Interfaces:**
- Consumes: `store.getPatientRaw`, `resolveScope`, `canRead`, `listAudit` with `actions`
- Produces: `GET /api/patients/:id/audit` → `{ entries, limit, offset }`
- Allowlist constant: `['patient.view','patient.write','patient.move','ai.invoke']`

- [ ] **Step 1: Write failing tests**

```js
test('member can read own patient audit allowlist only', async () => {
  // seed audit rows: patient.write + login.success on same subjectId trick — login uses session subject;
  // append patient.write + export with subjectId=patA during seed
  const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
  const r = await authFetch(srv.baseUrl, tok, '/api/patients/patA/audit?limit=50');
  assert.equal(r.status, 200);
  assert.ok(r.json.entries.every(e =>
    ['patient.view','patient.write','patient.move','ai.invoke'].includes(e.action)
  ));
});

test('member cannot read other org patient audit', async () => {
  const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
  assert.equal((await authFetch(srv.baseUrl, tok, '/api/patients/patB/audit')).status, 403);
});

test('missing patient is 404', async () => {
  const tok = (await login(srv.baseUrl, 'pgA', 'pw-pgA')).json.token;
  assert.equal((await authFetch(srv.baseUrl, tok, '/api/patients/no-such/audit')).status, 404);
});
```

For 403/200 tests, seed real patients into the store (via sync after boot, or `upsertPatient` in seed with ancestry JSON including `orgId`/`unitId`). Prefer sync after login like `server-audit.test.js` cross-tenant case, then appendAudit for that id — or upsertPatient in seed:

```js
await store.upsertPatient('patA', Date.now(), 0, JSON.stringify({
  id: 'patA', name: 'A', orgId: 'orgA', unitId: 'unitA', hospitalId: 'hA', departmentId: 'depA'
}));
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement route**

```js
const patientAuditMatch = pathname.match(/^\/api\/patients\/([^/]+)\/audit$/);
if(patientAuditMatch && req.method === 'GET'){
  const patientId = decodeURIComponent(patientAuditMatch[1]);
  const row = await store.getPatientRaw(patientId);
  if(!row) return sendJSON(res, 404, { error: 'Patient not found' });
  let patient; try{ patient = JSON.parse(row.data || '{}'); }catch{ patient = {}; }
  patient.id = patientId;
  if(isEnabled('MULTI_TENANT')){
    const scope = await resolveScope(actor, store);
    if(!canRead(patient, scope)) return sendJSON(res, 403, { error: 'Not in scope' });
  }
  const qIdx = req.url.indexOf('?');
  const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '');
  const parsed = parseAuditListQuery(params, { defaultLimit: 20, maxLimit: 100 });
  if(!parsed.ok) return sendJSON(res, 400, { error: parsed.error });
  const entries = await store.listAudit({
    subjectId: patientId,
    actions: ['patient.view', 'patient.write', 'patient.move', 'ai.invoke'],
    limit: parsed.filters.limit,
    offset: parsed.filters.offset
  });
  return sendJSON(res, 200, { entries, limit: parsed.filters.limit, offset: parsed.filters.offset });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test tests/server-audit-read.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server-audit-read.test.js
git commit -m "$(cat <<'EOF'
feat(T2): patient audit trail endpoint with canRead gate

EOF
)"
```

---

### Task 4: Admin console Audit section

**Files:**
- Create: `public/admin-audit.js`
- Modify: `public/admin-console.js` (`ADMIN_SECTIONS`, `ADMIN_SECTION_IDS`, `ADMIN_SECTION_ICONS`, `renderAdminSection`)
- Modify: `public/index.html` — add `<div class="admin-section" id="adminAuditSection" hidden></div>` after people/structure; add `<script src="admin-audit.js"></script>` after `admin-orgs.js`

**Interfaces:**
- Consumes: `api()`, `escapeHTML()`, `formatRelativeTime()`, `icon()`, `adminUI`, `isInstanceAdminUser()`
- Produces: `renderAdminAuditSection()`

- [ ] **Step 1: Wire shell + empty renderer**

In `admin-console.js`:

```js
const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'structure', label: 'Structure' },
  { id: 'audit', label: 'Audit' },
  { id: 'orgs', label: 'Organizations' }
];
// ADMIN_SECTION_IDS.audit = 'adminAuditSection'
// ADMIN_SECTION_ICONS.audit = 'clipboard' // or existing icon name present in sprite — grep ic- in index.html; use 'list' or 'dashboard' if no clipboard
```

In `renderAdminSection`:

```js
else if(adminUI.section === 'audit') renderAdminAuditSection();
```

Extend `adminUI` with:

```js
auditFilters: { action: '', actorId: '', subjectId: '', from: '', to: '', orgId: '' },
auditEntries: [],
auditSelectedId: null,
auditOffset: 0,
auditLoading: false,
auditError: null
```

- [ ] **Step 2: Implement `public/admin-audit.js`**

Functional requirements (match People density, no new CSS language beyond existing admin classes):

- Filter inputs + Apply / Export CSV / Load more
- List rows: time, actorUsername, action, subjectType/subjectId
- Click → detail pane with all fields + `JSON.stringify(detail)` inside `<pre>` with escapeHTML
- `buildAuditQuery()` from `adminUI.auditFilters` + limit 50 + offset
- Load: `api('/api/admin/audit?' + qs)`
- CSV: `window.location` will not send Bearer — use `fetch` with Authorization from `localStorage` + download blob (same pattern if export exists elsewhere; else):

```js
async function downloadAdminAuditCsv(){
  const token = localStorage.getItem('ortho_token') || localStorage.getItem(LS_TOKEN);
  const res = await fetch('/api/admin/audit.csv?' + buildAuditQuery({ csv: true }), {
    headers: { Authorization: 'Bearer ' + token }
  });
  if(!res.ok){ showToast('Could not export audit CSV'); return; }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ortho_audit.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
```

(Find the real token key via `LS_TOKEN` in `app.js` — use that constant name if global, else the string already used by `api()`.)

Org filter input: only render if `isInstanceAdminUser()`.

- [ ] **Step 3: Manual smoke** — `npm run dev`, log in as admin, open Audit, apply filter, export CSV. (Agent: at minimum run syntax check.)

```bash
node --check public/admin-audit.js
```

- [ ] **Step 4: Commit**

```bash
git add public/admin-audit.js public/admin-console.js public/index.html
git commit -m "$(cat <<'EOF'
feat(T2): admin console Audit section with filters and CSV

EOF
)"
```

---

### Task 5: Patient modal Activity

**Files:**
- Modify: `public/app.js` — `renderModalForm` (or wherever modal sections are built) + small helpers
- Optional test: skip unless cheap; not a blocker per spec

**Interfaces:**
- Consumes: `GET /api/patients/:id/audit`, `api()`, `escapeHTML()`, `formatRelativeTime()`
- Produces: Activity collapsible in existing-patient modal only

- [ ] **Step 1: Add helpers**

```js
function humaniseAuditAction(entry){
  if(entry.action === 'patient.view') return 'Viewed';
  if(entry.action === 'patient.write') return 'Updated';
  if(entry.action === 'patient.move') return 'Moved';
  if(entry.action === 'ai.invoke'){
    const ep = entry.detail && entry.detail.endpoint ? String(entry.detail.endpoint) : 'AI';
    return 'AI: ' + ep;
  }
  return entry.action || 'Event';
}

function renderPatientActivitySection(patientId){
  return `<details class="patient-activity" id="patientActivity" data-patient-id="${escapeHTML(patientId)}">
    <summary>Activity</summary>
    <div id="patientActivityBody" class="small-muted">Open to load activity</div>
    <button type="button" class="btn" id="patientActivityMore" hidden>Load more</button>
  </details>`;
}
```

Insert `renderPatientActivitySection(p.id)` only when editing existing patient inside `renderModalForm` output (near bottom).

- [ ] **Step 2: Bind expand / load-more**

In modal delegated listeners (or after `openPatientModal`):

```js
let patientActivityOffset = 0;
async function loadPatientActivity(reset){
  const root = document.getElementById('patientActivity');
  const body = document.getElementById('patientActivityBody');
  const more = document.getElementById('patientActivityMore');
  if(!root || !body) return;
  const id = root.dataset.patientId;
  if(reset) patientActivityOffset = 0;
  if(!navigator.onLine){
    body.textContent = 'Activity unavailable offline';
    return;
  }
  try{
    const data = await api('/api/patients/' + encodeURIComponent(id) + '/audit?limit=20&offset=' + patientActivityOffset);
    const entries = data.entries || [];
    if(reset) body.innerHTML = '';
    if(!entries.length && patientActivityOffset === 0){
      body.innerHTML = '<div class="small-muted">No activity yet</div>';
    } else {
      body.insertAdjacentHTML('beforeend', entries.map(e =>
        `<div class="patient-activity-row">` +
          `<span>${escapeHTML(formatRelativeTime(e.at))}</span> · ` +
          `<span>${escapeHTML(e.actorUsername || 'unknown')}</span> · ` +
          `<span>${escapeHTML(humaniseAuditAction(e))}</span>` +
        `</div>`
      ).join(''));
    }
    patientActivityOffset += entries.length;
    if(more) more.hidden = entries.length < 20;
  }catch{
    body.textContent = 'Could not load activity';
  }
}
```

On `toggle` of `#patientActivity` when `open`, call `loadPatientActivity(true)`. More button → `loadPatientActivity(false)`.

- [ ] **Step 3: Verify openPatientModal still fires patient-view audit (T1) and Activity does not block save**

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "$(cat <<'EOF'
feat(T2): patient modal Activity trail

EOF
)"
```

---

### Task 6: Verify + backlog

**Files:**
- Modify: `BACKLOG.md` — T2 `[x]`

- [ ] **Step 1: Full suite**

```bash
npm test
```

Expected: all pass (note final count). Golden sync green.

- [ ] **Step 2: Mark backlog**

Change T2 status from `[ ]` to `[x]`.

- [ ] **Step 3: Commit**

```bash
git add BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(T2): mark audit read API done

EOF
)"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| Admin filters + pagination | Task 2 |
| CSV export, 5000 cap, org clamp | Task 2 |
| Org A ↛ org B (JSON + CSV) | Task 2 |
| Patient endpoint + allowlist + canRead | Task 3 |
| `listAudit` actions IN | Task 1 |
| Admin Audit section | Task 4 |
| Patient modal Activity | Task 5 |
| Flag-off behaviour | Task 2 flag-off describe |
| No sync contract change | Task 2/6 golden |
| BACKLOG | Task 6 |

**Placeholder scan:** none remaining.  
**Type consistency:** `parseAuditListQuery` / `resolveAuditOrgClamp` / allowlist array shared as specified across Tasks 2–3.

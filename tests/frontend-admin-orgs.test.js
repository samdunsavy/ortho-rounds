import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

/** Mirrors orgAdminEnv() in frontend-admin-console.test.js (not exported from
    there, so duplicated here): stubs the admin API with a caller-supplied org
    list. Organizations is instance-admin-only functionality, so this always
    sets ortho_role to admin unless the caller explicitly opts out (needed by
    the repair-ancestry visibility test below, which drives the render path
    directly without an instance-admin load). */
function orgsEnv(orgs, instanceAdmin = true){
  const env = loadFrontendEnv();
  if(instanceAdmin) env.window.localStorage.setItem('ortho_role', 'admin');
  const calls = [];
  env.window.api = async (path, opts) => {
    calls.push({ path, opts });
    if(path === '/api/admin/orgs') return { orgs: orgs || [] };
    if(path === '/api/admin/users') return { users: [] };
    return {};
  };
  return Object.assign({ calls }, env);
}

describe('orgs section rendering', () => {
  test('renders a rail row and a default-selected detail pane after an instance-admin load', async () => {
    const { window, document } = orgsEnv([
      { id: 'o1', name: 'Pilot Org', plan: 'free', createdAt: 1, stats: { hospitals: 1, departments: 2, users: 4, livePatients: 7 } }
    ]);
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    const row = document.querySelector('[data-org-select="o1"]');
    assert.ok(row);
    assert.match(row.textContent, /Pilot Org/);
    const detail = document.getElementById('adminOrgsDetail');
    assert.match(detail.textContent, /Pilot Org/);
    assert.match(detail.textContent, /7/);
  });

  test('new organization name input has maxlength 80', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [] };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    assert.equal(document.getElementById('adminNewOrgName').getAttribute('maxlength'), '80');
  });
});

describe('orgs instrument polish (premium craft Task 6)', () => {
  test('orgs empty state uses admin-empty class', async () => {
    const { window, document } = orgsEnv([]);
    await window.loadAdminView();
    window.renderAdminOrgsSection();
    const empty = document.querySelector('#adminOrgsSection .admin-empty');
    assert.ok(empty);
    assert.match(empty.textContent, /No organizations yet/);
  });

  test('orgs detail pane includes slide-in motion class after select', async () => {
    const { window, document } = orgsEnv([
      { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 1, departments: 2, users: 3, livePatients: 4 } }
    ]);
    await window.loadAdminView();
    window.selectAdminOrg('o1');
    const detail = document.getElementById('adminOrgsDetail');
    assert.ok(detail);
    assert.ok(
      detail.classList.contains('admin-motion-slide-in') ||
      detail.querySelector('.admin-motion-slide-in'),
      'expected slide-in class on orgs detail pane or its inner root'
    );
  });
});

describe('orgs master-detail (Task 6)', () => {
  test('orgs render a rail of selectable rows + a detail pane', async () => {
    const { window, document } = orgsEnv([
      { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 1, departments: 2, users: 3, livePatients: 4 } }
    ]);
    await window.loadAdminView();
    window.renderAdminOrgsSection();
    assert.ok(document.querySelector('[data-org-select="o1"]'));
    assert.ok(document.getElementById('adminOrgsDetail'));
  });

  test('selecting an org shows its stats + View action in the detail pane', async () => {
    const { window, document } = orgsEnv([
      { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 1, departments: 2, users: 3, livePatients: 4 } },
      { id: 'o2', name: 'Beta', plan: 'free', stats: { hospitals: 0, departments: 0, users: 1, livePatients: 0 } }
    ]);
    await window.loadAdminView();
    window.selectAdminOrg('o2');
    const detail = document.getElementById('adminOrgsDetail');
    assert.match(detail.textContent, /Beta/);
    assert.ok(detail.querySelector('[data-view-org="o2"]'));
  });

  test('global create-org + repair-ancestry controls persist', async () => {
    const { window, document } = orgsEnv([{ id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }], true);
    await window.loadAdminView();
    window.renderAdminOrgsSection();
    assert.ok(document.getElementById('adminAddOrgBtn'));
    assert.ok(document.querySelector('[data-repair-ancestry]'));
  });

  test('clicking a rail row selects that org via the delegated handler', async () => {
    const { window, document } = orgsEnv([
      { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 1, departments: 1, users: 1, livePatients: 1 } },
      { id: 'o2', name: 'Beta', plan: 'free', stats: { hospitals: 0, departments: 0, users: 1, livePatients: 0 } }
    ]);
    await window.loadAdminView();
    document.querySelector('[data-org-select="o2"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.match(document.getElementById('adminOrgsDetail').textContent, /Beta/);
  });

  test('a stale selectedOrgId falls back to the first org', async () => {
    const { window, document } = orgsEnv([
      { id: 'o1', name: 'Alpha', plan: 'pro', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }
    ]);
    await window.loadAdminView();
    window.selectAdminOrg('does-not-exist');
    window.renderAdminOrgsSection();
    assert.match(document.getElementById('adminOrgsDetail').textContent, /Alpha/);
  });
});

describe('create-org-admin validation', () => {
  test('a blank org-admin username shows an inline message instead of no-oping', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.api = async (path) => path === '/api/admin/orgs' ? { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] } : { users: [] };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-new-org-admin="o1"]').value = '   ';
    document.querySelector('[data-create-org-admin="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual([...toasts], ['Enter a username']);
  });
});

describe('viewed-org chip', () => {
  test('viewing an org shows a persistent chip naming it, visible from any section', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path.startsWith('/api/admin/org')) return { org: { id: 'o1', name: 'Org One', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null } }, totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      return { users: [] };
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    const chip = document.getElementById('adminOrgChip');
    assert.ok(chip.textContent.includes('Org One'));
    assert.equal(chip.hidden, false);

    window.switchAdminSection('people');
    assert.equal(document.getElementById('adminOrgChip').hidden, false, 'the chip stays visible outside Structure/Organizations too');
  });

  test('clicking the chip\'s close button exits the org context', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [{ id: 'o1', name: 'Org One', plan: 'free', stats: { hospitals: 0, departments: 0, users: 0, livePatients: 0 } }] };
      if(path.startsWith('/api/admin/org')) return { org: { id: 'o1', name: 'Org One', stats: { livePatients: 0, byStatus: { postop: 0, preop: 0, conservative: 0, fordischarge: 0 }, users: 0, lastActivity: null } }, totals: { departments: 0, usersActive: 0, livePatients: 0 }, hospitals: [] };
      return { users: [] };
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-view-org="o1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    document.querySelector('[data-org-chip-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(document.getElementById('adminOrgChip').hidden, true);
    assert.equal(document.getElementById('adminOrgsSection').hidden, false);
  });
});

describe('repair ancestry', () => {
  test('the button is instance-admin only', () => {
    const { window, document } = loadFrontendEnv();
    window.renderAdminOrgsSection();
    assert.ok(!document.querySelector('[data-repair-ancestry]'));
    window.localStorage.setItem('ortho_role', 'admin');
    window.renderAdminOrgsSection();
    assert.ok(document.querySelector('[data-repair-ancestry]'));
  });

  test('clicking it confirms, then posts and reports the restamped count', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    let confirmed = '';
    window.showConfirm = (title, message) => { confirmed = message; return Promise.resolve(true); };
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.api = async (path, opts) => {
      if(path === '/api/admin/orgs') return { orgs: [] };
      if(path === '/api/admin/repair-ancestry' && opts && opts.method === 'POST') return { restamped: 4 };
      return { users: [] };
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-repair-ancestry]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(confirmed.length > 0);
    assert.deepEqual([...toasts], ['Fixed ancestry for 4 patients']);
  });

  test('declining the confirmation posts nothing', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin');
    window.showConfirm = () => Promise.resolve(false);
    const calls = [];
    window.api = async (path, opts) => { calls.push(path); return path === '/api/admin/orgs' ? { orgs: [] } : { users: [] }; };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    document.querySelector('[data-repair-ancestry]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.includes('/api/admin/repair-ancestry'), false);
  });
});

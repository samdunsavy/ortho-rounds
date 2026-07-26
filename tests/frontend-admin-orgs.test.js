import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontendEnv } from './helpers/frontend-env.js';

describe('orgs section rendering', () => {
  test('renders rollup cards after an instance-admin load', async () => {
    const { window, document } = loadFrontendEnv();
    window.localStorage.setItem('ortho_role', 'admin'); // instance admin
    window.api = async (path) => {
      if(path === '/api/admin/orgs') return { orgs: [
        { id: 'o1', name: 'Pilot Org', plan: 'free', createdAt: 1, stats: { hospitals: 1, departments: 2, users: 4, livePatients: 7 } }
      ] };
      if(path === '/api/admin/users') return { users: [] };
      return {};
    };
    await window.loadAdminView();
    window.switchAdminSection('orgs');
    const cards = document.querySelectorAll('#adminOrgsSection .admin-org-card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].textContent, /Pilot Org/);
    assert.match(cards[0].textContent, /7/);
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

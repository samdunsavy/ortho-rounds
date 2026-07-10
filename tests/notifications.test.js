import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import webPush from 'web-push';
import { runDigestPass } from '../notifications.js';

// notifications.js does `const webPush = (await import('web-push')).default`
// internally — Node's ESM/CJS interop caches web-push's module.exports object
// as a singleton, so importing it here and monkey-patching its methods
// affects what notifications.js sees too, without a real network call.
function stubWebPush(sendImpl){
  webPush.setVapidDetails = () => {};
  webPush.sendNotification = sendImpl;
}

function fakeConfig(){
  return { vapidPublicKey: 'pub', vapidPrivateKey: 'priv' };
}

function fakeStore(subs){
  const state = { subs: subs.map(s => Object.assign({}, s)), users: new Map(), updated: [], deleted: [] };
  return Object.assign(state, {
    async getAllSubscriptions(){ return state.subs; },
    async getUserById(id){ return state.users.get(id) || null; },
    async updateSubscription(endpoint, patch){
      state.updated.push({ endpoint, patch });
      const s = state.subs.find(x => x.endpoint === endpoint);
      if(s) Object.assign(s, patch);
    },
    async deleteSubscription(endpoint){
      state.deleted.push(endpoint);
      state.subs = state.subs.filter(x => x.endpoint !== endpoint);
    },
    setUser(id, user){ state.users.set(id, user); }
  });
}

function overduePatient(assignedPg){
  return {
    id: 'p1', status: 'postop', surgeryDate: '2020-01-01', assignedPg,
    postOpChecks: [{ id: 'c1', status: 'pending', duePodEnd: 0 }] // any surgeryDate this old is way past due
  };
}

describe('runDigestPass', () => {
  test('sends a digest and updates lastDigestAt when overdue items exist', async () => {
    let sentTo = null;
    stubWebPush(async (sub, payload) => { sentTo = { sub, payload }; });

    const store = fakeStore([{ userId: 'u1', endpoint: 'ep1', p256dh: 'k', auth: 'a', lastDigestAt: 0 }]);
    store.setUser('u1', { id: 'u1', username: 'PPG1', active: true });

    const result = await runDigestPass(store, fakeConfig(), [overduePatient('ppg1')]);

    assert.equal(result.sent, 1);
    assert.ok(sentTo);
    assert.match(JSON.parse(sentTo.payload).body, /1 overdue item/);
    assert.equal(store.updated.length, 1);
    assert.equal(store.updated[0].endpoint, 'ep1');
  });

  test('does not send when the user has no overdue items', async () => {
    stubWebPush(async () => { throw new Error('should not be called'); });

    const store = fakeStore([{ userId: 'u1', endpoint: 'ep1', p256dh: 'k', auth: 'a', lastDigestAt: 0 }]);
    store.setUser('u1', { id: 'u1', username: 'PPG1', active: true });

    const patient = overduePatient('someone-else'); // assignedPg does not match this user
    const result = await runDigestPass(store, fakeConfig(), [patient]);

    assert.equal(result.sent, 0);
    assert.equal(store.updated.length, 0);
  });

  test('throttles: does not re-send within the minimum interval', async () => {
    stubWebPush(async () => { throw new Error('should not be called — still throttled'); });

    const recentlySent = Date.now() - 60_000; // 1 minute ago, well under the throttle window
    const store = fakeStore([{ userId: 'u1', endpoint: 'ep1', p256dh: 'k', auth: 'a', lastDigestAt: recentlySent }]);
    store.setUser('u1', { id: 'u1', username: 'PPG1', active: true });

    const result = await runDigestPass(store, fakeConfig(), [overduePatient('ppg1')]);
    assert.equal(result.sent, 0);
  });

  test('deletes the subscription on a 410 Gone response instead of retrying it', async () => {
    stubWebPush(async () => { const e = new Error('gone'); e.statusCode = 410; throw e; });

    const store = fakeStore([{ userId: 'u1', endpoint: 'ep1', p256dh: 'k', auth: 'a', lastDigestAt: 0 }]);
    store.setUser('u1', { id: 'u1', username: 'PPG1', active: true });

    const result = await runDigestPass(store, fakeConfig(), [overduePatient('ppg1')]);
    assert.equal(result.sent, 0);
    assert.deepEqual(store.deleted, ['ep1']);
  });

  test('leaves the subscription alone on a transient (non-410/404) failure', async () => {
    stubWebPush(async () => { throw new Error('temporary network blip'); });

    const store = fakeStore([{ userId: 'u1', endpoint: 'ep1', p256dh: 'k', auth: 'a', lastDigestAt: 0 }]);
    store.setUser('u1', { id: 'u1', username: 'PPG1', active: true });

    const result = await runDigestPass(store, fakeConfig(), [overduePatient('ppg1')]);
    assert.equal(result.sent, 0);
    assert.deepEqual(store.deleted, []);
  });

  test('skips a disabled user entirely', async () => {
    stubWebPush(async () => { throw new Error('should not be called for a disabled user'); });

    const store = fakeStore([{ userId: 'u1', endpoint: 'ep1', p256dh: 'k', auth: 'a', lastDigestAt: 0 }]);
    store.setUser('u1', { id: 'u1', username: 'PPG1', active: false });

    const result = await runDigestPass(store, fakeConfig(), [overduePatient('ppg1')]);
    assert.equal(result.sent, 0);
  });

  test('is a no-op with zero subscriptions (never touches web-push)', async () => {
    stubWebPush(async () => { throw new Error('should not be called'); });
    const store = fakeStore([]);
    const result = await runDigestPass(store, fakeConfig(), [overduePatient('ppg1')]);
    assert.deepEqual(result, { sent: 0, checked: 0 });
  });
});

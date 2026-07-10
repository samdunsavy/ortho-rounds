/* Push notification digests: a periodic, throttled "you have overdue
   milestones" ping per PG, sent only to users with a saved push
   subscription. Complications have no due-window concept yet, so v1
   covers overdue post-op milestones only. */

import { logWarn } from './logger.js';

const DIGEST_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours between digests per user

/**
 * Mirrors public/app.js's calcPOD() (app.js:1577-1583) and
 * public/milestones.js's isPostOpItemActive/isItemOverdue (milestones.js:269-286).
 * Deliberately duplicated, not imported — milestones.js/app.js are plain
 * browser globals, not ES modules, so they can't be shared with the server.
 * ANY future change to overdue semantics on the client must be mirrored here.
 */
function calcPod(surgeryDateISO){
  if(!surgeryDateISO) return null;
  const surg = new Date(surgeryDateISO + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - surg) / 86400000);
}

function getPatientPod(p){
  if(!p) return null;
  if((p.status === 'postop' || p.status === 'fordischarge') && p.surgeryDate) return calcPod(p.surgeryDate);
  if(p.status === 'conservative' && p.admissionDate) return calcPod(p.admissionDate);
  return null;
}

function countOverdueMilestones(p){
  const pod = getPatientPod(p);
  if(pod === null) return 0;
  let n = 0;
  for(const c of (p.postOpChecks || [])){
    if(!c || c.status !== 'pending') continue;
    if(c.duePodEnd == null) continue;
    if(pod > c.duePodEnd) n++;
  }
  return n;
}

function patientBelongsToUser(p, username){
  const assigned = (p.assignedPg || '').trim().toUpperCase();
  return assigned && assigned === username.trim().toUpperCase();
}

/**
 * Runs one digest pass: for every user with a saved push subscription,
 * count overdue milestones across their assigned active patients and, if
 * any exist and the per-user throttle has elapsed, send one summary push.
 */
export async function runDigestPass(store, config, activePatients){
  const subscriptions = await store.getAllSubscriptions();
  if(!subscriptions.length) return { sent: 0, checked: 0 };

  const subsByUser = new Map();
  for(const sub of subscriptions){
    if(!subsByUser.has(sub.userId)) subsByUser.set(sub.userId, []);
    subsByUser.get(sub.userId).push(sub);
  }

  const now = Date.now();
  let sent = 0;

  for(const [userId, userSubs] of subsByUser){
    const user = await store.getUserById(userId);
    if(!user || !user.active) continue;

    const overdueCount = activePatients.reduce((total, p) => {
      return total + (patientBelongsToUser(p, user.username) ? countOverdueMilestones(p) : 0);
    }, 0);
    if(!overdueCount) continue;

    for(const sub of userSubs){
      if(now - (sub.lastDigestAt || 0) < DIGEST_MIN_INTERVAL_MS) continue;
      try{
        const ok = await sendPush(config, sub, {
          title: 'Ortho Rounds',
          body: `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} across your patients`
        });
        if(ok){
          await store.updateSubscription(sub.endpoint, { lastDigestAt: now });
          sent++;
        }else{
          // 404/410 means the browser/OS discarded this subscription —
          // stop trying it.
          await store.deleteSubscription(sub.endpoint);
        }
      }catch(err){
        // Any other failure (network blip, transient 5xx from the push
        // service) — leave the subscription alone to retry next pass,
        // but don't let it take down the rest of this digest run.
        logWarn('push_send_failed', { userId, errMessage: err.message });
      }
    }
  }

  return { sent, checked: subsByUser.size };
}

/**
 * Sends one push message. Returns true on success, false if the
 * subscription itself is gone (should be deleted), and rethrows for any
 * other failure so a transient error doesn't silently drop a subscription.
 */
async function sendPush(config, sub, payload){
  // Dynamic import so installs that never configure push never load
  // web-push — mirrors storage.js's dynamic `import('mongodb')`.
  const webPush = (await import('web-push')).default;
  webPush.setVapidDetails('mailto:admin@ortho-rounds.local', config.vapidPublicKey, config.vapidPrivateKey);
  try{
    await webPush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  }catch(err){
    if(err.statusCode === 404 || err.statusCode === 410) return false;
    throw err;
  }
}

/** One activity per notice; durable create/send intent prevents blind replay. */
import crypto from 'node:crypto';
import { GraphService } from '../graph-service.js';
import { releasedBatch, batchFolderUrl } from './release-batches.js';
import * as email from '../../dataverse/adapters/email-activity.js';
import AlertService from '../alert-service.js';
import { getCycle, getRole, eligibleStaff } from './config.js';
import { cycleDates } from './calendar.js';
import { readCycle, mutateCycle } from './store.js';
import { linkedCycleCode } from '../../dataverse/adapters/operations-grant-cycle.js';
import { sourceDependencies, ordinary, requestLabels } from './source.js';
import { pacificTime, progress, cleanupStatus, fail } from './model.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const accepted = row => [3, 6, 7].includes(Number(row?.statuscode));
const DEFAULTS = { ...sourceDependencies, boardFolder: cycle => GraphService.boardFolder(cycle), getCycle, cycleDates, getRole, eligibleStaff, readCycle, mutateCycle, create: email.create, find: email.findByCorrelation, get: email.getById, send: email.send,
  now: () => new Date().toISOString(), alert: async (cycle, code) => AlertService.createAlert({ type: 'board_writeup_attention', severity: 'warning', source: 'board-writeups', title: 'Board writeup workflow needs attention', message: `${cycle}: ${code}`, autoResolveKey: `board-writeups:${cycle}:${code}` }) };
/** `dates` are the calendar dates; null (calendar unreadable) withholds the date-driven notices. */
export function noticeIntents(config, state, now, dates) {
  const local = pacificTime(now), p = progress(config, state), notices = [];
  if (local.hour === 9 && config.active && state.firstEventAt && Date.parse(state.firstEventAt) < new Date(now).setUTCMinutes(0, 0, 0) && !p.complete) notices.push({ key: `release:${local.date}`, kind: 'release' });
  if (local.hour === 9 && config.active && dates?.boardEnds && local.date > dates.boardEnds && !state.archiveStartedAt) notices.push({ key: `confirm:${local.date}`, kind: 'confirm' });
  if (local.hour === 9 && config.active && dates && cleanupStatus(dates, state, now).due) notices.push({ key: `cleanup:${local.date}`, kind: 'cleanup' });
  const failures = Object.entries(state.archives).filter(([, x]) => x.error).map(([id, x]) => `${id}:${x.error}:${x.failureAt}`).sort();
  if (failures.length) notices.push({ key: `failure:${crypto.createHash('sha256').update(failures.join('|')).digest('hex').slice(0, 24)}`, kind: 'failure' });
  if (state.discrepancy?.missing?.length && !state.archiveStartedAt) notices.push({ key: `missing:${state.discrepancy.signature}`, kind: 'missing' });
  if (state.archiveCompletedAt) notices.push({ key: `complete:${state.archiveCompletedAt}`, kind: 'complete' });
  if (config.active) {
    for (const batchId of Object.keys(state.releaseBatches || {})) {
      if (releasedBatch(state, batchId)) notices.push({ key: `president:${batchId}`, kind: 'president', batchId });
    }
  }
  return notices;
}
async function recipients(config, kind, d) {
  if (kind === 'cleanup') {
    const admin = await d.eligibleStaff(config.adminId, { admin: true, app: false });
    return { to: [admin.email], cc: [] };
  }
  if (kind === 'release') {
    const cso = await d.getRole('cso');
    const user = await d.eligibleStaff(cso.value?.systemUserId);
    return { to: [user.email], cc: [] };
  }
  const manager = await d.getRole('grantsManager');
  const [admin, gm] = await Promise.all([d.eligibleStaff(config.adminId, { admin: true, app: false }), d.eligibleStaff(manager.value?.systemUserId)]);
  return { to: [admin.email], cc: admin.email.toLowerCase() === gm.email.toLowerCase() ? [] : [gm.email] };
}
function copy(config, state, kind, dates) {
  if (kind === 'cleanup') {
    const origin = new URL(process.env.NEXTAUTH_URL || 'https://invalid.invalid');
    if (origin.protocol !== 'https:' || origin.hostname === 'invalid.invalid') fail('board_email_base_url_missing');
    const url = `${origin.origin}/board-cycle-setup?cycle=${encodeURIComponent(config.cycle)}#discussion-cleanup`;
    return { subject: `${config.cycle}: Staff-discussion cleanup reminder`, body: `<p>The ${esc(config.cycle)} Board meeting ended on ${esc(dates.boardEnds)}; the one-week grace period ended on ${esc(cleanupStatus(dates, state).dueDate)}.</p><p>Please review the staff-discussion materials for this cycle and carry out any cleanup you decide is appropriate. This reminder does not delete files or records.</p><p>When finished, choose <strong>Mark cleanup complete</strong> on the Board writeups page to stop these daily reminders.</p><p><a href="${esc(url)}">Review cleanup status</a></p>` };
  }
  const p = progress(config, state);
  const title = { missing: 'Missing Board writeups need investigation', release: 'Writeups awaiting release to the President', confirm: 'Confirm Board writeups are ready to archive', failure: 'Board writeup archival needs attention', complete: 'Board writeup archival complete' }[kind];
  const entries = kind === 'missing' ? state.discrepancy.missing.map(x => state.noticeLabels?.[x.requestId] ? `${x.number} — ${x.institution}: ${x.filename}` : 'A proposal needs data verification; open the workflow for details') : kind === 'release' ? p.outstanding.map(id => { const label = state.noticeLabels?.[id] || state.releases[id]?.source; return label ? `${label.number} — ${label.institution}; PD: ${label.leadPD || 'Not assigned'}; ${state.releases[id]?.state || 'not released'}` : 'Request details unavailable'; })
    : Object.entries(state.archives).filter(([, x]) => x.error || x.excluded).map(([id, x]) => `${state.noticeLabels?.[id]?.number || 'Proposal needs data verification'}: ${x.error || x.excluded.reason}`);
  const origin = new URL(process.env.NEXTAUTH_URL || 'https://invalid.invalid');
  if (origin.protocol !== 'https:' || origin.hostname === 'invalid.invalid') fail('board_email_base_url_missing');
  const url = `${origin.origin}/board-writeups?cycle=${encodeURIComponent(config.cycle)}`;
  const archived = Object.values(state.archives).filter(x => x.archivedAt).length;
  const excluded = Object.values(state.archives).filter(x => x.excluded).length;
  const original = state.configHistory.find(x => x.value?.rosterConfirmed)?.value?.requestIds || config.requestIds;
  const removedWithoutRelease = original.filter(id => !config.requestIds.includes(id) && !state.releases[id]?.releasedAt);
  const totalReleased = Object.values(state.releases).filter(x => x.releasedAt).length;
  const completion = kind === 'complete' ? `<p>Original expected: ${original.length}; current expected: ${p.expected}; total released: ${totalReleased}; archived: ${archived}; excluded: ${excluded}.</p>${removedWithoutRelease.length ? `<p>Removed without release:</p><ul>${removedWithoutRelease.map(id => { const label = state.noticeLabels?.[id]; return `<li>${esc(label ? `${label.number} — ${label.institution}` : 'Proposal details unavailable; see setup history')}</li>`; }).join('')}</ul>` : ''}` : '';
  const changes = state.configHistory.filter(x => x.reason).map(x => x.reason);
  return { subject: `${config.cycle}: ${title}`, body: `<p>${esc(title)}</p><p>${p.released} of ${p.expected} expected writeups released. ${archived} archived; ${excluded} explicitly excluded.</p><p>Materials deadline: ${esc(dates.materialsDue || 'Not set')}</p>${entries.length ? `<ul>${entries.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${completion}${changes.length ? `<p>Roster corrections: ${changes.map(esc).join('; ')}</p>` : ''}<p><a href="${esc(url)}">Open Board writeups</a></p>` };
}
/** A Dynamics draft can be edited outside this workflow; verify the actual envelope. */
function assertPresidentActivity(row, activity) {
  if (row.kind !== 'president') return;
  const parties = activity?.email_activity_parties;
  const normalize = values => values.map(value => String(value || '').trim().toLowerCase()).sort();
  if (!Array.isArray(parties) || parties.some(party => ![1, 2, 3].includes(party.participationtypemask))
    || activity.subject !== row.subject || activity.description !== row.body) fail('board_email_activity_changed');
  for (const [mask, expected] of [[1, [row.from]], [2, row.to], [3, row.cc]]) {
    const actual = parties.filter(party => party.participationtypemask === mask);
    if (JSON.stringify(normalize(actual.map(party => party.addressused))) !== JSON.stringify(normalize(expected))) fail('board_email_activity_changed');
    if (mask === 1 && actual[0]?._partyid_value?.toLowerCase() !== row.actingUserSystemId?.toLowerCase()) fail('board_email_activity_changed');
  }
}

/** Server-resolved parties and live eligibility, checked again immediately before send. */
async function presidentNotice(cycle, intent, state, d) {
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') fail('board_cso_mail_unavailable', 'CSO email attribution must be enabled before sending.');
  const batch = releasedBatch(state, intent.batchId);
  if (!batch || intent.key !== `president:${intent.batchId}`) fail('board_batch_not_ready');
  const [cso, president] = await Promise.all([d.getRole('cso'), d.getRole('president')]);
  if (!cso.value?.systemUserId || cso.value.systemUserId !== batch.actor.systemUserId) fail('board_batch_cso_changed', 'The approving CSO assignment changed. Investigate this notification.');
  const [sender, recipient] = await Promise.all([d.eligibleStaff(cso.value.systemUserId), d.eligibleStaff(president.value?.systemUserId, { app: false })]);
  if (sender.profileId !== batch.actor.profileId) fail('board_actor_mismatch');
  const folder = await d.boardFolder(cycle);
  const url = batchFolderUrl(cycle, batch, folder);
  const labels = [];
  for (const row of batch.releases) {
    const request = await d.getRequest(row.requestId);
    if (!ordinary(request, cycle)) fail('board_notice_request_ineligible');
    const metadata = await d.metadata(row.destination.driveId, row.destination.itemId, { siteId: row.destination.siteId });
    if (!metadata || metadata.parentReference?.id !== folder.folderId) fail('board_batch_file_unavailable');
    const label = requestLabels(request);
    labels.push(`${label.number} — ${label.institution}`);
  }
  return { from: sender.email, to: [recipient.email], cc: [], actingUserSystemId: cso.value.systemUserId,
    subject: `${cycle}: ${labels.length} Board writeup${labels.length === 1 ? '' : 's'} released`,
    body: `<p>The following proposal writeups have been released to the Board folder:</p><ul>${labels.map(label => `<li>${esc(label)}</li>`).join('')}</ul><p><a href="${esc(url)}">Open the ${esc(cycle)} Board folder</a></p><p>${esc(sender.name)}<br>Chief Scientific Officer</p>` };
}

export async function deliverNotice(cycle, intent, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const config = await d.getCycle(cycle);
  if (!config.value?.active) return;
  const dates = await d.cycleDates(cycle);
  const { state } = await d.readCycle(cycle);
  if (!noticeIntents(config.value, state, d.now(), dates).some(x => x.key === intent.key && x.kind === intent.kind)) return;
  if (state.emails[intent.key]?.acceptedAt) return;
  const batchNotice = intent.kind === 'president' ? await presidentNotice(cycle, intent, state, d) : null;
  const noticeLabels = {};
  for (const id of ['cleanup', 'president'].includes(intent.kind) ? [] : config.value.requestIds) {
    let request;
    try { request = await d.getRequest(id); } catch (error) { if (intent.kind === 'release') throw error; }
    if (intent.kind === 'release' && !ordinary(request, cycle)) fail('board_notice_request_ineligible');
    if (ordinary(request, intent.kind === 'release' ? cycle : linkedCycleCode(request))) noticeLabels[id] = requestLabels(request);
  }
  if (intent.kind === 'complete') {
    const original = state.configHistory.find(x => x.value?.rosterConfirmed)?.value?.requestIds || [];
    for (const id of original.filter(id => !config.value.requestIds.includes(id))) {
      let request;
      try { request = await d.getRequest(id); } catch { /* Omit unavailable historical labels; completion still sends. */ }
      if (ordinary(request, linkedCycleCode(request))) noticeLabels[id] = requestLabels(request);
    }
  }
  const distribution = batchNotice ? { to: batchNotice.to, cc: batchNotice.cc } : await recipients(config.value, intent.kind, d);
  const from = batchNotice?.from || String(process.env.NOTIFICATION_EMAIL_FROM || '').trim();
  if (!/@wmkeck\.org$/i.test(from)) fail('board_sender_unavailable');
  const token = crypto.randomUUID();
  const row = await d.mutateCycle(cycle, journal => {
    if (!noticeIntents(config.value, journal, d.now(), dates).some(x => x.key === intent.key && x.kind === intent.kind)) return null;
    let record = journal.emails[intent.key];
    if (record?.acceptedAt || record?.lease && Date.parse(record.lease.until) > Date.parse(d.now())) return null;
    if (!record) record = journal.emails[intent.key] = { ...(batchNotice || copy(config.value, { ...journal, noticeLabels }, intent.kind, dates)), ...distribution, from, kind: intent.kind, createStartedAt: null, sendStartedAt: null, activityId: null, acceptedAt: null };
    if (!record.createStartedAt) Object.assign(record, batchNotice || distribution);
    record.lease = { id: token, until: new Date(Date.parse(d.now()) + 300000).toISOString() };
    return structuredClone(record);
  });
  if (!row) return;
  const mutate = fn => d.mutateCycle(cycle, journal => {
    const record = journal.emails[intent.key];
    if (record?.lease?.id !== token || Date.parse(record.lease.until) <= Date.parse(d.now())) fail('board_email_lease_lost');
    return fn(record, journal);
  });
  const correlation = `board:${cycle}:${crypto.createHash('sha256').update(intent.key).digest('hex').slice(0, 32)}`;
  try {
    let activity = row.activityId ? await d.get(row.activityId) : null;
    if (!activity && row.createStartedAt) {
      const found = await d.find(correlation);
      if (found.length !== 1) fail('board_email_create_uncertain');
      activity = found[0];
    }
    if (!activity) {
      await mutate((record, journal) => {
        if (!noticeIntents(config.value, journal, d.now(), dates).some(x => x.key === intent.key && x.kind === intent.kind)) fail('board_notice_no_longer_due');
        record.createStartedAt = d.now();
      });
      const id = await d.create({ subject: row.subject, body: row.body, from: row.from, to: row.to, cc: row.cc, correlationKey: correlation, ...(row.kind === 'president' ? { actingUserSystemId: row.actingUserSystemId, noFallback: true } : {}) });
      await mutate(record => { record.activityId = id; });
      activity = await d.get(id);
    }
    assertPresidentActivity(row, activity);
    await mutate(record => { record.activityId = activity.activityid; });
    if (!accepted(activity)) {
      if (row.sendStartedAt || Number(activity.statuscode) !== 1) fail('board_email_send_uncertain');
      const freshConfig = await d.getCycle(cycle);
      if (freshConfig.revision !== config.revision || !freshConfig.value?.active) fail('board_notice_configuration_changed');
      const freshDates = await d.cycleDates(cycle);
      if (freshDates.boardEnds !== dates.boardEnds || freshDates.materialsDue !== dates.materialsDue) fail('board_notice_configuration_changed');
      if (row.kind === 'president') {
        const fresh = await presidentNotice(cycle, intent, (await d.readCycle(cycle)).state, d);
        for (const key of ['from', 'to', 'cc', 'actingUserSystemId', 'subject', 'body']) {
          if (JSON.stringify(fresh[key]) !== JSON.stringify(row[key])) fail('board_email_parties_or_content_changed');
        }
      } else {
        const freshRecipients = await recipients(config.value, intent.kind, d);
        if (JSON.stringify(freshRecipients) !== JSON.stringify({ to: row.to, cc: row.cc })) fail('board_email_recipients_changed');
      }
      if (row.kind === 'president') {
        const finalActivity = await d.get(activity.activityid);
        assertPresidentActivity(row, finalActivity);
        if (accepted(finalActivity)) {
          await mutate(record => { record.acceptedAt = d.now(); record.lease = null; record.error = null; });
          return;
        }
        if (Number(finalActivity.statuscode) !== 1) fail('board_email_send_uncertain');
      }
      await mutate((record, journal) => {
        if (!noticeIntents(config.value, journal, d.now(), dates).some(x => x.key === intent.key && x.kind === intent.kind)) fail('board_notice_no_longer_due');
        if (record.sendStartedAt) fail('board_email_send_uncertain');
        record.sendStartedAt = d.now();
      });
      try {
        if (row.kind === 'president') await d.send(activity.activityid, { actingUserSystemId: row.actingUserSystemId, noFallback: true });
        else await d.send(activity.activityid);
      }
      catch { if (!accepted(await d.get(activity.activityid))) fail('board_email_send_uncertain'); }
    }
    await mutate(record => { record.acceptedAt = d.now(); record.lease = null; record.error = null; });
  } catch (e) {
    await d.mutateCycle(cycle, journal => {
      const record = journal.emails[intent.key];
      if (record?.lease?.id === token) { record.error = e.code || 'board_email_failed'; record.lease = null; }
    });
    await d.alert(cycle, e.code || 'board_email_failed');
  }
}

/** Reconcile old uncertain activities without sending historical catch-up email. */
export async function reconcileNotices(cycle, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const { state } = await d.readCycle(cycle);
  for (const [key, row] of Object.entries(state.emails)) {
    if (row.acceptedAt || !row.createStartedAt || row.lease && Date.parse(row.lease.until) > Date.parse(d.now())) continue;
    const correlation = `board:${cycle}:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
    const found = row.activityId ? [await d.get(row.activityId)] : await d.find(correlation);
    if (found.length !== 1 || !accepted(found[0])) continue;
    try { assertPresidentActivity(row, found[0]); }
    catch (error) {
      await d.mutateCycle(cycle, journal => {
        const current = journal.emails[key];
        if (current && !current.acceptedAt && !(current.lease && Date.parse(current.lease.until) > Date.parse(d.now()))) current.error = error.code;
      });
      await d.alert(cycle, error.code);
      continue;
    }
    await d.mutateCycle(cycle, journal => {
      const current = journal.emails[key];
      if (!current || current.acceptedAt || current.lease && Date.parse(current.lease.until) > Date.parse(d.now())) return;
      current.activityId = found[0].activityid; current.acceptedAt = d.now(); current.error = null; current.lease = null;
    });
  }
}

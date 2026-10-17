/** One activity per notice; durable create/send intent prevents blind replay. */
import crypto from 'node:crypto';
import * as email from '../../dataverse/adapters/email-activity.js';
import AlertService from '../alert-service.js';
import { getCycle, getRole, eligibleStaff } from './config.js';
import { readCycle, mutateCycle } from './store.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { sourceDependencies, ordinary, requestLabels } from './source.js';
import { pacificTime, progress, fail } from './model.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const accepted = row => [3, 6, 7].includes(Number(row?.statuscode));
const DEFAULTS = { ...sourceDependencies, getCycle, getRole, eligibleStaff, readCycle, mutateCycle, create: email.create, find: email.findByCorrelation, get: email.getById, send: email.send,
  now: () => new Date().toISOString(), alert: async (cycle, code) => AlertService.createAlert({ type: 'board_writeup_attention', severity: 'warning', source: 'board-writeups', title: 'Board writeup workflow needs attention', message: `${cycle}: ${code}`, autoResolveKey: `board-writeups:${cycle}:${code}` }) };
export function noticeIntents(config, state, now) {
  const local = pacificTime(now), p = progress(config, state), notices = [];
  if (local.hour === 9 && config.active && state.firstEventAt && Date.parse(state.firstEventAt) < new Date(now).setUTCMinutes(0, 0, 0) && !p.complete) notices.push({ key: `release:${local.date}`, kind: 'release' });
  if (local.hour === 9 && config.active && config.boardEnds && local.date > config.boardEnds && !state.archiveStartedAt) notices.push({ key: `confirm:${local.date}`, kind: 'confirm' });
  const failures = Object.entries(state.archives).filter(([, x]) => x.error).map(([id, x]) => `${id}:${x.error}:${x.failureAt}`).sort();
  if (failures.length) notices.push({ key: `failure:${crypto.createHash('sha256').update(failures.join('|')).digest('hex').slice(0, 24)}`, kind: 'failure' });
  if (state.discrepancy?.missing?.length && !state.archiveStartedAt) notices.push({ key: `missing:${state.discrepancy.signature}`, kind: 'missing' });
  if (state.archiveCompletedAt) notices.push({ key: `complete:${state.archiveCompletedAt}`, kind: 'complete' });
  return notices;
}
async function recipients(config, kind, d) {
  if (kind === 'release') {
    const cso = await d.getRole('cso');
    const user = await d.eligibleStaff(cso.value?.systemUserId);
    return { to: [user.email], cc: [] };
  }
  const manager = await d.getRole('grantsManager');
  const [admin, gm] = await Promise.all([d.eligibleStaff(config.adminId, { admin: true, app: false }), d.eligibleStaff(manager.value?.systemUserId)]);
  return { to: [admin.email], cc: admin.email.toLowerCase() === gm.email.toLowerCase() ? [] : [gm.email] };
}
function copy(config, state, kind) {
  const p = progress(config, state);
  const title = { missing: 'Missing Board writeups need investigation', release: 'Writeups awaiting release to Allison', confirm: 'Confirm Board writeups are ready to archive', failure: 'Board writeup archival needs attention', complete: 'Board writeup archival complete' }[kind];
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
  return { subject: `${config.cycle}: ${title}`, body: `<p>${esc(title)}</p><p>${p.released} of ${p.expected} expected writeups released. ${archived} archived; ${excluded} explicitly excluded.</p><p>Materials deadline: ${esc(config.materialsDue || 'Not set')}</p>${entries.length ? `<ul>${entries.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${completion}${changes.length ? `<p>Roster corrections: ${changes.map(esc).join('; ')}</p>` : ''}<p><a href="${esc(url)}">Open Board writeups</a></p>` };
}
export async function deliverNotice(cycle, intent, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const config = await d.getCycle(cycle);
  if (!config.value?.active) return;
  const { state } = await d.readCycle(cycle);
  if (!noticeIntents(config.value, state, d.now()).some(x => x.key === intent.key)) return;
  if (state.emails[intent.key]?.acceptedAt) return;
  const noticeLabels = {};
  for (const id of config.value.requestIds) {
    let request;
    try { request = await d.getRequest(id); } catch (error) { if (intent.kind === 'release') throw error; }
    if (intent.kind === 'release' && !ordinary(request, cycle)) fail('board_notice_request_ineligible');
    if (ordinary(request, intent.kind === 'release' ? cycle : meetingDateToCycleCode(request?.wmkf_meetingdate))) noticeLabels[id] = requestLabels(request);
  }
  if (intent.kind === 'complete') {
    const original = state.configHistory.find(x => x.value?.rosterConfirmed)?.value?.requestIds || [];
    for (const id of original.filter(id => !config.value.requestIds.includes(id))) {
      const request = await d.getRequest(id);
      if (ordinary(request, meetingDateToCycleCode(request?.wmkf_meetingdate))) noticeLabels[id] = requestLabels(request);
    }
  }
  const distribution = await recipients(config.value, intent.kind, d);
  const from = String(process.env.NOTIFICATION_EMAIL_FROM || '').trim();
  if (!/@wmkeck\.org$/i.test(from)) fail('board_sender_unavailable');
  const token = crypto.randomUUID();
  const row = await d.mutateCycle(cycle, journal => {
    if (!noticeIntents(config.value, journal, d.now()).some(x => x.key === intent.key)) return null;
    let record = journal.emails[intent.key];
    if (record?.acceptedAt || record?.lease && Date.parse(record.lease.until) > Date.parse(d.now())) return null;
    if (!record) record = journal.emails[intent.key] = { ...copy(config.value, { ...journal, noticeLabels }, intent.kind), ...distribution, from, kind: intent.kind, createStartedAt: null, sendStartedAt: null, activityId: null, acceptedAt: null };
    if (!record.createStartedAt) Object.assign(record, distribution);
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
        if (!noticeIntents(config.value, journal, d.now()).some(x => x.key === intent.key)) fail('board_notice_no_longer_due');
        record.createStartedAt = d.now();
      });
      const id = await d.create({ subject: row.subject, body: row.body, from: row.from, to: row.to, cc: row.cc, correlationKey: correlation });
      await mutate(record => { record.activityId = id; });
      activity = await d.get(id);
    }
    await mutate(record => { record.activityId = activity.activityid; });
    if (!accepted(activity)) {
      if (row.sendStartedAt || Number(activity.statuscode) !== 1) fail('board_email_send_uncertain');
      const freshConfig = await d.getCycle(cycle);
      if (freshConfig.revision !== config.revision || !freshConfig.value?.active) fail('board_notice_configuration_changed');
      const freshRecipients = await recipients(config.value, intent.kind, d);
      if (JSON.stringify(freshRecipients) !== JSON.stringify({ to: row.to, cc: row.cc })) fail('board_email_recipients_changed');
      await mutate((record, journal) => {
        if (!noticeIntents(config.value, journal, d.now()).some(x => x.key === intent.key)) fail('board_notice_no_longer_due');
        if (record.sendStartedAt) fail('board_email_send_uncertain');
        record.sendStartedAt = d.now();
      });
      try { await d.send(activity.activityid); }
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
    await d.mutateCycle(cycle, journal => {
      const current = journal.emails[key];
      if (!current || current.acceptedAt || current.lease && Date.parse(current.lease.until) > Date.parse(d.now())) return;
      current.activityId = found[0].activityid; current.acceptedAt = d.now(); current.error = null; current.lease = null;
    });
  }
}

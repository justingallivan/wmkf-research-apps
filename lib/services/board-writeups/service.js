import { boardWorkEnabled } from './mode.js';
/** Explicit CSO approval, create-only delivery and cycle-level archive fencing. */
import crypto from 'node:crypto';
import { GraphService } from '../graph-service.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';
import { getCycle, boardActor } from './config.js';
import { cycleDates, cycleDatesOrError } from './calendar.js';
import { readCycle, mutateCycle, audit, firstEvent } from './store.js';
import { sourceFor, sourceMatches, approvedBytes, ordinary, sourceDependencies, requestLabels } from './source.js';
import { fail, guid, exact, uploadRefusal, MAX_BYTES, progress, cleanupStatus } from './model.js';
const DEFAULTS = { getCycle, cycleDates, boardActor, readCycle, mutateCycle, sourceFor, approvedBytes,
  assertWrite: () => GraphService.assertBoardWriteEnvironment(), session: (cycle, name) => GraphService.boardUploadSession(cycle, name),
  put: (...args) => GraphService.putUploadSessionChunk(...args), metadata: (...args) => GraphService.getFileMetadataById(...args), download: (...args) => GraphService.downloadFile(...args),
  assertBudget: () => {}, hash: hashGovernedDocxContent, now: () => new Date().toISOString(), ...sourceDependencies, requestLabels };
export async function setup(cycle, actor, action, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const [config, staff] = await Promise.all([d.getCycle(cycle), d.boardActor(actor)]);
  if (action === 'release' && !staff.canRelease) fail('board_release_forbidden', 'Only the configured CSO may release writeups.', 403);
  if (action === 'archive' && !staff.canArchive) fail('board_archive_forbidden', 'An administrator or Grants Manager is required.', 403);
  if (!staff.canRelease && !staff.canArchive) fail('board_access_denied', 'Board workflow access is required.', 403);
  if (!config.value) fail('board_cycle_unconfigured', 'Set up this cycle in Admin first.', 404);
  return { config, staff };
}
export async function dashboard(cycle, actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const { config, staff } = await setup(cycle, actor, 'read', d);
  const [{ state, revision }, dates] = await Promise.all([d.readCycle(cycle), cycleDatesOrError(cycle, d)]);
  const rows = [];
  for (const requestId of new Set([...config.value.requestIds, ...Object.keys(state.releases)])) {
    const expected = config.value.requestIds.includes(requestId);
    let labels = {};
    try { labels = requestLabels(await d.getRequest(requestId)); } catch { /* Keep unavailable requests in the denominator. */ }
    const raw = state.releases[requestId];
    const receipt = raw ? structuredClone(raw) : null;
    if (receipt && !staff.canRelease) delete receipt.source.webUrl;
    // Non-CSO archive operators need released files only, not an early draft's URL.
    if (!staff.canRelease || !expected) { rows.push({ requestId, expected, ...labels, receipt, archive: state.archives[requestId] || null }); continue; }
    try {
      const { source } = await d.sourceFor(cycle, requestId);
      rows.push({ requestId, expected, ...labels, source: source?.earlyDraft && !boardWorkEnabled() ? null : source, receipt, archive: state.archives[requestId] || null });
    } catch (e) { rows.push({ requestId, expected, ...labels, error: e.code || 'board_source_unavailable', receipt }); }
  }
  return { config: config.value, dates, configRevision: config.revision, revision, rows, progress: progress(config.value, state),
    firstEventAt: state.firstEventAt, archiveStartedAt: state.archiveStartedAt, archiveCompletedAt: state.archiveCompletedAt,
    canRelease: staff.canRelease && !state.archiveStartedAt, canArchive: staff.canArchive, isSuperuser: staff.isSuperuser,
    cleanup: { ...cleanupStatus(dates, state, d.now()), canComplete: staff.isSuperuser && cleanupStatus(dates, state, d.now()).due },
    events: state.events.map(event => ({ actorId: event.actorId, action: event.action, at: event.at,
      details: { requestId: event.details?.requestId, actorName: event.details?.actorName,
        reason: event.details?.reason, source: event.details?.source ? { versionId: event.details.source.versionId } : undefined } })), configHistory: state.configHistory, configPending: Boolean(state.configIntent) };
}
/** Record the administrator's completion decision; never deletes discussion data. */
export async function completeCleanup(cycle, actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const { staff } = await setup(cycle, actor, 'read', d);
  if (!staff.isSuperuser) fail('board_cleanup_forbidden', 'Only an administrator may mark cleanup complete.', 403);
  const dates = await d.cycleDates(cycle);
  return d.mutateCycle(cycle, state => {
    if (state.configIntent) fail('board_cycle_locked', 'Resolve the pending cycle setup save first.');
    if (state.cleanupCompletedAt) return cleanupStatus(dates, state, d.now());
    if (!cleanupStatus(dates, state, d.now()).due) fail('board_cleanup_not_due', 'Cleanup is available seven days after the Board meeting end date.');
    state.cleanupCompletedAt = d.now();
    state.cleanupCompletedBy = { systemUserId: staff.systemUserId, name: staff.name || 'Administrator' };
    audit(state, staff.systemUserId, 'discussion_cleanup_completed', { actorName: state.cleanupCompletedBy.name }, state.cleanupCompletedAt);
    return cleanupStatus(dates, state, d.now());
  });
}
export async function queueRelease(cycle, actor, selections, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  d.assertWrite();
  const { config, staff } = await setup(cycle, actor, 'release', d);
  if (!config.value.active || !config.value.rosterConfirmed) fail('board_cycle_inactive', 'Activate the confirmed cycle first.');
  if (!Array.isArray(selections) || !selections.length || selections.length > 100) fail('board_selection_invalid', 'Select between 1 and 100 writeups.', 400);
  const seen = new Set(), results = [];
  // Validate the entire envelope before committing any approvals.
  for (const selection of selections) {
    exact(selection, ['requestId', 'documentId', 'eTag', 'versionId', 'draftConfirmed']);
    const id = guid(selection.requestId);
    if (seen.has(id)) fail('board_selection_duplicate');
    seen.add(id);
  }
  // Resolve all sources before the single journal commit. A worker can never
  // observe a half-enqueued batch, even if this HTTP request stops early.
  const prepared = [];
  for (const selection of selections) {
    const id = guid(selection.requestId);
    try {
      if (!config.value.requestIds.includes(id)) fail('board_request_not_expected');
      const { source } = await d.sourceFor(cycle, id);
      if (!source || source.documentId !== selection.documentId || source.eTag !== selection.eTag || source.versionId !== selection.versionId) fail('board_source_changed', 'The writeup changed. Review and select it again.');
      if (source.earlyDraft && selection.draftConfirmed !== true) fail('board_draft_confirmation_required', 'Confirm release of this early draft.');
      prepared.push({ id, source });
    } catch (e) { prepared.push({ id, error: e }); }
  }
  const batchId = crypto.randomUUID();
  await d.mutateCycle(cycle, state => {
    const requestIds = [];
    for (const entry of prepared) {
      const { id, source } = entry;
      try {
        if (entry.error) throw entry.error;
        if (state.archiveStartedAt || state.configIntent) fail('board_cycle_locked');
        const previous = state.releases[id];
        if (previous?.releasedAt) { results.push({ requestId: id, status: 'released' }); continue; }
        if (previous && previous.state !== 'failed' && previous.state !== 'cancelled') { results.push({ requestId: id, status: previous.state }); continue; }
        if (previous?.uploadStartedAt) fail('board_upload_needs_investigation');
        state.releases[id] = { requestId: id, batchId, state: 'queued', actor: { profileId: actor.profileId, systemUserId: staff.systemUserId }, approvedAt: d.now(), actorName: staff.name || 'CSO', source, configRevision: config.revision, lease: null, uploadStartedAt: null, destination: null, releasedAt: null, error: null };
        requestIds.push(id);
        audit(state, staff.systemUserId, 'release_approved', { requestId: id, batchId, actorName: staff.name || 'CSO', source, earlyDraft: source.earlyDraft });
        results.push({ requestId: id, status: 'queued' });
      } catch (e) { results.push({ requestId: id, status: 'failed', code: e.code || 'board_release_failed', message: e.code === 'board_source_changed' ? 'The writeup changed. Review and select it again.' : 'This writeup could not be released. Review its status or ask an administrator.' }); }
    }
    if (requestIds.length) {
      state.releaseBatches ||= {};
      if (Object.keys(state.releaseBatches).length >= 1000) fail('board_batch_capacity', 'The cycle journal needs administrator attention.', 503);
      state.releaseBatches[batchId] = { requestIds, actor: { profileId: actor.profileId, systemUserId: staff.systemUserId }, createdAt: d.now() };
    }
  });
  return { results };
}
export function owned(state, requestId, lease, now) {
  const row = state.releases[requestId];
  if (!row || row.lease?.id !== lease || Date.parse(row.lease.until) <= Date.parse(now)) fail('board_lease_lost');
  return row;
}
export async function deliverRelease(cycle, requestId, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  d.assertWrite();
  const token = crypto.randomUUID();
  const row = await d.mutateCycle(cycle, state => {
    const item = state.releases[requestId];
    if (!item || item.releasedAt || state.archiveStartedAt || state.configIntent || item.state === 'cancelled' || item.state === 'held') return null;
    if (item.lease && Date.parse(item.lease.until) > Date.parse(d.now())) return null;
    item.lease = { id: token, until: new Date(Date.parse(d.now()) + 600000).toISOString() };
    return structuredClone(item);
  });
  if (!row) return { status: 'skipped', requestId };
  let refusedUpload = null;
  try {
    if (!row.uploadStartedAt) {
      const { config } = await setup(cycle, row.actor, 'release', d);
      if (!config.value.active || config.revision !== row.configRevision || !config.value.requestIds.includes(requestId)) fail('board_configuration_changed');
      const { source } = await d.sourceFor(cycle, requestId);
      if (!sourceMatches(source, row.source)) fail('board_source_changed');
      const bytes = await d.approvedBytes(row.source);
      const session = await d.session(cycle, row.source.filename);
      d.assertBudget();
      // Session creation sends no document bytes; all uncertain outcomes after this intent are held.
      await d.mutateCycle(cycle, state => {
        const item = owned(state, requestId, token, d.now());
        if (state.archiveStartedAt || item.uploadStartedAt) fail('board_upload_already_started');
        item.hash = bytes.hash; item.byteHash = bytes.byteHash; item.folder = session.folder; item.uploadStartedAt = d.now(); item.state = 'uploading';
      });
      row.uploadStartedAt = d.now();
      let result;
      try { result = await d.put(session.uploadUrl, { start: 0, bytes: bytes.buffer, total: bytes.buffer.length }); }
      catch (error) { refusedUpload = uploadRefusal(error, d.now()); throw error; }
      if (!result.item?.id) fail('board_upload_outcome_unknown');
      await d.mutateCycle(cycle, state => {
        const item = owned(state, requestId, token, d.now());
        item.destination = { driveId: session.folder.driveId, itemId: result.item.id, siteId: session.folder.siteId, webUrl: result.item.webUrl };
        item.state = 'validating';
      });
    }
    const current = (await d.readCycle(cycle)).state.releases[requestId];
    if (!current.destination) fail('board_upload_outcome_unknown');
    const meta = await d.metadata(current.destination.driveId, current.destination.itemId, { siteId: current.destination.siteId });
    if (!meta || meta.parentReference?.id !== current.folder.folderId || meta.size > MAX_BYTES) fail('board_delivery_identity_mismatch');
    const { buffer } = await d.download(current.destination.driveId, current.destination.itemId, { maxBytes: MAX_BYTES });
    const after = await d.metadata(current.destination.driveId, current.destination.itemId);
    if (!after || after.eTag !== meta.eTag || await d.hash(buffer) !== current.hash) fail('board_delivery_content_unverified');
    await d.mutateCycle(cycle, state => {
      const item = owned(state, requestId, token, d.now());
      item.releasedAt = d.now(); item.state = 'released'; item.lease = null; item.error = null;
      item.destination = { ...item.destination, webUrl: meta.webUrl, versionId: meta.versionId, eTag: meta.eTag };
      firstEvent(state, item.releasedAt);
      audit(state, item.actor.systemUserId, 'released', { requestId, destination: item.destination });
    });
    return { requestId, status: 'released' };
  } catch (e) {
    await d.mutateCycle(cycle, state => {
      const item = state.releases[requestId];
      if (item?.lease?.id !== token) return;
      if (refusedUpload && !item.destination) item.uploadRefusal = refusedUpload;
      item.lastHttpStatus = Number(e.status) || null;
      item.error = e.code || 'board_delivery_failed'; item.state = item.uploadStartedAt ? 'held' : 'failed'; item.lease = null;
      audit(state, row.actor.systemUserId, 'release_failed', { requestId, code: item.error });
    });
    return { requestId, status: 'failed', code: e.code || 'board_delivery_failed' };
  }
}

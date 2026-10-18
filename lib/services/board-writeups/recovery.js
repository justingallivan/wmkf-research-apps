/** Explicit administrator recovery; uncertain uploads are never sent again. */
import { GraphService } from '../graph-service.js';
import { setup } from './service.js';
import { readCycle, mutateCycle, audit } from './store.js';
import { sourceDependencies, approvedBytes } from './source.js';
import { fail, guid, exact } from './model.js';
const DEFAULTS = { readCycle, mutateCycle, ...sourceDependencies, approvedBytes, now: () => new Date().toISOString(), assertWrite: () => GraphService.assertBoardWriteEnvironment() };
export async function recover(cycle, actor, input, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  d.assertWrite();
  exact(input, ['requestId', 'operation', 'action', 'itemId', 'eTag', 'reason']);
  const id = guid(input.requestId);
  if (!['release', 'archive'].includes(input.operation) || !['retry', 'bind', 'refreeze', 'cancel', 'exclude'].includes(input.action)) fail('board_recovery_invalid');
  if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000) fail('board_recovery_reason', 'Explain the recovery.');
  const { staff } = await setup(cycle, actor, 'archive', d);
  const key = input.operation === 'release' ? 'releases' : 'archives';
  const { state } = await d.readCycle(cycle);
  const row = state[key][id];
  if (!row || row.releasedAt || row.archivedAt || row.excluded || !['held', 'failed'].includes(row.state)) fail('board_recovery_not_held');
  if (row.lease && Date.parse(row.lease.until) > Date.parse(d.now())) fail('board_recovery_busy');
  const provenRefusal = Boolean(row.uploadRefusal && !row.destination && [400, 401, 403, 409, 412, 413, 415, 422].includes(row.uploadRefusal.status));
  let destination = row.destination, source = row.source;
  if (input.action === 'exclude') {
    if (input.operation !== 'archive' || row.destination || row.uploadStartedAt && !provenRefusal) fail('board_archive_exclusion_unproven');
  } else if (input.action === 'cancel') {
    if (input.operation !== 'release' || row.uploadStartedAt && !provenRefusal) fail('board_recovery_cannot_cancel_upload');
  } else if (input.action === 'bind') {
    if (!row.uploadStartedAt || !row.folder || !row.hash || destination) fail('board_recovery_binding_invalid');
    if (typeof input.itemId !== 'string' || !input.itemId || input.itemId.length > 256) fail('board_recovery_identity_invalid');
    const meta = await d.metadata(row.folder.driveId, input.itemId);
    if (!meta || meta.parentReference?.id !== row.folder.folderId || meta.eTag !== input.eTag) fail('board_recovery_file_changed');
    // Full content proof is required; a matching name alone never authorizes adoption.
    const bytes = await d.approvedBytes({ ...meta, driveId: row.folder.driveId, itemId: input.itemId });
    if (bytes.hash !== row.hash) fail('board_recovery_content_mismatch', 'This file does not match the approved copy. Investigate before recovery.');
    destination = { siteId: row.folder.siteId, driveId: row.folder.driveId, itemId: input.itemId, webUrl: meta.webUrl };
  } else if (input.action === 'refreeze') {
    if (input.operation !== 'archive' || row.uploadStartedAt && !provenRefusal) fail('board_recovery_refreeze_forbidden');
    const meta = await d.metadata(source.driveId, source.itemId);
    if (!meta || meta.eTag !== input.eTag) fail('board_recovery_file_changed');
    source = { ...meta, driveId: source.driveId, itemId: source.itemId };
  } else if (row.uploadStartedAt && !destination && !provenRefusal) fail('board_recovery_requires_binding', 'Identify and verify the existing copy first. It will not be uploaded again.');
  if (input.operation === 'release' && !row.uploadStartedAt && input.action !== 'cancel') fail('board_recovery_cso_required', 'The CSO must review and release this writeup again.');
  return d.mutateCycle(cycle, journal => {
    const current = journal[key][id];
    if (JSON.stringify(current) !== JSON.stringify(row)) fail('board_recovery_changed');
    if (input.operation === 'release' && journal.archiveStartedAt) fail('board_archive_already_started');
    if (destination && Object.entries(journal[key]).some(([otherId, other]) => otherId !== id && other.destination?.itemId === destination.itemId && other.destination?.driveId === destination.driveId)) fail('board_recovery_already_bound');
    const priorUpload = { uploadStartedAt: row.uploadStartedAt, uploadRefusal: row.uploadRefusal, hash: row.hash, folder: row.folder };
    if (provenRefusal && ['cancel', 'retry', 'refreeze'].includes(input.action)) { current.uploadStartedAt = null; current.uploadRefusal = null; }
    current.destination = destination; current.source = source; current.state = input.action === 'cancel' ? 'cancelled' : 'queued'; current.error = null; current.lease = null;
    if (input.action === 'exclude') {
      current.excluded = { reason: input.reason.trim(), actorId: staff.systemUserId, at: d.now() }; current.state = 'excluded';
      journal.archiveManifest = journal.archiveManifest.map(entry => entry.requestId === id ? { ...entry, excluded: true } : entry);
      if (journal.archiveManifest.every(entry => journal.archives[entry.requestId]?.archivedAt || journal.archives[entry.requestId]?.excluded)) journal.archiveCompletedAt = d.now();
    }
    if (input.action === 'refreeze') journal.archiveManifest = journal.archiveManifest.map(entry => entry.requestId === id ? { ...entry, metadata: source, reconfirmedAt: d.now(), reconfirmedBy: staff.systemUserId } : entry);
    if (input.operation === 'archive') journal.archiveActor = { profileId: actor.profileId, systemUserId: staff.systemUserId };
    audit(journal, staff.systemUserId, 'recovery_requested', { requestId: id, operation: input.operation, action: input.action, reason: input.reason.trim(), priorUpload, previousSource: row.source, source, destination });
    return { requestId: id, status: current.state };
  });
}

/** Bounded candidate inspection for a human recovery decision, never auto-adoption. */
export async function inspectRecovery(cycle, actor, requestId, operation, overrides = {}) {
  const d = { ...DEFAULTS, boardChildren: cycle => GraphService.boardChildren(cycle), files: path => GraphService.listFiles('akoya_request', path, { maxFiles: 100, failOnTruncation: true }), ...overrides };
  await setup(cycle, actor, 'archive', d);
  if (!['release', 'archive'].includes(operation)) fail('board_recovery_invalid');
  const { state } = await d.readCycle(cycle);
  const row = state[operation === 'release' ? 'releases' : 'archives'][guid(requestId)];
  if (!row || !['held', 'failed'].includes(row.state)) fail('board_recovery_not_held');
  const provenRefusal = Boolean(row.uploadRefusal && !row.destination && [400, 401, 403, 409, 412, 413, 415, 422].includes(row.uploadRefusal.status));
  if (!row.uploadStartedAt || provenRefusal) {
    const metadata = operation === 'archive' ? await d.metadata(row.source.driveId, row.source.itemId) : null;
    return { candidates: [], canRetry: operation === 'archive', canRefreeze: operation === 'archive', canExclude: operation === 'archive', canCancel: operation === 'release', eTag: metadata?.eTag || null };
  }
  if (row.destination) return { candidates: [], canRetry: true, canRefreeze: false };
  const files = operation === 'release' ? (await d.boardChildren(cycle)).items.filter(x => x.file) : await d.files(row.folder.folderPath);
  const candidates = [];
  for (const file of files) {
    const metadata = await d.metadata(row.folder.driveId, file.id);
    if (metadata?.parentReference?.id === row.folder.folderId) candidates.push({ itemId: file.id, name: file.name, eTag: metadata.eTag, webUrl: metadata.webUrl });
  }
  return { candidates, canRetry: false, canRefreeze: false };
}

/** Admin/Grants Manager reconciliation and immutable request-folder Board archives. */
import crypto from 'node:crypto';
import { GraphService } from '../graph-service.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import * as documents from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as OP, REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE, FINAL_WRITEUP_CONTRACT } from '../../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { configuredSharePointTargetInfo } from '../sharepoint-target-registry.js';
import { setup } from './service.js';
import { getCycle, boardActor } from './config.js';
import { readCycle, mutateCycle, audit } from './store.js';
import { sourceDependencies, ordinary, approvedBytes } from './source.js';
import { fail, guid, exact, uploadRefusal, progress, MAX_BYTES } from './model.js';
const DEFAULTS = { getCycle, boardActor, readCycle, mutateCycle, ...sourceDependencies, approvedBytes,
  children: cycle => GraphService.boardChildren(cycle), assertWrite: () => GraphService.assertBoardWriteEnvironment(),
  buckets: (id, number) => getRequestSharePointBuckets(id, number, { requireResolvedParents: true, requireCompleteResults: true }),
  site: () => GraphService.getSiteId(), drive: siteId => GraphService.getDriveId('akoya_request', { siteId }),
  ensureFolder: (...args) => GraphService.ensureFolderPath(...args), session: (...args) => GraphService.createBrowserUploadSession(...args), put: (...args) => GraphService.putUploadSessionChunk(...args),
  findDocument: key => documents.findByGenerationKey(key), createDocument: (...args) => documents.create(...args),
  assertBudget: () => {}, schemaReady: () => process.env.BOARD_WRITEUP_SCHEMA_READY === 'on', now: () => new Date().toISOString() };
export async function reconcile(cycle, actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  await setup(cycle, actor, 'archive', d);
  const { state, revision } = await d.readCycle(cycle);
  const { folder, items } = await d.children(cycle);
  const expected = Object.values(state.releases).filter(x => x.releasedAt);
  const known = new Set(expected.map(x => x.destination.itemId));
  const rows = [];
  for (const release of expected) {
    const excluded = state.archives[release.requestId]?.excluded;
    const present = items.find(x => x.id === release.destination.itemId && x.file);
    let metadata = null;
    if (!excluded) metadata = await d.metadata(release.destination.driveId, release.destination.itemId, { siteId: release.destination.siteId });
    const status = excluded ? 'excluded' : present && metadata?.parentReference?.id === folder?.folderId ? 'present' : metadata ? 'moved' : 'missing';
    rows.push({ requestId: release.requestId, number: release.source.number, institution: release.source.institution, filename: release.source.filename, status, exclusion: excluded || null, metadata });
  }
  const missing = rows.filter(x => ['missing', 'moved'].includes(x.status)).map(({ requestId, number, institution, filename }) => ({ requestId, number, institution, filename }));
  const signature = crypto.createHash('sha256').update(JSON.stringify(missing)).digest('hex');
  let reportRevision = revision;
  if ((missing.length || state.discrepancy) && state.discrepancy?.signature !== signature) {
    reportRevision = await d.mutateCycle(cycle, (journal, lockedRevision) => {
      if (lockedRevision !== Number(revision)) fail('board_archive_view_changed');
      journal.discrepancy = { signature, missing, at: d.now() };
      return lockedRevision + 1;
    });
  }
  return { revision: reportRevision, rows, extras: items.filter(x => x.file && !known.has(x.id)).map(x => ({ itemId: x.id, name: x.name, webUrl: x.webUrl, eTag: x.eTag })), folder };
}
export async function resolveDiscrepancy(cycle, actor, input, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const { staff } = await setup(cycle, actor, 'archive', d);
  exact(input, ['requestId', 'reason', 'action', 'itemId', 'eTag', 'confirmed']);
  const id = guid(input.requestId);
  if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000) fail('board_resolution_reason', 'Explain this resolution.', 400);
  const { state: before } = await d.readCycle(cycle);
  const release = before.releases[id];
  if (!release?.releasedAt) fail('board_release_not_confirmed');
  let destination = null;
  if (input.action === 'reconnect') {
    const { folder, items } = await d.children(cycle);
    const item = items.find(x => x.id === input.itemId && x.file);
    if (!item || !folder) fail('board_replacement_not_in_folder');
    if (Object.values(before.releases).some(x => x.requestId !== id && x.destination?.itemId === item.id)) fail('board_replacement_already_bound');
    const metadata = await d.metadata(folder.driveId, item.id);
    if (!metadata?.eTag || metadata.eTag !== input.eTag) fail('board_replacement_changed');
    // Explicit human confirmation binds an edited restored copy; never automatic name adoption.
    if (input.confirmed !== true) fail('board_replacement_confirmation_required');
    const proof = await d.approvedBytes({ ...metadata, driveId: folder.driveId, itemId: item.id });
    destination = { contentHash: proof.hash, driveId: folder.driveId, itemId: item.id, siteId: folder.siteId, webUrl: metadata.webUrl, versionId: metadata.versionId, eTag: metadata.eTag };
  } else if (input.action !== 'exclude') fail('board_resolution_invalid');
  return d.mutateCycle(cycle, state => {
    if (state.archiveStartedAt) fail('board_archive_already_started');
    if (JSON.stringify(state.releases[id]?.destination) !== JSON.stringify(release.destination)) fail('board_resolution_changed');
    if (destination) {
      state.releases[id].destination = destination;
      delete state.archives[id];
    } else state.archives[id] = { excluded: { reason: input.reason.trim(), actorId: staff.systemUserId, at: d.now() } };
    audit(state, staff.systemUserId, input.action, { requestId: id, reason: input.reason, previous: release.destination, destination });
    return { requestId: id, status: input.action === 'exclude' ? 'excluded' : 'reconnected' };
  });
}
export async function startArchive(cycle, actor, expectedRevision, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  d.assertWrite();
  if (!d.schemaReady()) fail('board_archive_schema_not_ready', 'The Board document registry must be provisioned before archival.', 503);
  const { config, staff } = await setup(cycle, actor, 'archive', d);
  const report = await reconcile(cycle, actor, d);
  if (Number(expectedRevision) !== Number(report.revision)) fail('board_archive_view_changed', 'Check the files again before confirming.');
  if (report.rows.some(x => !['present', 'excluded'].includes(x.status)) || report.extras.length) fail('board_archive_discrepancies', 'Resolve missing or extra files before archival.');
  return d.mutateCycle(cycle, (state, revision) => {
    if (state.archiveStartedAt) return { startedAt: state.archiveStartedAt };
    if (revision !== Number(report.revision)) fail('board_archive_view_changed');
    if (state.configIntent || !progress(config.value, state).complete || Object.values(state.releases).some(x => !x.releasedAt && x.state !== 'cancelled')) fail('board_archive_pending_releases', 'Resolve outstanding releases before archival.');
    const actual = Object.values(state.releases).filter(x => x.releasedAt);
    if (actual.length !== report.rows.length || actual.some(x => !report.rows.some(y => y.requestId === x.requestId && (y.status === 'excluded' || y.metadata?.id === x.destination.itemId)))) fail('board_archive_view_changed');
    state.archiveStartedAt = d.now(); state.archiveActor = { profileId: actor.profileId, systemUserId: staff.systemUserId, name: staff.name }; state.archiveConfig = config.value;
    state.archiveManifest = report.rows.map(x => ({ requestId: x.requestId, excluded: x.status === 'excluded', metadata: x.metadata }));
    for (const entry of state.archiveManifest) {
      if (entry.excluded) continue;
      state.archives[entry.requestId] = { state: 'queued', source: { ...entry.metadata, itemId: entry.metadata.id }, uploadStartedAt: null, destination: null, lease: null, archivedAt: null, registryId: null, error: null };
    }
    if (state.archiveManifest.every(x => x.excluded)) state.archiveCompletedAt = d.now();
    audit(state, staff.systemUserId, 'archive_started', { requests: state.archiveManifest.map(x => x.requestId) });
    return { startedAt: state.archiveStartedAt };
  });
}
function owned(state, id, token, now) {
  const item = state.archives[id];
  if (!item || item.lease?.id !== token || Date.parse(item.lease.until) <= Date.parse(now)) fail('board_archive_lease_lost');
  return item;
}
export async function archiveOne(cycle, requestId, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  d.assertWrite();
  if (!d.schemaReady()) fail('board_archive_schema_not_ready');
  const token = crypto.randomUUID();
  const work = await d.mutateCycle(cycle, state => {
    const item = state.archives[requestId];
    if (!state.archiveStartedAt || !item || item.archivedAt || item.excluded || item.state === 'held' || item.lease && Date.parse(item.lease.until) > Date.parse(d.now())) return null;
    item.lease = { id: token, until: new Date(Date.parse(d.now()) + 600000).toISOString() };
    return structuredClone({ item, actor: state.archiveActor, release: state.releases[requestId] });
  });
  if (!work) return;
  let refusedUpload = null;
  try {
    await setup(cycle, work.actor, 'archive', d);
    const request = await d.getRequest(requestId);
    if (!ordinary(request, cycle)) fail('board_archive_request_changed');
    if (!work.item.uploadStartedAt) {
      const bytes = await d.approvedBytes(work.item.source);
      const buckets = (await d.buckets(requestId, request.akoya_requestnum)).filter(x => x.source === 'dynamics' && x.library.toLowerCase() === 'akoya_request');
      if (buckets.length !== 1 || !configuredSharePointTargetInfo().registered) fail('board_archive_target_invalid');
      const siteId = await d.site(), driveId = await d.drive(siteId);
      const folderPath = `${buckets[0].folder}/Board Milestones/${cycle}`;
      const folder = await d.ensureFolder('akoya_request', folderPath, { siteId, driveId });
      const name = `${cycle} - ${work.release.source.filename}`;
      const session = await d.session('akoya_request', folderPath, name, { conflictBehavior: 'fail', siteId, driveId });
      d.assertBudget();
      await d.mutateCycle(cycle, state => {
        const item = owned(state, requestId, token, d.now());
        if (item.uploadStartedAt) fail('board_archive_upload_started');
        item.uploadStartedAt = d.now(); item.hash = bytes.hash; item.folder = { siteId, driveId, folderId: folder.id, folderPath }; item.filename = name;
      });
      let result;
      try { result = await d.put(session.uploadUrl, { start: 0, bytes: bytes.buffer, total: bytes.buffer.length }); }
      catch (error) { refusedUpload = uploadRefusal(error, d.now()); throw error; }
      if (!result.item?.id) fail('board_archive_upload_unknown');
      await d.mutateCycle(cycle, state => { owned(state, requestId, token, d.now()).destination = { siteId, driveId, itemId: result.item.id }; });
    }
    const item = (await d.readCycle(cycle)).state.archives[requestId];
    if (!item.destination) fail('board_archive_upload_unknown');
    const meta = await d.metadata(item.destination.driveId, item.destination.itemId);
    if (!meta || meta.parentReference?.id !== item.folder.folderId) fail('board_archive_identity_mismatch');
    const { buffer } = await d.download(item.destination.driveId, item.destination.itemId, { maxBytes: MAX_BYTES });
    const after = await d.metadata(item.destination.driveId, item.destination.itemId);
    if (!after || meta.eTag !== after.eTag || await d.hash(buffer) !== item.hash) fail('board_archive_content_unverified');
    const key = `board-writeup:${cycle}:${requestId}`;
    let found = await d.findDocument(key);
    if (found.capped || found.records.length > 1) fail('board_archive_registry_ambiguous');
    if (!found.records.length) {
      await d.createDocument({
        wmkf_name: item.filename, 'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`, 'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${work.release.source.documentId})`,
        wmkf_artifacttype: TYPE.BOARD_WRITEUP, wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.BOARD_READY,
        wmkf_generationkey: key, wmkf_cyclecode: cycle, wmkf_producer: 'board-writeup-archive', wmkf_contenttype: FINAL_WRITEUP_CONTRACT.contentType,
        wmkf_sharepointsiteid: item.destination.siteId, wmkf_sharepointdriveid: item.destination.driveId, wmkf_sharepointitemid: item.destination.itemId,
        wmkf_sharepointweburl: meta.webUrl, wmkf_sharepointversionid: meta.versionId, wmkf_sharepointetag: meta.eTag, wmkf_sharepointfolderpath: item.folder.folderPath,
        wmkf_filename: item.filename, wmkf_filesize: meta.size, wmkf_contenthash: item.hash, wmkf_sourceversionid: work.release.source.versionId, wmkf_sourcecontenthash: work.release.hash,
      }, { actingUserSystemId: work.actor.systemUserId, actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED, actorContext: { operation: 'board-writeup-archive', requestId, operationId: key } });
      found = await d.findDocument(key);
    }
    const record = found.records?.[0];
    if (found.capped || found.records?.length !== 1 || record._wmkf_request_value?.toLowerCase() !== requestId || record.wmkf_artifacttype !== TYPE.BOARD_WRITEUP || record.wmkf_sharepointitemid !== item.destination.itemId || record.wmkf_sharepointdriveid !== item.destination.driveId || record.wmkf_operationstatus !== OP.READY) fail('board_archive_registry_unconfirmed');
    await d.mutateCycle(cycle, state => {
      const current = owned(state, requestId, token, d.now());
      current.archivedAt = d.now(); current.registryId = record.wmkf_requestdocumentid; current.destination.webUrl = meta.webUrl; current.state = 'archived'; current.lease = null; current.error = null;
      audit(state, work.actor.systemUserId, 'archived', { requestId, actorName: work.actor.name, registryId: current.registryId });
      if (state.archiveManifest.every(x => state.archives[x.requestId]?.archivedAt || state.archives[x.requestId]?.excluded)) state.archiveCompletedAt = d.now();
    });
  } catch (e) {
    await d.mutateCycle(cycle, state => {
      const item = state.archives[requestId];
      if (item?.lease?.id !== token) return;
      if (refusedUpload && !item.destination) item.uploadRefusal = refusedUpload;
      item.lastHttpStatus = Number(e.status) || null;
      item.state = 'held'; item.error = e.code || 'board_archive_failed'; item.lease = null; item.failureAt = d.now();
      audit(state, work.actor.systemUserId, 'archive_failed', { requestId, code: item.error });
    });
  }
}

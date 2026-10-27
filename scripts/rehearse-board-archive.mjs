/** Bounded operator rehearsal. No worker, mail, production cycle journal or cleanup.
 * Run with: node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-board-archive.mjs
 * plan --request-id GUID --actor-id GUID --env-file ABS_PATH --out ABS_PATH
 * seed|archive|verify --plan ABS_PATH [--approve PLAN_SHA256]
 * plan reads only; seed/archive require the displayed digest. No live action by default.
 * Writes additionally require DATAVERSE_PROD_WRITE_ACK="board-archive-rehearsal YYYY-MM-DD" (today UTC).
 * Receipt is local; uncertain writes are never automatically replayed. Keep artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isGuid } from '../lib/utils/guid.js';

export const CYCLE = 'J00';
export const EDIT_MARKER = 'REHEARSAL EDIT VERIFIED';
const DV = 'https://wmkf.crm.dynamics.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const hash = data => createHash('sha256').update(data).digest('hex');
export const planDigest = plan => hash(JSON.stringify(plan));
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function testRequestOnly(request, id) {
  return request?.akoya_requestid?.toLowerCase() === id.toLowerCase()
    && request.wmkf_istestrequest === true;
}
export function validatePlan(p) {
  check(p?.version === 1 && p.cycle === CYCLE && p.dataverse === DV, 'Invalid rehearsal plan');
  for (const id of [p.requestId, p.actorId, p.runId, p.sourceDocumentId]) check(isGuid(id), 'Invalid plan identity');
  check(/^\d{1,20}$/.test(p.requestNumber), 'Invalid test request number');
  check(p.requestFolder === `${p.requestNumber}_${p.requestId.replaceAll('-', '').toUpperCase()}`, 'Unexpected test request folder');
  check(p.boardFolder === `Board Materials/WMKF-Archive-Rehearsal-${p.runId}`, 'Unexpected source folder');
  check(p.archiveFolder === `${p.requestFolder}/Board Milestones/${CYCLE}`, 'Unexpected archive folder');
  check(p.filename === `${p.requestNumber} - Archive Rehearsal - Writeup.docx`, 'Unexpected fixture filename');
  check(p.archiveFilename === `${CYCLE} - ${p.filename}`, 'Unexpected archive filename');
  check(p.sourceKey === `board-rehearsal-source:${p.runId}` && p.archiveKey === `board-writeup:${CYCLE}:${p.requestId}`, 'Unexpected registry keys');
  check(p.email === 'BLOCK ALL' && p.journal === 'LOCAL FILE ONLY', 'Unsafe rehearsal policy');
  check(path.isAbsolute(p.envFile), 'Absolute credential file required');
  return p;
}

/** Default deny all network mutations, including mail and batch APIs.
 * A wrapper may admit ONE exact Graph folder/upload operation, never mail.
 * No signed upload/download URL is printed or written to disk.
 */
export function installFetchFence({ tenant, requestId, sourceId, sourceKey, archiveKey, database = null, network = globalThis.fetch }) {
  const permits = new Map(), uploads = new Set(), downloads = new Set(), items = new Set();
  let writesEnabled = false;
  const block = () => { throw new Error('Rehearsal network fence: operation blocked (all email is blocked)'); };
  function permit(url, body) {
    const u = new URL(url);
    check(writesEnabled && u.origin === 'https://graph.microsoft.com'
      && /^\/v1\.0\/drives\//.test(u.pathname)
      && /(?:\/children|:\/createUploadSession)$/.test(u.pathname), 'Only scoped Graph creates can be permitted');
    permits.set(u.href, JSON.stringify(body));
  }
  async function guarded(input, init = {}) {
    check(typeof input === 'string' || input instanceof URL, 'Unexpected fetch input');
    const url = new URL(input), method = (init.method || 'GET').toUpperCase();
    if (url.protocol !== 'https:' || url.username || url.password || /(?:sendmail|sendemail|\/emails(?:\(|$)|\$batch)/i.test(decodeURIComponent(url.pathname))) block();
    let allowed = false;
    if (method === 'GET') {
      allowed = url.origin === DV || url.origin === 'https://graph.microsoft.com' || downloads.has(url.href);
      if (url.origin === 'https://graph.microsoft.com' && /\/content$/.test(url.pathname)) {
        allowed = items.has(decodeURIComponent(url.pathname).replace(/\/content$/, ''));
      }
    }
    if (method === 'POST' && url.href === `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`) {
      const scope = new URLSearchParams(String(init.body)).get('scope');
      allowed = [`${DV}/.default`, 'https://graph.microsoft.com/.default'].includes(scope);
    } else if (database && method === 'POST' && url.href === database.endpoint) {
      const body = JSON.parse(String(init.body));
      const query = typeof body.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : '';
      const profiles = 'SELECT id, azure_email, is_active FROM user_profiles ORDER BY CASE WHEN is_active = true THEN 0 ELSE 1 END, id';
      const admin = "SELECT p.id,p.is_active,EXISTS(SELECT 1 FROM dynamics_user_roles r WHERE r.user_profile_id=p.id AND r.role='superuser') AS superuser FROM user_profiles p WHERE p.id=$1";
      allowed = new Headers(init.headers).get('neon-connection-string') === database.connectionString
        && Object.keys(body).sort().join(',') === 'params,query' && Array.isArray(body.params)
        && ((query === profiles && body.params.length === 0)
          || (query === admin && body.params.length === 1 && /^[1-9]\d*$/.test(String(body.params[0]))));
    } else if (writesEnabled && method === 'POST' && permits.has(url.href)) {
      allowed = permits.get(url.href) === String(init.body); permits.delete(url.href);
    } else if (writesEnabled && method === 'PUT' && uploads.has(url.href)) {
      allowed = true; uploads.delete(url.href);
    } else if (writesEnabled && method === 'POST' && url.href === `${DV}/api/data/v9.2/wmkf_requestdocuments`) {
      const body = JSON.parse(String(init.body));
      allowed = body['wmkf_Request@odata.bind'] === `/akoya_requests(${requestId})`
        && ((body.wmkf_generationkey === sourceKey && body.wmkf_requestdocumentid === sourceId && body.wmkf_producer === 'board-archive-rehearsal')
          || (body.wmkf_generationkey === archiveKey && body['wmkf_SourceDocument@odata.bind'] === `/wmkf_requestdocuments(${sourceId})` && body.wmkf_producer === 'board-writeup-archive'));
      if (allowed) {
        // Consume the registry identity before sending: an uncertain response cannot replay.
        const key = `registry:${body.wmkf_generationkey}`;
        if (items.has(key)) block(); items.add(key);
      }
    }
    if (!allowed) block();
    const response = await network(input, { ...init, redirect: 'manual' });
    if (method === 'GET' && url.origin === 'https://graph.microsoft.com') {
      const itemKey = decodeURIComponent(url.pathname).replace(/\/content$/, '');
      if (items.has(itemKey)) {
        const location = response.headers.get('location');
        if (location) downloads.add(new URL(location).href);
        if (response.headers.get('content-type')?.includes('json') && response.ok) {
          const body = await response.clone().json();
          if (body['@microsoft.graph.downloadUrl']) downloads.add(new URL(body['@microsoft.graph.downloadUrl']).href);
        }
      }
    }
    return response;
  }
  globalThis.fetch = guarded;
  return {
    enableWrites: () => { writesEnabled = true; }, permit,
    upload: url => { const u = new URL(url); check(writesEnabled && u.protocol === 'https:' && u.hostname === 'appriver3651007194.sharepoint.com' && !u.username && !u.password, 'Unexpected upload destination'); uploads.add(u.href); },
    item: (drive, id) => items.add(`/v1.0/drives/${drive}/items/${id}`),
    restore: () => { globalThis.fetch = network; },
  };
}

function args(argv) {
  const [phase, ...rest] = argv, out = { phase };
  check(['plan', 'seed', 'archive', 'verify', 'diagnose-upload'].includes(phase), 'Choose plan, seed, archive, verify or diagnose-upload. No default execution.');
  for (let i = 0; i < rest.length; i += 2) {
    check(['--request-id', '--request-number', '--actor-id', '--actor-name', '--env-file', '--out', '--plan', '--approve'].includes(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--'), 'Invalid argument');
    check(!out[rest[i]], 'Duplicate argument'); out[rest[i]] = rest[i + 1];
  }
  return out;
}
function save(file, data, exclusive = false) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
}
export function actorSchemaSetting(value, requiresWrite) {
  if (requiresWrite) check(value === 'on', 'Explicit-actor schema must be verified and enabled before rehearsal writes');
  return value === 'on' ? 'on' : 'off';
}
async function runtime(envFile, p, requiresWrite = false) {
  check(!process.env.VERCEL_ENV, 'Run only from an owner local terminal, never a deployed worker');
  const env = parseEnv(fs.readFileSync(envFile, 'utf8'));
  // App credentials only, never model/agent credentials. Never modify the env file.
  for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) {
    check(env[key], `Missing ${key}`); process.env[key] = env[key];
  }
  process.env.DYNAMICS_URL = DV; process.env.DYNAMICS_SANDBOX_URL = DV;
  check(process.env.DATAVERSE_ALLOW_PROD_READS === 'yes', 'Owner must explicitly permit production reads');
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.BOARD_WRITEUP_SCHEMA_READY = 'on';
  process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY = actorSchemaSetting(
    process.env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY ?? env.REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY, requiresWrite);
  process.env.SHAREPOINT_SITE_URL = 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';
  for (const key of ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING']) if (env[key]) process.env[key] = env[key];
  check(env.POSTGRES_URL, 'Owner app database connection required for administrator verification');
  const { neonConfig } = await import('@neondatabase/serverless');
  const databaseUrl = new URL(env.POSTGRES_URL);
  const endpoint = typeof neonConfig.fetchEndpoint === 'function'
    ? neonConfig.fetchEndpoint(databaseUrl.hostname, databaseUrl.port || 5432) : neonConfig.fetchEndpoint;
  const database = { endpoint: new URL(endpoint).href, connectionString: env.POSTGRES_URL };
  const fence = installFetchFence({ database, tenant: env.DYNAMICS_TENANT_ID, requestId: p?.requestId, sourceId: p?.sourceDocumentId, sourceKey: p?.sourceKey, archiveKey: p?.archiveKey });
  const [graph, requests, docs, buckets, model, archive, source, reader, config] = await Promise.all([
    import('../lib/services/graph-service.js'), import('../lib/dataverse/adapters/grant-request.js'),
    import('../lib/dataverse/adapters/request-document.js'), import('../lib/utils/sharepoint-buckets.js'),
    import('../shared/config/requestDocument.js'),
    import('../lib/services/board-writeups/archive.js'), import('../lib/services/board-writeups/source.js'),
    import('../lib/services/board-writeups/reader.js'), import('../lib/services/board-writeups/config.js'),
  ]);
  return { G: graph.GraphService, requests, docs, buckets, model, archive, source, reader, config, fence };
}
async function resolveTargets(r, requestId, actorId) {
  check(isGuid(requestId) && isGuid(actorId), 'Explicit request/actor GUIDs required');
  const request = await r.requests.getById(requestId, { select: 'akoya_requestid,akoya_requestnum,wmkf_istestrequest,wmkf_testcreationrunid' });
  check(testRequestOnly(request, requestId), 'STOP: request is not explicitly marked as a test');
  const actor = await r.config.eligibleStaff(actorId, { admin: true });
  const list = (await r.buckets.getRequestSharePointBuckets(requestId, request.akoya_requestnum, { requireResolvedParents: true, requireCompleteResults: true }))
    .filter(b => b.source === 'dynamics' && b.library.toLowerCase() === 'akoya_request');
  const folder = `${request.akoya_requestnum}_${requestId.replaceAll('-', '').toUpperCase()}`;
  check(list.length === 1 && list[0].folder === folder, 'Ambiguous or unexpected test request folder');
  const siteId = await r.G.getSiteId(), driveId = await r.G.getDriveId('akoya_request', { siteId });
  const root = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodeURIComponent(folder)}`);
  check(root?.id && root.folder, 'Existing test request folder required');
  const { RESEARCH_BOARD_MATERIALS_TARGET: board } = await import('../lib/services/sharepoint-target-registry.js');
  const parent = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(board.driveId)}/items/${encodeURIComponent(board.folderId)}`);
  check(parent?.id === board.folderId && parent.webUrl === board.webUrl && parent.folder, 'Board root changed');
  return { request, actor, bucket: list[0], siteId, driveId, rootId: root.id, board };
}
export function scopedChildren(listing, folderId) {
  check(Array.isArray(listing?.value) && !listing['@odata.nextLink'] && listing.value.length <= 50, 'Incomplete isolated source listing');
  check(listing.value.every(item => item.parentReference?.id === folderId), 'Unexpected child parent');
  return { folder: { folderId }, items: listing.value };
}
async function graphCall(r, url, method = 'GET', body) {
  if (method !== 'GET') r.fence.permit(url, body);
  const response = await fetch(url, { method, headers: { ...r.G.buildHeaders(await r.G.getAccessToken()), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) {
    const provider = await response.json().catch(() => null);
    const code = /^[a-z0-9_.-]{1,100}$/i.test(provider?.error?.code || '') ? provider.error.code : 'unknown';
    const detail = String(provider?.error?.message || 'No provider detail').replace(/https?:\/\/\S+/gi, '[URL redacted]').replace(/[\x00-\x1f]/g, ' ').slice(0, 500);
    throw Object.assign(new Error(`Graph operation refused (${response.status}; ${code}): ${detail}`), { status: response.status, code });
  }
  return response.json();
}
async function childFolder(r, drive, parentId, name, createOnly = false) {
  const base = `${GRAPH}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(parentId)}`;
  if (!createOnly) {
    const existing = await graphCall(r, `${base}:/${encodeURIComponent(name)}`);
    if (existing) { check(existing.folder && existing.parentReference?.id === parentId, 'Folder identity changed'); return existing; }
  }
  const item = await graphCall(r, `${base}/children`, 'POST', { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
  check(item.folder && item.parentReference?.id === parentId, 'Created folder identity differs');
  return item;
}
async function uploadSession(r, drive, folderId, name) {
  const session = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/createUploadSession`, 'POST', { item: { name, '@microsoft.graph.conflictBehavior': 'fail' } });
  check(session.uploadUrl && session.expirationDateTime, 'Incomplete upload session');
  r.fence.upload(session.uploadUrl);
  return { uploadUrl: session.uploadUrl };
}

export async function resolvePlanIds(r, a) {
  check(Boolean(a['--request-id']) !== Boolean(a['--request-number']), 'Supply exactly one request GUID or number');
  check(Boolean(a['--actor-id']) !== Boolean(a['--actor-name']), 'Supply exactly one actor GUID or full name');
  const odata = await import('../lib/dataverse/core/odata.js');
  const uniqueId = (result, field) => {
    check(!result.capped && !result.hasMore && result.records?.length === 1, `Identity lookup for ${field} must return exactly one record (received ${result.records?.length ?? 'unknown'}; incomplete=${Boolean(result.capped || result.hasMore)})`);
    check(isGuid(result.records[0][field]), `Identity lookup for ${field} returned an invalid Dataverse GUID`);
    return result.records[0][field].toLowerCase();
  };
  let requestId = a['--request-id'], actorId = a['--actor-id'];
  if (!requestId) {
    check(/^\d{1,20}$/.test(a['--request-number']), 'Numeric request number required');
    requestId = uniqueId(await r.requests.queryRequests({ select: 'akoya_requestid', filter: odata.eq('akoya_requestnum', a['--request-number']), top: 2 }), 'akoya_requestid');
  }
  if (!actorId) {
    check(a['--actor-name'].trim().length > 0 && a['--actor-name'].length <= 150, 'Exact full staff name required');
    const users = r.users || await import('../lib/dataverse/adapters/system-user.js');
    actorId = uniqueId(await users.queryUsers({ select: 'systemuserid', filter: odata.and([odata.eq('fullname', a['--actor-name']), odata.eqRaw('isdisabled', false)]), top: 2 }), 'systemuserid');
  }
  check(isGuid(requestId) && isGuid(actorId), 'Valid request and actor identities required');
  return { requestId: requestId.toLowerCase(), actorId: actorId.toLowerCase() };
}

export async function withRehearsalContext(work) {
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  return bypassDynamicsRestrictions('isolated-board-archive-rehearsal', work);
}
export async function main(argv = process.argv.slice(2)) {
  return withRehearsalContext(() => run(argv));
}
async function run(argv) {
  const a = args(argv);
  if (a.phase === 'plan') {
    check(path.isAbsolute(a['--out'] || '') && path.isAbsolute(a['--env-file'] || ''), 'Absolute --out and --env-file required');
    const r = await runtime(a['--env-file']);
    try {
      const ids = await resolvePlanIds(r, a);
      const t = await resolveTargets(r, ids.requestId, ids.actorId);
      const runId = randomUUID(), requestId = t.request.akoya_requestid.toLowerCase();
      const p = validatePlan({ version: 1, dataverse: DV, cycle: CYCLE, runId, requestId, requestNumber: String(t.request.akoya_requestnum), actorId: ids.actorId,
        sourceDocumentId: randomUUID(), envFile: a['--env-file'], requestFolder: t.bucket.folder,
        siteId: t.siteId, driveId: t.driveId, requestFolderId: t.rootId, board: t.board,
        boardFolder: `Board Materials/WMKF-Archive-Rehearsal-${runId}`,
        archiveFolder: `${t.bucket.folder}/Board Milestones/${CYCLE}`,
        filename: `${t.request.akoya_requestnum} - Archive Rehearsal - Writeup.docx`,
        archiveFilename: `${CYCLE} - ${t.request.akoya_requestnum} - Archive Rehearsal - Writeup.docx`,
        sourceKey: `board-rehearsal-source:${runId}`, archiveKey: `board-writeup:${CYCLE}:${requestId}`, email: 'BLOCK ALL', journal: 'LOCAL FILE ONLY' });
      check((await r.docs.findByGenerationKey(p.archiveKey)).records.length === 0, 'A prior J00 archive exists for this test request; choose another test request');
      save(a['--out'], p, true);
      console.log(JSON.stringify({ plan: p, approve: planDigest(p), writes: 'NONE', next: 'Show this plan to Justin before seed. Do not start the production worker.' }, null, 2));
    } finally { r.fence.restore(); }
    return;
  }
  check(path.isAbsolute(a['--plan'] || ''), 'Absolute --plan required');
  const p = validatePlan(JSON.parse(fs.readFileSync(a['--plan'], 'utf8')));
  if (a.phase !== 'verify') check(a['--approve'] === planDigest(p), 'Exact approved plan digest required');
  const receiptFile = `${a['--plan']}.receipt.json`, lock = `${a['--plan']}.lock`;
  const fd = fs.openSync(lock, 'wx', 0o600);
  let r;
  try {
    const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : { digest: planDigest(p) };
    check(receipt.digest === planDigest(p), 'Plan changed since receipt');
    check(!receipt[`${a.phase}Started`], 'Phase already attempted. Inspect retained receipt; never blindly retry.');
    r = await runtime(p.envFile, p, ['seed', 'archive', 'diagnose-upload'].includes(a.phase));
    const t = await resolveTargets(r, p.requestId, p.actorId);
    check(String(t.request.akoya_requestnum) === p.requestNumber && t.bucket.folder === p.requestFolder && t.siteId === p.siteId && t.driveId === p.driveId && t.rootId === p.requestFolderId && JSON.stringify(t.board) === JSON.stringify(p.board), 'Approved targets changed');
    const { TYPE, OP, LIFE } = { TYPE: r.model.REQUEST_DOCUMENT_ARTIFACT_TYPE, OP: r.model.REQUEST_DOCUMENT_OPERATION_STATUS, LIFE: r.model.REQUEST_DOCUMENT_LIFECYCLE_STATE };
    const { hashGovernedDocxContent } = await import('../lib/services/documents/governed-docx-hash.js');
    if (['seed', 'archive', 'diagnose-upload'].includes(a.phase)) {
      const { assertDataverseOperationAllowed } = await import('../lib/dataverse/core/interlock.js');
      assertDataverseOperationAllowed({ url: `${DV}/api/data/v9.2/wmkf_requestdocuments`, method: 'POST', callerLabel: 'isolated-board-archive-rehearsal' });
    }
    if (a.phase === 'diagnose-upload') {
      check(receipt.seedStarted && receipt.sourceFolderId && receipt.originalHash && !receipt.sourceItemId && !receipt.seedComplete && !receipt.archiveStarted,
        'Diagnostic requires the retained pre-upload failed seed; no existing file can be retried');
      const isolated = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(p.board.driveId)}/items/${encodeURIComponent(p.board.folderId)}:/${encodeURIComponent(`WMKF-Archive-Rehearsal-${p.runId}`)}`);
      check(isolated?.id === receipt.sourceFolderId && isolated.folder && isolated.parentReference?.id === p.board.folderId, 'Diagnostic source folder differs');
      const listing = scopedChildren(await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(p.board.driveId)}/items/${encodeURIComponent(isolated.id)}/children?$top=50`), isolated.id);
      check(listing.items.length === 0, 'Diagnostic source folder is not empty; stop and inspect');
      receipt['diagnose-uploadStarted'] = new Date().toISOString(); save(receiptFile, receipt);
      r.fence.enableWrites();
      try {
        await uploadSession(r, p.board.driveId, isolated.id, p.filename);
        receipt.uploadDiagnostic = { status: 'session-accepted', fileBytesSent: 0 };
        console.log('Upload session accepted. No file bytes sent; no registry rows created. Keep the failed-seed receipt.');
      } catch (error) {
        receipt.uploadDiagnostic = { status: error.status || null, code: error.code || null, message: error.message, fileBytesSent: 0 };
        throw error;
      } finally { save(receiptFile, receipt); }
      return;
    }
    if (a.phase === 'seed') {
      check(!receipt.seedStarted, 'Seed already attempted');
      check((await r.docs.findByGenerationKey(p.sourceKey)).records.length === 0 && (await r.docs.findByGenerationKey(p.archiveKey)).records.length === 0, 'Registry collision');
      receipt.seedStarted = new Date().toISOString(); save(receiptFile, receipt);
      r.fence.enableWrites();
      const folder = await childFolder(r, p.board.driveId, p.board.folderId, `WMKF-Archive-Rehearsal-${p.runId}`, true);
      receipt.sourceFolderId = folder.id; save(receiptFile, receipt);
      const { Document, Packer, Paragraph } = await import('docx');
      const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('FICTIONAL ARCHIVAL REHEARSAL — NO PROPOSAL DATA'), new Paragraph(`Run ${p.runId}`), new Paragraph('Original rehearsal text.')] }] }));
      receipt.originalHash = await hashGovernedDocxContent(bytes); save(receiptFile, receipt);
      const session = await uploadSession(r, p.board.driveId, folder.id, p.filename);
      const item = (await r.G.putUploadSessionChunk(session.uploadUrl, { start: 0, bytes, total: bytes.length })).item;
      check(item?.id, 'Upload outcome unknown; stop and inspect');
      receipt.sourceItemId = item.id; save(receiptFile, receipt); r.fence.item(p.board.driveId, item.id);
      const metadata = await r.G.getFileMetadataById(p.board.driveId, item.id);
      check(metadata?.eTag && metadata.versionId && metadata.parentReference?.id === folder.id, 'Seed publication metadata incomplete');
      const read = await r.G.downloadFile(p.board.driveId, item.id, { maxBytes: 1024 * 1024 });
      check(await hashGovernedDocxContent(read.buffer) === receipt.originalHash, 'Seed readback differs');
      await r.docs.create({ wmkf_requestdocumentid: p.sourceDocumentId, wmkf_name: p.filename,
        'wmkf_Request@odata.bind': `/akoya_requests(${p.requestId})`, wmkf_artifacttype: TYPE.FINAL_WRITEUP, wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.REVIEW,
        wmkf_generationkey: p.sourceKey, wmkf_cyclecode: CYCLE, wmkf_producer: 'board-archive-rehearsal', wmkf_filename: p.filename,
        wmkf_sharepointsiteid: p.board.siteId, wmkf_sharepointdriveid: p.board.driveId, wmkf_sharepointitemid: item.id,
        wmkf_sharepointweburl: metadata.webUrl, wmkf_sharepointversionid: metadata.versionId, wmkf_sharepointetag: metadata.eTag,
        wmkf_sharepointfolderpath: p.boardFolder, wmkf_contenttype: r.model.FINAL_WRITEUP_CONTRACT.contentType, wmkf_filesize: metadata.size, wmkf_contenthash: receipt.originalHash },
      { actingUserSystemId: p.actorId, actorPolicy: 'required', actorContext: { operation: 'board-archive-rehearsal', requestId: p.requestId, operationId: p.sourceKey } });
      const source = await r.docs.findByGenerationKey(p.sourceKey);
      check(!source.capped && source.records.length === 1 && source.records[0].wmkf_requestdocumentid === p.sourceDocumentId, 'Source registry not verified');
      receipt.originalVersionId = metadata.versionId; receipt.sourceUrl = metadata.webUrl; receipt.seedComplete = true; save(receiptFile, receipt);
      console.log(JSON.stringify({ sourceUrl: receipt.sourceUrl, next: `Edit ONLY this fictional file in Word, append ${EDIT_MARKER}, save and close. Then ask to run archive.`, emails: 'BLOCKED' }, null, 2));
      return;
    }
    check(receipt.seedComplete && receipt.sourceItemId && receipt.originalVersionId, 'Verified seed required');
    const sourceFolder = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(p.board.driveId)}/items/${encodeURIComponent(p.board.folderId)}:/${encodeURIComponent(`WMKF-Archive-Rehearsal-${p.runId}`)}`);
    check(sourceFolder?.id === receipt.sourceFolderId && sourceFolder.folder && sourceFolder.parentReference?.id === p.board.folderId, 'Source folder no longer matches the approved path');
    r.fence.item(p.board.driveId, receipt.sourceItemId);
    if (a.phase === 'archive') {
      const registered = await r.docs.findByGenerationKey(p.sourceKey);
      check(!registered.capped && registered.records.length === 1 && registered.records[0].wmkf_requestdocumentid === p.sourceDocumentId && registered.records[0]._wmkf_request_value?.toLowerCase() === p.requestId && registered.records[0].wmkf_sharepointitemid === receipt.sourceItemId, 'Source registry changed');
      const source = await r.G.getFileMetadataById(p.board.driveId, receipt.sourceItemId);
      check(source?.parentReference?.id === receipt.sourceFolderId && source.name === p.filename, 'Source moved or renamed');
      const edited = await r.source.approvedBytes({ ...source, driveId: p.board.driveId, itemId: receipt.sourceItemId });
      check(edited.buffer.length <= 1024 * 1024, 'Fictional edit exceeds the one-MiB rehearsal cap');
      const JSZip = (await import('jszip')).default;
      const xml = await (await JSZip.loadAsync(edited.buffer)).file('word/document.xml').async('string');
      check(edited.hash !== receipt.originalHash && xml.replace(/<[^>]*>/g, '').includes(EDIT_MARKER), 'Saved rehearsal edit marker required');
      receipt.archiveStarted = new Date().toISOString(); save(receiptFile, receipt);
      const { emptyState } = await import('../lib/services/board-writeups/store.js');
      const state = emptyState(); let revision = 0;
      const actor = { profileId: t.actor.profileId, systemUserId: p.actorId };
      state.releases[p.requestId] = { requestId: p.requestId, releasedAt: receipt.seedStarted, source: { number: p.requestNumber, institution: 'Archive Rehearsal', filename: p.filename, documentId: p.sourceDocumentId, versionId: receipt.originalVersionId }, hash: receipt.originalHash,
        destination: { driveId: p.board.driveId, itemId: receipt.sourceItemId, siteId: p.board.siteId } };
      const localSave = () => { receipt.state = state; receipt.revision = revision; save(receiptFile, receipt); };
      const deps = {
        assertWrite: () => validatePlan(p), schemaReady: () => true,
        getCycle: async cycle => { check(cycle === CYCLE, 'Wrong cycle'); return { value: { cycle: CYCLE, active: true, rosterConfirmed: true, requestIds: [p.requestId] } }; },
        boardActor: async () => ({ ...await r.config.eligibleStaff(p.actorId, { admin: true }), canArchive: true, canRelease: false }),
        readCycle: async cycle => { check(cycle === CYCLE, 'Wrong journal'); return { state: structuredClone(state), revision }; },
        mutateCycle: async (cycle, fn) => { check(cycle === CYCLE, 'Wrong journal'); const next = structuredClone(state); const result = fn(next, revision); check(!result?.then, 'Async mutation refused'); Object.assign(state, next); revision++; localSave(); return result; },
        children: async () => {
          const listing = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(p.board.driveId)}/items/${encodeURIComponent(receipt.sourceFolderId)}/children?$top=50`);
          return scopedChildren(listing, receipt.sourceFolderId);
        },
        getRequest: async id => { check(id === p.requestId, 'Wrong request'); const row = await r.requests.getById(id, { select: 'akoya_requestid,wmkf_istestrequest' }); check(testRequestOnly(row, p.requestId), 'Test marker changed'); return row; },
        requestEligible: row => testRequestOnly(row, p.requestId),
        buckets: async id => { check(id === p.requestId, 'Wrong bucket'); return [t.bucket]; }, site: async () => p.siteId, drive: async () => p.driveId,
        ensureFolder: async (library, folder) => { check(library === 'akoya_request' && folder === p.archiveFolder, 'Wrong archive folder');
          const parent = await childFolder(r, p.driveId, p.requestFolderId, 'Board Milestones');
          return childFolder(r, p.driveId, parent.id, CYCLE); },
        session: async (library, folder, filename) => { check(library === 'akoya_request' && folder === p.archiveFolder && filename === p.archiveFilename, 'Wrong upload target');
          const destination = await graphCall(r, `${GRAPH}/drives/${encodeURIComponent(p.driveId)}/root:/${folder.split('/').map(encodeURIComponent).join('/')}`);
          return uploadSession(r, p.driveId, destination.id, filename); },
        put: async (...input) => { const result = await r.G.putUploadSessionChunk(...input); if (result.item?.id) r.fence.item(p.driveId, result.item.id); return result; },
      };
      r.fence.enableWrites();
      await r.archive.startArchive(CYCLE, actor, revision, deps);
      await r.archive.archiveOne(CYCLE, p.requestId, deps);
      localSave();
      check(state.archives[p.requestId]?.archivedAt && state.archiveCompletedAt, 'Archive held or incomplete; inspect local receipt, never retry automatically');
      receipt.editedHash = edited.hash; receipt.archiveComplete = true; save(receiptFile, receipt);
    }
    check(receipt.archiveComplete, 'Completed archive required');
    const entry = receipt.state.archives[p.requestId]; r.fence.item(p.driveId, entry.destination.itemId);
    const bytes = await r.G.downloadFile(p.driveId, entry.destination.itemId, { maxBytes: 1024 * 1024 });
    check(await hashGovernedDocxContent(bytes.buffer) === receipt.editedHash && receipt.editedHash !== receipt.originalHash, 'Edited contents not preserved');
    const refs = await r.reader.boardReferences(p.requestId);
    const reference = refs.find(ref => ref.documentId === entry.registryId && ref.cycle === CYCLE && ref.filename === p.archiveFilename);
    check(reference && reference.webUrl === entry.destination.webUrl, 'Board reference reader did not expose exact archive');
    receipt.verifiedAt = new Date().toISOString(); save(receiptFile, receipt);
    console.log(JSON.stringify({ result: 'PASS', archive: reference, emails: 'BLOCKED', journal: receiptFile,
      limits: 'Invokes real startArchive/archiveOne/adapter/reader, using a local journal and test-only eligibility. Does not exercise production scheduler, Postgres journal, dashboard auth or browser rendering. Artifacts retained; no cleanup.' }, null, 2));
  } finally { r?.fence.restore(); fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

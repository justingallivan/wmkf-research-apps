import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { installFetchFence, validatePlan, testRequestOnly, planDigest, scopedChildren, resolvePlanIds, actorSchemaSetting, withRehearsalContext } from '../../scripts/rehearse-board-archive.mjs';

const requestId = randomUUID(), sourceId = randomUUID(), runId = randomUUID(), actorId = randomUUID();
const filename = `000000 - Archive Rehearsal ${runId} - Writeup.docx`;
const plan = { version: 1, cycle: 'J00', dataverse: 'https://wmkf.crm.dynamics.com', requestId, sourceDocumentId: sourceId, runId, actorId, requestNumber: '000000', requestFolder: `000000_${requestId.replaceAll('-', '').toUpperCase()}`,
  boardFolder: `Board Materials/WMKF-Archive-Rehearsal-${runId}`, archiveFolder: `000000_${requestId.replaceAll('-', '').toUpperCase()}/Board Milestones/J00`, filename, archiveFilename: `J00 - ${filename}`,
  sourceKey: `board-rehearsal-source:${runId}`, archiveKey: `board-writeup:J00:${requestId}`, email: 'BLOCK ALL', journal: 'LOCAL FILE ONLY', envFile: '/private/tmp/fictional-env' };

test('manifest rejects D26, real-file names, alternate hosts, and email policy changes', () => {
  assert.equal(validatePlan(plan), plan);
  for (const patch of [{ cycle: 'D26' }, { boardFolder: 'Board Materials/D26' }, { archiveFolder: 'real/Board Milestones/D26' }, { filename: 'Real writeup.docx' }, { email: 'ALLOW' }, { journal: 'PRODUCTION DATABASE' }, { dataverse: 'https://example.com' }]) {
    assert.throws(() => validatePlan({ ...plan, ...patch }));
  }
  assert.notEqual(planDigest(plan), planDigest({ ...plan, actorId: randomUUID() }));
});

test('eligibility requires exact request and affirmative test marker', () => {
  assert.equal(testRequestOnly({ akoya_requestid: requestId, wmkf_istestrequest: true }, requestId), true);
  for (const marker of [false, null, undefined, 'true', 1]) assert.equal(testRequestOnly({ akoya_requestid: requestId, wmkf_istestrequest: marker }, requestId), false);
  assert.equal(testRequestOnly({ akoya_requestid: randomUUID(), wmkf_istestrequest: true }, requestId), false);
});

test('network fence blocks every mail surface, batch, settings, deletes, unplanned uploads and all plan-mode writes', async () => {
  const calls = [];
  const fence = installFetchFence({ tenant: 'tenant', requestId, sourceId, sourceKey: plan.sourceKey, archiveKey: plan.archiveKey,
    network: async (url, init) => { calls.push([url, init]); return new Response('{}', { headers: { 'content-type': 'application/json' } }); } });
  const forbidden = [
    ['https://graph.microsoft.com/v1.0/me/sendMail', 'POST'], ['https://graph.microsoft.com/v1.0/users/a/sendMail', 'POST'],
    ['https://wmkf.crm.dynamics.com/api/data/v9.2/SendEmail', 'POST'], ['https://wmkf.crm.dynamics.com/api/data/v9.2/emails', 'POST'],
    ['https://wmkf.crm.dynamics.com/api/data/v9.2/$batch', 'POST'], ['https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_settings', 'POST'],
    ['https://graph.microsoft.com/v1.0/drives/d/items/i', 'DELETE'], ['https://appriver3651007194.sharepoint.com/upload', 'PUT'],
    ['https://graph.microsoft.com/v1.0/drives/d/items/i/content', 'PUT'],
    ['https://wmkf.crm.dynamics.com/api/data/v9.2/akoya_requests(a)', 'PATCH'],
  ];
  try {
    await assert.rejects(fetch('https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_requestdocuments', { method: 'POST', body: JSON.stringify({ 'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`, wmkf_generationkey: plan.sourceKey, wmkf_requestdocumentid: sourceId, wmkf_producer: 'board-archive-rehearsal' }) }));
    fence.enableWrites();
    for (const [url, method] of forbidden) await assert.rejects(fetch(url, { method }), /blocked/);
    assert.equal(calls.length, 0);
    assert.throws(() => fence.permit(forbidden[0][0], {}));
    await assert.rejects(fetch('https://login.microsoftonline.com/tenant/oauth2/v2.0/token', { method: 'POST', body: 'scope=https://outlook.office.com/.default' }));
    await fetch('https://login.microsoftonline.com/tenant/oauth2/v2.0/token', { method: 'POST', body: 'scope=https://graph.microsoft.com/.default' });
    assert.equal(calls.length, 1);
  } finally { fence.restore(); }
});

test('scoped Graph create is exact-body, one-shot and cannot admit arbitrary upload host', async () => {
  let sent = 0;
  const fence = installFetchFence({ tenant: 'tenant', network: async () => { sent++; return new Response('{}'); } });
  const url = 'https://graph.microsoft.com/v1.0/drives/test/items/test/children', body = { name: `WMKF-Archive-Rehearsal-${runId}`, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' };
  try {
    assert.throws(() => fence.permit(url, body)); fence.enableWrites(); fence.permit(url, body);
    await assert.rejects(fetch(url, { method: 'POST', body: JSON.stringify({ ...body, name: 'D26' }) }));
    assert.equal(sent, 0);
    fence.permit(url, body); await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    await assert.rejects(fetch(url, { method: 'POST', body: JSON.stringify(body) }));
    assert.equal(sent, 1);
    assert.throws(() => fence.upload('https://example.com/upload'));
    const upload = 'https://appriver3651007194.sharepoint.com/fixture-upload'; fence.upload(upload);
    await fetch(upload, { method: 'PUT', body: 'fictional' });
    await assert.rejects(fetch(upload, { method: 'PUT', body: 'fictional' }));
    assert.equal(sent, 2);
  } finally { fence.restore(); }
});

test('registry writes cannot bind ordinary request, alter source lineage or replay a create', async () => {
  let sent = 0;
  const fence = installFetchFence({ tenant: 'tenant', requestId, sourceId, sourceKey: plan.sourceKey, archiveKey: plan.archiveKey, network: async () => { sent++; return new Response('{}'); } });
  const url = 'https://wmkf.crm.dynamics.com/api/data/v9.2/wmkf_requestdocuments';
  const source = { 'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`, wmkf_generationkey: plan.sourceKey, wmkf_requestdocumentid: sourceId, wmkf_producer: 'board-archive-rehearsal' };
  try {
    fence.enableWrites();
    await assert.rejects(fetch(url, { method: 'POST', body: JSON.stringify({ ...source, 'wmkf_Request@odata.bind': `/akoya_requests(${randomUUID()})` }) }));
    await fetch(url, { method: 'POST', body: JSON.stringify(source) });
    await assert.rejects(fetch(url, { method: 'POST', body: JSON.stringify(source) }));
    await assert.rejects(fetch(url, { method: 'POST', body: JSON.stringify({ ...source, wmkf_generationkey: plan.archiveKey, wmkf_producer: 'board-writeup-archive', 'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${randomUUID()})` }) }));
    assert.equal(sent, 1);
  } finally { fence.restore(); }
});


test('real startArchive accepts raw Graph file facets, rejects extra files, and refuses pagination', async () => {
  const { startArchive } = await import('../../lib/services/board-writeups/archive.js');
  const item = { id: 'fictional-item', name: filename, file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, parentReference: { id: 'fictional-folder' }, eTag: 'v2', publication: { versionId: '2.0' } };
  const metadata = { id: item.id, parentReference: item.parentReference, eTag: 'v2', versionId: '2.0' };
  let state, revision, listing;
  const reset = () => { revision = 0; listing = { value: [item] }; state = { releases: { [requestId]: { requestId, releasedAt: '2026-01-01', destination: { driveId: 'fictional-drive', itemId: item.id }, source: { filename } } }, archives: {}, events: [], configIntent: null }; };
  const deps = { assertWrite: () => {}, schemaReady: () => true,
    getCycle: async () => ({ value: { requestIds: [requestId], rosterConfirmed: true } }), boardActor: async () => ({ canArchive: true, systemUserId: actorId }),
    readCycle: async () => ({ state: structuredClone(state), revision }),
    mutateCycle: async (_cycle, fn) => { const next = structuredClone(state); const result = fn(next, revision); state = next; revision++; return result; },
    children: async () => scopedChildren(listing, 'fictional-folder'), metadata: async () => metadata, now: () => '2026-01-01T00:00:00Z',
  };
  reset();
  await startArchive('J00', { profileId: 'fictional-admin', systemUserId: actorId }, revision, deps);
  assert.equal(state.archiveManifest[0].metadata.versionId, '2.0');
  assert.equal(state.archives[requestId].source.itemId, item.id);
  reset(); listing.value.push({ ...item, id: 'unexpected-item' });
  await assert.rejects(startArchive('J00', { profileId: 'fictional-admin', systemUserId: actorId }, revision, deps), /Resolve missing or extra/);
  assert.equal(state.archiveStartedAt, undefined);
  reset(); listing['@odata.nextLink'] = 'https://graph.microsoft.com/next';
  await assert.rejects(startArchive('J00', { profileId: 'fictional-admin', systemUserId: actorId }, revision, deps), /Incomplete/);
  assert.equal(state.archiveStartedAt, undefined);
});


test('read-only identity lookup resolves exact request number and staff name, refusing ambiguity', async () => {
  const queries = [];
  const r = { requests: { queryRequests: async query => { queries.push(query); return { records: [{ akoya_requestid: requestId }] }; } },
    users: { queryUsers: async query => { queries.push(query); return { records: [{ systemuserid: actorId }] }; } } };
  const args = { '--request-number': '1003220', '--actor-name': 'Justin Gallivan' };
  assert.deepEqual(await resolvePlanIds(r, args), { requestId, actorId });
  assert.equal(queries[0].filter, "akoya_requestnum eq '1003220'");
  assert.equal(queries[1].filter, "fullname eq 'Justin Gallivan' and isdisabled eq false");
  assert.ok(queries.every(query => query.top === 2));
  r.requests.queryRequests = async () => ({ records: [{ akoya_requestid: requestId }, { akoya_requestid: randomUUID() }] });
  await assert.rejects(resolvePlanIds(r, args), /exactly one/);
  await assert.rejects(resolvePlanIds(r, { ...args, '--request-id': requestId }), /exactly one request/);
  r.requests.queryRequests = async () => ({ records: [{ akoya_requestid: requestId }] });
  r.users.queryUsers = async () => ({ capped: true, records: [{ systemuserid: actorId }] });
  await assert.rejects(resolvePlanIds(r, args), /exactly one/);
});


test('read-only planning tolerates absent actor flag; writes still fail closed', () => {
  for (const value of [undefined, '', 'off', 'true']) {
    assert.equal(actorSchemaSetting(value, false), 'off');
    assert.throws(() => actorSchemaSetting(value, true), /before rehearsal writes/);
  }
  assert.equal(actorSchemaSetting('on', false), 'on');
  assert.equal(actorSchemaSetting('on', true), 'on');
});


test('planning context survives awaits through real Dataverse query adapters', async () => {
  const { DynamicsService } = await import('../../lib/services/dynamics-service.js');
  const requests = await import('../../lib/dataverse/adapters/grant-request.js');
  const users = await import('../../lib/dataverse/adapters/system-user.js');
  const { getDynamicsContext } = await import('../../lib/services/dynamics-context.js');
  const previousFetch = globalThis.fetch, previousToken = DynamicsService.getAccessToken;
  const previousUrl = process.env.DYNAMICS_URL;
  process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  let reads = 0;
  DynamicsService.getAccessToken = async () => 'offline-fixture-token';
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET');
    const pathname = new URL(url).pathname;
    assert.ok(pathname.endsWith('/akoya_requests') || pathname.endsWith('/systemusers'));
    reads++;
    return new Response(JSON.stringify({ value: pathname.endsWith('/akoya_requests') ? [{ akoya_requestid: requestId }] : [{ systemuserid: actorId }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const before = getDynamicsContext();
    await withRehearsalContext(async () => {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(getDynamicsContext().requestId, 'isolated-board-archive-rehearsal');
      assert.deepEqual(await resolvePlanIds({ requests, users }, { '--request-number': '1003220', '--actor-name': 'Justin Gallivan' }), { requestId, actorId });
    });
    assert.equal(reads, 2);
    assert.equal(getDynamicsContext(), before);
  } finally {
    globalThis.fetch = previousFetch; DynamicsService.getAccessToken = previousToken;
    if (previousUrl === undefined) delete process.env.DYNAMICS_URL; else process.env.DYNAMICS_URL = previousUrl;
  }
});


test('identity and plan validation accept Dataverse GUIDs outside UUID version 1-5', async () => {
  const dataverseId = '4bfb6e40-678f-f111-8076-7ced8d3d15a6';
  const r = { requests: { queryRequests: async () => ({ records: [{ akoya_requestid: dataverseId }] }) },
    users: { queryUsers: async () => ({ records: [{ systemuserid: actorId }] }) } };
  assert.deepEqual(await resolvePlanIds(r, { '--request-number': '1003220', '--actor-name': 'Justin Gallivan' }), { requestId: dataverseId, actorId });
  const p = { ...plan, requestId: dataverseId, requestNumber: '1003220', requestFolder: `1003220_${dataverseId.replaceAll('-', '').toUpperCase()}`,
    archiveFolder: `1003220_${dataverseId.replaceAll('-', '').toUpperCase()}/Board Milestones/J00`,
    filename: `1003220 - Archive Rehearsal ${runId} - Writeup.docx`, archiveFilename: `J00 - 1003220 - Archive Rehearsal ${runId} - Writeup.docx`, archiveKey: `board-writeup:J00:${dataverseId}` };
  assert.equal(validatePlan(p), p);
  r.requests.queryRequests = async () => ({ records: [{ akoya_requestid: "not-a-guid')" }] });
  await assert.rejects(resolvePlanIds(r, { '--request-number': '1003220', '--actor-name': 'Justin Gallivan' }), /invalid Dataverse GUID/);
});

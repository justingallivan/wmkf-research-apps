#!/usr/bin/env node
/** Fictional D97 sentiment consumer fixture; default is read-only preflight.
 * No provider call or actual human assessment is represented. Profile 1 records
 * the operator's fixture installation only. Uses existing governed writers.
 * Shared SharePoint files are create-only, in a new clearly marked TEST folder.
 * A partial/ambiguous receipt stops execution for inspection; never auto-cleanup.
 * Run: node scripts/setup-ranking-test-sentiment.mjs --env-file PATH [--execute|--recover].
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { RANKING_TEST_DATAVERSE as TARGET, RANKING_TEST_DATABASE as HOST,
  RANKING_TEST_REQUESTS, RANKING_TEST_RUN, RANKING_TEST_ORIGIN, RANKING_TEST_PROJECT, getRankingTestPolicy } from '../lib/services/proposal-ranking/test-policy.js';
const require = createRequire(import.meta.url);
const jiti = require('jiti')(import.meta.url, { interopDefault: false });
const REQUEST = RANKING_TEST_REQUESTS[0];
const ACTOR = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const RECEIPT = '/private/tmp/ranking-d97-sentiment-fixture.json';
const LIBRARY = 'akoya_request';
const SITE = 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';
const MODEL = 'fixture:no-model-no-human-assessment';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const recover = args[2] === '--recover';
const execute = args[2] === '--execute' || recover;
assert(args[0] === '--env-file' && args[1] && args.length === (execute ? 3 : 2), 'Use --env-file PATH [--execute|--recover]');
const env = parseEnv(fs.readFileSync(args[1], 'utf8'));
assert(env.POSTGRES_URL, 'Explicit test database required');
require('./bootstrap-meeting-transcription-test.js').validateTarget(env);
for (const [key, value] of Object.entries(env).filter(([k, v]) => ['POSTGRES_URL', 'DATABASE_URL'].includes(k) && v)) {
  const u = new URL(value);
  assert(['postgres:', 'postgresql:'].includes(u.protocol) && u.hostname === HOST && u.pathname === '/neondb'
    && (!u.port || u.port === '5432') && u.username && u.password
    && ['require', 'verify-full'].includes(u.searchParams.get('sslmode'))
    && [...u.searchParams.keys()].every(k => ['sslmode', 'channel_binding'].includes(k)), `Unexpected ${key} target`);
}
assert(env.DYNAMICS_URL === TARGET && env.NEXTAUTH_URL === RANKING_TEST_ORIGIN
  && env.DATAVERSE_TARGET_INTERLOCK === 'on' && env.DATAVERSE_DAL_ENFORCEMENT === 'on'
  && env.DATAVERSE_ALLOW_PROD_READS === 'no', 'Dedicated sandbox target required');
const local = parseEnv(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8'));
Object.assign(process.env, env, { POSTGRES_URL: env.POSTGRES_URL, DATABASE_URL: env.POSTGRES_URL,
  DYNAMICS_SANDBOX_URL: TARGET, SHAREPOINT_SITE_URL: SITE });
for (const key of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
  assert(local[key] && local[key] !== '[SENSITIVE]', `Missing app credential ${key}`);
  process.env[key] = local[key];
}
// Match the dedicated Preview identity contract locally; this configures only
// this process, never hosted flags. Request access is limited to this fixture;
// actual schema readiness flags remain from the explicit environment file.
for (const key of ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID', 'NEXTAUTH_SECRET']) {
  assert(local[key] && local[key] !== '[SENSITIVE]', `Missing authentication configuration ${key}`);
  process.env[key] = local[key];
}
Object.assign(process.env, { VERCEL_PROJECT_ID: RANKING_TEST_PROJECT, VERCEL_ENV: 'preview', NODE_ENV: 'production',
  PROPOSAL_RANKING_TEST_ENABLED: 'on', PROPOSAL_RANKING_WORKFLOW_V2: 'on', AUTH_REQUIRED: 'true',
  EMERGENCY_AUTH_BYPASS: 'false', MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: 'meeting-transcription-test',
  MEETING_TRANSCRIPTION_REHEARSAL_ENABLED: 'off', MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED: 'off',
  TRANSCRIPTION_PILOT_ENABLED: 'false', TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false',
  MEETING_TRACKER_TRANSCRIPTION_ACCESS: `test:${REQUEST}`,
  POST_PRESENTATION_MATERIALS_ACCESS: `test:${REQUEST}` });
assert(getRankingTestPolicy().enabled, 'Dedicated local test identity policy is not ready');
const { Client } = require('pg');
const db = new Client({ connectionString: env.POSTGRES_URL });
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
const dv = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });
const { GraphService: graph } = jiti('../lib/services/graph-service.js');
const docs = jiti('../lib/dataverse/adapters/request-document.js');
const visits = jiti('../lib/dataverse/adapters/site-visit.js');
const store = jiti('../lib/services/post-presentation-materials/discussion-sentiment-store.js');
const service = jiti('../lib/services/post-presentation-materials/discussion-sentiment-service.js');
const { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } = jiti('../lib/services/meeting-tracker-transcription/bundle.js');
const { buildStaffDiscussionTranscriptText } = jiti('../lib/services/meeting-tracker-transcription/presentation-boundary.js');
const { staffDiscussionTranscriptGenerationKey, POST_PRESENTATION_PRODUCER } = jiti('../lib/services/post-presentation-materials/presentation-transcript-binding.js');
const { withDalContext } = jiti('../lib/dataverse/core/context.js');
const { getDeliberationSentiments, hasMeetingTrackerAccess } = jiti('../lib/services/post-presentation-materials/discussion-sentiment-reader.js');
let receipt = fs.existsSync(RECEIPT) ? JSON.parse(fs.readFileSync(RECEIPT, 'utf8')) : null;
const save = () => {
  const temporary = `${RECEIPT}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, RECEIPT);
};
async function rows() {
  const r = await db.query('SELECT * FROM staff_discussion_sentiments WHERE request_id=$1', [REQUEST]);
  assert(r.rows.every(row => receipt?.runId === row.id && row.requested_by_profile_id === 1), 'Unowned sentiment run; refusing');
  return r.rows;
}
async function main() {
  await db.connect();
  const r = await dv.get(`/akoya_requests(${REQUEST})?$select=akoya_requestid,wmkf_istestrequest,wmkf_testcreationrunid,wmkf_meetingdate`);
  assert(r.ok && r.body.wmkf_istestrequest === true && r.body.wmkf_testcreationrunid === RANKING_TEST_RUN
    && r.body.wmkf_meetingdate?.startsWith('2097-12-01'), 'Exact owned D97 request required');
  const p = (await db.query('SELECT id,azure_id,dynamics_systemuser_id,is_active,needs_linking FROM user_profiles WHERE id=1')).rows[0];
  assert(p?.azure_id === OID && p.dynamics_systemuser_id === ACTOR && p.is_active && p.needs_linking === false, 'Fixture operator identity differs');
  const actor = await dv.get(`/systemusers(${ACTOR})?$select=systemuserid,azureactivedirectoryobjectid,isdisabled`);
  assert(actor.ok && actor.body.azureactivedirectoryobjectid === OID && actor.body.isdisabled === false, 'Inactive or mismatched actor');
  const artifactMetadata = await dv.get("/EntityDefinitions(LogicalName='wmkf_requestdocument')/Attributes(LogicalName='wmkf_artifacttype')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet");
  assert(artifactMetadata.ok && Array.isArray(artifactMetadata.body.OptionSet?.Options), 'Artifact metadata unavailable');
  const artifactOptions = new Map(artifactMetadata.body.OptionSet.Options.map(option =>
    [option.Value, option.Label?.LocalizedLabels?.find(label => label.LanguageCode === 1033)?.Label]));
  assert(artifactOptions.get(100000006) === 'Transcript'
    && artifactOptions.get(100000013) === 'Staff Discussion Transcript',
  'Sandbox artifact option contract missing: require Transcript 100000006 and Staff Discussion Transcript 100000013');
  const siteId = await graph.getSiteId();
  const driveId = await graph.getDriveId(LIBRARY, { siteId });
  if (receipt) assert(receipt.requestId === REQUEST && receipt.target === TARGET && receipt.databaseHost === HOST
    && receipt.siteId === siteId && receipt.driveId === driveId && receipt.model === MODEL, 'Receipt target mismatch');
  await rows();
  const existingDocs = await docs.findByRequest(REQUEST, { includeMeetingTranscriptBundle: true });
  const existingVisits = await visits.findActiveByRequest(REQUEST);
  assert(!existingDocs.capped && !existingVisits.capped, 'Incomplete fixture inventory');
  assert((existingDocs.records || []).every(row => receipt?.documentIds?.includes(row.wmkf_requestdocumentid)), 'Unowned request documents');
  assert((existingVisits.records || []).every(row => receipt?.visitId === row.activityid), 'Unowned active Site Visit');
  console.log(JSON.stringify({ discovery: 'read-only', siteId, driveId, existingDocuments: existingDocs.records.length, existingVisits: existingVisits.records.length }));
  const promptVersion = await service.loadPromptVersion(service.DISCUSSION_SENTIMENT_DEPENDENCIES);
  assert(Number.isInteger(promptVersion) && promptVersion > 0, 'Positive current prompt version required');
  assert(await hasMeetingTrackerAccess(1), 'Fixture operator requires live Meeting Tracker access');
  // Readiness checks are genuine environment gates, never dependency overrides.
  service.assertSentimentEnabled(REQUEST, 1, ACTOR, service.DISCUSSION_SENTIMENT_DEPENDENCIES);
  console.log(JSON.stringify({ mode: execute ? 'execute' : 'preflight', requestId: REQUEST, target: TARGET,
    databaseHost: HOST, sharePointScope: 'shared', siteId, driveId, promptVersion,
    provenance: MODEL, existingReceipt: Boolean(receipt) }));
  if (!execute) return;
  if (recover) {
    await recoverExactFixture(existingDocs.records, existingVisits.records, promptVersion);
    return;
  }
  if (receipt) {
    assert(receipt.complete, 'Partial receipt: inspect exact recorded IDs; no automatic retry or cleanup');
    for (const file of Object.values(receipt.files)) await verifyFile(file);
    const accepted = (await rows())[0];
    assert(accepted?.accepted_at && !accepted.withdrawn_at && accepted.model === MODEL, 'Fixture acceptance changed');
    const current = await getDeliberationSentiments([REQUEST], { profileId: 1 });
    assert(current[REQUEST]?.status === 'current' && current[REQUEST].sentiment?.headline?.startsWith('TEST FIXTURE:'), 'Consumer does not show current fixture');
    console.log(JSON.stringify({ alreadyInstalled: true, consumerStatus: current[REQUEST].status, requestId: REQUEST }));
    return;
  }
  receipt = { version: 1, requestId: REQUEST, target: TARGET, databaseHost: HOST, siteId, driveId,
    model: MODEL, createdAt: new Date().toISOString(), fixtureId: crypto.randomUUID(),
    visitId: crypto.randomUUID(), revisionId: crypto.randomUUID(), runId: crypto.randomUUID(), documentIds: [], files: {} };
  receipt.folder = `TEST - Fictional Proposal Ranking D97/${receipt.fixtureId}`;
  fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
  await visits.create({ activityid: receipt.visitId, subject: 'TEST FIXTURE - fictional ranking discussion; no actual meeting',
    scheduledstart: '2097-12-01T18:00:00Z', scheduledend: '2097-12-01T18:30:00Z',
    'regardingobjectid_akoya_request_wmkf_sitevisit@odata.bind': `/akoya_requests(${REQUEST})` }, [], { actingUserSystemId: ACTOR });
  receipt.visitCreated = true; save();
  const identity = { requestId: REQUEST, siteVisitActivityId: receipt.visitId, revisionId: receipt.revisionId,
    operationId: receipt.fixtureId, sourceRevisionId: null, sourceProvenance: null, discussionAttribution: null,
    presentationEnd: { endMs: 10000, confirmedBy: 1, confirmedAt: receipt.createdAt } };
  const content = { text: '', utterances: [
    { speaker: 'A', start: 0, end: 10000, text: 'TEST FIXTURE. This fictional presentation describes an imaginary research proposal. No real meeting or recording occurred.' },
    { speaker: 'B', start: 10000, end: 20000, text: 'This fictional project has an interesting research question, but its sample size needs clarification.' },
    { speaker: 'C', start: 20000, end: 30000, text: 'I agree that the question is promising. The fictional team should clarify its recruitment plan.' },
  ] };
  const names = { A: 'Fictional Presenter', B: 'Ada Example (fictional)', C: 'Riley Example (fictional)' };
  const built = buildMeetingTranscriptFiles({ content, speakerNames: names, identity });
  await graph.ensureFolderPath(LIBRARY, receipt.folder, { siteId, driveId });
  for (const [role, file] of Object.entries(built.files)) receipt.files[role] = await upload(role, file);
  const discussionBytes = Buffer.from(`\uFEFF${buildStaffDiscussionTranscriptText(content, names, 10000)}`);
  receipt.files.discussion = await upload('discussion', { bytes: discussionBytes, sha256: digest(discussionBytes),
    filename: `TEST-fictional-discussion-${receipt.revisionId}.txt`, contentType: 'text/plain; charset=utf-8' });
  const manifestFiles = Object.fromEntries(['txt','source','vtt'].map(role => [role, descriptor(receipt.files[role])]));
  const manifest = buildMeetingTranscriptManifest({ identity, files: manifestFiles });
  for (const [role, artifactType] of [['txt', 100000006], ['discussion', 100000013]]) {
    const documentId = crypto.randomUUID();
    receipt.documentIds.push(documentId); save(); // journal before potentially ambiguous create
    await createFixtureDocument(role, artifactType, documentId, manifest);
  }
  await finishSentiment(promptVersion);
}
async function createFixtureDocument(role, artifactType, documentId, manifest = null) {
  const file = receipt.files[role];
  return docs.create({ wmkf_requestdocumentid: documentId, wmkf_name: `TEST FIXTURE - fictional ${role}`,
      'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST})`, wmkf_artifacttype: artifactType,
      wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000,
      wmkf_generationkey: role === 'discussion' ? staffDiscussionTranscriptGenerationKey({ requestId: REQUEST,
        sourceRevisionId: receipt.revisionId, presentationEndMs: 10000 }) : digest(Buffer.from(`fixture:${receipt.fixtureId}`)),
      wmkf_cyclecode: 'D97', wmkf_inputfingerprint: file.sha256, wmkf_claimtoken: receipt.fixtureId,
      wmkf_producer: POST_PRESENTATION_PRODUCER, wmkf_contenttype: file.contentType, wmkf_contenthash: file.sha256,
      wmkf_sharepointsiteid: receipt.siteId, wmkf_sharepointdriveid: receipt.driveId, wmkf_sharepointitemid: file.itemId,
      wmkf_sharepointweburl: file.webUrl, wmkf_sharepointversionid: file.versionId, wmkf_sharepointetag: file.eTag,
      wmkf_sharepointfolderpath: receipt.folder, wmkf_filename: file.filename, wmkf_filesize: file.size,
      wmkf_sharepointlastmodified: file.lastModified,
      ...(role === 'txt' ? { wmkf_transcriptbundlejson: JSON.stringify(manifest) } : {}),
    }, { actorPolicy: 'required', actorContext: { operation: 'ranking-test-sentiment-fixture', requestId: REQUEST,
      operationId: receipt.fixtureId }, actingUserSystemId: ACTOR });
}

/** One bounded recovery for the inspected October 13 option-13 failure only. */
async function recoverExactFixture(existingDocs, existingVisits, promptVersion) {
  assert(receipt && !receipt.complete && receipt.visitCreated && !receipt.uploadAttempt
    && !receipt.createdFilePendingVerification, 'Receipt is not the inspected partial state');
  assert(receipt.fixtureId === '40a936d5-40d1-4634-a24c-9caf8eaadffc'
    && receipt.visitId === '49b6ee7f-3d4c-4144-bd06-1f6294d87e2e'
    && receipt.revisionId === '9a317849-5d09-423d-aef9-d4512a033874'
    && receipt.runId === '3a0bf326-4217-43a7-a65c-f0ee07acd577'
    && receipt.folder === `TEST - Fictional Proposal Ranking D97/${receipt.fixtureId}`
    && JSON.stringify(receipt.documentIds) === JSON.stringify([
      '2c6e951d-9734-45a6-982f-988df24fbd96', 'ae7134ff-dceb-479a-a035-530c3d8ee058']),
  'Recovery is restricted to the exact inspected receipt');
  assert((await rows()).length === 0, 'Recovery requires the journaled sentiment run still absent');
  assert(existingVisits.length === 1 && existingVisits[0].activityid === receipt.visitId
    && existingVisits[0]._regardingobjectid_value === REQUEST
    && existingVisits[0].subject === 'TEST FIXTURE - fictional ranking discussion; no actual meeting', 'Site Visit changed');
  assert(existingDocs.length === 1 && existingDocs[0].wmkf_requestdocumentid === receipt.documentIds[0], 'Unexpected document state');
  const missing = await dv.get(`/wmkf_requestdocuments(${receipt.documentIds[1]})?$select=wmkf_requestdocumentid`);
  assert(missing.status === 404, 'Journaled discussion ID is not confirmed absent');
  const expectedHashes = {
    txt: '597a0d1d11bc174f680639abb343324373dbf914bd82b3be846cf94ae8b6a168',
    source: '0a2f616165c2a8cdcf1d80f078f28e8a2a9a2b7e794f72ae7eb4d48190f6d876',
    vtt: 'e0cfbaffb105ea27c80f85dca0553fd036b931dd51ddbed0fbc297a043fe62c8',
    discussion: '4e2f6eabc147c4292375ba03aba092c97e7ad9c2ac66d063d7c49b0df7d0e586',
  };
  assert(Object.keys(receipt.files).sort().join(',') === Object.keys(expectedHashes).sort().join(','), 'File inventory changed');
  for (const [role, file] of Object.entries(receipt.files)) {
    assert(file.sha256 === expectedHashes[role] && file.siteId === receipt.siteId && file.driveId === receipt.driveId,
      'Receipt file binding changed');
    await verifyFile(file);
  }
  const row = existingDocs[0], file = receipt.files.txt;
  assert(row._wmkf_request_value === REQUEST && row.wmkf_claimtoken === receipt.fixtureId
    && row.wmkf_artifacttype === 100000006 && row.wmkf_operationstatus === 100000001
    && row.wmkf_lifecyclestate === 100000000 && row.wmkf_producer === POST_PRESENTATION_PRODUCER
    && row.wmkf_generationkey === digest(Buffer.from(`fixture:${receipt.fixtureId}`))
    && row.wmkf_contenthash === file.sha256 && row.wmkf_sharepointsiteid === file.siteId
    && row.wmkf_sharepointdriveid === file.driveId && row.wmkf_sharepointitemid === file.itemId
    && row.wmkf_sharepointversionid === file.versionId && row.wmkf_sharepointetag === file.eTag,
  'Existing transcript differs from the inspected fixture');
  const expectedManifest = buildMeetingTranscriptManifest({ identity: {
    requestId: REQUEST, siteVisitActivityId: receipt.visitId, revisionId: receipt.revisionId,
    operationId: receipt.fixtureId, sourceRevisionId: null, sourceProvenance: null, discussionAttribution: null,
    presentationEnd: { endMs: 10000, confirmedBy: 1, confirmedAt: receipt.createdAt },
  }, files: Object.fromEntries(['txt','source','vtt'].map(role => [role, descriptor(receipt.files[role])])) });
  assert.deepEqual(JSON.parse(row.wmkf_transcriptbundlejson), expectedManifest, 'Existing transcript manifest changed');
  receipt.recoveryAttemptedAt = new Date().toISOString(); save();
  await createFixtureDocument('discussion', 100000013, receipt.documentIds[1]);
  receipt.discussionRecoveredAt = new Date().toISOString(); save();
  await finishSentiment(promptVersion);
}

async function finishSentiment(promptVersion) {
  assert((await rows()).length === 0, 'Sentiment run already exists; explicit state reconciliation required');
  const reserved = await store.reserveRun({ id: receipt.runId, requestId: REQUEST,
    sourceArtifactId: receipt.documentIds[1], sourceContentHash: receipt.files.discussion.sha256,
    promptName: 'meeting-transcript.staff-discussion-sentiment', profileId: 1 });
  assert(reserved.run, 'Sentiment reservation conflict');
  const record = service.validateSentimentOutput({ schemaVersion: 1, enthusiasm: 'moderate', reception: 'mixed',
    headline: 'TEST FIXTURE: fictional discussion; scripted acceptance, no model or human assessment.',
    supportPoints: [], concernPoints: [], disagreements: [], uncertainties: [] });
  assert(record.ok, 'Fixture shape invalid');
  assert(await store.completeRun({ id: receipt.runId, record: record.value,
    promptName: 'meeting-transcript.staff-discussion-sentiment', promptVersion, model: MODEL }), 'Fixture completion conflict');
  const beforeAcceptance = await rows();
  assert(beforeAcceptance.length === 1 && !beforeAcceptance[0].accepted_at, 'Acceptance state changed');
  await service.acceptDiscussionSentiment({ requestId: REQUEST, ownerProfileId: 1, runId: receipt.runId });
  receipt.acceptedAs = 'scripted fictional consumer fixture, not model output or actual human assessment'; save();
  const consumed = await getDeliberationSentiments([REQUEST], { profileId: 1 });
  assert(consumed[REQUEST]?.status === 'current'
    && consumed[REQUEST].sentiment?.headline === record.value.headline, 'Real consumer did not return current fixture');
  receipt.consumerReadback = consumed;
  receipt.complete = true; save();
  console.log(JSON.stringify({ fixtureInstalled: true, requestId: REQUEST, receipt: RECEIPT, provenance: MODEL }));
}
function descriptor(file) {
  return Object.fromEntries(['siteId','driveId','itemId','versionId','eTag','sha256','size','filename','contentType'].map(k => [k, file[k]]));
}
async function verifyFile(file) {
  const before = await graph.getFileMetadataById(file.driveId, file.itemId, { siteId: file.siteId });
  assert(before?.eTag === file.eTag && before.versionId === file.versionId && before.size === file.size, 'File identity changed');
  const downloaded = await graph.downloadFile(file.driveId, file.itemId, { maxBytes: 4_000_000 });
  assert(Buffer.isBuffer(downloaded.buffer) && digest(downloaded.buffer) === file.sha256, 'File bytes differ');
  const after = await graph.getFileMetadataById(file.driveId, file.itemId, { siteId: file.siteId });
  assert(after?.eTag === before.eTag && after.versionId === before.versionId, 'File changed during verification');
}
async function upload(role, file) {
  receipt.uploadAttempt = { role, filename: file.filename }; save();
  const result = await graph.uploadFile(LIBRARY, receipt.folder, file.filename, file.bytes, file.contentType,
    { conflictBehavior: 'fail', siteId: receipt.siteId, driveId: receipt.driveId,
      onItemCreated: created => { receipt.createdFilePendingVerification = created; save(); } });
  assert(result.siteId === receipt.siteId && result.driveId === receipt.driveId && result.size === file.bytes.length
    && result.versionId && result.eTag, 'Upload identity incomplete');
  const saved = { siteId: result.siteId, driveId: result.driveId, itemId: result.id, versionId: result.versionId,
    eTag: result.eTag, size: result.size, sha256: file.sha256, filename: file.filename, contentType: file.contentType,
    webUrl: result.webUrl, lastModified: result.lastModified };
  await verifyFile(saved);
  receipt.files[role] = saved; delete receipt.uploadAttempt; delete receipt.createdFilePendingVerification; save();
  return saved;
}
try { await withDalContext('ranking-test-sentiment-fixture', main); }
catch (error) {
  // Never print provider bodies, request headers, credentials, or generic message text.
  const code = String(error?.code || error?.name || 'Error').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  const platformCode = /\b0x[0-9a-f]{8}\b/i.exec(String(error?.message || ''))?.[0] || null;
  console.error(JSON.stringify({ fixtureStopped: true, code, platformCode,
    status: Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    assertion: error instanceof assert.AssertionError ? error.message : null,
    receiptExists: fs.existsSync(RECEIPT), lastJournaledDocument: receipt?.documentIds?.at(-1) || null,
    action: 'Inspect exact receipt state before retry; no automatic recovery or cleanup.' }));
  process.exitCode = 1;
}
finally { await db.end(); }

#!/usr/bin/env node

/**
 * Complete only the request-specific, synthetic inputs for the writeup
 * regeneration service rehearsal. The separate Test Request Factory command
 * owns Request/location creation. This helper is deliberately inert unless
 * --execute is supplied, and always revalidates the prepared Factory
 * manifest, receipt, registered Sandbox host, marker/run id, exact unique
 * Request folder, actor roster, and live ETag before its first write.
 *
 * This is fixture setup, not an API route/authentication test. It never
 * submits a review, starts a lifecycle, invokes a model, or sends a message;
 * the integration runner owns those service calls.
 * Run with `node --import ./scripts/lib/use-extensionless.mjs` so the
 * application's extensionless ESM imports resolve under the repository's
 * supported Node runtime.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { SANDBOX_HOSTS } from '../lib/dataverse/core/target-registry.js';
import * as grantRequestAdapter from '../lib/dataverse/adapters/grant-request.js';
import * as contactAdapter from '../lib/dataverse/adapters/contact.js';
import * as suggestionAdapter from '../lib/dataverse/adapters/reviewer-suggestion.js';
import * as potentialReviewerAdapter from '../lib/dataverse/adapters/potential-reviewer.js';
import * as siteVisitAdapter from '../lib/dataverse/adapters/site-visit.js';
import * as systemUserAdapter from '../lib/dataverse/adapters/system-user.js';
import { getRequestSharePointBuckets } from '../lib/utils/sharepoint-buckets.js';
import { GraphService } from '../lib/services/graph-service.js';
import { extractTextFromBuffer } from '../lib/utils/file-loader.js';
import { saveSiteVisitLogistics, SITE_VISIT_LOGISTICS_DEPENDENCIES } from '../lib/services/site-visit/logistics-service.js';
import { getSiteVisitRecipientDirectory, SITE_VISIT_RECIPIENT_DIRECTORY_DEPENDENCIES } from '../lib/services/site-visit/recipient-directory-service.js';
import { createReviewsSandboxDeps } from '../lib/services/test-requests/reviews-sandbox-deps.js';
import {
  buildSuggestionCreateBody,
  syntheticPersonProjection,
} from '../lib/services/reviewer-engagement/seed-synthetic-review.js';
import { isSyntheticReviewerRow } from '../lib/services/test-requests/isolation.js';
import { sha256 } from '../lib/services/test-requests/basic-clone-steps.js';
import { expectedRequestFolder } from '../lib/services/test-requests/sandbox-clone.js';
import { meetingDateToCycleCode } from '../lib/utils/cycle-code.js';
import { SITE_VISIT_FORMAT } from '../shared/config/siteVisit.js';
import { readScheduledPreparationStateStatusPairs } from '../shared/config/siteVisit.js';
import { PRE_SITE_VISIT_CONTRACT } from '../shared/config/requestDocument.js';
import { REVIEW_STATUS_MAP } from '../shared/config/reviewerLifecycle.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX_ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'akoya_requeststatus',
  'wmkf_istestrequest', 'wmkf_testcreationrunid', 'wmkf_meetingdate',
  '_wmkf_projectleader_value', '_wmkf_programdirector_value', '_wmkf_grantprogram_value',
].join(',');
const SOURCE_REVIEW_SELECT = [
  'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
  'wmkf_suggestionlabel', 'wmkf_programarea', 'wmkf_relevancescore', 'wmkf_matchreason',
  'wmkf_sources', 'wmkf_selected', 'wmkf_invited', 'wmkf_accepted', 'wmkf_declined',
  'wmkf_responsetype', 'wmkf_emailsentat', 'wmkf_responsereceivedat', 'wmkf_materialssentat',
  'wmkf_revieweraffiliation', 'wmkf_reviewerfirstname', 'wmkf_reviewerlastname',
  'wmkf_reviewernickname', 'wmkf_reviewertitle', 'wmkf_applicantdisposition',
  'wmkf_grantcyclecode', 'wmkf_reviewreceivedat', 'wmkf_reviewstatus',
].join(',');
const SOURCE_PERSON_SELECT = [
  'wmkf_potentialreviewersid', 'statecode', '_wmkf_contact_value', 'wmkf_firstname',
  'wmkf_lastname', 'wmkf_emailaddress', 'wmkf_areaofexpertise', 'wmkf_primaryaffiliation',
  'wmkf_academicrank', 'wmkf_primarydepartment', 'wmkf_maininstitution',
  'wmkf_issyntheticreviewer',
].join(',');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function option(name) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}
function outsideRepo(file, label) {
  if (!file || !path.isAbsolute(file)) throw new Error(`${label} must be an absolute path.`);
  const rel = path.relative(ROOT, path.resolve(file));
  if (rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) {
    throw new Error(`${label} must be outside the repository.`);
  }
}
function sameId(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
function appendJsonl(file, row) {
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
function sandboxFence() {
  const host = new URL(process.env.DYNAMICS_URL || '').hostname.toLowerCase();
  if (!SANDBOX_HOSTS.includes(host) || process.env.DYNAMICS_URL !== SANDBOX_ORIGIN
      || process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_ORIGIN) {
    throw new Error('Refusing fixture work: both Dynamics URLs must equal the registered Sandbox origin.');
  }
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on' || process.env.DATAVERSE_DAL_ENFORCEMENT !== 'on') {
    throw new Error('Refusing fixture work: target interlock and DAL enforcement must both be on.');
  }
  delete process.env.DATAVERSE_ALLOW_PROD_READS;
}

function makeSyntheticPdf(text) {
  const escaped = text.replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7e]/g, ' ');
  const stream = `BT /F1 11 Tf 50 760 Td 13 TL (${escaped.slice(0, 3500)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function assertFactoryPair(factory, receipt) {
  if (factory.kind !== 'test-request-sandbox-rehearsal-manifest/v3'
      || factory.target !== SANDBOX_ORIGIN || receipt.target !== SANDBOX_ORIGIN
      || !sameId(factory.values.requestId, receipt.requestId)
      || !sameId(factory.values.runId, receipt.runId)
      || !sameId(factory.values.locationId, receipt.locationId)
      || receipt.createAttempted !== true
      || receipt.verification?.ok !== true
      || (receipt.goverifyBypass && receipt.goverifyBypass.restoreVerified !== true)) {
    throw new Error('Factory manifest and successful receipt do not describe the same registered-Sandbox Request.');
  }
}

async function readSyntheticSourceSuggestionTemplate(sourceRequestId) {
  const rows = await suggestionAdapter.findByRequest(sourceRequestId, { selectedOnly: true, requireComplete: true });
  if (rows.length > 200) throw new Error('Source review roster exceeded the bounded limit.');
  const candidates = [...rows].sort((a, b) => String(a.wmkf_appreviewersuggestionid).localeCompare(String(b.wmkf_appreviewersuggestionid)));
  const owned = [];
  for (const candidate of candidates) {
    const suggestion = await suggestionAdapter.getByIdWithSelect(candidate.wmkf_appreviewersuggestionid, SOURCE_REVIEW_SELECT);
    if (!suggestion || !sameId(suggestion._wmkf_request_value, sourceRequestId)
        || suggestion.wmkf_selected !== true || suggestion.wmkf_accepted !== true
        || suggestion.wmkf_declined === true) continue;
    const person = await potentialReviewerAdapter.getByIdWithSelect(suggestion._wmkf_potentialreviewer_value, { select: SOURCE_PERSON_SELECT });
    if (person && isSyntheticReviewerRow(person) && person.statecode === 0 && !person._wmkf_contact_value) {
      owned.push({ suggestion, person });
    }
  }
  if (owned.length === 0) {
    throw new Error('No accepted selected suggestion is attached to an active contactless synthetic person for a supported seeder projection.');
  }
  // The source is only a synthetic field template. The destination projection
  // explicitly starts a new accepted-but-unreceived review, regardless of the
  // source suggestion's prior response/review history.
  return owned[0];
}

async function execute({ factory, receipt, staffing, actorIds, journalPath }) {
  sandboxFence();
  assertFactoryPair(factory, receipt);
  const requestId = factory.values.requestId;
  const sourceId = factory.source.requestId;
  const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!request || !sameId(request.akoya_requestid, requestId)
      || request.wmkf_istestrequest !== true || !sameId(request.wmkf_testcreationrunid, factory.values.runId)) {
    throw new Error('The Factory Request is absent or its test marker/run binding does not match the manifest.');
  }
  if (typeof request._etag !== 'string' || request._etag.length === 0) {
    throw new Error('The Factory Request lacks an ETag; refusing to patch fixture bindings without a concurrency fence.');
  }
  const expectedFolder = expectedRequestFolder(request.akoya_requestnum, requestId);
  const buckets = await getRequestSharePointBuckets(requestId, request.akoya_requestnum, {
    requireResolvedParents: true, requireCompleteResults: true,
  });
  const requestBuckets = buckets.filter((bucket) => bucket.source === 'dynamics');
  if (requestBuckets.length !== 1 || requestBuckets[0].library !== 'akoya_request'
      || requestBuckets[0].folder !== expectedFolder) {
    throw new Error('The Request does not have exactly one Factory-owned akoya_request folder at its expected path.');
  }
  const programId = staffing.matrixSetting.value.programs[0]?.grantProgramId;
  const reviewerIds = staffing.matrixSetting.value.programs[0]?.reviewerIds || [];
  const leadId = actorIds.leadProgramDirectorId;
  const colleagueId = actorIds.reviewingColleagueId;
  if (!programId || !sameId(reviewerIds[0], leadId) || !reviewerIds.some((id) => sameId(id, colleagueId))) {
    throw new Error('The selected actors do not match the reviewed single-Research staffing plan.');
  }
  const [lead, colleague, activePrograms, audiences] = await Promise.all([
    systemUserAdapter.getById(leadId), systemUserAdapter.getById(colleagueId),
    (await import('../lib/dataverse/adapters/grant-program.js')).listActive({ top: 100 }),
    (await import('../lib/services/final-writeup/matrix-audience-service.js')).resolveFinalWriteupMatrixAudiences(),
  ]);
  const activeProgram = activePrograms.records?.find((row) => sameId(row.wmkf_grantprogramid, programId));
  const resolvedProgram = audiences.programs?.find((row) => sameId(row.grantProgramId, programId));
  if (!lead || lead.isdisabled !== false || !colleague || colleague.isdisabled !== false
      || !activeProgram || activeProgram.wmkf_name !== 'Research'
      || !resolvedProgram || !resolvedProgram.reviewers.some((row) => sameId(row.reviewerId, leadId))
      || !resolvedProgram.reviewers.some((row) => sameId(row.reviewerId, colleagueId))) {
    throw new Error('Live Sandbox actor, active Research program, or resolved reviewer audience changed from the reviewed setup.');
  }
  const appDatabaseUrl = option('app-postgres-url');
  const parsedAppDatabase = new URL(appDatabaseUrl || '');
  if (parsedAppDatabase.hostname !== '127.0.0.1' || parsedAppDatabase.port !== '55439'
      || parsedAppDatabase.pathname !== '/writeup_regeneration_rehearsal') {
    throw new Error('The Site Visit profile lookup must use the dedicated loopback writeup-regeneration rehearsal database.');
  }
  const { Client } = await import('pg');
  const profileDb = new Client({ connectionString: appDatabaseUrl });
  await profileDb.connect();
  let profileRows;
  try {
    const query = await profileDb.query(
      'SELECT id, name, display_name, azure_email, dynamics_systemuser_id FROM user_profiles WHERE is_active = true AND dynamics_systemuser_id = $1', [leadId],
    );
    profileRows = query.rows;
  } finally {
    await profileDb.end();
  }
  if (profileRows.length !== 1 || !Number.isSafeInteger(Number(profileRows[0].id))) {
    throw new Error('The isolated app database must contain exactly one active profile mapped to the selected lead.');
  }
  const organizerProfileId = Number(profileRows[0].id);
  if (!sameId(profileRows[0].dynamics_systemuser_id, leadId)) {
    throw new Error('The isolated app profile mapping no longer matches the selected Sandbox lead.');
  }
  const profileEmail = String(profileRows[0].azure_email || '').trim().toLowerCase();
  const leadEmail = String(lead.internalemailaddress || '').trim().toLowerCase();
  if (!profileEmail || !leadEmail || profileEmail !== leadEmail) {
    throw new Error('The isolated app profile email does not exactly match the enabled Sandbox lead email.');
  }
  const graphSiteId = await GraphService.getSiteId();
  const graphDriveId = await GraphService.getDriveId('akoya_request');
  if (!sameId(graphSiteId, factory.expectedGraphSiteId) || !sameId(graphDriveId, factory.expectedGraphDriveId)) {
    throw new Error('The configured SharePoint site/drive changed from the prepared Factory manifest.');
  }
  const requestFolderParts = requestBuckets[0].folder.split('/').filter(Boolean);
  if (!requestFolderParts.length) throw new Error('The Factory Request folder path was empty.');
  const requestFolderName = requestFolderParts.pop();
  const requestFolderParent = requestFolderParts.join('/');
  const requestFolderMeta = await GraphService.getFileMetadataByPath('akoya_request', requestFolderParent, requestFolderName,
    { siteId: graphSiteId, driveId: graphDriveId });
  if (!requestFolderMeta?.id) throw new Error('The Factory-created Request folder is not readable at its exact path.');
  const writeupFolderPath = `${requestBuckets[0].folder}/${PRE_SITE_VISIT_CONTRACT.relativeFolder}`;
  const siteVisitPairs = readScheduledPreparationStateStatusPairs();
  if (!siteVisitPairs.some((pair) => pair.stateCode === 0 && pair.statusCode === 1 && pair.eligible)) {
    throw new Error('The reviewed Sandbox eligible Site Visit state/status pair 0/1 is no longer configured.');
  }
  if (process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY !== 'on') {
    throw new Error('Site Visit logistics schema readiness must be process-scoped on for this Sandbox rehearsal.');
  }
  const now = new Date().toISOString();
  const contactEmail = `writeup-regen-${factory.values.runId}@example.invalid`;
  const intent = {
    at: now, phase: 'fixture-completion-intent', target: SANDBOX_ORIGIN,
    requestId, requestNumber: request.akoya_requestnum, runId: factory.values.runId,
    locationId: factory.values.locationId, folderPath: requestBuckets[0].folder,
    programId, leadProgramDirectorId: leadId, reviewingColleagueId: colleagueId,
    contactEmail, expectedRequestEtag: request._etag || null,
  };
  const executeRequested = process.argv.includes('--execute');
  if (executeRequested) appendJsonl(journalPath, intent);

  const existingContact = await contactAdapter.findByEmail(contactEmail);
  if (existingContact) throw new Error('The run-specific synthetic PI Contact address already exists; refusing to adopt it.');
  const sourceReview = await readSyntheticSourceSuggestionTemplate(sourceId);
  const proposalPath = `${requestBuckets[0].folder}/AI Materials`;
  const proposalName = `ProposalNarrative_${request.akoya_requestnum}.pdf`;
  const narrative = [
    `Synthetic proposal narrative for Request ${request.akoya_requestnum}. This is a controlled rehearsal fixture, not applicant-submitted material.`,
    `Run: ${factory.values.runId}. The research program examines a clearly labeled hypothetical question and describes objectives, approach, expected outcomes, and limitations.`,
    'No real applicant, reviewer, or award information is included. The document exists only to exercise the application narrative extraction and governed writeup workflow.',
  ].join('\n\n');
  const bytes = makeSyntheticPdf(narrative);
  const text = await extractTextFromBuffer(bytes, proposalName, 'application/pdf');
  if (String(text || '').trim().length < 60) throw new Error('The synthetic PDF did not meet the narrative extractor minimum.');
  const plan = {
    mode: 'SANDBOX_FIXTURE_COMPLETION', target: SANDBOX_ORIGIN, requestId,
    requestNumber: request.akoya_requestnum, expectedRequestEtag: request._etag || null,
    folderPath: requestBuckets[0].folder, narrativePath: `${proposalPath}/${proposalName}`,
    narrativeChars: String(text).trim().length, narrativeSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    siteId: graphSiteId, driveId: graphDriveId, requestFolderId: requestFolderMeta.id,
    writeupFolderPath,
    appDatabase: {
      container: 'wmkf-writeup-regen-pg', image: 'postgres:16', containerIdPrefix: 'a67b21c1aa7a',
      host: '127.0.0.1', port: 55439, database: 'writeup_regeneration_rehearsal',
    },
    selectedSourceSuggestion: sourceReview.suggestion.wmkf_appreviewersuggestionid,
    selectedSourcePerson: sourceReview.person.wmkf_potentialreviewersid,
    organizerProfileId,
    writes: ['synthetic PI Contact', 'ETag-bound Request PI/PD/program/status patch', 'synthetic proposal PDF', 'synthetic reviewer person/suggestion'],
    modelCalls: 0, realEmailOrNotification: false,
  };
  if (!executeRequested) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'pi-contact-create-intent', email: contactEmail });
  const pi = await contactAdapter.findOrCreateByEmail({
    firstName: `TEST PI ${factory.values.runId.slice(0, 8)}`,
    lastName: 'Writeup Regeneration Fixture', email: contactEmail,
  }, { actingUserSystemId: leadId });
  if (!pi.created || !pi.id) throw new Error('The synthetic PI Contact create was not a new, confirmed row.');
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'pi-contact-created', contactId: pi.id, email: contactEmail });

  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'request-patch-intent',
    requestId, expectedEtag: request._etag, programId, leadProgramDirectorId: leadId, contactId: pi.id,
    status: 'Phase II Pending' });
  await grantRequestAdapter.updateById(requestId, {
    akoya_requeststatus: 'Phase II Pending',
    'wmkf_ProjectLeader@odata.bind': `/contacts(${pi.id})`,
    'wmkf_ProgramDirector@odata.bind': `/systemusers(${leadId})`,
    'wmkf_GrantProgram@odata.bind': `/wmkf_grantprograms(${programId})`,
  }, { ifMatch: request._etag, actingUserSystemId: leadId, noFallback: true });
  const updated = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!updated || !sameId(updated._wmkf_projectleader_value, pi.id)
      || !sameId(updated._wmkf_programdirector_value, leadId)
      || !sameId(updated._wmkf_grantprogram_value, programId)
      || updated.akoya_requeststatus !== 'Phase II Pending') {
    throw new Error('The Request fixture binding patch did not read back exactly.');
  }
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'request-bound', requestEtag: updated._etag,
    piContactId: pi.id, leadProgramDirectorId: leadId, grantProgramId: programId, status: updated.akoya_requeststatus });

  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'narrative-upload-intent',
    folderPath: proposalPath, filename: proposalName, sha256: plan.narrativeSha256 });
  const materialFolder = await GraphService.ensureFolderPath('akoya_request', proposalPath,
    { siteId: graphSiteId, driveId: graphDriveId });
  if (!materialFolder?.id) throw new Error('Graph did not return the synthetic narrative folder item id.');
  const uploaded = await GraphService.uploadFile('akoya_request', proposalPath, proposalName, bytes,
    'application/pdf', { conflictBehavior: 'fail' });
  const downloaded = await GraphService.downloadFileByPath('akoya_request', proposalPath, proposalName);
  const downloadedText = await extractTextFromBuffer(downloaded.buffer, proposalName, downloaded.mimeType || 'application/pdf');
  if (crypto.createHash('sha256').update(downloaded.buffer).digest('hex') !== plan.narrativeSha256
      || String(downloadedText || '').trim().length < 60) {
    throw new Error('Narrative upload did not verify by exact path, content hash, and extracted text.');
  }
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'narrative-verified',
    driveItemId: uploaded.id, folderPath: proposalPath, filename: proposalName,
    sha256: plan.narrativeSha256, extractedChars: String(downloadedText).trim().length });

  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'writeup-folder-create-intent',
    folderPath: writeupFolderPath, siteId: graphSiteId, driveId: graphDriveId });
  const writeupFolder = await GraphService.ensureFolderPath('akoya_request', writeupFolderPath,
    { siteId: graphSiteId, driveId: graphDriveId });
  if (!writeupFolder?.id) throw new Error('Graph did not return the Pre-Site artifact folder item id.');
  const writeupFolderMeta = await GraphService.getFileMetadataByPath('akoya_request',
    `${requestBuckets[0].folder}/Artifacts`, 'Pre-Site Visit', { siteId: graphSiteId, driveId: graphDriveId });
  if (!writeupFolderMeta?.id || !sameId(writeupFolderMeta.id, writeupFolder.id)) {
    throw new Error('The Pre-Site artifact folder failed exact Graph ID readback.');
  }
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'writeup-folder-verified',
    folderPath: writeupFolderPath, folderId: writeupFolderMeta.id });

  const scheduledStart = '2026-10-14T10:00:00';
  const scheduledEnd = '2026-10-14T11:00:00';
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'synthetic-site-visit-create-intent',
    requestId, organizerProfileId, leadProgramDirectorId: leadId, scheduledStart, scheduledEnd,
    stateCode: 0, statusCode: 1, synthetic: true });
  const siteVisitInput = {
    requestId,
    subject: `SYNTHETIC writeup-regeneration rehearsal ${factory.values.runId.slice(0, 8)}`,
    description: 'Synthetic historical Site Visit fixture for the writeup-regeneration rehearsal. No meeting occurred.',
    startLocal: scheduledStart, endLocal: scheduledEnd, timeZone: 'America/Los_Angeles',
    format: SITE_VISIT_FORMAT.VIRTUAL, locationOrLink: 'Synthetic rehearsal fixture; no meeting link.',
    organizer: { kind: 'staff', profileId: organizerProfileId },
    requiredAttendees: [], optionalAttendees: [],
  };
  const siteVisitDeps = {
    ...SITE_VISIT_LOGISTICS_DEPENDENCIES,
    getRecipientDirectory: () => getSiteVisitRecipientDirectory({
      ...SITE_VISIT_RECIPIENT_DIRECTORY_DEPENDENCIES,
      listProfiles: async () => profileRows,
      listRoster: async () => [],
    }),
  };
  const savedVisit = await saveSiteVisitLogistics(siteVisitInput, { actingUserSystemId: leadId }, siteVisitDeps);
  const verifiedVisit = await siteVisitAdapter.getById(savedVisit.siteVisit.activityId);
  if (!verifiedVisit || !sameId(verifiedVisit._regardingobjectid_value, requestId)
      || Date.parse(verifiedVisit.scheduledend || '') > Date.now()
      || Number(verifiedVisit.statecode) !== 0 || Number(verifiedVisit.statuscode) !== 1
      || !verifiedVisit._etag || !String(verifiedVisit.subject || '').startsWith('SYNTHETIC writeup-regeneration rehearsal')) {
    throw new Error('The synthetic Site Visit failed request/ended-time/eligible-state/ETag readback.');
  }
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'synthetic-site-visit-verified',
    activityId: verifiedVisit.activityid, etag: verifiedVisit._etag, scheduledStart: verifiedVisit.scheduledstart,
    scheduledEnd: verifiedVisit.scheduledend, stateCode: verifiedVisit.statecode, statusCode: verifiedVisit.statuscode });

  const source = sourceReview;
  const personId = crypto.randomUUID();
  const suggestionId = crypto.randomUUID();
  const testEmail = `writeup-reviewer-${factory.values.runId}@example.invalid`;
  const sourceReviewer = {
    person: source.person,
    suggestion: source.suggestion,
    answers: [],
    reviewForm: 'unreceived',
  };
  const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_ORIGIN });
  const personPayload = {
    wmkf_potentialreviewersid: personId,
    ...syntheticPersonProjection(sourceReviewer, testEmail),
  };
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'synthetic-person-create-intent', personId, testEmail });
  await deps.createPerson(personPayload);
  const person = await deps.getPersonById(personId, { select: SOURCE_PERSON_SELECT });
  if (!person || !isSyntheticReviewerRow(person) || !sameId(person.wmkf_potentialreviewersid, personId)) {
    throw new Error('Synthetic reviewer person create failed exact marker/identity readback.');
  }
  const acceptedAt = new Date().toISOString();
  const suggestionPayload = {
    wmkf_appreviewersuggestionid: suggestionId,
    ...buildSuggestionCreateBody({ ...sourceReviewer, suggestion: {
      ...source.suggestion,
      wmkf_accepted: true,
      wmkf_declined: false,
      wmkf_reviewreceivedat: null,
      wmkf_responsereceivedat: acceptedAt,
      wmkf_invited: false,
      wmkf_emailsentat: null,
      wmkf_materialssentat: null,
    } }, {
      destinationRequestId: requestId,
      destinationPersonId: personId,
      grantCycleCode: updated.wmkf_meetingdate
        ? (meetingDateToCycleCode(updated.wmkf_meetingdate)?.toUpperCase() ?? null)
        : null,
    }),
    // The pure seeder intentionally excludes review-status writes from its
    // source projection. This explicit synthetic accepted state uses the
    // canonical option value; no submitted/completed status or answers carry.
    wmkf_reviewstatus: REVIEW_STATUS_MAP.accepted,
  };
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'synthetic-suggestion-create-intent', suggestionId, personId });
  await deps.createSuggestion(suggestionPayload);
  const suggestion = await deps.getSuggestionById(suggestionId, { select: SOURCE_REVIEW_SELECT });
  if (!suggestion || !sameId(suggestion._wmkf_request_value, requestId)
      || !sameId(suggestion._wmkf_potentialreviewer_value, personId)
      || suggestion.wmkf_accepted !== true || suggestion.wmkf_declined === true
      || !suggestion.wmkf_responsereceivedat || suggestion.wmkf_reviewreceivedat
      || suggestion.wmkf_reviewstatus !== REVIEW_STATUS_MAP.accepted) {
    throw new Error('Synthetic unreceived review suggestion create failed exact binding/readiness readback.');
  }
  appendJsonl(journalPath, { at: new Date().toISOString(), phase: 'reviewer-seeded',
    personId, suggestionId, suggestionEtag: suggestion._etag, accepted: true, receivedAt: null,
    responseReceivedAt: suggestion.wmkf_responsereceivedat,
    sourceSuggestionId: source.suggestion.wmkf_appreviewersuggestionid });

  const report = {
    schemaVersion: 1,
    target: { environment: 'sandbox', hostname: new URL(SANDBOX_ORIGIN).hostname },
    request: {
      id: requestId, number: updated.akoya_requestnum, etag: updated._etag,
      status: updated.akoya_requeststatus, programId,
      leadProgramDirectorId: leadId, projectLeaderContactId: pi.id,
    },
    actors: { leadProgramDirectorId: leadId, reviewingColleagueId: colleagueId },
    sharePoint: {
      siteId: graphSiteId,
      driveId: graphDriveId,
      library: 'akoya_request', folderPath: requestBuckets[0].folder,
      folderId: requestFolderMeta.id,
      writeupFolderPath,
      writeupFolderId: writeupFolderMeta.id,
      narrative: {
        itemId: uploaded.id, relativePath: `AI Materials/${proposalName}`,
        sha256: plan.narrativeSha256, extractedChars: String(downloadedText).trim().length,
      },
    },
    factory: { manifestSha256: sha256(factory), receiptPath: path.resolve(option('receipt')) },
    appDatabase: {
      container: 'wmkf-writeup-regen-pg', image: 'postgres:16', containerIdPrefix: 'a67b21c1aa7a',
      host: '127.0.0.1', port: 55439, database: 'writeup_regeneration_rehearsal',
    },
    review: {
      potentialReviewerId: personId, suggestionId,
      accepted: suggestion.wmkf_accepted === true, receivedAt: suggestion.wmkf_reviewreceivedat || null,
      reviewStatus: suggestion.wmkf_reviewstatus,
      responseReceivedAt: suggestion.wmkf_responsereceivedat,
      etag: suggestion._etag,
      seedReceipt: {
        method: 'reviews-sandbox-deps + seed-synthetic-review projection',
        templateOnly: true, answersCopied: false, communicationSent: false,
        sourceSuggestionId: source.suggestion.wmkf_appreviewersuggestionid,
      },
    },
    siteVisit: {
      activityId: verifiedVisit.activityid, etag: verifiedVisit._etag,
      startUtc: verifiedVisit.scheduledstart, endUtc: verifiedVisit.scheduledend,
      state: Number(verifiedVisit.statecode), status: Number(verifiedVisit.statuscode), synthetic: true,
    },
  };
  const output = option('out');
  if (!output) throw new Error('--out is required with --execute and must be outside the repository.');
  outsideRepo(output, 'Fixture manifest');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ mode: 'SANDBOX_FIXTURE_CREATED', requestId, requestNumber: updated.akoya_requestnum,
    folderPath: requestBuckets[0].folder, fixtureManifest: path.resolve(output), reviewAccepted: true, reviewReceived: false,
    modelCalls: 0, realEmailOrNotification: false }, null, 2));
}

async function main() {
  const manifestPath = option('factory-manifest');
  const receiptPath = option('receipt');
  const staffingPath = option('staffing');
  const actorIdsPath = option('actors');
  const journalPath = option('journal');
  for (const [file, label] of [[manifestPath, 'Factory manifest'], [receiptPath, 'Factory receipt'],
    [staffingPath, 'staffing plan'], [actorIdsPath, 'actor ids'], [journalPath, 'journal']]) outsideRepo(file, label);
  if (!fs.existsSync(journalPath) && process.argv.includes('--execute')) fs.writeFileSync(journalPath, '', { flag: 'wx', mode: 0o600 });
  loadEnvLocal();
  sandboxFence();
  process.env.TEST_REQUEST_ISOLATION = 'on';
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  process.env.SITE_VISIT_LOGISTICS_SCHEMA_READY = 'on';
  const factory = readJson(manifestPath);
  const receipt = readJson(receiptPath);
  const staffing = readJson(staffingPath);
  const actorMap = readJson(actorIdsPath);
  const actorIds = {
    leadProgramDirectorId: actorMap['Justin Gallivan'],
    reviewingColleagueId: actorMap['John Sader'],
  };
  if (!actorIds.leadProgramDirectorId || !actorIds.reviewingColleagueId) throw new Error('Owner-selected Sandbox actors are absent from the private actor file.');
  await withDalContext('writeup-regeneration-sandbox-fixture', () => execute({ factory, receipt, staffing, actorIds, journalPath }));
}

main().catch((error) => {
  console.error(`Sandbox fixture preparation failed: ${error.message}`);
  process.exitCode = 1;
});

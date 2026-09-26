/**
 * Test Request Factory slice 6c-ii Stage C — the `copy_review_file` step
 * body (lib/services/test-requests/run-runner.js `stepCopyReviewFile`).
 *
 * @jest-environment node
 */
import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { advanceRun } from '../../lib/services/test-requests/run-runner.js';
import { sha256, MANIFEST_V4 } from '../../lib/services/test-requests/basic-clone-steps.js';
import { REVIEW_FILE_COPY_POLICY } from '../../lib/services/test-requests/review-file-copy.js';
import { assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const APP_USER_ID = '55555555-5555-4555-8555-555555555555';
const ORG_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_PERSON_A = '77777777-7777-4777-8777-777777777771';
const DEST_SUGGESTION_A = '99999999-9999-4999-8999-999999999991';
const DEST_PERSON_A = '88888888-8888-4888-8888-888888888881';
const SITE = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
const TARGET = { ...SITE, registered: true };
// Grammar-conformant Graph identities (run-ledger.js's GRAPH_DRIVE_ID/GRAPH_SITE_ID/
// GRAPH_ITEM_ID): the fake ledger below runs every plannedIdentity/readback
// through the REAL assertLedgerReceipt, so these must be shape-valid, not
// just distinct strings.
const EXPECTED_DRIVE_ID = 'b!driveIdSample1234567890';
const EXPECTED_SITE_ID = 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222';
const SOURCE_ITEM_ID = `01${'A'.repeat(32)}`;
const DEST_ITEM_ID = `01${'B'.repeat(32)}`;
const DOCX_SOURCE_ITEM_ID = `01${'C'.repeat(32)}`;
const DOCX_DEST_ITEM_ID = `01${'D'.repeat(32)}`;

// Starts with the real PDF magic bytes ('%PDF-') so it passes P1-2's
// (Opus round 1) magic-byte sniff in the copy step, same as a real upload.
const NARRATIVE = Buffer.from('%PDF-1.4 review file bytes');
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function ok(body, status = 200) {
  return { ok: true, status, body };
}

function baseRun(overrides = {}) {
  return {
    runId: RUN_ID,
    recipe: 'reviews',
    status: 'prepared',
    currentStep: 'copy_review_file',
    stepIndex: 11,
    version: 1,
    leaseToken: null,
    leaseGeneration: 0,
    lockedUntil: null,
    createBodySha256: 'body-hash',
    copyPolicyDigest: 'policy-digest',
    sourceRequestId: SOURCE_ID,
    sourceRevision: 'rev-1',
    destinationRequestId: REQUEST_ID,
    destinationLocationId: LOCATION_ID,
    expectedAppUserId: APP_USER_ID,
    expectedOrganizationId: ORG_ID,
    expectedGraphSiteId: EXPECTED_SITE_ID,
    expectedGraphDriveId: EXPECTED_DRIVE_ID,
    destinationRequestNumber: null,
    meetingDate: '2026-12-01',
    ...overrides,
  };
}

function baseManifest(bundleSha256, overrides = {}) {
  return {
    kind: MANIFEST_V4,
    recipe: 'reviews',
    values: { requestId: REQUEST_ID, runId: RUN_ID, locationId: LOCATION_ID, meetingDate: '2026-12-01' },
    source: { requestId: SOURCE_ID, revision: 'rev-1', requestType: 100000000, bundleSha256 },
    createBodySha256: 'body-hash',
    copyPolicy: { digest: 'policy-digest' },
    expectedRequestType: { value: 100000000 },
    expectedAppUserId: APP_USER_ID,
    expectedOrganization: { accountid: ORG_ID },
    expectedGraphSiteId: 'site-1',
    expectedGraphDriveId: 'drive-1',
    ...overrides,
  };
}

function runAndManifestFor(bundle, runOverrides = {}, manifestOverrides = {}) {
  const digest = sha256(bundle);
  return { run: baseRun({ bundleSha256: digest, ...runOverrides }), manifest: baseManifest(digest, manifestOverrides) };
}

function bundleWithOneReviewer({ reviewForm = 'uploaded', files } = {}) {
  return {
    reviewers: [
      {
        suggestionId: 'source-suggestion-1',
        personId: SOURCE_PERSON_A,
        person: { wmkf_name: 'Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer' },
        personIsSynthetic: false,
        suggestion: {},
        answers: [],
        reviewForm,
        files: files ?? (reviewForm === 'uploaded' ? [{
          id: 'source-suggestion-1:item-1', kind: 'reviewerUpload', library: 'akoya_request',
          folder: 'source-request/Reviewer_Uploads/reviewer_abcd1234/attempt_11111111111111111111111111111111',
          name: 'MyReview.pdf', driveId: 'stale-drive', graphItemId: SOURCE_ITEM_ID, sharePointSite: SITE,
          size: NARRATIVE.length, mimeType: 'application/pdf', eTag: '"src-1"', versionId: '1.0',
          contentHash: hash(NARRATIVE), suggestionId: 'source-suggestion-1',
        }] : []),
      },
    ],
  };
}

/** Recording fake ledger, extended with reviewer-assignment reads (mirrors test-request-run-runner-seed-reviewers.test.js). */
function createFakeLedger(initialRun, { assignments = [], preseed = [] } = {}) {
  const calls = [];
  let run = { ...initialRun };
  const resources = [];
  let nextSequence = 1;
  let nextResourceId = 1;

  function fenceOk(leaseToken, leaseGeneration, expectedVersion) {
    return run.leaseToken === leaseToken && run.leaseGeneration === leaseGeneration
      && (expectedVersion === undefined || run.version === expectedVersion) && run.lockedUntil !== null;
  }
  const ledger = {
    async getRun(runId) { return runId === run.runId ? { ...run } : null; },
    async claimLease({ expectedVersion }) {
      if (run.version !== expectedVersion || run.lockedUntil !== null) return null;
      run = { ...run, leaseToken: `lease-${run.leaseGeneration + 1}`, leaseGeneration: run.leaseGeneration + 1, lockedUntil: 'future', version: run.version + 1 };
      return { ...run };
    },
    async releaseLease({ leaseToken, leaseGeneration }) {
      if (!fenceOk(leaseToken, leaseGeneration)) return null;
      run = { ...run, leaseToken: null, lockedUntil: null };
      return { ...run };
    },
    async advanceStep({ leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status, destinationRequestNumber }) {
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = { ...run, currentStep: nextStep, stepIndex: nextStepIndex, status: status ?? run.status, destinationRequestNumber: destinationRequestNumber ?? run.destinationRequestNumber, version: run.version + 1 };
      return { ...run };
    },
    async markReady() { throw new Error('markReady must never be called by copy_review_file'); },
    async markNeedsAttention({ leaseToken, leaseGeneration, expectedVersion, reason, error = null }) {
      if (!fenceOk(leaseToken, leaseGeneration, expectedVersion)) return null;
      run = { ...run, status: 'needs_attention', needsAttentionReason: reason?.code ?? reason, lastError: error ?? run.lastError ?? null, leaseToken: null, lockedUntil: null, version: run.version + 1 };
      return { ...run };
    },
    async journalPlannedResource({ step, resourceKind, system, plannedIdentity }) {
      // Pin the REAL receipt allowlist (run-ledger.js assertLedgerReceipt) --
      // the same validation the live Postgres ledger applies before any
      // CHECK constraint ever runs. A fake ledger that skips this can hide
      // an unallowlisted key (as `primaryFilename` was, pre-Stage-C-fix)
      // indefinitely.
      assertLedgerReceipt(plannedIdentity, 'plannedIdentity');
      const resource = { resourceId: nextResourceId++, sequence: nextSequence++, step, resourceKind, system, plannedIdentity, readback: null, outcome: 'planned' };
      resources.push(resource);
      calls.push({ op: 'journalPlannedResource', step, resourceKind, plannedIdentity });
      return { ...resource };
    },
    async recordResourceReadback({ resourceId, responseStatus, readback, outcome }) {
      assertLedgerReceipt(readback, 'readback');
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.readback = { ...(resource.readback || {}), ...(readback || {}) };
      resource.outcome = outcome;
      resource.responseStatus = responseStatus;
      calls.push({ op: 'recordResourceReadback', resourceId, outcome, readback });
      return { ...resource };
    },
    async recordResourceFailure({ resourceId, outcome, error }) {
      const resource = resources.find((row) => row.resourceId === resourceId);
      resource.outcome = outcome;
      resource.error = error?.code ?? error;
      calls.push({ op: 'recordResourceFailure', resourceId, outcome, error: error?.code ?? error });
      return { ...resource };
    },
    async listRunResources() { return resources.map((row) => ({ ...row })); },
    async listRunReviewerAssignments() { return assignments.map(({ address, ...rest }) => ({ ...rest })); },
    async getRunReviewerAssignment(_runId, sequence) { return assignments.find((a) => a.sequence === sequence) || null; },
  };
  (async () => {
    for (const entry of preseed) {
      const resource = await ledger.journalPlannedResource(entry.plan);
      if (entry.readback) await ledger.recordResourceReadback({ resourceId: resource.resourceId, ...entry.readback });
    }
  })();
  return { ledger, calls, getResources: () => resources };
}

async function preseedSuggestion(ledger) {
  const resource = await ledger.journalPlannedResource({
    step: 'seed_reviewers', resourceKind: 'dataverse_reviewer_suggestion', system: 'dataverse',
    plannedIdentity: { assignmentSequence: 1, suggestionId: DEST_SUGGESTION_A, destinationPersonId: DEST_PERSON_A },
  });
  await ledger.recordResourceReadback({ resourceId: resource.resourceId, readback: { suggestionId: DEST_SUGGESTION_A }, outcome: 'verified' });
}

function preflightClient() {
  return {
    async get(requestPath) {
      if (requestPath.startsWith(`/akoya_requests(${REQUEST_ID})`)) {
        return ok({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1000400', wmkf_meetingdate: '2026-12-01' });
      }
      if (requestPath.includes('EntityDefinitions')) {
        if (requestPath.includes('ManyToOneRelationships')) return ok({ value: [{ ReferencedEntity: 'account' }] });
        if (requestPath.includes('PicklistAttributeMetadata')) return ok({ OptionSet: { Options: [{ Value: 100000000, Label: { UserLocalizedLabel: { Label: 'Grant' } } }] } });
        if (requestPath.includes('MoneyAttributeMetadata')) return ok({ MinValue: 0, MaxValue: 1 });
        if (requestPath.includes('StringAttributeMetadata') || requestPath.includes('MemoAttributeMetadata')) return ok({ MaxLength: 100 });
        return ok({
          value: [
            'akoya_requestid', 'akoya_applicantid', 'akoya_title', 'akoya_purpose', 'akoya_request',
            'akoya_fiscalyear', 'akoya_requesttype', 'wmkf_meetingdate', 'wmkf_istestrequest',
            'wmkf_testcreationrunid', 'wmkf_respondreminderenabled', 'wmkf_reviewduereminderenabled',
          ].map((field) => ({ LogicalName: field, AttributeType: 'String', IsValidForCreate: true, RequiredLevel: { Value: 'None' } })),
        });
      }
      if (requestPath.startsWith('/accounts')) return ok({ value: [{ accountid: ORG_ID, name: 'W. M. Keck Foundation', statecode: 0 }] });
      if (requestPath.startsWith('/sharepointsites')) return ok({ value: [{ sharepointsiteid: 'site-x', absoluteurl: 'https://example.sharepoint.com/sites/akoyago' }] });
      if (requestPath.startsWith('/sharepointdocumentlocations')) return ok({ value: [{ sharepointdocumentlocationid: 'parent-1', _parentsiteorlocation_value: 'site-x' }] });
      if (requestPath.startsWith('/systemusers')) return ok({ value: [{ systemuserid: APP_USER_ID, fullname: '# WMK: Research Review App Suite', accessmode: 4, isdisabled: false }] });
      if (requestPath.startsWith('/contacts')) return ok({ value: [] });
      throw new Error(`unexpected preflight path: ${requestPath}`);
    },
  };
}

function fakeGraph({ uploadedBytesOverride } = {}) {
  const destination = new Map();
  return {
    clearGraphCaches: jest.fn(),
    configuredSharePointTarget: jest.fn(() => TARGET),
    getSiteId: jest.fn(async () => EXPECTED_SITE_ID),
    getDriveId: jest.fn(async () => EXPECTED_DRIVE_ID),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      if (itemId === SOURCE_ITEM_ID) return { id: SOURCE_ITEM_ID, name: 'MyReview.pdf', size: NARRATIVE.length, mimeType: 'application/pdf', eTag: '"src-1"', versionId: '1.0' };
      for (const item of destination.values()) if (item.id === itemId) return item;
      return null;
    }),
    downloadFile: jest.fn(async (driveId, itemId) => {
      if (itemId === SOURCE_ITEM_ID) return { buffer: NARRATIVE };
      for (const item of destination.values()) if (item.id === itemId) return { buffer: item.buffer };
      throw new Error('missing');
    }),
    getFileMetadataByPath: jest.fn(async (library, folder, filename) => destination.get(`${folder}/${filename}`) ?? null),
    ensureFolderPath: jest.fn(async (library, folder) => ({ id: `folder:${folder}` })),
    uploadFile: jest.fn(async (library, folder, filename, buffer, mimeType, options) => {
      const bytes = uploadedBytesOverride ?? buffer;
      const item = { id: DEST_ITEM_ID, name: filename, size: bytes.length, mimeType, eTag: '"new"', versionId: '1.0', buffer: bytes };
      destination.set(`${folder}/${filename}`, item);
      if (options?.onItemCreated) await options.onItemCreated({ id: item.id, name: filename, size: bytes.length, eTag: item.eTag });
      return { id: item.id, name: filename, size: bytes.length, eTag: item.eTag, versionId: '1.0' };
    }),
    destination,
  };
}

const sharePointTarget = () => ({ ...TARGET, siteUrl: 'https://example.sharepoint.com/sites/akoyago' });

describe('stepCopyReviewFile', () => {
  beforeEach(() => { process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0'); });

  it('a bundle with zero uploaded reviews advances immediately with no journal', async () => {
    const bundle = bundleWithOneReviewer({ reviewForm: 'unreceived' });
    const { run, manifest } = runAndManifestFor(bundle);
    const { ledger, calls } = createFakeLedger(run, { assignments: [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }] });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph: fakeGraph(), sharePointTarget },
    });
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('seed_review_answers');
    expect(calls.filter((c) => c.op === 'journalPlannedResource')).toHaveLength(0);
  });

  it('copies the one uploaded file, journals the folder resource with the primary filename, and advances', async () => {
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64), address: 'throwaway@example.test' }];
    const { ledger, calls } = createFakeLedger(run, { assignments });
    await preseedSuggestion(ledger);

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph: fakeGraph(), sharePointTarget },
    });
    expect(result.outcome).toBe('advanced');
    expect(result.run.currentStep).toBe('seed_review_answers');
    const resources = await ledger.listRunResources();
    const folderResource = resources.find((r) => r.step === 'copy_review_file' && r.resourceKind === 'sharepoint_folder');
    expect(folderResource.outcome).toBe('verified');
    expect(folderResource.readback.filename).toBe('Review_1.pdf');
    expect(folderResource.plannedIdentity.folder).toMatch(/^Reviewer_Uploads\/Reviewer_[0-9a-f]{8}\/attempt_[0-9a-f]{32}$/);
    const fileResource = resources.find((r) => r.step === 'copy_review_file' && r.resourceKind === 'sharepoint_file');
    expect(fileResource.outcome).toBe('verified');
    expect(fileResource.readback.filename).toBe('Review_1.pdf');
  });

  it('a review with no seeded suggestion refuses reviewer_answers_ambiguous', async () => {
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }];
    const { ledger } = createFakeLedger(run, { assignments });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph: fakeGraph(), sharePointTarget },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('reviewer_answers_ambiguous');
  });

  it('resumes with the SAME attempt id recovered from the journaled folder resource, never a fresh one', async () => {
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }];
    const { ledger } = createFakeLedger(run, { assignments });
    await preseedSuggestion(ledger);
    // Pre-seed a folder resource as if a prior call already picked an
    // attempt id (but had not yet copied any files).
    const fixedAttemptId = 'b'.repeat(32);
    const folder = `Reviewer_Uploads/Reviewer_${DEST_SUGGESTION_A.replace(/-/g, '').slice(0, 8)}/attempt_${fixedAttemptId}`;
    const folderResource = await ledger.journalPlannedResource({
      step: 'copy_review_file', resourceKind: 'sharepoint_folder', system: 'sharepoint',
      plannedIdentity: { assignmentSequence: 1, folder },
    });

    const graph = fakeGraph();
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph, sharePointTarget },
    });
    expect(result.outcome).toBe('advanced');
    const resources = await ledger.listRunResources();
    const sameFolderResource = resources.find((r) => r.resourceId === folderResource.resourceId);
    expect(sameFolderResource.plannedIdentity.folder).toBe(folder);
    expect(sameFolderResource.readback.filename).toBe('Review_1.pdf');
    // P2-1 (Opus round 1): the fake Graph's ACTUAL upload folder -- not just
    // the journaled resource's folder -- must equal the recovered attempt
    // id's folder, so a regenerated (never-uploaded-to) attempt id would be
    // caught even if the journal bookkeeping alone looked consistent.
    const uploadFolderArg = graph.uploadFile.mock.calls[0][1];
    expect(uploadFolderArg.endsWith(`/${folder}`)).toBe(true);
  });

  it('refuses (P2-1, Opus round 1) when the planned folder disagrees with the journaled folder resource', async () => {
    const bundle = bundleWithOneReviewer();
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }];
    const { ledger } = createFakeLedger(run, { assignments });
    await preseedSuggestion(ledger);
    // Journal a folder resource whose attempt id cannot be recovered by
    // buildReviewerSubfolder's own convention (a foreign subfolder segment),
    // simulating a planner regression that would otherwise silently upload
    // into an un-journaled folder.
    const foreignFolder = 'Reviewer_Uploads/Reviewer_deadbeef/attempt_cccccccccccccccccccccccccccccccc';
    await ledger.journalPlannedResource({
      step: 'copy_review_file', resourceKind: 'sharepoint_folder', system: 'sharepoint',
      plannedIdentity: { assignmentSequence: 1, folder: foreignFolder },
    });
    const graph = fakeGraph();
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph, sharePointTarget },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('file_journal_unverified');
    expect(graph.uploadFile).not.toHaveBeenCalled();
    const resources = await ledger.listRunResources();
    const fileResource = resources.find((r) => r.step === 'copy_review_file' && r.resourceKind === 'sharepoint_file');
    expect(fileResource.outcome).toBe('planned');
  });

  it('refuses (P1-2, Opus round 1) a .pdf-named file whose bytes are actually a DOCX (ZIP magic), before any upload', async () => {
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="ns"><w:body/></w:document>');
    const docxBytesUnderPdfName = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const mismatchedFile = {
      id: 'source-suggestion-1:item-1', kind: 'reviewerUpload', library: 'akoya_request',
      folder: 'source-request/Reviewer_Uploads/reviewer_abcd1234/attempt_11111111111111111111111111111111',
      name: 'MyReview.pdf', driveId: 'stale-drive', graphItemId: SOURCE_ITEM_ID, sharePointSite: SITE,
      size: docxBytesUnderPdfName.length, mimeType: 'application/pdf', eTag: '"src-1"', versionId: '1.0',
      contentHash: hash(docxBytesUnderPdfName), suggestionId: 'source-suggestion-1',
    };
    const bundle = bundleWithOneReviewer({ files: [mismatchedFile] });
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }];
    const { ledger } = createFakeLedger(run, { assignments });
    await preseedSuggestion(ledger);
    const graph = fakeGraph();
    graph.downloadFile = jest.fn(async (driveId, itemId) => {
      if (itemId === SOURCE_ITEM_ID) return { buffer: docxBytesUnderPdfName };
      for (const item of graph.destination.values()) if (item.id === itemId) return { buffer: item.buffer };
      throw new Error('missing');
    });
    graph.getFileMetadataById = jest.fn(async (driveId, itemId) => {
      if (itemId === SOURCE_ITEM_ID) return { id: SOURCE_ITEM_ID, name: 'MyReview.pdf', size: docxBytesUnderPdfName.length, mimeType: 'application/pdf', eTag: '"src-1"', versionId: '1.0' };
      for (const item of graph.destination.values()) if (item.id === itemId) return item;
      return null;
    });
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph, sharePointTarget },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.needsAttentionReason).toBe('file_rejected');
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
    expect(graph.uploadFile).not.toHaveBeenCalled();
  });

  it('refuses the whole run before any journal when the bundle exceeds the total-bytes ceiling', async () => {
    const bigFile = {
      id: 'source-suggestion-1:item-1', kind: 'reviewerUpload', library: 'akoya_request',
      folder: 'x', name: 'MyReview.pdf', driveId: 'stale-drive', graphItemId: SOURCE_ITEM_ID, sharePointSite: SITE,
      size: REVIEW_FILE_COPY_POLICY.maxTotalBytes + 1, mimeType: 'application/pdf', eTag: '"src-1"', versionId: '1.0',
      contentHash: hash(NARRATIVE), suggestionId: 'source-suggestion-1',
    };
    const bundle = bundleWithOneReviewer({ files: [bigFile] });
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }];
    const { ledger, calls } = createFakeLedger(run, { assignments });
    await preseedSuggestion(ledger);
    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph: fakeGraph(), sharePointTarget },
    });
    expect(result.outcome).toBe('needs_attention');
    expect(result.run.lastError.message).toMatch(/exceeding the .*-byte ceiling/);
    expect(calls.filter((c) => c.op === 'journalPlannedResource' && c.step === 'copy_review_file')).toHaveLength(0);
  });
});

describe('stepCopyReviewFile: DOCX package integrity mode wired end-to-end', () => {
  beforeEach(() => { process.env.DYNAMICS_CLIENT_ID = APP_USER_ID.replace(/./, '0'); });

  it('accepts a DOCX destination whose bytes were rewritten by SharePoint property promotion, and journals attestedDigest', async () => {
    // Reuse the real docx-package-attestation fixtures via a tiny inline zip
    // mutation (metadata-part rewrite only) rather than importing JSZip
    // afresh -- proves the wiring, not the comparator's own logic (already
    // covered by docx-package-attestation.test.js).
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document xmlns:w="ns"><w:body><w:p/></w:body></w:document>');
    zip.file('[Content_Types].xml', '<Types xmlns="ns"></Types>');
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="ns"></Relationships>');
    zip.file('docProps/core.xml', '<cp:coreProperties/>');
    const sourceDocx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const promotedZip = await JSZip.loadAsync(sourceDocx);
    promotedZip.file('docProps/core.xml', '<cp:coreProperties>rewritten</cp:coreProperties>');
    const promotedDocx = await promotedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const docxFile = {
      id: 'source-suggestion-1:item-docx', kind: 'reviewerUpload', library: 'akoya_request',
      folder: 'source-request/Reviewer_Uploads/reviewer_abcd1234/attempt_11111111111111111111111111111111',
      name: 'MyReview.docx', driveId: 'stale-drive', graphItemId: DOCX_SOURCE_ITEM_ID, sharePointSite: SITE,
      size: sourceDocx.length, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      eTag: '"src-docx"', versionId: '1.0', contentHash: hash(sourceDocx), suggestionId: 'source-suggestion-1',
    };
    const bundle = bundleWithOneReviewer({ files: [docxFile] });
    const { run, manifest } = runAndManifestFor(bundle);
    const assignments = [{ sequence: 1, sourcePersonId: SOURCE_PERSON_A, destinationPersonId: DEST_PERSON_A, reused: false, addressSha256: 'a'.repeat(64) }];
    const { ledger } = createFakeLedger(run, { assignments });
    await preseedSuggestion(ledger);

    const graph = fakeGraph({ uploadedBytesOverride: promotedDocx });
    graph.getFileMetadataById = jest.fn(async (driveId, itemId) => {
      if (itemId === DOCX_SOURCE_ITEM_ID) return { id: DOCX_SOURCE_ITEM_ID, name: 'MyReview.docx', size: sourceDocx.length, mimeType: docxFile.mimeType, eTag: '"src-docx"', versionId: '1.0' };
      for (const item of graph.destination.values()) if (item.id === itemId) return item;
      return null;
    });
    graph.downloadFile = jest.fn(async (driveId, itemId) => {
      if (itemId === DOCX_SOURCE_ITEM_ID) return { buffer: sourceDocx };
      for (const item of graph.destination.values()) if (item.id === itemId) return { buffer: item.buffer };
      throw new Error('missing');
    });

    const result = await advanceRun({
      runId: RUN_ID, ledger, manifest, bundle,
      deps: { client: preflightClient(), graph, sharePointTarget },
    });
    expect(result.outcome).toBe('advanced');
    const resources = await ledger.listRunResources();
    const fileResource = resources.find((r) => r.step === 'copy_review_file' && r.resourceKind === 'sharepoint_file');
    expect(fileResource.outcome).toBe('verified');
    expect(fileResource.readback.attestedDigest).toBe(hash(promotedDocx));
    expect(fileResource.readback.filename).toBe('Review_1.docx');
  });
});

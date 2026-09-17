/**
 * @jest-environment node
 *
 * Node environment: the service now imports the deliberation briefing link
 * service, whose token primitive resolves `jose` to its Node build.
 */
// Plan §11 (Step C1): wrap the real `assembleReviewBundle` in a jest.fn so
// tests can assert call count/arguments while every other test in this
// suite still exercises the real assembly logic end to end.
jest.mock('../../lib/services/pre-site-visit/review-bundle-service.js', () => {
  const actual = jest.requireActual('../../lib/services/pre-site-visit/review-bundle-service.js');
  return {
    ...actual,
    assembleReviewBundle: jest.fn(actual.assembleReviewBundle),
  };
});
import {
  BRIEFING_LINK_PLACEHOLDER,
  REVIEW_BUNDLE_LINK_PLACEHOLDER,
  distributionBodyHtml,
  getPreSiteDistributionHistory,
  renderBriefingBody,
  reviewBundleDocumentUrl,
  normalizeDistributionRecipients,
  preparePreSiteDistribution,
  projectDistributionAttempt,
  sendPreSiteDistribution,
} from '../../lib/services/pre-site-visit/distribution-service';
import { assembleReviewBundle } from '../../lib/services/pre-site-visit/review-bundle-service.js';
import { PRE_SITE_DISTRIBUTION_CONTRACT as REVIEW_BUNDLE_PRODUCER_CONTRACT } from '../../shared/config/requestDocument.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';
import { DELIBERATION_SHARE_SEED_BRIEFING_COPY } from '../../shared/config/deliberationShareEmail.js';
import { briefInputFingerprint } from '../../lib/services/pre-rp-brief/docx-renderer.js';
import { PDFDocument } from 'pdf-lib';

// A real, parseable one-page PDF (plan §11, Step C1): `assembleReviewBundle`
// calls `PDFDocument.load` on every part, so the magic-byte-only fixture
// used elsewhere in this suite (`Buffer.from('%PDF-frozen-bytes')`) is not
// sufficient for the review bundle's default happy path.
let REVIEW_PART_PDF;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  REVIEW_PART_PDF = Buffer.from(await doc.save());
});

// A minimal, valid Pre-RP Brief input envelope (plan §3.4a shape) with one
// received review, used as the "generated" snapshot stored on a source row
// and, by default, as the "live" inputs too (no drift) so existing
// prepare-path tests exercise the happy path through the new review/drift
// gate (plan §3.4b) without asserting on it. Tests that DO exercise the
// gate build their own generated/live pair with `briefEnvelope` overrides.
function briefEnvelope(overrides = {}) {
  return {
    schemaVersion: PRE_RP_BRIEF_CONTRACT.snapshotSchemaVersion,
    artifactType: PRE_RP_BRIEF_CONTRACT.snapshotArtifactType,
    request: {
      institutionName: 'Test Institution',
      projectTitle: 'Test Project',
      principalInvestigator: 'Dr. PI',
      programDirector: 'Dr. PD',
      abstract: 'A test abstract.',
    },
    reviews: [
      {
        suggestionId: 'reviewer-1',
        reviewReceivedAt: '2026-09-01T00:00:00Z',
        name: 'Reviewer One',
        academicRank: 'Professor',
        reviewerOverallAssessment: 'Strong',
        reviewerAffiliation: 'Test University',
        mainInstitution: 'Test University',
        affiliation: 'Test University',
        // Plan §11 (Step C1): a retained review file, so the review bundle
        // gate's happy path (assembleReviewBundle needs at least one
        // received review with a file) holds for every test that doesn't
        // deliberately override it.
        reviewSharePointFolder: 'Requests/1002379/Reviewer_Uploads/attempt_1',
        reviewFilename: 'review-1.pdf',
      },
    ],
    ...overrides,
  };
}

// Builds { snapshotJson, fingerprint, envelope } for a "generated"/stored
// snapshot to place on a source row's wmkf_presiteinputsnapshotjson +
// wmkf_inputfingerprint, and a matching `loadPreRpBriefInputs` mock whose
// live envelope defaults to the same envelope (no drift).
function briefGateFixture({ generated = briefEnvelope(), live = generated } = {}) {
  return {
    generated,
    live,
    snapshotJson: JSON.stringify(generated),
    fingerprint: briefInputFingerprint(generated),
    loadPreRpBriefInputs: jest.fn(async () => ({
      requestNumber: '1002379',
      cycleCode: 'D26',
      envelope: live,
    })),
  };
}

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const ORIGINAL_IMPERSONATION = process.env.DYNAMICS_IMPERSONATION_ENABLED;

beforeEach(() => {
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
});

afterAll(() => {
  if (ORIGINAL_IMPERSONATION === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
  else process.env.DYNAMICS_IMPERSONATION_ENABLED = ORIGINAL_IMPERSONATION;
});

test('normalizes known recipients without identity scoring and rejects To/Cc overlap', () => {
  expect(normalizeDistributionRecipients(
    'Staff@Example.org; staff@example.org\nconsultant@example.org',
    'another@example.org',
  )).toEqual({
    to: ['staff@example.org', 'consultant@example.org'],
    cc: ['another@example.org'],
  });
  expect(() => normalizeDistributionRecipients('staff@example.org', 'STAFF@example.org'))
    .toThrow(/both To and Cc/);
});

test('plain-text body rendering escapes markup and carries a recovery marker', () => {
  const html = distributionBodyHtml('Hello <staff>\n\nThank you & goodbye.', OPERATION_ID);
  expect(html).toContain('Hello &lt;staff&gt;');
  expect(html).toContain('Thank you &amp; goodbye.');
  expect(html).toContain(`wmkf-pre-site-distribution:${OPERATION_ID}`);
});

test('prepare rejects an unrecognized attachment mode before any persistence or file work', async () => {
  await expect(preparePreSiteDistribution({
    requestId: REQUEST_ID,
    expectedArtifactId: '44444444-4444-4444-8444-444444444444',
    operationId: OPERATION_ID,
    attachmentMode: 'zip',
    to: 'staff@example.org',
    subject: 'Frozen materials',
    bodyText: 'Attached.',
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, {})).rejects.toMatchObject({ code: 'distribution_attachment_mode_invalid' });
});

test('an absent or empty attachment mode means none: both snapshots are pinned, nothing is selected for attachment', async () => {
  for (const attachmentMode of [undefined, '']) {
    const harness = createPrepareHarness();
    const input = prepareInput();
    if (attachmentMode === undefined) delete input.attachmentMode; else input.attachmentMode = attachmentMode;
    const result = await preparePreSiteDistribution(input, harness.dependencies);
    expect(harness.dependencies.createOrGetAttempt.mock.calls[0][0].attachmentMode).toBe('none');
    expect(result.attempt.attachmentMode).toBe('none');
    expect(result.attempt.attachments).toEqual([]);
    expect(result.attempt.briefingLinkId).toBe('12121212-1212-4212-8212-121212121212');
    // Snapshots are still pinned because the briefing page serves them.
    const prepared = harness.dependencies.recordPrepared.mock.calls[0][1];
    expect(prepared.docx?.documentId).toBeTruthy();
    expect(prepared.pdf?.documentId).toBeTruthy();
    // Slice 4: the pinned snapshot rows carry the brief's artifact type,
    // since the source is now the brief (type 100000009), not Pre-Site.
    for (const call of harness.dependencies.createDocument.mock.calls) {
      expect(call[0].wmkf_artifacttype).toBe(PRE_RP_BRIEF_CONTRACT.artifactType);
    }
  }
});

test('the preview hash pins both snapshot identities even when nothing is attached (a snapshot swap invalidates the preview)', async () => {
  const a = createPrepareHarness();
  const b = createPrepareHarness();
  const [first, second] = await Promise.all([
    preparePreSiteDistribution(prepareInput({ attachmentMode: 'none' }), a.dependencies),
    preparePreSiteDistribution(prepareInput({ attachmentMode: 'none' }), b.dependencies),
  ]);
  expect(first.attempt.previewHash).toBe(second.attempt.previewHash);
  const c = createPrepareHarness({ settledWordVersionId: '1.1' });
  const third = await preparePreSiteDistribution(prepareInput({ attachmentMode: 'none' }), c.dependencies);
  // Discriminating: the harness option changes only the DOCX snapshot's
  // settled version (the source version stays '2.0' and nothing is attached),
  // so an equal hash here would mean the snapshots were not pinned.
  expect(third.attempt.previewHash).not.toBe(first.attempt.previewHash);
});

const SESSION = {
  sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  scheduledStartIso: '2026-09-11T18:45:00.000Z',
  scheduledEndIso: '2026-09-11T20:00:00.000Z',
  ianaTimeZone: 'America/Los_Angeles',
  meetingLink: 'https://zoom.example/j/123',
  location: '',
  order: 1,
  minutes: 15,
  attendees: [{ name: 'A', email: 'a@example.org' }],
};

test('the email carries the request\'s deliberation session (tracker §5.6): body line with Join link, snapshot persisted, both hashes bound', async () => {
  const withSession = createPrepareHarness();
  withSession.dependencies.getSession = jest.fn(async () => SESSION);
  const result = await preparePreSiteDistribution(prepareInput(), withSession.dependencies);
  expect(withSession.dependencies.getSession).toHaveBeenCalledWith(REQUEST_ID);
  const created = withSession.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(created.bodyHtml).toContain('<strong>Pre-discussion:</strong>');
  expect(created.bodyHtml).toContain('September 11, 2026');
  expect(created.bodyHtml).toContain('11:45');
  expect(created.bodyHtml).toContain('<a href="https://zoom.example/j/123">Join meeting</a>');
  expect(created.sessionSnapshot).toEqual({
    sessionId: SESSION.sessionId,
    scheduledStartIso: SESSION.scheduledStartIso,
    scheduledEndIso: SESSION.scheduledEndIso,
    ianaTimeZone: 'America/Los_Angeles',
    meetingLink: 'https://zoom.example/j/123',
    location: '',
  });
  expect(created.sessionSnapshot).not.toHaveProperty('attendees');

  const without = createPrepareHarness();
  without.dependencies.getSession = jest.fn(async () => null);
  const plain = await preparePreSiteDistribution(prepareInput(), without.dependencies);
  const plainCreated = without.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(plainCreated.bodyHtml).toContain('<strong>Pre-discussion:</strong> not yet scheduled.');
  expect(plainCreated.bodyHtml).not.toContain('Join meeting');
  expect(plainCreated.sessionSnapshot).toBeNull();
  // Discriminating: only the session differs between the two harnesses.
  expect(created.draftHash).not.toBe(plainCreated.draftHash);
  expect(result.attempt.previewHash).not.toBe(plain.attempt.previewHash);
});

test('a non-https meeting link is dropped from the email and the snapshot; a session-reader failure reads as not scheduled', async () => {
  const harness = createPrepareHarness();
  harness.dependencies.getSession = jest.fn(async () => ({ ...SESSION, meetingLink: 'javascript:alert(1)' }));
  await preparePreSiteDistribution(prepareInput(), harness.dependencies);
  const created = harness.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(created.bodyHtml).not.toContain('Join meeting');
  expect(created.sessionSnapshot.meetingLink).toBe('');

  const failing = createPrepareHarness();
  failing.dependencies.getSession = jest.fn(async () => { throw new Error('tracker down'); });
  await preparePreSiteDistribution(prepareInput(), failing.dependencies);
  expect(failing.dependencies.createOrGetAttempt.mock.calls[0][0].sessionSnapshot).toBeNull();
});

test('send refuses when the deliberation session moved, appeared, or was removed since preview; unchanged passes the check', async () => {
  const snapshot = {
    sessionId: SESSION.sessionId, scheduledStartIso: SESSION.scheduledStartIso, scheduledEndIso: SESSION.scheduledEndIso,
    ianaTimeZone: 'America/Los_Angeles', meetingLink: 'https://zoom.example/j/123', location: '',
  };
  const input = { requestId: REQUEST_ID, operationId: OPERATION_ID, previewHash: 'a'.repeat(64), fromEmail: 'sender@example.org', actingUserSystemId: ACTOR_ID };
  const attempt = (session_snapshot) => attemptFixture({ session_snapshot });
  const deps = (row, live) => ({
    ...currentSourceDependencies(row),
    getSession: jest.fn(async () => live),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => ({ ...row, lease_token: '77777777-7777-4777-8777-777777777777' })),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => row),
  });

  for (const [stored, live] of [
    [snapshot, { ...SESSION, scheduledStartIso: '2026-09-12T18:45:00.000Z' }],
    [snapshot, null],
    [null, SESSION],
    [snapshot, { ...SESSION, meetingLink: 'https://zoom.example/j/999' }],
  ]) {
    const d = deps(attempt(stored), live);
    await expect(sendPreSiteDistribution(input, d)).rejects.toMatchObject({ code: 'distribution_session_stale' });
    expect(d.createEmailActivity).not.toHaveBeenCalled();
  }

  for (const [stored, live] of [[snapshot, SESSION], [null, null], [JSON.stringify(snapshot), SESSION]]) {
    const d = deps(attempt(stored), live);
    await expect(sendPreSiteDistribution(input, d)).rejects.not.toMatchObject({ code: 'distribution_session_stale' });
  }
});

test('prepare refuses when the briefing page is not enabled, before any persistence or file work', async () => {
  const off = createPrepareHarness();
  off.dependencies.briefingReady = () => false;
  off.dependencies.ensureBriefingLink = jest.fn();
  await expect(preparePreSiteDistribution(prepareInput(), off.dependencies))
    .rejects.toMatchObject({ code: 'distribution_briefing_required', httpStatus: 503 });
  expect(off.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
  expect(off.dependencies.ensureBriefingLink).not.toHaveBeenCalled();
  const unwired = createPrepareHarness();
  delete unwired.dependencies.ensureBriefingLink;
  await expect(preparePreSiteDistribution(prepareInput(), unwired.dependencies))
    .rejects.toMatchObject({ code: 'distribution_briefing_required' });
  expect(unwired.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
});

function createPrepareHarness({
  mutateWordDuringPdf = false,
  provisionalWordETag = 'word-etag',
  settledWordVersionId = '1.0',
  briefGate = briefGateFixture(),
  // Real store semantics (distribution-store.js createOrGetDistributionAttempt):
  // INSERT ON CONFLICT (operation_id) DO NOTHING, so a repeat call with the
  // same operationId returns the FIRST-persisted row untouched, letting the
  // service's own draft_hash comparison decide reuse vs conflict. Off by
  // default so existing single-call-per-operationId tests keep their
  // simpler always-overwrite mock unchanged.
  dedupeAttempts = false,
} = {}) {
  const sourceDocumentId = '44444444-4444-4444-8444-444444444444';
  const sourceBytes = Buffer.from('governed-word-bytes');
  const pdfBytes = Buffer.from('%PDF-frozen-bytes');
  const sourceHash = 'gdc1:source-hash';
  const sourceRow = {
    wmkf_requestdocumentid: sourceDocumentId,
    _wmkf_request_value: REQUEST_ID,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_sharepointsiteid: 'source-site',
    wmkf_sharepointdriveid: 'source-drive',
    wmkf_sharepointitemid: 'source-item',
    wmkf_sharepointfolderpath: 'Requests/1002379',
    wmkf_filename: 'PreSite.docx',
    wmkf_cyclecode: 'D26',
    wmkf_presiteinputsnapshotjson: briefGate.snapshotJson,
    wmkf_inputfingerprint: briefGate.fingerprint,
  };
  let attempt = null;
  const attemptsByOperationId = new Map();
  const snapshots = [];
  let snapshotSequence = 0;
  let wordMetadataReads = 0;
  let uuidSequence = 6;
  let settledWordVersion = settledWordVersionId;
  let settledWordETag = 'word-etag';
  // Plan §11 (Step C1): the review bundle's assembled bytes, tracked by
  // itemId so getFileMetadataById/downloadFile can serve back exactly what
  // was uploaded (its size varies with the review set, unlike the fixed
  // sourceBytes/pdfBytes used for the word/pdf snapshots).
  let uploadedBundleBytes = null;
  let uploadedBundleFilename = 'bundle.pdf';

  const metadata = (itemId, versionId, eTag, size, name) => ({
    siteId: 'snapshot-site',
    driveId: 'snapshot-drive',
    id: itemId,
    versionId,
    eTag,
    size,
    name,
    webUrl: `https://sharepoint.test/${name}`,
    lastModified: '2026-08-23T12:00:00Z',
  });

  const dependencies = {
    // The link is mandatory since 2026-09-10; individual tests override these
    // to exercise the refusal paths.
    briefingReady: () => true,
    ensureBriefingLink: jest.fn(async () => ({
      link: { id: '12121212-1212-4212-8212-121212121212', url: 'https://apps.test/external/briefing/default-token', expiresAt: '2026-12-18T00:00:00.000Z' },
      reused: false,
    })),
    recordBriefingLink: jest.fn(async (_operationId, briefingLinkId) => {
      attempt = { ...attempt, briefing_link_id: briefingLinkId };
      if (dedupeAttempts) attemptsByOperationId.set(attempt.operation_id, attempt);
      return attempt;
    }),
    getRequest: jest.fn(async () => ({
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: '1002379',
      _wmkf_currentprerpbrief_value: sourceDocumentId,
    })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [sourceRow] })),
    loadPreRpBriefInputs: briefGate.loadPreRpBriefInputs,
    createOrGetAttempt: jest.fn(async (input) => {
      if (dedupeAttempts && attemptsByOperationId.has(input.operationId)) {
        attempt = attemptsByOperationId.get(input.operationId);
        return attempt;
      }
      attempt = {
        operation_id: input.operationId,
        request_id: input.requestId,
        source_document_id: input.sourceDocumentId,
        attachment_mode: input.attachmentMode,
        to_recipients: input.toRecipients,
        cc_recipients: input.ccRecipients,
        subject: input.subject,
        body_text: input.bodyText,
        body_html: input.bodyHtml,
        from_email: input.fromEmail,
        acting_user_system_id: input.actingUserSystemId,
        draft_hash: input.draftHash,
        template_version: input.templateVersion,
        calendar_enabled: input.calendarEnabled,
        site_visit_id: input.siteVisitId,
        site_visit_etag: input.siteVisitEtag,
        site_visit_snapshot: input.siteVisitSnapshot,
        material_links: input.materialLinks,
        calendar_filename: input.calendar?.filename || null,
        calendar_content_type: input.calendar?.contentType || null,
        calendar_byte_hash: input.calendar?.byteHash || null,
        calendar_size: input.calendar?.size || null,
        input_fingerprint_generated: input.inputFingerprintGenerated || null,
        input_fingerprint_live: input.inputFingerprintLive || null,
        stale_inputs_delta: input.staleInputsDelta || null,
        stale_inputs_acknowledged_at: input.staleInputsAcknowledgedAt || null,
        stale_inputs_acknowledged_by: input.staleInputsAcknowledgedBy || null,
        state: 'preparing',
      };
      if (dedupeAttempts) attemptsByOperationId.set(input.operationId, attempt);
      return attempt;
    }),
    recordSource: jest.fn(async (_operationId, captured) => {
      attempt = {
        ...attempt,
        source_drive_id: captured.driveId,
        source_item_id: captured.itemId,
        source_version_id: captured.versionId,
        source_content_hash: captured.contentHash,
        source_byte_hash: captured.byteHash,
        source_filename: captured.filename,
      };
      if (dedupeAttempts) attemptsByOperationId.set(attempt.operation_id, attempt);
      return attempt;
    }),
    findDocumentByGenerationKey: jest.fn(async (generationKey) => ({
      records: snapshots
        .filter((row) => row.wmkf_generationkey === generationKey)
        .map((row) => ({ ...row })),
    })),
    createDocument: jest.fn(async (payload) => {
      snapshotSequence += 1;
      const row = {
        ...payload,
        // Sequential ids: a re-prepare builds a second DOCX and a second PDF
        // snapshot, and updateDocument finds rows by id.
        wmkf_requestdocumentid: `${String(4 + snapshotSequence).repeat(8)}-${String(4 + snapshotSequence).repeat(4)}-4${String(4 + snapshotSequence).repeat(3)}-8${String(4 + snapshotSequence).repeat(3)}-${String(4 + snapshotSequence).repeat(12)}`,
        _wmkf_request_value: REQUEST_ID,
        _wmkf_sourcedocument_value: payload['wmkf_SourceDocument@odata.bind']
          .match(/\(([^)]+)\)/)?.[1],
        _etag: `snapshot-${snapshotSequence}`,
        modifiedon: '2026-08-23T12:00:00Z',
      };
      delete row['wmkf_Request@odata.bind'];
      delete row['wmkf_SourceDocument@odata.bind'];
      snapshots.push(row);
      return row.wmkf_requestdocumentid;
    }),
    updateDocument: jest.fn(async (id, patch) => {
      const row = snapshots.find((candidate) => candidate.wmkf_requestdocumentid === id);
      Object.assign(row, patch, { _etag: `${row._etag}-next` });
    }),
    ensureFolderPath: jest.fn(async () => undefined),
    getFileMetadataByPath: jest.fn(async () => null),
    // Plan §11 (Step C1): the default review file is `review-1.pdf`
    // (briefEnvelope's default review), so assembleReviewBundle's happy
    // path downloads it directly rather than converting via Graph.
    downloadFileByPath: jest.fn(async () => ({ buffer: REVIEW_PART_PDF })),
    uploadFile: jest.fn(async (_library, _folder, filename, buffer, contentType) => {
      if (contentType === PRE_SITE_VISIT_CONTRACT.contentType) {
        return metadata('word-snapshot', 'ctag-provisional', provisionalWordETag, buffer.length, filename);
      }
      if (/ - Reviews - /.test(filename)) {
        uploadedBundleBytes = buffer;
        uploadedBundleFilename = filename;
        return metadata('bundle-snapshot', 'ctag-bundle', 'bundle-etag', buffer.length, filename);
      }
      return metadata('pdf-snapshot', 'ctag-pdf', 'pdf-etag', buffer.length, filename);
    }),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      if (driveId === 'source-drive' && itemId === 'source-item') {
        return {
          driveId,
          id: itemId,
          versionId: '2.0',
          eTag: 'source-etag',
          lastModified: '2026-08-23T11:00:00Z',
          size: sourceBytes.length,
          name: sourceRow.wmkf_filename,
        };
      }
      if (itemId === 'word-snapshot') {
        wordMetadataReads += 1;
        const versionId = mutateWordDuringPdf && wordMetadataReads >= 3
          ? '2.0'
          : settledWordVersion;
        return metadata(itemId, versionId, settledWordETag, sourceBytes.length, 'snapshot.docx');
      }
      if (itemId === 'pdf-snapshot') {
        return metadata(itemId, '1.0', 'pdf-etag', pdfBytes.length, 'snapshot.pdf');
      }
      if (itemId === 'bundle-snapshot') {
        return metadata(itemId, '1.0', 'bundle-etag', uploadedBundleBytes ? uploadedBundleBytes.length : 0, uploadedBundleFilename);
      }
      return null;
    }),
    downloadFile: jest.fn(async (_driveId, itemId) => (
      itemId === 'bundle-snapshot'
        ? { buffer: uploadedBundleBytes, filename: uploadedBundleFilename }
        : { buffer: sourceBytes, filename: sourceRow.wmkf_filename }
    )),
    downloadFileVersion: jest.fn(),
    downloadFileAsPdf: jest.fn(async () => pdfBytes),
    hashDocx: jest.fn(async () => sourceHash),
    recordPrepared: jest.fn(async (_operationId, prepared) => {
      attempt = {
        ...attempt,
        state: 'prepared',
        preview_hash: prepared.previewHash,
        docx_snapshot_document_id: prepared.docx.documentId,
        docx_drive_id: prepared.docx.driveId,
        docx_item_id: prepared.docx.itemId,
        docx_version_id: prepared.docx.versionId,
        docx_filename: prepared.docx.filename,
        docx_content_type: prepared.docx.contentType,
        docx_byte_hash: prepared.docx.byteHash,
        docx_size: prepared.docx.size,
        pdf_snapshot_document_id: prepared.pdf?.documentId || null,
        pdf_drive_id: prepared.pdf?.driveId || null,
        pdf_item_id: prepared.pdf?.itemId || null,
        pdf_version_id: prepared.pdf?.versionId || null,
        pdf_filename: prepared.pdf?.filename || null,
        pdf_content_type: prepared.pdf?.contentType || null,
        pdf_byte_hash: prepared.pdf?.byteHash || null,
        pdf_size: prepared.pdf?.size || null,
        calendar_filename: prepared.calendar?.filename || null,
        calendar_content_type: prepared.calendar?.contentType || null,
        calendar_byte_hash: prepared.calendar?.byteHash || null,
        calendar_size: prepared.calendar?.size || null,
        review_bundle_document_id: prepared.reviewBundle?.documentId || null,
        review_bundle_drive_id: prepared.reviewBundle?.driveId || null,
        review_bundle_item_id: prepared.reviewBundle?.itemId || null,
        review_bundle_version_id: prepared.reviewBundle?.versionId || null,
        review_bundle_filename: prepared.reviewBundle?.filename || null,
        review_bundle_size: prepared.reviewBundle?.size || null,
        review_bundle_byte_hash: prepared.reviewBundle?.byteHash || null,
        review_bundle_set_fingerprint: prepared.reviewBundle?.setFingerprint || null,
        review_bundle_review_count: prepared.reviewBundle?.reviewCount || null,
      };
      if (dedupeAttempts) attemptsByOperationId.set(attempt.operation_id, attempt);
      return attempt;
    }),
    // Every prepare now builds both snapshots, so a re-prepare needs more than
    // two ids: hand them out sequentially and deterministically.
    randomUUID: jest.fn(() => {
      uuidSequence += 1;
      return `${String(uuidSequence).repeat(8)}-${String(uuidSequence).repeat(4)}-4${String(uuidSequence).repeat(3)}-8${String(uuidSequence).repeat(3)}-${String(uuidSequence).repeat(12)}`.slice(0, 36);
    }),
    now: jest.fn(() => new Date('2026-08-23T12:00:00Z')),
  };

  return {
    dependencies,
    snapshots,
    setWordPublication(versionId, eTag) {
      settledWordVersion = versionId;
      settledWordETag = eTag;
    },
  };
}

function prepareInput(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    expectedArtifactId: '44444444-4444-4444-8444-444444444444',
    operationId: OPERATION_ID,
    attachmentMode: 'none',
    to: 'staff@example.org',
    cc: 'consultant@example.org',
    subject: 'Frozen materials',
    bodyText: 'Attached.',
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
    ...overrides,
  };
}

describe('prepare-time review/drift gate (plan §3.4b)', () => {
  test('a malformed stored input snapshot fails closed before any persistence or file work', async () => {
    const gate = briefGateFixture();
    const harness = createPrepareHarness({ briefGate: { ...gate, snapshotJson: '{not-json' } });
    await expect(preparePreSiteDistribution(prepareInput(), harness.dependencies))
      .rejects.toMatchObject({ code: 'brief_snapshot_invalid', httpStatus: 409 });
    expect(harness.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
    expect(harness.dependencies.ensureBriefingLink).not.toHaveBeenCalled();
    expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  });

  test('a stored snapshot that no longer matches the row\'s recorded fingerprint fails closed before any persistence or file work', async () => {
    const gate = briefGateFixture();
    const harness = createPrepareHarness({ briefGate: { ...gate, fingerprint: 'f'.repeat(64) } });
    await expect(preparePreSiteDistribution(prepareInput(), harness.dependencies))
      .rejects.toMatchObject({ code: 'brief_snapshot_invalid', httpStatus: 409 });
    expect(harness.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
    expect(harness.dependencies.ensureBriefingLink).not.toHaveBeenCalled();
    expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  });

  test('a stored snapshot with no received reviews (B10) fails closed before any persistence or file work', async () => {
    const unreceived = briefEnvelope({
      reviews: [{ ...briefEnvelope().reviews[0], reviewReceivedAt: null }],
    });
    const gate = briefGateFixture({ generated: unreceived });
    const harness = createPrepareHarness({ briefGate: gate });
    await expect(preparePreSiteDistribution(prepareInput(), harness.dependencies))
      .rejects.toMatchObject({ code: 'brief_reviews_required', httpStatus: 409 });
    expect(harness.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
    expect(harness.dependencies.ensureBriefingLink).not.toHaveBeenCalled();
    expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  });

  test('at least one received review with no live drift succeeds and persists equal fingerprints with a null delta', async () => {
    const gate = briefGateFixture();
    const harness = createPrepareHarness({ briefGate: gate });
    await preparePreSiteDistribution(prepareInput(), harness.dependencies);
    const persisted = harness.dependencies.createOrGetAttempt.mock.calls[0][0];
    expect(persisted.inputFingerprintGenerated).toBe(gate.fingerprint);
    expect(persisted.inputFingerprintLive).toBe(gate.fingerprint);
    expect(persisted.staleInputsDelta).toBeNull();
    expect(persisted.staleInputsAcknowledgedAt).toBeNull();
    expect(persisted.staleInputsAcknowledgedBy).toBeNull();
  });

  test('drifted live inputs without an acknowledgement fail closed with the fingerprints and a bounded delta, before any write', async () => {
    const generated = briefEnvelope();
    const liveD1 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D1.' } });
    const gate = briefGateFixture({ generated, live: liveD1 });
    const harness = createPrepareHarness({ briefGate: gate });
    const liveFingerprintD1 = briefInputFingerprint(liveD1);
    await expect(preparePreSiteDistribution(prepareInput(), harness.dependencies))
      .rejects.toMatchObject({
        code: 'brief_inputs_stale',
        httpStatus: 409,
        body: {
          generatedFingerprint: gate.fingerprint,
          liveFingerprint: liveFingerprintD1,
          delta: expect.objectContaining({
            changedRequestFields: ['abstract'],
            abstractChanged: true,
          }),
        },
      });
    expect(harness.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
    expect(harness.dependencies.ensureBriefingLink).not.toHaveBeenCalled();
    expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  });

  test('a retry that echoes a now-stale acknowledgement fails closed again with the newly-current live fingerprint', async () => {
    const generated = briefEnvelope();
    const liveD1 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D1.' } });
    const liveD2 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D2.' } });
    const fingerprintD1 = briefInputFingerprint(liveD1);
    const fingerprintD2 = briefInputFingerprint(liveD2);
    const gate = briefGateFixture({ generated, live: liveD2 });
    const harness = createPrepareHarness({ briefGate: gate });
    await expect(preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      harness.dependencies,
    )).rejects.toMatchObject({
      code: 'brief_inputs_stale',
      httpStatus: 409,
      body: expect.objectContaining({ liveFingerprint: fingerprintD2 }),
    });
    expect(harness.dependencies.createOrGetAttempt).not.toHaveBeenCalled();
  });

  test('a retry that echoes the exact current live fingerprint succeeds and persists actor, time, both fingerprints, and the delta', async () => {
    const generated = briefEnvelope();
    const liveD2 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D2.' } });
    const fingerprintD2 = briefInputFingerprint(liveD2);
    const gate = briefGateFixture({ generated, live: liveD2 });
    const harness = createPrepareHarness({ briefGate: gate });
    await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD2 }),
      harness.dependencies,
    );
    const persisted = harness.dependencies.createOrGetAttempt.mock.calls[0][0];
    expect(persisted.inputFingerprintGenerated).toBe(gate.fingerprint);
    expect(persisted.inputFingerprintLive).toBe(fingerprintD2);
    expect(persisted.staleInputsDelta).toMatchObject({ abstractChanged: true, changedRequestFields: ['abstract'] });
    expect(persisted.staleInputsAcknowledgedAt).toBe('2026-08-23T12:00:00.000Z');
    expect(persisted.staleInputsAcknowledgedBy).toBe(ACTOR_ID);
  });

  test('the same operation id with the same acknowledged drift recovers the already-prepared attempt', async () => {
    const generated = briefEnvelope();
    const liveD1 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D1.' } });
    const fingerprintD1 = briefInputFingerprint(liveD1);
    const gate = briefGateFixture({ generated, live: liveD1 });
    const harness = createPrepareHarness({ briefGate: gate, dedupeAttempts: true });
    const first = await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      harness.dependencies,
    );
    expect(first.reused).toBeFalsy();
    const second = await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      harness.dependencies,
    );
    expect(second.reused).toBe(true);
    expect(second.attempt.attemptId).toBe(first.attempt.attemptId);
    // Only the first call built new snapshot documents (docx, pdf, and the
    // review bundle); the retry recovered the prepared attempt without
    // doing that file work again.
    expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(3);
  });

  test('the same operation id with a different acknowledgement conflicts instead of silently reusing the prior attempt', async () => {
    const generated = briefEnvelope();
    const liveD1 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D1.' } });
    const fingerprintD1 = briefInputFingerprint(liveD1);
    const gate = briefGateFixture({ generated, live: generated });
    const harness = createPrepareHarness({ briefGate: gate, dedupeAttempts: true });
    await preparePreSiteDistribution(prepareInput(), harness.dependencies);
    // Live inputs drift after the first prepare; a same-operation-id retry
    // now requires (and carries) an acknowledgement the first call did not.
    harness.dependencies.loadPreRpBriefInputs = jest.fn(async () => ({
      requestNumber: '1002379',
      cycleCode: 'D26',
      envelope: liveD1,
    }));
    await expect(preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'distribution_operation_conflict' });
  });

  test('draftHash and previewHash change when the acknowledged fingerprint changes', async () => {
    const generated = briefEnvelope();
    const liveD1 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D1.' } });
    const fingerprintD1 = briefInputFingerprint(liveD1);

    const noDrift = createPrepareHarness({ briefGate: briefGateFixture({ generated }) });
    const noDriftResult = await preparePreSiteDistribution(prepareInput(), noDrift.dependencies);
    const noDriftHash = noDrift.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

    const drifted = createPrepareHarness({ briefGate: briefGateFixture({ generated, live: liveD1 }) });
    const driftedResult = await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      drifted.dependencies,
    );
    const driftedHash = drifted.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

    expect(driftedHash).not.toBe(noDriftHash);
    expect(driftedResult.attempt.previewHash).not.toBe(noDriftResult.attempt.previewHash);
  });

  test('draftHash and previewHash ignore non-received suggestions because delta and fingerprint share one canonical form', async () => {
    const generated = briefEnvelope();
    const liveD1 = briefEnvelope({ request: { ...generated.request, abstract: 'Updated abstract D1.' } });
    const liveD1WithPendingReviewer = briefEnvelope({
      request: { ...generated.request, abstract: 'Updated abstract D1.' },
      reviews: [
        ...liveD1.reviews,
        {
          suggestionId: 'reviewer-pending',
          reviewReceivedAt: null,
          name: 'Reviewer Pending',
          academicRank: 'Associate Professor',
          reviewerOverallAssessment: null,
          reviewerAffiliation: 'Another University',
          mainInstitution: 'Another University',
          affiliation: 'Another University',
        },
      ],
    });
    const fingerprintD1 = briefInputFingerprint(liveD1);
    // The pending (non-received) reviewer changes neither canonical form.
    expect(briefInputFingerprint(liveD1WithPendingReviewer)).toBe(fingerprintD1);

    const withoutPending = createPrepareHarness({ briefGate: briefGateFixture({ generated, live: liveD1 }) });
    const withoutPendingResult = await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      withoutPending.dependencies,
    );
    const withoutPendingHash = withoutPending.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

    const withPending = createPrepareHarness({
      briefGate: briefGateFixture({ generated, live: liveD1WithPendingReviewer }),
    });
    const withPendingResult = await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: fingerprintD1 }),
      withPending.dependencies,
    );
    const withPendingHash = withPending.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

    expect(withPending.dependencies.createOrGetAttempt.mock.calls[0][0].inputFingerprintLive).toBe(
      withoutPending.dependencies.createOrGetAttempt.mock.calls[0][0].inputFingerprintLive,
    );
    expect(withPending.dependencies.createOrGetAttempt.mock.calls[0][0].staleInputsDelta).toEqual(
      withoutPending.dependencies.createOrGetAttempt.mock.calls[0][0].staleInputsDelta,
    );
    expect(withPending.dependencies.createOrGetAttempt.mock.calls[0][0].staleInputsDelta)
      .toMatchObject({ addedReviewerSuggestionIds: [], liveReviewCount: 1 });
    expect(withPendingHash).toBe(withoutPendingHash);
    expect(withPendingResult.attempt.previewHash).toBe(withoutPendingResult.attempt.previewHash);
  });

  test('a received timestamp rewrite changes both the fingerprint and the reviewer delta', async () => {
    const generated = briefEnvelope();
    const live = briefEnvelope({
      reviews: [{
        ...generated.reviews[0],
        reviewReceivedAt: '2026-09-02T00:00:00Z',
      }],
    });
    const liveFingerprint = briefInputFingerprint(live);
    expect(liveFingerprint).not.toBe(briefInputFingerprint(generated));

    const harness = createPrepareHarness({ briefGate: briefGateFixture({ generated, live }) });
    await preparePreSiteDistribution(
      prepareInput({ acknowledgeStaleInputs: liveFingerprint }),
      harness.dependencies,
    );

    expect(harness.dependencies.createOrGetAttempt.mock.calls[0][0].staleInputsDelta)
      .toMatchObject({
        changedReviewerSuggestionIds: ['reviewer-1'],
        generatedReviewCount: 1,
        liveReviewCount: 1,
      });
  });

  test('send fails closed as distribution_stale_source for a pre-existing unsent attempt sourced from a legacy Pre-Site row', async () => {
    const row = attemptFixture();
    const dependencies = {
      getLiveBriefingLink: jest.fn(async () => ({ id: FIXTURE_BRIEFING_LINK_ID, url: 'https://apps.test/external/briefing/fixture-token' })),
      getRequest: jest.fn(async () => ({
        akoya_requestid: row.request_id,
        // No brief has ever been generated for this request — the pointer
        // is null, and the source row below is the legacy Pre-Site type.
        _wmkf_currentprerpbrief_value: null,
      })),
      findDocumentsByRequest: jest.fn(async () => ({ records: [{
        wmkf_requestdocumentid: row.source_document_id,
        _wmkf_request_value: row.request_id,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
        wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
        wmkf_sharepointsiteid: 'site',
        wmkf_sharepointdriveid: row.source_drive_id,
        wmkf_sharepointitemid: row.source_item_id,
        wmkf_sharepointfolderpath: 'Requests/1002379',
      }] })),
      getFileMetadataById: jest.fn(async () => ({
        driveId: row.source_drive_id,
        id: row.source_item_id,
        versionId: row.source_version_id,
      })),
      getAttempt: jest.fn(async () => row),
      claimSend: jest.fn(async () => row),
      findEmailByCorrelation: jest.fn(),
      createEmailActivity: jest.fn(),
      recordFailure: jest.fn(async () => row),
    };

    await expect(sendPreSiteDistribution({
      requestId: REQUEST_ID,
      operationId: OPERATION_ID,
      previewHash: 'a'.repeat(64),
      fromEmail: 'sender@example.org',
      actingUserSystemId: ACTOR_ID,
    }, dependencies)).rejects.toMatchObject({ code: 'distribution_stale_source' });
    expect(dependencies.findEmailByCorrelation).not.toHaveBeenCalled();
    expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
  });
});

test('prepare persists native Graph publication versions instead of provisional cTags', async () => {
  const harness = createPrepareHarness();

  const result = await preparePreSiteDistribution(prepareInput(), harness.dependencies);

  expect(result.attempt.state).toBe('prepared');
  expect(result.attempt.attachments).toEqual([]);
  const pinned = harness.dependencies.recordPrepared.mock.calls[0][1];
  expect([pinned.docx.versionId, pinned.pdf.versionId, pinned.reviewBundle.versionId]).toEqual(['1.0', '1.0', '1.0']);
  expect(harness.snapshots.map((row) => row.wmkf_sharepointversionid))
    .toEqual(['1.0', '1.0', '1.0']);
});

test('prepare accepts the settled stable-ID eTag when the upload response eTag is provisional', async () => {
  const harness = createPrepareHarness({ provisionalWordETag: 'upload-response-etag' });

  const result = await preparePreSiteDistribution(
    prepareInput({ attachmentMode: 'none' }),
    harness.dependencies,
  );

  expect(result.attempt.attachments).toEqual([]);
  expect(harness.dependencies.recordPrepared.mock.calls[0][1].docx.versionId).toBe('1.0');
  expect(harness.snapshots[0].wmkf_sharepointetag).toBe('word-etag');
});

test('prepare refuses a material selection (retired) and binds one informational calendar to the preview', async () => {
  const harness = createPrepareHarness();
  const materialId = '99999999-9999-4999-8999-999999999999';
  const sourceResult = await harness.dependencies.findDocumentsByRequest();
  const material = {
    wmkf_requestdocumentid: materialId,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_filename: 'Applicant <Slides>.pdf',
    wmkf_sharepointweburl: 'https://sharepoint.test/slides?a=1&b=2',
    wmkf_sharepointdriveid: 'materials-drive',
    wmkf_sharepointitemid: 'slides-item',
    wmkf_sharepointversionid: '3.0',
  };
  harness.dependencies.findDocumentsByRequest.mockResolvedValue({
    records: [...sourceResult.records, material],
  });
  harness.dependencies.schemaReady = jest.fn(() => true);
  harness.dependencies.getSiteVisitById = jest.fn(async () => ({
    activityid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    _etag: 'W/"7"',
    _regardingobjectid_value: REQUEST_ID,
    statecode: 0,
    subject: 'Site Visit',
    description: 'Discussion',
    scheduledstart: '2026-09-15T14:00:00Z',
    scheduledend: '2026-09-15T16:00:00Z',
    wmkf_ianatimezone: 'America/Chicago',
    wmkf_visitformat: 100000002,
    wmkf_locationorlink: 'Conference room / Teams',
    wmkf_attendeerefsjson: JSON.stringify({
      version: 1,
      organizer: { kind: 'staff', profileId: 7 },
      requiredAttendees: [],
      optionalAttendees: [],
    }),
    modifiedon: '2026-08-24T12:34:56Z',
    wmkf_SiteVisit_activity_parties: [{
      participationtypemask: 7,
      addressused: 'organizer@wmkeck.org',
    }],
  }));

  // Material links are retired (owner 2026-09-10): a selection is refused
  // before any persistence, even for an eligible Ready material.
  await expect(preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    includeCalendar: true,
    siteVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    selectedMaterialIds: [materialId],
  }), harness.dependencies)).rejects.toMatchObject({ code: 'distribution_material_links_retired', httpStatus: 400 });
  expect(harness.dependencies.createOrGetAttempt).not.toHaveBeenCalled();

  const result = await preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    includeCalendar: true,
    siteVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), harness.dependencies);

  // Nothing but the informational calendar is attached; the writeup and the
  // materials ride the briefing page.
  expect(result.attempt.attachments.map((attachment) => attachment.kind))
    .toEqual(['calendar']);
  expect(result.attempt.materialLinks).toEqual([]);
  expect(result.attempt.calendarEnabled).toBe(true);
  expect(result.attempt.bodyText).toBe('Attached.');
  const persisted = harness.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(persisted.toRecipients).toEqual(['staff@example.org', 'organizer@wmkeck.org']);
  expect(persisted.ccRecipients).toEqual(['consultant@example.org']);
  expect(persisted.bodyHtml).not.toContain('Applicant');
  expect(persisted.bodyHtml).toContain('the research presentation materials, no login required');
  expect(persisted.calendar.content.toString('utf8')).toContain('METHOD:PUBLISH');
  expect(persisted.calendar.content.toString('utf8'))
    .toContain('ORGANIZER:mailto:organizer@wmkeck.org');
  expect(persisted.calendar.content.toString('utf8')).not.toContain('ATTENDEE');
});

test('calendar organizer is moved from Cc to To before preview persistence', async () => {
  const harness = createPrepareHarness();
  harness.dependencies.schemaReady = jest.fn(() => true);
  harness.dependencies.getSiteVisitById = jest.fn(async () => ({
    activityid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    _etag: 'W/"7"',
    _regardingobjectid_value: REQUEST_ID,
    statecode: 0,
    subject: 'Site Visit',
    scheduledstart: '2026-09-15T14:00:00Z',
    scheduledend: '2026-09-15T16:00:00Z',
    wmkf_attendeerefsjson: JSON.stringify({
      version: 1,
      organizer: { kind: 'staff', profileId: 7 },
      requiredAttendees: [],
      optionalAttendees: [],
    }),
    modifiedon: '2026-08-24T12:34:56Z',
    wmkf_SiteVisit_activity_parties: [{
      participationtypemask: 7,
      addressused: 'ORGANIZER@wmkeck.org',
    }],
  }));

  await preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    cc: 'organizer@wmkeck.org, consultant@example.org',
    includeCalendar: true,
    siteVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), harness.dependencies);

  const persisted = harness.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(persisted.toRecipients).toEqual(['staff@example.org', 'organizer@wmkeck.org']);
  expect(persisted.ccRecipients).toEqual(['consultant@example.org']);
});

test('the calendar selection participates in the draft identity; a material selection is refused', async () => {
  const base = createPrepareHarness();
  await preparePreSiteDistribution(prepareInput({ attachmentMode: 'none' }), base.dependencies);
  const baseHash = base.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

  const materialId = '99999999-9999-4999-8999-999999999999';
  const material = createPrepareHarness();
  const materialSource = await material.dependencies.findDocumentsByRequest();
  material.dependencies.findDocumentsByRequest.mockResolvedValue({
    records: [
      ...materialSource.records,
      {
        wmkf_requestdocumentid: materialId,
        _wmkf_request_value: REQUEST_ID,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
        wmkf_filename: 'Applicant Slides.pdf',
        wmkf_sharepointweburl: 'https://sharepoint.test/slides',
        wmkf_sharepointdriveid: 'materials-drive',
        wmkf_sharepointitemid: 'slides-item',
        wmkf_sharepointversionid: '3.0',
      },
    ],
  });
  // Material links are retired: a selection is refused before the draft
  // identity is ever computed (the calendar still participates below).
  await expect(preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    selectedMaterialIds: [materialId],
  }), material.dependencies)).rejects.toMatchObject({ code: 'distribution_material_links_retired' });
  expect(material.dependencies.createOrGetAttempt).not.toHaveBeenCalled();

  const extended = createPrepareHarness();
  extended.dependencies.schemaReady = jest.fn(() => true);
  extended.dependencies.getSiteVisitById = jest.fn(async () => ({
    activityid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    _etag: 'W/"7"',
    _regardingobjectid_value: REQUEST_ID,
    statecode: 0,
    subject: 'Site Visit',
    scheduledstart: '2026-09-15T14:00:00Z',
    scheduledend: '2026-09-15T16:00:00Z',
    wmkf_attendeerefsjson: JSON.stringify({
      version: 1,
      organizer: { kind: 'staff', profileId: 7 },
      requiredAttendees: [],
      optionalAttendees: [],
    }),
    modifiedon: '2026-08-24T12:34:56Z',
    wmkf_SiteVisit_activity_parties: [{
      participationtypemask: 7,
      addressused: 'organizer@wmkeck.org',
    }],
  }));
  await preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    includeCalendar: true,
    siteVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), extended.dependencies);
  const extendedHash = extended.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;
  expect(extendedHash).not.toBe(baseHash);
});

test('byte-identical Ready snapshot metadata drift refreshes the registry and remains reusable', async () => {
  const harness = createPrepareHarness();
  await preparePreSiteDistribution(
    prepareInput({ attachmentMode: 'none' }),
    harness.dependencies,
  );
  harness.setWordPublication('2.0', 'word-etag-2');

  const result = await preparePreSiteDistribution(prepareInput({
    operationId: '99999999-9999-4999-8999-999999999999',
    attachmentMode: 'none',
  }), harness.dependencies);

  expect(result.attempt.attachments).toEqual([]);
  expect(harness.dependencies.recordPrepared.mock.calls[1][1].docx.versionId).toBe('2.0');
  expect(harness.snapshots[0]).toMatchObject({
    wmkf_sharepointversionid: '2.0',
    wmkf_sharepointetag: 'word-etag-2',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
  });
});

test('prepare rejects PDF conversion when the frozen Word publication changes mid-conversion', async () => {
  const harness = createPrepareHarness({ mutateWordDuringPdf: true });

  await expect(preparePreSiteDistribution(
    prepareInput(),
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'distribution_pdf_source_changed' });
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.recordPrepared).not.toHaveBeenCalled();
});

const FIXTURE_BRIEFING_LINK_ID = '13131313-1313-4313-8313-131313131313';

function attemptFixture(overrides = {}) {
  return {
    // Bound link by default: since 2026-09-10 every sendable preview carries one.
    briefing_link_id: FIXTURE_BRIEFING_LINK_ID,
    operation_id: OPERATION_ID,
    request_id: REQUEST_ID,
    source_document_id: '44444444-4444-4444-8444-444444444444',
    source_drive_id: 'drive',
    source_item_id: 'working-word',
    source_version_id: '2.0',
    attachment_mode: 'both',
    to_recipients: ['staff@example.org'],
    cc_recipients: ['consultant@example.org'],
    subject: 'Frozen materials',
    body_text: 'Attached.',
    body_html: '<p>Attached.</p>',
    from_email: 'sender@example.org',
    acting_user_system_id: ACTOR_ID,
    draft_hash: 'b'.repeat(64),
    preview_hash: 'a'.repeat(64),
    state: 'prepared',
    docx_snapshot_document_id: '55555555-5555-4555-8555-555555555555',
    docx_drive_id: 'drive',
    docx_item_id: 'word-item',
    docx_version_id: '1.0',
    docx_web_url: 'https://sharepoint.test/word',
    docx_filename: 'frozen.docx',
    docx_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docx_byte_hash: 'c'.repeat(64),
    docx_size: 10,
    pdf_snapshot_document_id: '66666666-6666-4666-8666-666666666666',
    pdf_drive_id: 'drive',
    pdf_item_id: 'pdf-item',
    pdf_version_id: '1.0',
    pdf_web_url: 'https://sharepoint.test/pdf',
    pdf_filename: 'frozen.pdf',
    pdf_content_type: 'application/pdf',
    pdf_byte_hash: 'd'.repeat(64),
    pdf_size: 20,
    attempt_count: 0,
    ...overrides,
  };
}

function currentSourceDependencies(row) {
  return {
    getLiveBriefingLink: jest.fn(async () => ({ id: FIXTURE_BRIEFING_LINK_ID, url: 'https://apps.test/external/briefing/fixture-token' })),
    getRequest: jest.fn(async () => ({
      akoya_requestid: row.request_id,
      _wmkf_currentprerpbrief_value: row.source_document_id,
    })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: row.source_document_id,
      _wmkf_request_value: row.request_id,
      wmkf_operationstatus: 100000001,
      wmkf_lifecyclestate: 100000001,
      wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
      wmkf_contenttype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: row.source_drive_id,
      wmkf_sharepointitemid: row.source_item_id,
      wmkf_sharepointfolderpath: 'Requests/1002379',
    }] })),
    getFileMetadataById: jest.fn(async () => ({
      driveId: row.source_drive_id,
      id: row.source_item_id,
      versionId: row.source_version_id,
    })),
  };
}

function emailFixture(row, overrides = {}) {
  return {
    activityid: row.dynamics_email_id || '88888888-8888-4888-8888-888888888888',
    subject: row.subject,
    description: row.body_html,
    subcategory: `wmkf-pre-site-distribution:${row.operation_id}`,
    statuscode: 1,
    email_activity_parties: [
      { participationtypemask: 1, addressused: row.from_email },
      ...row.to_recipients.map((addressused) => ({ participationtypemask: 2, addressused })),
      ...row.cc_recipients.map((addressused) => ({ participationtypemask: 3, addressused })),
    ],
    ...overrides,
  };
}

test('projects only the selected attachment mode', () => {
  const projected = projectDistributionAttempt(attemptFixture({ attachment_mode: 'pdf' }));
  expect(projected.attachments.map((file) => file.kind)).toEqual(['pdf']);
});

test('projects the stored failure code so the UI can classify stale previews', () => {
  const projected = projectDistributionAttempt(attemptFixture({
    last_error_code: 'distribution_material_stale',
    last_error_message: 'A linked Site Visit material changed after preview. Prepare a new exact preview.',
  }));
  expect(projected.lastErrorCode).toBe('distribution_material_stale');
  expect(projected.lastError).toMatch(/changed after preview/);
  expect(projectDistributionAttempt(attemptFixture()).lastErrorCode).toBeNull();
});

test('history marks a retained distribution changed when the working Word version advances', async () => {
  const attempt = attemptFixture({ source_version_id: '1.0' });
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [attempt]),
    getRequest: jest.fn(async () => ({ _wmkf_currentprerpbrief_value: attempt.source_document_id })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: attempt.source_document_id,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'working-word',
    }] })),
    getFileMetadataById: jest.fn(async () => ({ versionId: '2.0' })),
    hasSentAttemptForSource: jest.fn(async () => false),
  });
  expect(result.attempts[0].sourceFreshness).toBe('changed');
  expect(result.currentSourceEverSent).toBe(false);
});

test('history resolves the drift-acknowledging actor to a name once per distinct actor; send-time projections carry none', async () => {
  const ACTOR = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
  const acknowledged = attemptFixture({
    input_fingerprint_generated: 'a'.repeat(64),
    input_fingerprint_live: 'b'.repeat(64),
    stale_inputs_delta: JSON.stringify({ changedRequestFields: ['akoya_title'] }),
    stale_inputs_acknowledged_at: '2026-09-05T11:55:00Z',
    stale_inputs_acknowledged_by: ACTOR,
  });
  const getSystemUserName = jest.fn(async () => 'Ada Staff');
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [acknowledged, { ...acknowledged, id: 'attempt-2' }, attemptFixture()]),
    getRequest: jest.fn(async () => ({})),
    hasSentAttemptForSource: jest.fn(async () => false),
    getSystemUserName,
  });
  expect(getSystemUserName).toHaveBeenCalledTimes(1);
  expect(getSystemUserName).toHaveBeenCalledWith(ACTOR.toLowerCase());
  expect(result.attempts[0].staleInputsAcknowledged).toMatchObject({
    acknowledgedBy: ACTOR,
    acknowledgedByName: 'Ada Staff',
  });
  expect(result.attempts[1].staleInputsAcknowledged.acknowledgedByName).toBe('Ada Staff');
  expect(result.attempts[2].staleInputsAcknowledged).toBeNull();
  expect(projectDistributionAttempt(acknowledged).staleInputsAcknowledged.acknowledgedByName).toBeNull();
});

test('history leaves the actor name null and still returns when the name lookup fails', async () => {
  const acknowledged = attemptFixture({
    input_fingerprint_generated: 'a'.repeat(64),
    input_fingerprint_live: 'b'.repeat(64),
    stale_inputs_delta: JSON.stringify({}),
    stale_inputs_acknowledged_at: '2026-09-05T11:55:00Z',
    stale_inputs_acknowledged_by: '11111111-1111-4111-8111-111111111111',
  });
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
      listAttempts: jest.fn(async () => [acknowledged]),
      getRequest: jest.fn(async () => ({})),
      hasSentAttemptForSource: jest.fn(async () => false),
      getSystemUserName: jest.fn(async () => { throw new Error('dataverse down'); }),
    });
    expect(result.attempts[0].staleInputsAcknowledged).toMatchObject({
      acknowledgedBy: '11111111-1111-4111-8111-111111111111',
      acknowledgedByName: null,
    });
  } finally {
    errorSpy.mockRestore();
  }
});

test('history returns configured Share defaults and preserves built-in fallbacks for blank values', async () => {
  const attempt = attemptFixture({ source_version_id: '1.0' });
  const getSettingStrict = jest.fn(async (key) => (
    key === 'email.deliberation_share.subject'
      ? { found: true, value: 'Discussion notes — {{requestNumber}}' }
      : { found: true, value: '   ' }
  ));
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [attempt]),
    getRequest: jest.fn(async () => ({ _wmkf_currentprerpbrief_value: null })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getFileMetadataById: jest.fn(async () => null),
    hasSentAttemptForSource: jest.fn(async () => false),
    getSettingStrict,
  });
  expect(result.emailDefaults).toMatchObject({
    subjectTemplate: 'Discussion notes — {{requestNumber}}',
    bodyTemplate: expect.stringContaining('deliberation briefing page'),
    briefingCopy: DELIBERATION_SHARE_SEED_BRIEFING_COPY,
    configured: false,
    unavailable: false,
  });
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.subject');
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.body');
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.briefing_heading');
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.briefing_link_text');
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.briefing_description');
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.briefing_expiry_lead_in');
  expect(getSettingStrict).toHaveBeenCalledWith('email.deliberation_share.review_bundle_link_text');
});

test('history marks Share defaults configured only when every stored value is non-blank', async () => {
  const configured = {
    'email.deliberation_share.subject': 'Notes — {{requestNumber}}',
    'email.deliberation_share.body': 'Use the briefing page.',
    'email.deliberation_share.briefing_heading': 'Decision packet:',
    'email.deliberation_share.briefing_link_text': 'Open the packet',
    'email.deliberation_share.briefing_description': 'background and review materials.',
    'email.deliberation_share.briefing_expiry_lead_in': 'Available until',
    'email.deliberation_share.review_bundle_link_text': 'Get every review',
  };
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => []),
    getRequest: jest.fn(async () => ({ _wmkf_currentprerpbrief_value: null })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getFileMetadataById: jest.fn(async () => null),
    hasSentAttemptForSource: jest.fn(async () => false),
    getSettingStrict: jest.fn(async (key) => ({ found: true, value: configured[key] })),
  });
  expect(result.emailDefaults).toEqual({
    subjectTemplate: 'Notes — {{requestNumber}}',
    bodyTemplate: 'Use the briefing page.',
    briefingCopy: {
      heading: 'Decision packet:',
      linkText: 'Open the packet',
      description: 'background and review materials.',
      expiryLeadIn: 'Available until',
      reviewBundleLinkText: 'Get every review',
    },
    configured: true,
    unavailable: false,
  });
});

test('history reports unavailable Share defaults while retaining built-in wording', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => []),
    getRequest: jest.fn(async () => ({ _wmkf_currentprerpbrief_value: null })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getFileMetadataById: jest.fn(async () => null),
    hasSentAttemptForSource: jest.fn(async () => false),
    getSettingStrict: jest.fn(async () => { throw new Error('Dataverse 503'); }),
  });
  expect(result.emailDefaults).toMatchObject({
    subjectTemplate: 'Site Visit materials — {{requestNumber}}',
    bodyTemplate: expect.stringContaining('deliberation briefing page'),
    briefingCopy: DELIBERATION_SHARE_SEED_BRIEFING_COPY,
    configured: false,
    unavailable: true,
  });
  expect(consoleSpy).toHaveBeenCalledTimes(7);
  consoleSpy.mockRestore();
});

test('history derives currentSourceEverSent from the uncapped store check scoped to the current document', async () => {
  const attempt = attemptFixture({ source_version_id: '1.0' });
  const hasSentAttemptForSource = jest.fn(async () => true);
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [attempt]),
    getRequest: jest.fn(async () => ({ _wmkf_currentprerpbrief_value: attempt.source_document_id })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: attempt.source_document_id,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'working-word',
    }] })),
    getFileMetadataById: jest.fn(async () => ({ versionId: '1.0' })),
    hasSentAttemptForSource,
  });
  expect(hasSentAttemptForSource).toHaveBeenCalledWith(REQUEST_ID, attempt.source_document_id);
  expect(result.currentSourceEverSent).toBe(true);
});

test('history reports currentSourceEverSent=false when no current document resolves', async () => {
  const attempt = attemptFixture({ source_version_id: '1.0' });
  const hasSentAttemptForSource = jest.fn(async () => true);
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [attempt]),
    getRequest: jest.fn(async () => ({ _wmkf_currentprerpbrief_value: null })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getFileMetadataById: jest.fn(async () => null),
    hasSentAttemptForSource,
  });
  expect(hasSentAttemptForSource).not.toHaveBeenCalled();
  expect(result.currentSourceEverSent).toBe(false);
});

test('a no-attachment send creates the activity, attaches nothing, and reaches sent without touching the attachment ledger', async () => {
  let row = attemptFixture({ attachment_mode: 'none', body_html: `<p>Hi</p><p><a href="${BRIEFING_LINK_PLACEHOLDER}">Open</a></p>` });
  const calls = [];
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777', attempt_count: 1 };
      return row;
    }),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(async () => '88888888-8888-4888-8888-888888888888'),
    recordEmailActivity: jest.fn(async (attempt, emailId) => {
      row = { ...attempt, dynamics_email_id: emailId, state: 'activity_created' };
      calls.push('activity');
      return row;
    }),
    findEmailAttachments: jest.fn(),
    downloadFile: jest.fn(),
    addEmailAttachment: jest.fn(),
    recordAttachment: jest.fn(),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row, {
        description: row.body_html.replace(BRIEFING_LINK_PLACEHOLDER, 'https://apps.test/external/briefing/fixture-token'),
      }))
      .mockResolvedValueOnce({ statuscode: 1 })
      .mockResolvedValueOnce({ statuscode: 6, statecode: 0 }),
    recordSendRequested: jest.fn(async (attempt) => {
      row = { ...attempt, state: 'send_requested', send_requested_at: new Date() };
      calls.push('send_requested');
      return row;
    }),
    renewSendLease: jest.fn(async (attempt) => attempt),
    sendEmail: jest.fn(async () => { calls.push('send'); }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), send_requested_at: new Date(), lease_token: null };
      calls.push('sent');
      return row;
    }),
    recordFailure: jest.fn(async () => row),
  };

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.attempt.transportAccepted).toBe(true);
  expect(result.attempt.attachments).toEqual([]);
  expect(calls).toEqual(['activity', 'send_requested', 'send', 'sent']);
  // The activity body carries the live link where the placeholder was.
  expect(dependencies.createEmailActivity.mock.calls[0][0].body).toContain('https://apps.test/external/briefing/fixture-token');
  expect(dependencies.addEmailAttachment).not.toHaveBeenCalled();
  expect(dependencies.recordAttachment).not.toHaveBeenCalled();
  expect(dependencies.downloadFile).not.toHaveBeenCalled();
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
});

test('send accepts an unchanged linked material after PostgreSQL JSONB reorders its object keys', async () => {
  const materialId = '99999999-9999-4999-8999-999999999999';
  const materialType = REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES;
  let row = attemptFixture({
    material_links: [{
      itemId: 'slides-item',
      webUrl: 'https://sharepoint.test/slides',
      driveId: 'materials-drive',
      filename: 'Applicant Slides.pdf',
      versionId: '3.0',
      artifactId: materialId,
      artifactType: materialType,
      artifactTypeLabel: REQUEST_DOCUMENT_ARTIFACT_LABEL[materialType],
    }],
  });
  const calls = [];
  const sourceDependencies = currentSourceDependencies(row);
  const sourceRecords = (await sourceDependencies.findDocumentsByRequest()).records;
  const dependencies = {
    ...sourceDependencies,
    findDocumentsByRequest: jest.fn(async () => ({ records: [
      ...sourceRecords,
      {
        wmkf_requestdocumentid: materialId,
        _wmkf_request_value: REQUEST_ID,
        wmkf_artifacttype: materialType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
        wmkf_filename: 'Applicant Slides.pdf',
        wmkf_sharepointweburl: 'https://sharepoint.test/slides',
        wmkf_sharepointdriveid: 'materials-drive',
        wmkf_sharepointitemid: 'slides-item',
        wmkf_sharepointversionid: '3.0',
      },
    ] })),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777', attempt_count: 1 };
      return row;
    }),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(async () => '88888888-8888-4888-8888-888888888888'),
    recordEmailActivity: jest.fn(async (attempt, emailId) => {
      row = { ...attempt, dynamics_email_id: emailId, state: 'activity_created' };
      calls.push('activity');
      return row;
    }),
    findEmailAttachments: jest.fn(async () => []),
    downloadFile: jest.fn(async (_drive, item) => ({
      buffer: item === 'word-item' ? Buffer.from('word-bytes') : Buffer.from('pdf-bytes'),
    })),
    addEmailAttachment: jest.fn(async (_emailId, attachment) => { calls.push(`add:${attachment.filename}`); }),
    recordAttachment: jest.fn(async (attempt, kind) => {
      row = {
        ...attempt,
        ...(kind === 'docx' ? { docx_attached_at: new Date() } : { pdf_attached_at: new Date() }),
      };
      calls.push(`persist:${kind}`);
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ statuscode: 1 })
      .mockResolvedValueOnce({ statuscode: 6, statecode: 0 }),
    recordSendRequested: jest.fn(async (attempt) => {
      row = { ...attempt, state: 'send_requested', send_requested_at: new Date() };
      calls.push('send_requested');
      return row;
    }),
    renewSendLease: jest.fn(async (attempt) => attempt),
    sendEmail: jest.fn(async () => { calls.push('send'); }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), send_requested_at: new Date(), lease_token: null };
      calls.push('sent');
      return row;
    }),
    recordFailure: jest.fn(async () => row),
  };
  // Match fixture hashes to the exact downloaded buffers.
  const crypto = await import('node:crypto');
  row.docx_byte_hash = crypto.createHash('sha256').update('word-bytes').digest('hex');
  row.pdf_byte_hash = crypto.createHash('sha256').update('pdf-bytes').digest('hex');

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.attempt.transportAccepted).toBe(true);
  expect(calls).toEqual([
    'activity',
    'add:frozen.docx', 'persist:docx',
    'add:frozen.pdf', 'persist:pdf',
    'send_requested', 'send', 'sent',
  ]);
  expect(dependencies.createEmailActivity).toHaveBeenCalledTimes(1);
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
});

test('send rejects a real linked-material version change before creating a Dynamics activity', async () => {
  const materialId = '99999999-9999-4999-8999-999999999999';
  const materialType = REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES;
  let row = attemptFixture({
    material_links: [{
      itemId: 'slides-item',
      webUrl: 'https://sharepoint.test/slides',
      driveId: 'materials-drive',
      filename: 'Applicant Slides.pdf',
      versionId: '3.0',
      artifactId: materialId,
      artifactType: materialType,
      artifactTypeLabel: REQUEST_DOCUMENT_ARTIFACT_LABEL[materialType],
    }],
  });
  const sourceDependencies = currentSourceDependencies(row);
  const sourceRecords = (await sourceDependencies.findDocumentsByRequest()).records;
  const dependencies = {
    ...sourceDependencies,
    findDocumentsByRequest: jest.fn(async () => ({ records: [
      ...sourceRecords,
      {
        wmkf_requestdocumentid: materialId,
        _wmkf_request_value: REQUEST_ID,
        wmkf_artifacttype: materialType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
        wmkf_filename: 'Applicant Slides.pdf',
        wmkf_sharepointweburl: 'https://sharepoint.test/slides',
        wmkf_sharepointdriveid: 'materials-drive',
        wmkf_sharepointitemid: 'slides-item',
        wmkf_sharepointversionid: '4.0',
      },
    ] })),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    findEmailByCorrelation: jest.fn(),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_material_stale' });
  expect(dependencies.findEmailByCorrelation).not.toHaveBeenCalled();
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('an exact sent retry returns its receipt without another Dynamics write', async () => {
  const sent = attemptFixture({
    state: 'sent',
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    sent_at: new Date(),
    send_requested_at: new Date(),
  });
  const dependencies = {
    getAttempt: jest.fn(async () => sent),
    claimSend: jest.fn(),
  };
  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);
  expect(result.reused).toBe(true);
  expect(dependencies.claimSend).not.toHaveBeenCalled();
});

test('a prepared send fails before its lease or any Dynamics call when impersonation is disabled', async () => {
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false';
  const prepared = attemptFixture();
  const dependencies = {
    getAttempt: jest.fn(async () => prepared),
    claimSend: jest.fn(),
    createEmailActivity: jest.fn(),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_impersonation_required' });
  expect(dependencies.claimSend).not.toHaveBeenCalled();
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('send rejects a prepared attempt whose source pointer changed after guarded reopen', async () => {
  let row = attemptFixture();
  const newPointerId = '99999999-9999-4999-8999-999999999999';
  const dependencies = {
    ...currentSourceDependencies(row),
    getRequest: jest.fn(async () => ({
      akoya_requestid: row.request_id,
      _wmkf_currentprerpbrief_value: newPointerId,
    })),
    // The pointer now names a different, otherwise-valid brief — resolving
    // it is what makes this "stale" rather than "broken" (a genuinely
    // dangling pointer resolves as brief_pointer_invalid instead, which is
    // a distinct reconciliation problem, not what this test exercises).
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: row.source_document_id,
      _wmkf_request_value: row.request_id,
      wmkf_operationstatus: 100000001,
      wmkf_lifecyclestate: 100000001,
      wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
      wmkf_contenttype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: row.source_drive_id,
      wmkf_sharepointitemid: row.source_item_id,
      wmkf_sharepointfolderpath: 'Requests/1002379',
    }, {
      wmkf_requestdocumentid: newPointerId,
      _wmkf_request_value: row.request_id,
      wmkf_operationstatus: 100000001,
      wmkf_lifecyclestate: 100000001,
      wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
      wmkf_contenttype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: 'new-drive',
      wmkf_sharepointitemid: 'new-item',
      wmkf_sharepointfolderpath: 'Requests/1002379',
    }] })),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    findEmailByCorrelation: jest.fn(),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_stale_source' });
  expect(dependencies.findEmailByCorrelation).not.toHaveBeenCalled();
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('send fails before claiming when a selected frozen attachment identity is incomplete', async () => {
  const incomplete = attemptFixture({
    attachment_mode: 'pdf',
    pdf_item_id: null,
  });
  const dependencies = {
    getAttempt: jest.fn(async () => incomplete),
    claimSend: jest.fn(),
  };
  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_preview_incomplete' });
  expect(dependencies.claimSend).not.toHaveBeenCalled();
});

test('a recovered Dynamics attachment is byte-verified before marking its step complete', async () => {
  const crypto = await import('node:crypto');
  const bytes = Buffer.from('pdf-bytes');
  let row = attemptFixture({
    attachment_mode: 'pdf',
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    pdf_byte_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    pdf_size: bytes.length,
  });
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 6 }),
    recordEmailActivity: jest.fn(async (attempt) => attempt),
    findEmailAttachments: jest.fn(async () => [{ activitymimeattachmentid: 'attachment-1' }]),
    getEmailAttachmentContent: jest.fn(async () => ({
      activitymimeattachmentid: 'attachment-1',
      filename: row.pdf_filename,
      mimetype: row.pdf_content_type,
      filesize: bytes.length,
      body: bytes.toString('base64'),
    })),
    addEmailAttachment: jest.fn(),
    recordAttachment: jest.fn(async (attempt) => {
      row = { ...attempt, pdf_attached_at: new Date(), state: 'attachments_added' };
      return row;
    }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), lease_token: null };
      return row;
    }),
    recordFailure: jest.fn(),
  };

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.reused).toBe(true);
  expect(dependencies.addEmailAttachment).not.toHaveBeenCalled();
  expect(dependencies.recordAttachment).toHaveBeenCalledWith(
    expect.any(Object),
    'pdf',
  );
});

test('a lost attachment response is byte-verified before the recovered step is persisted', async () => {
  const crypto = await import('node:crypto');
  const bytes = Buffer.from('pdf-bytes');
  let row = attemptFixture({
    attachment_mode: 'pdf',
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    pdf_byte_hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    pdf_size: bytes.length,
  });
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn(async () => emailFixture(row)),
    recordEmailActivity: jest.fn(async (attempt) => attempt),
    findEmailAttachments: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ activitymimeattachmentid: 'attachment-1' }]),
    downloadFile: jest.fn(async () => ({ buffer: bytes })),
    addEmailAttachment: jest.fn(async () => { throw new Error('connection reset after write'); }),
    getEmailAttachmentContent: jest.fn(async () => ({
      activitymimeattachmentid: 'attachment-1',
      filename: row.pdf_filename,
      mimetype: row.pdf_content_type,
      filesize: bytes.length,
      body: Buffer.from('different-bytes').toString('base64'),
    })),
    recordAttachment: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_attachment_recovery_mismatch' });
  expect(dependencies.recordAttachment).not.toHaveBeenCalled();
});

test('an ambiguous SendEmail response is recovered from Dynamics status without a duplicate send', async () => {
  let row = attemptFixture({
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    docx_attached_at: new Date(),
    pdf_attached_at: new Date(),
    state: 'attachments_added',
  });
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 1 })
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 6 })
      .mockResolvedValueOnce({ activityid: row.dynamics_email_id, subject: row.subject, statuscode: 6 }),
    recordEmailActivity: jest.fn(async (attempt) => attempt),
    recordSendRequested: jest.fn(async (attempt) => {
      row = { ...attempt, state: 'send_requested', send_requested_at: new Date() };
      return row;
    }),
    renewSendLease: jest.fn(async (attempt) => attempt),
    sendEmail: jest.fn(async () => { throw new Error('connection reset after write'); }),
    recordSent: jest.fn(async (attempt, status) => {
      row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), lease_token: null };
      return row;
    }),
    recordFailure: jest.fn(),
  };

  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies);

  expect(result.attempt.transportAccepted).toBe(true);
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
  expect(dependencies.recordFailure).not.toHaveBeenCalled();
});

test('transport is not called when the send lease cannot be renewed', async () => {
  let row = attemptFixture({
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    docx_attached_at: new Date(),
    pdf_attached_at: new Date(),
    state: 'attachments_added',
  });
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ statuscode: 1 }),
    recordSendRequested: jest.fn(async (attempt) => ({
      ...attempt,
      state: 'send_requested',
      send_requested_at: new Date(),
    })),
    renewSendLease: jest.fn(async () => null),
    sendEmail: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_send_lease_lost' });
  expect(dependencies.sendEmail).not.toHaveBeenCalled();
});

test('transport is not called when the source changes after activity recovery but before send', async () => {
  let row = attemptFixture({
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    docx_attached_at: new Date(),
    pdf_attached_at: new Date(),
    state: 'attachments_added',
  });
  const newPointerId = '99999999-9999-4999-8999-999999999999';
  const dependencies = {
    ...currentSourceDependencies(row),
    getRequest: jest.fn()
      .mockResolvedValueOnce({
        akoya_requestid: row.request_id,
        _wmkf_currentprerpbrief_value: row.source_document_id,
      })
      .mockResolvedValueOnce({
        akoya_requestid: row.request_id,
        _wmkf_currentprerpbrief_value: newPointerId,
      }),
    // The pointer now names a different, otherwise-valid brief — see the
    // sibling "guarded reopen" test above for why this must resolve rather
    // than dangle.
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: row.source_document_id,
      _wmkf_request_value: row.request_id,
      wmkf_operationstatus: 100000001,
      wmkf_lifecyclestate: 100000001,
      wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
      wmkf_contenttype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: row.source_drive_id,
      wmkf_sharepointitemid: row.source_item_id,
      wmkf_sharepointfolderpath: 'Requests/1002379',
    }, {
      wmkf_requestdocumentid: newPointerId,
      _wmkf_request_value: row.request_id,
      wmkf_operationstatus: 100000001,
      wmkf_lifecyclestate: 100000001,
      wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
      wmkf_contenttype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: 'new-drive',
      wmkf_sharepointitemid: 'new-item',
      wmkf_sharepointfolderpath: 'Requests/1002379',
    }] })),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    getEmailActivity: jest.fn()
      .mockImplementationOnce(async () => emailFixture(row))
      .mockResolvedValueOnce({ statuscode: 1 }),
    recordSendRequested: jest.fn(async (attempt) => ({
      ...attempt,
      state: 'send_requested',
      send_requested_at: new Date(),
    })),
    renewSendLease: jest.fn(async (attempt) => attempt),
    sendEmail: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_stale_source' });
  // The final rechecks now run before send intent is stamped or the lease is
  // renewed, so a pre-transport failure leaves the attempt provably unsent.
  expect(dependencies.recordSendRequested).not.toHaveBeenCalled();
  expect(dependencies.renewSendLease).not.toHaveBeenCalled();
  expect(dependencies.sendEmail).not.toHaveBeenCalled();
});

test('a created activity ID is persisted before exact-content mismatch and reused on retry', async () => {
  let row = attemptFixture({ attachment_mode: 'docx' });
  const emailId = '88888888-8888-4888-8888-888888888888';
  const createEmailActivity = jest.fn(async () => emailId);
  const recordEmailActivity = jest.fn(async (attempt, persistedId) => {
    row = { ...attempt, dynamics_email_id: persistedId, state: 'activity_created' };
    return row;
  });
  const base = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity,
    recordEmailActivity,
    getEmailActivity: jest.fn(async () => emailFixture(row, { subject: 'Changed in Dynamics' })),
    recordFailure: jest.fn(async () => row),
  };
  const send = () => sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, base);

  await expect(send()).rejects.toMatchObject({ code: 'distribution_email_mismatch' });
  expect(row.dynamics_email_id).toBe(emailId);
  expect(recordEmailActivity).toHaveBeenCalledTimes(1);

  await expect(send()).rejects.toMatchObject({ code: 'distribution_email_mismatch' });
  expect(createEmailActivity).toHaveBeenCalledTimes(1);
});

test('post-create correlation ambiguity is preserved instead of masking recovery', async () => {
  let row = attemptFixture({ attachment_mode: 'docx' });
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    findEmailByCorrelation: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        emailFixture(row, { activityid: '88888888-8888-4888-8888-888888888888' }),
        emailFixture(row, { activityid: '99999999-9999-4999-8999-999999999999' }),
      ]),
    createEmailActivity: jest.fn(async () => { throw new Error('connection reset after create'); }),
    recordFailure: jest.fn(async () => row),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_email_ambiguous' });
  expect(dependencies.recordFailure).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ code: 'distribution_email_ambiguous' }),
    'distribution_email_ambiguous',
  );
});

test('a missing persisted Dynamics activity fails closed without creating a replacement', async () => {
  const row = attemptFixture({
    dynamics_email_id: '88888888-8888-4888-8888-888888888888',
    state: 'activity_created',
  });
  const leased = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
  const dependencies = {
    ...currentSourceDependencies(row),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => leased),
    getEmailActivity: jest.fn(async () => null),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => leased),
  };

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_email_missing' });
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Deliberation briefing link integration (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
// §2.2, §4): the link appears in the body only when minted, joins the exact
// preview hash, and a replaced link fails the send.
// ---------------------------------------------------------------------------

test('body html carries the briefing section only when a link was minted', () => {
  const without = distributionBodyHtml('Hello', OPERATION_ID, []);
  expect(without).not.toContain('Briefing page');
  const link = { id: 'l', url: 'https://apps.test/external/briefing/abc<>', expiresAt: '2026-10-08T20:00:00Z' };
  const withLink = distributionBodyHtml('Hello', OPERATION_ID, [], link);
  expect(withLink).toContain('<strong>Briefing page:</strong>');
  // The stored body never carries the token: only the placeholder.
  expect(withLink).not.toContain('apps.test');
  expect(withLink).toContain(`href="${BRIEFING_LINK_PLACEHOLDER}"`);
  expect(withLink).toContain('expires on October 8, 2026');
  const rendered = renderBriefingBody(withLink, link.url);
  expect(rendered).toContain('href="https://apps.test/external/briefing/abc&lt;&gt;"');
  expect(rendered).not.toContain(BRIEFING_LINK_PLACEHOLDER);
  expect(renderBriefingBody(withLink, null)).toBe(withLink);
  expect(withLink.indexOf('Briefing page')).toBeLessThan(withLink.indexOf('wmkf-pre-site-distribution'));
});

test('body html carries the review-bundle placeholder alongside the briefing link; renderBriefingBody resolves both hrefs from the one token', () => {
  const link = { id: 'l', url: 'https://apps.test/external/briefing/abc123', expiresAt: '2026-10-08T20:00:00Z' };
  const withLink = distributionBodyHtml('Hello', OPERATION_ID, [], link);
  expect(withLink).toContain(`href="${REVIEW_BUNDLE_LINK_PLACEHOLDER}"`);
  expect(withLink).toContain('Download all reviews (PDF)');
  // Never a second token, or the token embedded anywhere in the stored body.
  expect(withLink).not.toContain('apps.test');

  const rendered = renderBriefingBody(withLink, link.url);
  expect(rendered).toContain('href="https://apps.test/external/briefing/abc123"');
  expect(rendered).toContain('href="https://apps.test/api/external/briefing/abc123/document?member=review-bundle"');
  expect(rendered).not.toContain(BRIEFING_LINK_PLACEHOLDER);
  expect(rendered).not.toContain(REVIEW_BUNDLE_LINK_PLACEHOLDER);

  expect(reviewBundleDocumentUrl(link.url))
    .toBe('https://apps.test/api/external/briefing/abc123/document?member=review-bundle');
  expect(reviewBundleDocumentUrl(null)).toBeNull();
  expect(reviewBundleDocumentUrl('not a url')).toBeNull();
});

test('body html uses Admin briefing wording while keeping the bound URL and expiration date server-owned', () => {
  const link = {
    id: 'l',
    url: 'https://apps.test/external/briefing/server-owned-token',
    expiresAt: '2026-11-14T20:00:00Z',
  };
  const customCopy = {
    heading: 'Discussion packet <staff>:',
    linkText: 'Open the decision materials',
    description: 'the proposal and supporting context, ready for discussion.',
    expiryLeadIn: 'This secure link remains available through',
  };
  const stored = distributionBodyHtml('Hello', OPERATION_ID, [], link, null, customCopy);
  expect(stored).toContain('<strong>Discussion packet &lt;staff&gt;:</strong>');
  expect(stored).toContain(`href="${BRIEFING_LINK_PLACEHOLDER}">Open the decision materials</a>`);
  expect(stored).toContain('the proposal and supporting context, ready for discussion.');
  expect(stored).toContain('This secure link remains available through November 14, 2026.');
  expect(stored).not.toContain(link.url);

  const rendered = renderBriefingBody(stored, link.url);
  expect(rendered).toContain(`href="${link.url}"`);
  expect(rendered).toContain('November 14, 2026');
});

test('prepare freezes the Admin briefing wording into the stored body and preview hash', async () => {
  const settings = {
    'email.deliberation_share.subject': 'Notes — {{requestNumber}}',
    'email.deliberation_share.body': 'Use the briefing page.',
    'email.deliberation_share.briefing_heading': 'Decision packet:',
    'email.deliberation_share.briefing_link_text': 'Open the packet',
    'email.deliberation_share.briefing_description': 'the proposal and review context.',
    'email.deliberation_share.briefing_expiry_lead_in': 'Available until',
  };
  const first = createPrepareHarness();
  first.dependencies.getSettingStrict = jest.fn(async (key) => ({ found: true, value: settings[key] }));
  const firstResult = await preparePreSiteDistribution(prepareInput(), first.dependencies);
  const firstStored = first.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(firstStored.bodyHtml).toContain('<strong>Decision packet:</strong>');
  expect(firstStored.bodyHtml).toContain('>Open the packet</a> — the proposal and review context.');
  expect(firstStored.bodyHtml).toContain('Available until December 17, 2026.');
  expect(firstStored.bodyHtml).not.toContain('external/briefing/default-token');

  const second = createPrepareHarness();
  second.dependencies.getSettingStrict = jest.fn(async (key) => ({
    found: true,
    value: key === 'email.deliberation_share.briefing_description'
      ? 'different Admin wording.'
      : settings[key],
  }));
  const secondResult = await preparePreSiteDistribution(prepareInput(), second.dependencies);
  expect(secondResult.attempt.previewHash).not.toBe(firstResult.attempt.previewHash);
});

test('draftHash and previewHash both bind the review-bundle link-text copy key (discriminating: change only that key)', async () => {
  const base = createPrepareHarness();
  const baseResult = await preparePreSiteDistribution(prepareInput(), base.dependencies);
  const baseDraftHash = base.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

  const changed = createPrepareHarness();
  changed.dependencies.getSettingStrict = jest.fn(async (key) => (
    key === 'email.deliberation_share.review_bundle_link_text'
      ? { found: true, value: 'Get every review' }
      : { found: false, value: null }
  ));
  const changedResult = await preparePreSiteDistribution(
    prepareInput({ operationId: '77777777-7777-4777-8777-777777777779' }),
    changed.dependencies,
  );
  const changedDraftHash = changed.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;

  expect(changedDraftHash).not.toBe(baseDraftHash);
  expect(changedResult.attempt.previewHash).not.toBe(baseResult.attempt.previewHash);
  const stored = changed.dependencies.createOrGetAttempt.mock.calls[0][0].bodyHtml;
  expect(stored).toContain('>Get every review</a>');
});

test('prepare mints the briefing link, binds it to the attempt, and folds it into the preview hash', async () => {
  // Every prepare now links (the harness default is link 1212…); a different
  // link must yield a different preview hash and a different bound id.
  const plain = createPrepareHarness();
  const plainResult = await preparePreSiteDistribution({
    requestId: REQUEST_ID,
    expectedArtifactId: '44444444-4444-4444-8444-444444444444',
    operationId: OPERATION_ID,
    attachmentMode: 'none',
    to: 'staff@example.org',
    subject: 'Frozen materials',
    bodyText: 'Attached.',
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, plain.dependencies);
  expect(plainResult.briefingLink?.id).toBe('12121212-1212-4212-8212-121212121212');

  const linked = createPrepareHarness();
  const briefing = { id: '99999999-9999-4999-8999-999999999999', url: 'https://apps.test/external/briefing/tok', expiresAt: '2026-10-08T20:00:00.000Z' };
  linked.dependencies.briefingReady = () => true;
  linked.dependencies.ensureBriefingLink = jest.fn(async () => ({ link: briefing, reused: false }));
  let bound = null;
  linked.dependencies.recordBriefingLink = jest.fn(async (operationId, briefingLinkId) => {
    bound = briefingLinkId;
    const current = await linked.dependencies.createOrGetAttempt({ operationId });
    return { ...current, briefing_link_id: briefingLinkId };
  });
  const linkedResult = await preparePreSiteDistribution({
    requestId: REQUEST_ID,
    expectedArtifactId: '44444444-4444-4444-8444-444444444444',
    operationId: OPERATION_ID,
    attachmentMode: 'none',
    to: 'staff@example.org',
    subject: 'Frozen materials',
    bodyText: 'Attached.',
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, linked.dependencies);
  expect(linked.dependencies.ensureBriefingLink).toHaveBeenCalledWith(REQUEST_ID, ACTOR_ID);
  expect(bound).toBe(briefing.id);
  expect(linkedResult.briefingLink).toEqual(briefing);
  expect(linkedResult.attempt.previewHash).not.toBe(plainResult.attempt.previewHash);
  const created = linked.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(created.bodyHtml).toContain(`href="${BRIEFING_LINK_PLACEHOLDER}"`);
  expect(JSON.stringify(created)).not.toContain('external/briefing/tok');
});

test('send refuses a prepared attempt whose briefing link was replaced', async () => {
  let row = attemptFixture({ briefing_link_id: '99999999-9999-4999-8999-999999999999' });
  const dependencies = {
    ...currentSourceDependencies(row),
    getLiveBriefingLink: jest.fn(async () => ({ id: '10101010-1010-4010-8010-101010101010', url: 'https://apps.test/external/briefing/new' })),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' };
      return row;
    }),
    findEmailByCorrelation: jest.fn(),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };
  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_briefing_stale' });
  expect(dependencies.getLiveBriefingLink).toHaveBeenCalledWith(REQUEST_ID);
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('an unbound preview (prepared before the link was mandatory) is refused at send regardless of the flag, unless its send was already requested', async () => {
  const refuse = (row) => ({
    ...currentSourceDependencies(row),
    briefingReady: () => true,
    getLiveBriefingLink: jest.fn(),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => ({ ...row, lease_token: '77777777-7777-4777-8777-777777777777' })),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(),
    recordFailure: jest.fn(async () => row),
  });
  const input = { requestId: REQUEST_ID, operationId: OPERATION_ID, previewHash: 'a'.repeat(64), fromEmail: 'sender@example.org', actingUserSystemId: ACTOR_ID };
  const unbound = refuse(attemptFixture({ briefing_link_id: null }));
  await expect(sendPreSiteDistribution(input, unbound)).rejects.toMatchObject({ code: 'distribution_briefing_stale' });
  expect(unbound.createEmailActivity).not.toHaveBeenCalled();
  expect(unbound.getLiveBriefingLink).not.toHaveBeenCalled();

  // Already send-requested: the retry reconciles status and is not refused here.
  const requested = refuse(attemptFixture({ briefing_link_id: null, state: 'send_requested', send_requested_at: new Date(), dynamics_email_id: null }));
  await expect(sendPreSiteDistribution(input, requested)).rejects.not.toMatchObject({ code: 'distribution_briefing_stale' });

  // Flag off no longer exempts it: the email carries no attachment, so a
  // linkless send would be a bare email.
  const off = { ...refuse(attemptFixture({ briefing_link_id: null })), briefingReady: () => false };
  await expect(sendPreSiteDistribution(input, off)).rejects.toMatchObject({ code: 'distribution_briefing_stale' });
  expect(off.createEmailActivity).not.toHaveBeenCalled();
});

test('send renders the live link into the activity body only at creation, and a reissue after attachments stops transport', async () => {
  const linkId = '99999999-9999-4999-8999-999999999999';
  const bodyWithPlaceholder = distributionBodyHtml('Attached.', OPERATION_ID, [], { id: linkId, expiresAt: '2026-10-08T20:00:00Z' });
  let row = attemptFixture({ briefing_link_id: linkId, body_html: bodyWithPlaceholder, attachment_mode: 'docx' });
  const url = 'https://apps.test/external/briefing/live-token';
  let liveId = linkId;
  const calls = [];
  const dependencies = {
    ...currentSourceDependencies(row),
    getLiveBriefingLink: jest.fn(async () => ({ id: liveId, url })),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => {
      row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777', attempt_count: 1 };
      return row;
    }),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(async (activity) => { calls.push(activity.body); return '88888888-8888-4888-8888-888888888888'; }),
    recordEmailActivity: jest.fn(async (attempt, emailId) => {
      row = { ...attempt, dynamics_email_id: emailId, state: 'activity_created' };
      return row;
    }),
    getEmailActivity: jest.fn(async () => emailFixture(row, { description: renderBriefingBody(row.body_html, url) })),
    findEmailAttachments: jest.fn(async () => []),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('word-bytes') })),
    addEmailAttachment: jest.fn(async () => {}),
    recordAttachment: jest.fn(async (attempt) => { liveId = 'replaced'; row = { ...attempt, docx_attached_at: new Date() }; return row; }),
    recordSendRequested: jest.fn(async (attempt) => { row = { ...attempt, state: 'send_requested', send_requested_at: new Date() }; return row; }),
    renewSendLease: jest.fn(async (attempt) => attempt),
    sendEmail: jest.fn(),
    recordSent: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };
  const crypto = await import('node:crypto');
  row.docx_byte_hash = crypto.createHash('sha256').update('word-bytes').digest('hex');

  await expect(sendPreSiteDistribution({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: 'a'.repeat(64),
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  }, dependencies)).rejects.toMatchObject({ code: 'distribution_briefing_stale' });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain(`href="${url}"`);
  expect(calls[0]).not.toContain(BRIEFING_LINK_PLACEHOLDER);
  expect(dependencies.sendEmail).not.toHaveBeenCalled();
  expect(dependencies.getLiveBriefingLink).toHaveBeenCalledTimes(2);
  // The failure happened before send intent, so the attempt is provably unsent
  // and cannot block a reissue as an "unresolved" send.
  expect(dependencies.recordSendRequested).not.toHaveBeenCalled();
});

test('a retry of a send-requested attempt reconciles an accepted Dynamics send before requiring link liveness', async () => {
  const linkId = '99999999-9999-4999-8999-999999999999';
  let row = attemptFixture({
    briefing_link_id: linkId, state: 'send_requested', send_requested_at: new Date(),
    dynamics_email_id: '88888888-8888-4888-8888-888888888888', docx_attached_at: new Date(), pdf_attached_at: new Date(),
  });
  const dependencies = {
    ...currentSourceDependencies(row),
    // The link expired after the send went out: liveness would now fail.
    getLiveBriefingLink: jest.fn(async () => null),
    getAttempt: jest.fn(async () => row),
    claimSend: jest.fn(async () => { row = { ...row, lease_token: '77777777-7777-4777-8777-777777777777' }; return row; }),
    getEmailActivity: jest.fn(async () => ({ statuscode: 6, statecode: 0 })),
    recordSent: jest.fn(async (attempt, status) => { row = { ...attempt, ...status, state: 'sent', sent_at: new Date(), lease_token: null }; return row; }),
    findEmailByCorrelation: jest.fn(),
    createEmailActivity: jest.fn(),
    sendEmail: jest.fn(),
    recordFailure: jest.fn(async () => row),
  };
  const result = await sendPreSiteDistribution({
    requestId: REQUEST_ID, operationId: OPERATION_ID, previewHash: 'a'.repeat(64), fromEmail: 'sender@example.org', actingUserSystemId: ACTOR_ID,
  }, dependencies);
  expect(result.attempt.transportAccepted).toBe(true);
  expect(result.reused).toBe(true);
  expect(dependencies.getLiveBriefingLink).not.toHaveBeenCalled();
  expect(dependencies.sendEmail).not.toHaveBeenCalled();
});

async function onePagePdfBuffer(label) {
  const { PDFDocument: LocalPDFDocument } = await import('pdf-lib');
  const doc = await LocalPDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(label, { x: 10, y: 10, size: 10 });
  return Buffer.from(await doc.save());
}

describe('review bundle (plan §11, Step C1)', () => {
  beforeEach(() => {
    assembleReviewBundle.mockClear();
  });

  test('prepare calls assembleReviewBundle exactly once with the live received reviews, creates the bundle registry row with the institution-led filename (no request number), and persists the nine columns', async () => {
    const harness = createPrepareHarness();
    const result = await preparePreSiteDistribution(prepareInput(), harness.dependencies);

    expect(assembleReviewBundle).toHaveBeenCalledTimes(1);
    const [callArgs] = assembleReviewBundle.mock.calls[0];
    expect(callArgs.reviews).toEqual(briefEnvelope().reviews);
    expect(callArgs.institutionName).toBe('Test Institution');

    const bundleDoc = harness.dependencies.createDocument.mock.calls
      .map((call) => call[0])
      .find((payload) => payload.wmkf_producer === `${REVIEW_BUNDLE_PRODUCER_CONTRACT.producerPrefix}-review-bundle`);
    expect(bundleDoc).toBeDefined();
    expect(bundleDoc.wmkf_templateid).toBe('pdf-lib-review-bundle');
    expect(bundleDoc.wmkf_name).toBe('1002379 frozen review bundle');
    expect(bundleDoc.wmkf_filename).toMatch(/^Test Institution - Reviews - [0-9a-f]{8}\.pdf$/);
    expect(bundleDoc.wmkf_filename).not.toContain('1002379');

    const persisted = harness.dependencies.recordPrepared.mock.calls[0][1];
    expect(persisted.reviewBundle).toMatchObject({
      documentId: expect.any(String),
      driveId: 'snapshot-drive',
      itemId: 'bundle-snapshot',
      versionId: '1.0',
      filename: bundleDoc.wmkf_filename,
      size: expect.any(Number),
      byteHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      setFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      reviewCount: 1,
    });
    expect(result.attempt.reviewBundle).toMatchObject({
      filename: bundleDoc.wmkf_filename,
      reviewCount: 1,
      setFingerprint: persisted.reviewBundle.setFingerprint,
    });
    // No drive/item ids to the client.
    expect(JSON.stringify(result.attempt.reviewBundle)).not.toMatch(/drive|item/i);
  });

  test('draftHash and previewHash both change when the review set changes, isolated from the brief input fingerprint (same reviewer identity, only the retained file changes)', async () => {
    const base = createPrepareHarness();
    await preparePreSiteDistribution(prepareInput(), base.dependencies);
    const baseDraftHash = base.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;
    const basePreviewHash = base.dependencies.recordPrepared.mock.calls[0][1].previewHash;

    // Only `reviewFilename` changes; every REVIEW_FINGERPRINT_FIELDS field
    // (suggestionId, name, academicRank, ...) is identical, so
    // briefInputFingerprint (and therefore every other draftHash/previewHash
    // input) is unchanged — the review-set identity is the only thing that
    // can move either hash here.
    const [baseReview] = briefEnvelope().reviews;
    const movedFileEnvelope = briefEnvelope({
      reviews: [{ ...baseReview, reviewFilename: 'review-1-v2.pdf' }],
    });
    expect(briefInputFingerprint(movedFileEnvelope)).toBe(briefInputFingerprint(briefEnvelope()));
    const moved = createPrepareHarness({
      briefGate: briefGateFixture({ generated: movedFileEnvelope, live: movedFileEnvelope }),
    });
    await preparePreSiteDistribution(
      prepareInput({ operationId: '55555555-5555-4555-8555-555555555555' }),
      moved.dependencies,
    );
    const movedDraftHash = moved.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;
    const movedPreviewHash = moved.dependencies.recordPrepared.mock.calls[0][1].previewHash;

    expect(movedDraftHash).not.toBe(baseDraftHash);
    expect(movedPreviewHash).not.toBe(basePreviewHash);
  });

  test('previewHash changes when only the bundle byte hash changes (same review set, different bytes at the same path)', async () => {
    const base = createPrepareHarness();
    await preparePreSiteDistribution(prepareInput(), base.dependencies);
    const baseDraftHash = base.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;
    const basePreviewHash = base.dependencies.recordPrepared.mock.calls[0][1].previewHash;

    const changedBytes = createPrepareHarness();
    const differentPdf = await onePagePdfBuffer('different-content');
    changedBytes.dependencies.downloadFileByPath = jest.fn(async () => ({ buffer: differentPdf }));
    await preparePreSiteDistribution(
      prepareInput({ operationId: '66666666-6666-4666-8666-666666666666' }),
      changedBytes.dependencies,
    );
    const changedDraftHash = changedBytes.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;
    const changedPreviewHash = changedBytes.dependencies.recordPrepared.mock.calls[0][1].previewHash;

    // The review SET (paths/filenames) is unchanged, so draftHash (which
    // binds only the set fingerprint) is unaffected; previewHash binds the
    // exact bundle byte hash, so it changes.
    expect(changedDraftHash).toBe(baseDraftHash);
    expect(changedPreviewHash).not.toBe(basePreviewHash);
  });

  test('a bundle failure (Graph unavailable) leaves the attempt un-prepared and surfaces the bundle error code', async () => {
    const harness = createPrepareHarness();
    harness.dependencies.downloadFileByPath = jest.fn(async () => { throw new Error('Graph is down'); });
    await expect(preparePreSiteDistribution(prepareInput(), harness.dependencies))
      .rejects.toMatchObject({ code: 'review_bundle_unavailable', httpStatus: 502 });
    expect(harness.dependencies.recordPrepared).not.toHaveBeenCalled();
    expect(harness.dependencies.createOrGetAttempt).toHaveBeenCalled();
  });

  test('a bundle failure (no received review has a file) leaves the attempt un-prepared and surfaces review_bundle_empty', async () => {
    const noFileEnvelope = briefEnvelope({
      reviews: [{
        suggestionId: 'reviewer-1',
        reviewReceivedAt: '2026-09-01T00:00:00Z',
        name: 'Reviewer One',
        affiliation: 'Test University',
        reviewSharePointFolder: null,
        reviewFilename: null,
      }],
    });
    const harness = createPrepareHarness({
      briefGate: briefGateFixture({ generated: noFileEnvelope, live: noFileEnvelope }),
    });
    await expect(preparePreSiteDistribution(prepareInput(), harness.dependencies))
      .rejects.toMatchObject({ code: 'review_bundle_empty', httpStatus: 409 });
    expect(harness.dependencies.recordPrepared).not.toHaveBeenCalled();
  });
});

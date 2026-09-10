/**
 * @jest-environment node
 *
 * Node environment: the service now imports the deliberation briefing link
 * service, whose token primitive resolves `jose` to its Node build.
 */
import {
  BRIEFING_LINK_PLACEHOLDER,
  distributionBodyHtml,
  getPreSiteDistributionHistory,
  renderBriefingBody,
  normalizeDistributionRecipients,
  preparePreSiteDistribution,
  projectDistributionAttempt,
  sendPreSiteDistribution,
} from '../../lib/services/pre-site-visit/distribution-service';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

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
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_sharepointsiteid: 'source-site',
    wmkf_sharepointdriveid: 'source-drive',
    wmkf_sharepointitemid: 'source-item',
    wmkf_sharepointfolderpath: 'Requests/1002379',
    wmkf_filename: 'PreSite.docx',
    wmkf_cyclecode: 'D26',
  };
  let attempt = null;
  const snapshots = [];
  let snapshotSequence = 0;
  let wordMetadataReads = 0;
  let uuidSequence = 6;
  let settledWordVersion = settledWordVersionId;
  let settledWordETag = 'word-etag';

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
      return attempt;
    }),
    getRequest: jest.fn(async () => ({
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: '1002379',
      _wmkf_currentpresitevisit_value: sourceDocumentId,
    })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [sourceRow] })),
    createOrGetAttempt: jest.fn(async (input) => {
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
        state: 'preparing',
      };
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
    uploadFile: jest.fn(async (_library, _folder, filename, buffer, contentType) => (
      contentType === PRE_SITE_VISIT_CONTRACT.contentType
        ? metadata('word-snapshot', 'ctag-provisional', provisionalWordETag, buffer.length, filename)
        : metadata('pdf-snapshot', 'ctag-pdf', 'pdf-etag', buffer.length, filename)
    )),
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
      return null;
    }),
    downloadFile: jest.fn(async () => ({ buffer: sourceBytes, filename: sourceRow.wmkf_filename })),
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
      };
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

test('prepare persists native Graph publication versions instead of provisional cTags', async () => {
  const harness = createPrepareHarness();

  const result = await preparePreSiteDistribution(prepareInput(), harness.dependencies);

  expect(result.attempt.state).toBe('prepared');
  expect(result.attempt.attachments).toEqual([]);
  const pinned = harness.dependencies.recordPrepared.mock.calls[0][1];
  expect([pinned.docx.versionId, pinned.pdf.versionId]).toEqual(['1.0', '1.0']);
  expect(harness.snapshots.map((row) => row.wmkf_sharepointversionid))
    .toEqual(['1.0', '1.0']);
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

test('prepare binds server-resolved material links and one informational calendar to the preview', async () => {
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

  const result = await preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    includeCalendar: true,
    siteVisitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    selectedMaterialIds: [materialId],
  }), harness.dependencies);

  // Nothing but the informational calendar is attached; the writeup rides the briefing page.
  expect(result.attempt.attachments.map((attachment) => attachment.kind))
    .toEqual(['calendar']);
  expect(result.attempt.materialLinks).toEqual([expect.objectContaining({ artifactId: materialId })]);
  expect(result.attempt.calendarEnabled).toBe(true);
  expect(result.attempt.bodyText).toBe('Attached.');
  const persisted = harness.dependencies.createOrGetAttempt.mock.calls[0][0];
  expect(persisted.toRecipients).toEqual(['staff@example.org', 'organizer@wmkeck.org']);
  expect(persisted.ccRecipients).toEqual(['consultant@example.org']);
  expect(persisted.bodyHtml).toContain('Applicant &lt;Slides&gt;.pdf');
  expect(persisted.bodyHtml).toContain('a=1&amp;b=2');
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

test('calendar and material selections participate in the draft identity', async () => {
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
  await preparePreSiteDistribution(prepareInput({
    attachmentMode: 'none',
    selectedMaterialIds: [materialId],
  }), material.dependencies);
  const materialHash = material.dependencies.createOrGetAttempt.mock.calls[0][0].draftHash;
  expect(materialHash).not.toBe(baseHash);

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
      _wmkf_currentpresitevisit_value: row.source_document_id,
    })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: row.source_document_id,
      _wmkf_request_value: row.request_id,
      wmkf_operationstatus: 100000001,
      wmkf_lifecyclestate: 100000001,
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
    getRequest: jest.fn(async () => ({ _wmkf_currentpresitevisit_value: attempt.source_document_id })),
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

test('history derives currentSourceEverSent from the uncapped store check scoped to the current document', async () => {
  const attempt = attemptFixture({ source_version_id: '1.0' });
  const hasSentAttemptForSource = jest.fn(async () => true);
  const result = await getPreSiteDistributionHistory({ requestId: REQUEST_ID }, {
    listAttempts: jest.fn(async () => [attempt]),
    getRequest: jest.fn(async () => ({ _wmkf_currentpresitevisit_value: attempt.source_document_id })),
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
    getRequest: jest.fn(async () => ({ _wmkf_currentpresitevisit_value: null })),
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
  const dependencies = {
    ...currentSourceDependencies(row),
    getRequest: jest.fn(async () => ({
      akoya_requestid: row.request_id,
      _wmkf_currentpresitevisit_value: '99999999-9999-4999-8999-999999999999',
    })),
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
  const dependencies = {
    ...currentSourceDependencies(row),
    getRequest: jest.fn()
      .mockResolvedValueOnce({
        akoya_requestid: row.request_id,
        _wmkf_currentpresitevisit_value: row.source_document_id,
      })
      .mockResolvedValueOnce({
        akoya_requestid: row.request_id,
        _wmkf_currentpresitevisit_value: '99999999-9999-4999-8999-999999999999',
      }),
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

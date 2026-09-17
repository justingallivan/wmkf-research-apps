/**
 * Briefing page read model and bounded member resolution
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.1, §3, §4).
 *
 * @jest-environment node
 */
import { buildBriefingContext, resolveBriefingMember } from '../../lib/services/deliberation-briefing/briefing-page-service';
import { PRE_SITE_DISTRIBUTION_CONTRACT } from '../../shared/config/requestDocument.js';
import { reviewSetFingerprint } from '../../lib/services/pre-site-visit/review-bundle-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RECEIVED_ID = '22222222-2222-4222-8222-222222222222';
const PENDING_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ID = '44444444-4444-4444-8444-444444444444';
const DOCX_REVIEW_ID = '99999999-9999-4999-8999-999999999999';
const SLIDES_ID = '55555555-5555-4555-8555-555555555555';
const RECORDING_ID = '66666666-6666-4666-8666-666666666666';
const WRITEUP_ROW_ID = '77777777-7777-4777-8777-777777777777';
const FOREIGN_MATERIAL_ID = '88888888-8888-4888-8888-888888888888';
const REVIEW_BUNDLE_ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Registry rows: one servable deck, one oversize recording (listed, not
// served), the writeup row itself (never a material), a foreign request's
// slides (never in this request's set), and a review-bundle snapshot row
// that (defense-in-depth) shares a materials-eligible artifact type but
// must still be excluded by `isPreSiteDistributionSnapshot`.
function materialRows() {
  return [
    { wmkf_requestdocumentid: SLIDES_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Applicant Slides.pdf', wmkf_filesize: 2048, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'slides-item' },
    { wmkf_requestdocumentid: RECORDING_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000005, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Visit.mp4', wmkf_filesize: 900 * 1024 * 1024, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'recording-item' },
    { wmkf_requestdocumentid: WRITEUP_ROW_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000001, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Writeup.docx', wmkf_filesize: 100, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'writeup-item' },
    { wmkf_requestdocumentid: FOREIGN_MATERIAL_ID, _wmkf_request_value: FOREIGN_ID, wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Other.pdf', wmkf_filesize: 100, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'other-item' },
    { wmkf_requestdocumentid: REVIEW_BUNDLE_ROW_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Test Institution - Reviews - aaaaaaaa.pdf', wmkf_filesize: 4096, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'bundle-item', wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-review-bundle` },
  ];
}

function suggestions() {
  return [
    {
      wmkf_appreviewersuggestionid: RECEIVED_ID,
      wmkf_reviewreceivedat: '2026-09-01T10:00:00Z',
      wmkf_reviewerfirstname: 'Ada',
      wmkf_reviewerlastname: 'Lovelace',
      wmkf_revieweraffiliation: 'Analytical Engines Ltd',
      wmkf_reviewsharepointfolder: 'Requests/1002379/Reviewer_Uploads/attempt_x',
      wmkf_reviewfilename: 'review.pdf',
      _wmkf_potentialreviewer_value: 'person-1',
    },
    {
      wmkf_appreviewersuggestionid: PENDING_ID,
      wmkf_reviewreceivedat: null,
      wmkf_reviewerfirstname: 'Not',
      wmkf_reviewerlastname: 'Yet',
      _wmkf_potentialreviewer_value: 'person-2',
    },
  ];
}

function deps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => ({
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: '1002379',
      akoya_title: 'Quantum Widgets',
      wmkf_meetingdate: '2026-12-01',
      _akoya_applicantid_value: 'acct-1',
      _akoya_applicantid_value_formatted: 'Annotation University',
      _wmkf_projectleader_value: 'pi-1',
      _wmkf_projectleader_value_formatted: 'Anthony Leung',
      _wmkf_programdirector_value: 'pd-1',
      _wmkf_programdirector_value_formatted: 'Justin Gallivan',
    })),
    getAccount: jest.fn(async () => ({ name: 'Example University' })),
    findSuggestions: jest.fn(async () => suggestions()),
    getPerson: jest.fn(async () => ({ wmkf_name: 'Ada Lovelace', wmkf_primaryaffiliation: 'Person Affiliation' })),
    fetchAnswers: jest.fn(async () => ({
      [RECEIVED_ID]: [
        { questionText: 'Strengths?', questionType: 'richtext', answerHtml: '<p>Strong</p>', answerText: 'Strong', answerValue: null },
      ],
    })),
    findActiveSiteVisit: jest.fn(async () => ({ scheduledstart: '2026-10-01T16:00:00Z', scheduledend: '2026-10-01T20:00:00Z' })),
    getSession: jest.fn(async () => null),
    getLatestAttempt: jest.fn(async () => null),
    findDocuments: jest.fn(async () => ({ records: materialRows() })),
    // Active bucket first, then an archive bucket: the proposal is looked up in
    // each bucket's Reviewer Materials folder by the reviewer portal's filename rule.
    getSharePointBuckets: jest.fn(async () => ([
      { library: 'akoya_request', folder: 'Requests/1002379', source: 'active' },
      { library: 'akoya_request_archive', folder: 'Archive/1002379', source: 'archive' },
    ])),
    getFileMetadataByPath: jest.fn(async (library, folder, filename) => (
      library === 'akoya_request' && folder === 'Requests/1002379/Reviewer Materials' && filename === 'Proposal_1002379.pdf'
        ? { id: 'proposal-item', driveId: 'drive-1', name: 'Proposal_1002379.pdf', size: 1234 }
        : null
    )),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'x.pdf', size: 5 })),
    downloadReview: jest.fn(async () => ({ buffer: Buffer.from('%PDF-review'), mimeType: 'application/pdf', filename: 'review.pdf', size: 11 })),
    loadConsultantFeedback: jest.fn(async () => ({ status: 'ok', items: [] })),
    isFeedbackAttachment: jest.fn(async () => false),
    findDocumentById: jest.fn(async () => ({ records: [] })),
    // Plan §11 (Step C2): review-bundle on-demand rebuild. Fail-closed
    // defaults (no rebuild, no persisted rebuild) — review-bundle tests
    // override both explicitly.
    retainReviewBundle: jest.fn(async () => { throw new Error('retainReviewBundle not mocked for this test'); }),
    recordReviewBundleRebuilt: jest.fn(async () => null),
    ...overrides,
  };
}

const LINK = { expires_at: new Date('2026-10-08T20:00:00Z') };

test('context carries only received reviews with authors, no URL-shaped fields, and a writeup placeholder before any send', async () => {
  const d = deps();
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.title).toBe('Example University');
  expect(context.projectLeader).toBe('Anthony Leung');
  expect(context.programDirector).toBe('Justin Gallivan');
  expect(context.proposalTitle).toBe('Quantum Widgets');
  expect(context.writeup).toBeNull();
  expect(context.session).toBeNull();
  expect(context.siteVisit.scheduledStart).toBe('2026-10-01T16:00:00.000Z');
  expect(context.reviews).toHaveLength(1);
  expect(context.reviews[0]).toMatchObject({
    id: RECEIVED_ID,
    reviewerName: 'Ada Lovelace',
    affiliation: 'Analytical Engines Ltd',
    file: { member: `review:${RECEIVED_ID}`, filename: 'review.pdf' },
  });
  expect(context.reviews[0].answers[0]).toEqual({ questionText: 'Strengths?', questionType: 'richtext', answerText: 'Strong', answerHtml: '<p>Strong</p>' });
  expect(context.proposal).toEqual({ member: 'proposal', filename: 'Proposal_1002379.pdf', size: 1234 });
  expect(context.expiresAt).toBe('2026-10-08T20:00:00.000Z');
  const serialized = JSON.stringify(context);
  expect(serialized).not.toMatch(/sharepoint|driveId|itemId|webUrl|folder/i);
  expect(d.fetchAnswers).toHaveBeenCalledWith([RECEIVED_ID]);
});

const DOCX_BYTES = Buffer.from('docx');
const DOCX_HASH = require('node:crypto').createHash('sha256').update(DOCX_BYTES).digest('hex');

function sentAttempt(overrides = {}) {
  return {
    docx_drive_id: 'd', docx_item_id: 'i', docx_filename: 'PreSite_1002379.docx', docx_size: '2048', docx_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx_byte_hash: DOCX_HASH,
    pdf_drive_id: 'd', pdf_item_id: 'p', pdf_filename: 'PreSite_1002379.pdf', pdf_size: '4096', pdf_content_type: 'application/pdf', pdf_byte_hash: 'f'.repeat(64),
    sent_at: '2026-09-09T01:00:00Z', send_requested_at: '2026-09-09T00:59:00Z',
    ...overrides,
  };
}

test('the staff brief exposes only a friendly DOCX descriptor and downloads verify the pinned bytes', async () => {
  const d = deps({
    getLatestAttempt: jest.fn(async () => sentAttempt()),
    downloadFile: jest.fn(async () => ({ buffer: DOCX_BYTES, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'PreSite_1002379.docx', size: DOCX_BYTES.length })),
  });
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.writeup).toEqual({
    docx: { member: 'writeup-docx', displayName: 'Staff Brief 1002379.docx', size: 2048 },
    sharedAt: '2026-09-09T01:00:00.000Z',
  });
  expect(JSON.stringify(context.writeup)).not.toContain('PreSite_1002379');
  const docx = await resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-docx' }, d);
  expect(d.downloadFile).toHaveBeenCalledWith('d', 'i');
  expect(docx).toMatchObject({ filename: 'PreSite_1002379.docx', inline: false });
});

test('staffAcknowledgedNewerInputs is null unless the send was prepared over acknowledged drift (B14)', async () => {
  const noDrift = deps({ getLatestAttempt: jest.fn(async () => sentAttempt()) });
  const contextNoDrift = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, noDrift);
  expect(contextNoDrift.staffAcknowledgedNewerInputs).toBeNull();

  const drifted = deps({
    getLatestAttempt: jest.fn(async () => sentAttempt({
      stale_inputs_acknowledged_at: '2026-09-10T18:30:00Z',
      stale_inputs_acknowledged_by: '33333333-3333-4333-8333-333333333333',
      stale_inputs_delta: { abstractChanged: true, changedRequestFields: ['abstract'] },
    })),
  });
  const contextDrifted = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, drifted);
  // Only the boolean-implied presence plus timestamp — never the delta,
  // changed field names, actor id, or abstract text.
  expect(contextDrifted.staffAcknowledgedNewerInputs).toEqual({ acknowledgedAt: '2026-09-10T18:30:00.000Z' });
  expect(JSON.stringify(contextDrifted.staffAcknowledgedNewerInputs)).not.toContain('abstract');
  expect(JSON.stringify(contextDrifted.staffAcknowledgedNewerInputs)).not.toContain('33333333');
});

test('a snapshot whose bytes no longer match the pinned hash is refused', async () => {
  const mutated = deps({
    getLatestAttempt: jest.fn(async () => sentAttempt()),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('docx-edited'), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'x.docx', size: 11 })),
  });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-docx' }, mutated))
    .rejects.toMatchObject({ httpStatus: 409, body: { ok: false, reason: 'snapshot_mismatch' } });
  const noHash = deps({ getLatestAttempt: jest.fn(async () => sentAttempt({ docx_byte_hash: null })) });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-docx' }, noHash))
    .rejects.toMatchObject({ httpStatus: 409 });
});

test('the retired PDF member is refused even when the sent attempt has a PDF pointer', async () => {
  const d = deps({ getLatestAttempt: jest.fn(async () => sentAttempt()) });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-pdf' }, d))
    .rejects.toMatchObject({ httpStatus: 404 });
  expect(d.downloadFile).not.toHaveBeenCalled();
});

test('unknown members and reviews outside the request set are 404 before any Graph call', async () => {
  const d = deps();
  for (const member of ['../etc', 'writeup-docx', `review:${PENDING_ID}`, `review:${FOREIGN_ID}`, 'review:not-a-guid', 'x'.repeat(61)]) {
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member }, d)).rejects.toMatchObject({ httpStatus: 404 });
  }
  expect(d.downloadFile).not.toHaveBeenCalled();
  expect(d.downloadReview).not.toHaveBeenCalled();
});

test('every member branch 404s before any Graph read when the request no longer resolves', async () => {
  for (const member of ['writeup-docx', 'proposal', `review:${RECEIVED_ID}`]) {
    const gone = deps({
      getRequest: jest.fn(async () => { const e = new Error('Get record failed (404)'); e.status = 404; throw e; }),
      getLatestAttempt: jest.fn(async () => sentAttempt()),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member }, gone)).rejects.toMatchObject({ httpStatus: 404 });
    expect(gone.downloadFile).not.toHaveBeenCalled();
    expect(gone.downloadReview).not.toHaveBeenCalled();
  }
});

test('a review member in the received set streams through the existing review reader', async () => {
  const d = deps();
  const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: `review:${RECEIVED_ID}` }, d);
  expect(d.downloadReview).toHaveBeenCalledWith({ suggestionId: RECEIVED_ID });
  expect(file.filename).toBe('review.pdf');
  expect(file).toMatchObject({ mimeType: 'application/pdf', inline: true });
});

test('DOCX review files stay out of the context and are refused before download', async () => {
  const docxReview = {
    ...suggestions()[0],
    wmkf_appreviewersuggestionid: DOCX_REVIEW_ID,
    wmkf_reviewfilename: 'Review-1002379-Ada-Lovelace.docx',
  };
  const d = deps({
    findSuggestions: jest.fn(async () => [docxReview]),
    fetchAnswers: jest.fn(async () => ({
      [DOCX_REVIEW_ID]: [{ questionText: 'Strengths?', questionType: 'text', answerText: 'Strong', answerHtml: null }],
    })),
  });
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.reviews).toHaveLength(1);
  expect(context.reviews[0]).toMatchObject({ id: DOCX_REVIEW_ID, file: null });
  expect(context.reviews[0].answers).toHaveLength(1);
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `review:${DOCX_REVIEW_ID}` }, d))
    .rejects.toMatchObject({ httpStatus: 404 });
  expect(d.downloadReview).not.toHaveBeenCalled();
});

test('a PDF-named review with non-PDF bytes is refused after download', async () => {
  const d = deps({
    downloadReview: jest.fn(async () => ({ buffer: Buffer.from('not a pdf'), mimeType: 'application/pdf', filename: 'review.pdf', size: 9 })),
  });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `review:${RECEIVED_ID}` }, d))
    .rejects.toMatchObject({ httpStatus: 404 });
  expect(d.downloadReview).toHaveBeenCalledWith({ suggestionId: RECEIVED_ID });
});

test('the proposal member resolves Reviewer Materials/Proposal_<num>.pdf by governed path (D20) and 404s when it is absent', async () => {
  const d = deps();
  const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: 'proposal' }, d);
  expect(d.getFileMetadataByPath).toHaveBeenCalledWith('akoya_request', 'Requests/1002379/Reviewer Materials', 'Proposal_1002379.pdf');
  expect(d.downloadFile).toHaveBeenCalledWith('drive-1', 'proposal-item');
  expect(file.filename).toBe('Proposal_1002379.pdf');
  expect(file.inline).toBe(true);

  // Found only in the archive bucket: still served; a bucket that throws is skipped.
  const archived = deps({
    getFileMetadataByPath: jest.fn(async (library) => {
      if (library === 'akoya_request') throw new Error('library unavailable');
      return { id: 'archive-item', driveId: 'drive-2', name: 'Proposal_1002379.pdf', size: 99 };
    }),
  });
  await resolveBriefingMember({ requestId: REQUEST_ID, member: 'proposal' }, archived);
  expect(archived.downloadFile).toHaveBeenCalledWith('drive-2', 'archive-item');

  const missing = deps({ getFileMetadataByPath: jest.fn(async () => null) });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'proposal' }, missing)).rejects.toMatchObject({ httpStatus: 404 });
  expect(missing.downloadFile).not.toHaveBeenCalled();
});

test('materials: the context lists this request\'s Ready applicant/visit files by label, never the writeup row, and flags oversize files as unavailable', async () => {
  const d = deps();
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.materials).toEqual([
    { member: `material:${SLIDES_ID}`, label: 'Applicant Slides', filename: 'Applicant Slides.pdf', size: 2048, available: true, inline: true },
    { member: `material:${RECORDING_ID}`, label: 'Recording', filename: 'Visit.mp4', size: 900 * 1024 * 1024, available: false, inline: false },
  ]);
  expect(JSON.stringify(context.materials)).not.toMatch(/drive|item|sharepoint|Writeup\.docx|Other\.pdf|Reviews - aaaaaaaa/i);
  // A registry failure leaves the section empty rather than failing the page.
  const broken = deps({ findDocuments: jest.fn(async () => { throw new Error('dataverse down'); }) });
  expect((await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, broken)).materials).toEqual([]);
});

test('materials: a review-bundle snapshot row is excluded even when its artifact type would otherwise be eligible', async () => {
  const d = deps();
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.materials.map((material) => material.member)).not.toContain(`material:${REVIEW_BUNDLE_ROW_ID}`);
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `material:${REVIEW_BUNDLE_ROW_ID}` }, deps()))
    .rejects.toMatchObject({ httpStatus: 404 });
});

test('materials: a member in the eligible set downloads the registry row\'s file; writeup, foreign, oversize, and unknown ids are 404 before any Graph call', async () => {
  const d = deps({ downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'x.pdf', size: 2048 })) });
  const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: `material:${SLIDES_ID}` }, d);
  expect(d.downloadFile).toHaveBeenCalledWith('mat-drive', 'slides-item');
  expect(file.filename).toBe('Applicant Slides.pdf');
  expect(file.inline).toBe(true);

  for (const member of [`material:${WRITEUP_ROW_ID}`, `material:${FOREIGN_MATERIAL_ID}`, `material:${RECORDING_ID}`, 'material:not-a-guid', `material:${PENDING_ID}`]) {
    const fresh = deps();
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member }, fresh)).rejects.toMatchObject({ httpStatus: 404 });
    expect(fresh.downloadFile).not.toHaveBeenCalled();
  }
});

test('materials: a file whose actual bytes exceed the cap is refused even when the registry size was unknown', async () => {
  const rows = materialRows().map((row) => (row.wmkf_requestdocumentid === SLIDES_ID ? { ...row, wmkf_filesize: null } : row));
  const d = deps({
    findDocuments: jest.fn(async () => ({ records: rows })),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.alloc(10), mimeType: 'video/mp4', filename: 'big.mp4', size: 900 * 1024 * 1024 })),
  });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `material:${SLIDES_ID}` }, d)).rejects.toMatchObject({ httpStatus: 404 });
});

test('consultant feedback: the context carries the loader\'s status and items verbatim', async () => {
  const items = [{ name: 'Jane Doe', affiliation: 'Acme', receivedOn: '2026-09-01', bodyHtml: '<p>Great work.</p>' }];
  const d = deps({ loadConsultantFeedback: jest.fn(async () => ({ status: 'ok', items })) });
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.consultantFeedback).toEqual({ status: 'ok', items });
  expect(d.loadConsultantFeedback).toHaveBeenCalledWith(REQUEST_ID);
});

test('consultant feedback: a throwing loader yields unavailable rather than failing the whole context (§3.3, Codex AR-1 finding 4)', async () => {
  const d = deps({ loadConsultantFeedback: jest.fn(async () => { throw new Error('table unavailable'); }) });
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.ok).toBe(true);
  expect(context.consultantFeedback).toEqual({ status: 'unavailable', items: [] });
});

describe('feedback: member (slice 2 attachment)', () => {
  const FEEDBACK_DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const readyRow = (overrides = {}) => ({
    wmkf_requestdocumentid: FEEDBACK_DOC_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: 100000008, // CONSULTANT_FEEDBACK
    wmkf_operationstatus: 100000001, // READY
    wmkf_lifecyclestate: 100000000, // Draft
    wmkf_filename: 'Consultant Feedback-1002379-J Doe-2026-09-01.pdf',
    wmkf_sharepointdriveid: 'fb-drive',
    wmkf_sharepointitemid: 'fb-item',
    ...overrides,
  });

  test('downloads when shared+active in Postgres AND Ready/not-Superseded in the registry, inline for PDF', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow()] })),
      downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'x.pdf', size: 5 })),
    });
    const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d);
    expect(d.downloadFile).toHaveBeenCalledWith('fb-drive', 'fb-item');
    expect(file.inline).toBe(true);
  });

  test('non-PDF attachment downloads, not inline', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow({ wmkf_filename: 'notes.docx' })] })),
      downloadFile: jest.fn(async () => ({ buffer: Buffer.from('PK'), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'notes.docx', size: 5 })),
    });
    const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d);
    expect(file.inline).toBe(false);
  });

  test('not shared / not active in Postgres: 404 with no Graph call', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => false),
      findDocumentById: jest.fn(async () => ({ records: [readyRow()] })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.findDocumentById).not.toHaveBeenCalled();
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('registry row belongs to another request: 404 with no Graph call', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow({ _wmkf_request_value: FOREIGN_ID })] })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('Superseded registry row: 404 with no Graph call', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow({ wmkf_lifecyclestate: 100000003 })] })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('a Ready, same-request row of ANOTHER artifact type referenced by the feedback row: 404 with no Graph call (typed registry boundary)', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow({ wmkf_artifacttype: 100000003 })] })), // Applicant Slides
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('a Ready row missing its SharePoint drive/item pointers: 404 with no Graph call', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow({ wmkf_sharepointdriveid: null, wmkf_sharepointitemid: null })] })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('non-Ready registry row: 404 with no Graph call', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => true),
      findDocumentById: jest.fn(async () => ({ records: [readyRow({ wmkf_operationstatus: 100000000 })] })), // Generating
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('a `deleting` row never proves membership (the Postgres check already excludes it): 404 with no Graph call', async () => {
    const d = deps({
      isFeedbackAttachment: jest.fn(async () => false), // deleting rows never satisfy status='active'
      findDocumentById: jest.fn(async () => ({ records: [readyRow()] })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: `feedback:${FEEDBACK_DOC_ID}` }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.downloadFile).not.toHaveBeenCalled();
  });

  test('a non-GUID id is 404 before any lookup', async () => {
    const d = deps();
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'feedback:not-a-guid' }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.isFeedbackAttachment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// review-bundle member (plan §11, Step C2): pinned-identity serve, drift
// detection (fingerprint-only, no Graph reads), on-demand rebuild through
// the shared `retainReviewBundle` helper, and the context projection.
// ---------------------------------------------------------------------------

// Matches exactly what resolveBriefingMember computes from the default
// `suggestions()` fixture's received (RECEIVED_ID) row: reviewSetFingerprint
// filters on `reviewReceivedAt` truthiness, so it must be present here too.
const PINNED_SET_FINGERPRINT = reviewSetFingerprint([{
  suggestionId: RECEIVED_ID,
  reviewSharePointFolder: 'Requests/1002379/Reviewer_Uploads/attempt_x',
  reviewFilename: 'review.pdf',
  reviewReceivedAt: '2026-09-01T10:00:00.000Z',
}]);
const BUNDLE_BYTES = Buffer.from('%PDF-pinned-bundle-bytes');
const BUNDLE_BYTE_HASH = require('crypto').createHash('sha256').update(BUNDLE_BYTES).digest('hex');

const REVIEW_BUNDLE_ACTOR_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

function bundleAttemptFixture(overrides = {}) {
  return {
    operation_id: 'op-bundle-1',
    state: 'sent',
    source_document_id: 'source-doc-1',
    acting_user_system_id: REVIEW_BUNDLE_ACTOR_ID,
    review_bundle_document_id: 'bundle-doc-1',
    review_bundle_drive_id: 'bundle-drive',
    review_bundle_item_id: 'bundle-item',
    review_bundle_version_id: '1.0',
    review_bundle_filename: 'Example University - Reviews - aaaaaaaa.pdf',
    review_bundle_size: BUNDLE_BYTES.length,
    review_bundle_byte_hash: BUNDLE_BYTE_HASH,
    review_bundle_set_fingerprint: PINNED_SET_FINGERPRINT,
    review_bundle_review_count: 1,
    review_bundle_rebuilt_at: null,
    ...overrides,
  };
}

function sourceRowFixture(overrides = {}) {
  return {
    wmkf_requestdocumentid: 'source-doc-1',
    wmkf_sharepointfolderpath: 'Requests/1002379',
    wmkf_cyclecode: 'D26',
    ...overrides,
  };
}

describe('resolveBriefingMember: review-bundle (plan §11, Step C2)', () => {
  test('serves the pinned bundle when the live review set is unchanged, without any retainReviewBundle call', async () => {
    const d = deps({
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture()),
      downloadFile: jest.fn(async (driveId, itemId) => (
        driveId === 'bundle-drive' && itemId === 'bundle-item'
          ? { buffer: BUNDLE_BYTES, mimeType: 'application/pdf', filename: 'bundle.pdf', size: BUNDLE_BYTES.length }
          : { buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'x.pdf', size: 5 }
      )),
    });
    const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d);
    expect(file.buffer).toEqual(BUNDLE_BYTES);
    expect(file.mimeType).toBe('application/pdf');
    expect(file.filename).toBe('Example University - Reviews - aaaaaaaa.pdf');
    expect(file.inline).toBe(true);
    expect(d.retainReviewBundle).not.toHaveBeenCalled();
    expect(d.recordReviewBundleRebuilt).not.toHaveBeenCalled();
    // Fingerprint-only comparison: no SharePoint/Graph metadata lookup for
    // review parts (only the one download of the pinned bundle itself).
    expect(d.getFileMetadataByPath).not.toHaveBeenCalled();
  });

  test('409 snapshot_mismatch when the set is unchanged but the pinned bytes no longer hash to review_bundle_byte_hash', async () => {
    const d = deps({
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture()),
      downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-different-bytes'), mimeType: 'application/pdf', filename: 'bundle.pdf', size: 10 })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d))
      .rejects.toMatchObject({ httpStatus: 409, body: { reason: 'snapshot_mismatch' } });
    expect(d.retainReviewBundle).not.toHaveBeenCalled();
  });

  test('rebuilds once through retainReviewBundle when the live set differs, attributed to the sent attempt\'s staff actor, persists the new identity, and serves the new bytes', async () => {
    const rebuiltBytes = Buffer.from('%PDF-rebuilt-bundle-bytes');
    const rebuiltHash = require('crypto').createHash('sha256').update(rebuiltBytes).digest('hex');
    const newSuggestions = () => ([
      {
        wmkf_appreviewersuggestionid: RECEIVED_ID,
        wmkf_reviewreceivedat: '2026-09-01T10:00:00Z',
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_revieweraffiliation: 'Analytical Engines Ltd',
        // The live folder/filename differ from the pinned identity's
        // fingerprint source, so the fingerprints diverge.
        wmkf_reviewsharepointfolder: 'Requests/1002379/Reviewer_Uploads/attempt_y',
        wmkf_reviewfilename: 'review-v2.pdf',
        _wmkf_potentialreviewer_value: 'person-1',
      },
    ]);
    const d = deps({
      findSuggestions: jest.fn(async () => newSuggestions()),
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture()),
      findDocumentById: jest.fn(async (id) => (
        id === 'source-doc-1' ? { records: [sourceRowFixture()] } : { records: [] }
      )),
      retainReviewBundle: jest.fn(async () => ({
        snapshot: {
          documentId: 'bundle-doc-2', driveId: 'bundle-drive-2', itemId: 'bundle-item-2',
          versionId: '2.0', filename: 'Example University - Reviews - bbbbbbbb.pdf',
          size: rebuiltBytes.length, byteHash: rebuiltHash,
        },
        assembly: { reviewCount: 1 },
        setFingerprint: 'c'.repeat(64),
      })),
      recordReviewBundleRebuilt: jest.fn(async (operationId, rebuilt) => ({
        operation_id: operationId,
        state: 'sent',
        review_bundle_document_id: rebuilt.documentId,
        review_bundle_drive_id: rebuilt.driveId,
        review_bundle_item_id: rebuilt.itemId,
        review_bundle_version_id: rebuilt.versionId,
        review_bundle_filename: rebuilt.filename,
        review_bundle_size: rebuilt.size,
        review_bundle_byte_hash: rebuilt.byteHash,
        review_bundle_set_fingerprint: rebuilt.setFingerprint,
        review_bundle_review_count: rebuilt.reviewCount,
        review_bundle_rebuilt_at: '2026-09-17T12:00:00Z',
      })),
      downloadFile: jest.fn(async (driveId, itemId) => (
        driveId === 'bundle-drive-2' && itemId === 'bundle-item-2'
          ? { buffer: rebuiltBytes, mimeType: 'application/pdf', filename: 'rebuilt.pdf', size: rebuiltBytes.length }
          : { buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'x.pdf', size: 5 }
      )),
    });

    const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d);

    expect(d.retainReviewBundle).toHaveBeenCalledTimes(1);
    const [rebuildArgs, rebuildActorId] = d.retainReviewBundle.mock.calls[0];
    // Attributed to the staff member who shared — never unattributed.
    expect(rebuildActorId).toBe(REVIEW_BUNDLE_ACTOR_ID);
    expect(rebuildArgs.sourceDocumentId).toBe('source-doc-1');
    expect(rebuildArgs.folderPath).toBe('Requests/1002379/Distribution Snapshots');
    expect(rebuildArgs.cycleCode).toBe('D26');
    expect(rebuildArgs.reviews).toEqual([expect.objectContaining({
      suggestionId: RECEIVED_ID,
      reviewSharePointFolder: 'Requests/1002379/Reviewer_Uploads/attempt_y',
      reviewFilename: 'review-v2.pdf',
    })]);

    expect(d.recordReviewBundleRebuilt).toHaveBeenCalledTimes(1);
    const [operationIdArg, rebuiltArg] = d.recordReviewBundleRebuilt.mock.calls[0];
    expect(operationIdArg).toBe('op-bundle-1');
    expect(rebuiltArg).toMatchObject({
      documentId: 'bundle-doc-2',
      driveId: 'bundle-drive-2',
      itemId: 'bundle-item-2',
      byteHash: rebuiltHash,
      reviewCount: 1,
    });

    expect(file.buffer).toEqual(rebuiltBytes);
    expect(file.filename).toBe('Example University - Reviews - bbbbbbbb.pdf');
  });

  test('a rebuild failure serves 503 review_bundle_unavailable and never writes the store', async () => {
    const d = deps({
      findSuggestions: jest.fn(async () => ([{
        wmkf_appreviewersuggestionid: RECEIVED_ID,
        wmkf_reviewreceivedat: '2026-09-01T10:00:00Z',
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewsharepointfolder: 'Requests/1002379/Reviewer_Uploads/attempt_y',
        wmkf_reviewfilename: 'review-v2.pdf',
      }])),
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture()),
      findDocumentById: jest.fn(async () => ({ records: [sourceRowFixture()] })),
      retainReviewBundle: jest.fn(async () => { throw new Error('Graph is down'); }),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d))
      .rejects.toMatchObject({ httpStatus: 503, body: { reason: 'review_bundle_unavailable' } });
    expect(d.recordReviewBundleRebuilt).not.toHaveBeenCalled();
  });

  test('a legacy actor-less attempt (no acting_user_system_id) never rebuilds unattributed: changed set → 503 and no writes', async () => {
    const d = deps({
      findSuggestions: jest.fn(async () => ([{
        wmkf_appreviewersuggestionid: RECEIVED_ID,
        wmkf_reviewreceivedat: '2026-09-01T10:00:00Z',
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        // The live folder/filename differ from the pinned identity, so the
        // fingerprints diverge and a rebuild would otherwise be attempted.
        wmkf_reviewsharepointfolder: 'Requests/1002379/Reviewer_Uploads/attempt_y',
        wmkf_reviewfilename: 'review-v2.pdf',
      }])),
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture({ acting_user_system_id: null })),
      findDocumentById: jest.fn(async () => ({ records: [sourceRowFixture()] })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d))
      .rejects.toMatchObject({ httpStatus: 503, body: { reason: 'review_bundle_unavailable' } });
    expect(d.retainReviewBundle).not.toHaveBeenCalled();
    expect(d.recordReviewBundleRebuilt).not.toHaveBeenCalled();
    expect(d.findDocumentById).not.toHaveBeenCalled();
  });

  test('a legacy actor-less attempt still serves the pinned bundle when the live set is unchanged', async () => {
    const d = deps({
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture({ acting_user_system_id: null })),
      downloadFile: jest.fn(async (driveId, itemId) => (
        driveId === 'bundle-drive' && itemId === 'bundle-item'
          ? { buffer: BUNDLE_BYTES, mimeType: 'application/pdf', filename: 'bundle.pdf', size: BUNDLE_BYTES.length }
          : { buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'x.pdf', size: 5 }
      )),
    });
    const file = await resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d);
    expect(file.buffer).toEqual(BUNDLE_BYTES);
    expect(d.retainReviewBundle).not.toHaveBeenCalled();
    expect(d.recordReviewBundleRebuilt).not.toHaveBeenCalled();
  });

  test('a lost-write rebuild (recordReviewBundleRebuilt returns null, e.g. attempt no longer sent) also serves 503', async () => {
    const d = deps({
      findSuggestions: jest.fn(async () => ([{
        wmkf_appreviewersuggestionid: RECEIVED_ID,
        wmkf_reviewreceivedat: '2026-09-01T10:00:00Z',
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewsharepointfolder: 'Requests/1002379/Reviewer_Uploads/attempt_y',
        wmkf_reviewfilename: 'review-v2.pdf',
      }])),
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture()),
      findDocumentById: jest.fn(async () => ({ records: [sourceRowFixture()] })),
      retainReviewBundle: jest.fn(async () => ({
        snapshot: { documentId: 'd', driveId: 'dr', itemId: 'it', versionId: '1.0', filename: 'f.pdf', size: 1, byteHash: 'a'.repeat(64) },
        assembly: { reviewCount: 1 },
        setFingerprint: 'b'.repeat(64),
      })),
      recordReviewBundleRebuilt: jest.fn(async () => null),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d))
      .rejects.toMatchObject({ httpStatus: 503, body: { reason: 'review_bundle_unavailable' } });
  });

  test('404 for a pre-bundle (legacy) attempt', async () => {
    const d = deps({
      getLatestAttempt: jest.fn(async () => ({ ...bundleAttemptFixture(), review_bundle_drive_id: null, review_bundle_item_id: null })),
    });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(d.findSuggestions).not.toHaveBeenCalled();
  });

  test('404 when there is no sent attempt yet', async () => {
    const d = deps({ getLatestAttempt: jest.fn(async () => null) });
    await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'review-bundle' }, d))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('buildBriefingContext: reviewBundle projection (plan §11, Step C2)', () => {
  test('exposes filename/size/reviewCount/rebuiltAt for a bundled sent attempt', async () => {
    const d = deps({
      getLatestAttempt: jest.fn(async () => bundleAttemptFixture({ review_bundle_rebuilt_at: '2026-09-17T12:00:00Z' })),
    });
    const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
    expect(context.reviewBundle).toEqual({
      member: 'review-bundle',
      filename: 'Example University - Reviews - aaaaaaaa.pdf',
      size: BUNDLE_BYTES.length,
      reviewCount: 1,
      rebuiltAt: '2026-09-17T12:00:00.000Z',
    });
    // Never drive/item ids, byte hashes, or set fingerprints.
    const serialized = JSON.stringify(context.reviewBundle);
    expect(serialized).not.toMatch(/drive|item/i);
    expect(serialized).not.toContain(BUNDLE_BYTE_HASH);
    expect(serialized).not.toContain(PINNED_SET_FINGERPRINT);
  });

  test('is null for a legacy (pre-bundle) attempt and when there is no sent attempt yet', async () => {
    const legacy = deps({
      getLatestAttempt: jest.fn(async () => ({ ...bundleAttemptFixture(), review_bundle_drive_id: null, review_bundle_item_id: null })),
    });
    expect((await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, legacy)).reviewBundle).toBeNull();

    const none = deps({ getLatestAttempt: jest.fn(async () => null) });
    expect((await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, none)).reviewBundle).toBeNull();
  });
});

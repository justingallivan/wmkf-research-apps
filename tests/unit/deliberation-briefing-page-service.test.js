/**
 * Briefing page read model and bounded member resolution
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.1, §3, §4).
 *
 * @jest-environment node
 */
import { buildBriefingContext, resolveBriefingMember } from '../../lib/services/deliberation-briefing/briefing-page-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RECEIVED_ID = '22222222-2222-4222-8222-222222222222';
const PENDING_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ID = '44444444-4444-4444-8444-444444444444';
const SLIDES_ID = '55555555-5555-4555-8555-555555555555';
const RECORDING_ID = '66666666-6666-4666-8666-666666666666';
const WRITEUP_ROW_ID = '77777777-7777-4777-8777-777777777777';
const FOREIGN_MATERIAL_ID = '88888888-8888-4888-8888-888888888888';

// Registry rows: one servable deck, one oversize recording (listed, not
// served), the writeup row itself (never a material), and a foreign request's
// slides (never in this request's set).
function materialRows() {
  return [
    { wmkf_requestdocumentid: SLIDES_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Applicant Slides.pdf', wmkf_filesize: 2048, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'slides-item' },
    { wmkf_requestdocumentid: RECORDING_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000005, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Visit.mp4', wmkf_filesize: 900 * 1024 * 1024, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'recording-item' },
    { wmkf_requestdocumentid: WRITEUP_ROW_ID, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: 100000001, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Writeup.docx', wmkf_filesize: 100, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'writeup-item' },
    { wmkf_requestdocumentid: FOREIGN_MATERIAL_ID, _wmkf_request_value: FOREIGN_ID, wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000001, wmkf_filename: 'Other.pdf', wmkf_filesize: 100, wmkf_sharepointdriveid: 'mat-drive', wmkf_sharepointitemid: 'other-item' },
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
    downloadReview: jest.fn(async () => ({ buffer: Buffer.from('r'), mimeType: 'application/pdf', filename: 'review.pdf', size: 1 })),
    ...overrides,
  };
}

const LINK = { expires_at: new Date('2026-10-08T20:00:00Z') };

test('context carries only received reviews with authors, no URL-shaped fields, and a writeup placeholder before any send', async () => {
  const d = deps();
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.title).toBe('Example University');
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

const PDF_BYTES = Buffer.from('%PDF-');
const PDF_HASH = require('node:crypto').createHash('sha256').update(PDF_BYTES).digest('hex');

function sentAttempt(overrides = {}) {
  return {
    docx_drive_id: 'd', docx_item_id: 'i', docx_filename: 'PreSite_1002379.docx', docx_size: '2048', docx_content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx_byte_hash: 'f'.repeat(64),
    pdf_drive_id: 'd', pdf_item_id: 'p', pdf_filename: 'PreSite_1002379.pdf', pdf_size: '4096', pdf_content_type: 'application/pdf', pdf_byte_hash: PDF_HASH,
    sent_at: '2026-09-09T01:00:00Z', send_requested_at: '2026-09-09T00:59:00Z',
    ...overrides,
  };
}

test('writeup descriptors come from the latest sent attempt and downloads verify the pinned bytes', async () => {
  const d = deps({ getLatestAttempt: jest.fn(async () => sentAttempt()) });
  const context = await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, d);
  expect(context.writeup).toEqual({
    docx: { member: 'writeup-docx', filename: 'PreSite_1002379.docx', size: 2048 },
    pdf: { member: 'writeup-pdf', filename: 'PreSite_1002379.pdf', size: 4096 },
    sharedAt: '2026-09-09T01:00:00.000Z',
  });
  const pdf = await resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-pdf' }, d);
  expect(d.downloadFile).toHaveBeenCalledWith('d', 'p');
  expect(pdf).toMatchObject({ filename: 'PreSite_1002379.pdf', mimeType: 'application/pdf', inline: true });
});

test('a snapshot whose bytes no longer match the pinned hash is refused', async () => {
  const mutated = deps({
    getLatestAttempt: jest.fn(async () => sentAttempt()),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-edited'), mimeType: 'application/pdf', filename: 'x.pdf', size: 11 })),
  });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-pdf' }, mutated))
    .rejects.toMatchObject({ httpStatus: 409, body: { ok: false, reason: 'snapshot_mismatch' } });
  const noHash = deps({ getLatestAttempt: jest.fn(async () => sentAttempt({ pdf_byte_hash: null })) });
  await expect(resolveBriefingMember({ requestId: REQUEST_ID, member: 'writeup-pdf' }, noHash))
    .rejects.toMatchObject({ httpStatus: 409 });
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
  for (const member of ['writeup-pdf', 'proposal', `review:${RECEIVED_ID}`]) {
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
    { member: `material:${SLIDES_ID}`, label: 'Applicant Slides', filename: 'Applicant Slides.pdf', size: 2048, available: true },
    { member: `material:${RECORDING_ID}`, label: 'Recording', filename: 'Visit.mp4', size: 900 * 1024 * 1024, available: false },
  ]);
  expect(JSON.stringify(context.materials)).not.toMatch(/drive|item|sharepoint|Writeup\.docx|Other\.pdf/i);
  // A registry failure leaves the section empty rather than failing the page.
  const broken = deps({ findDocuments: jest.fn(async () => { throw new Error('dataverse down'); }) });
  expect((await buildBriefingContext({ requestId: REQUEST_ID, link: LINK }, broken)).materials).toEqual([]);
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

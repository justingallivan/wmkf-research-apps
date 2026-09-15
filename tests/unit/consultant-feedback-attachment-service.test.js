/**
 * lib/services/consultant-feedback-attachment-service.js
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §4 lifecycle,
 * Codex AR findings on the finalize crash points and loser-side cleanup)
 *
 * @jest-environment node
 */
import { mintAttachmentUpload, finalizeAttachmentUpload, CONSULTANT_FEEDBACK_CONTENT_TYPES } from '../../lib/services/consultant-feedback-attachment-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { PORTAL_UPLOAD_SCOPES } from '../../lib/services/portal-upload-staging';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const STAGING_ID = '22222222-2222-4222-8222-222222222222';
const REGISTRY_ID = '33333333-3333-4333-8333-333333333333';

function baseDeps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1002379' })),
    getSharePointBuckets: jest.fn(async () => ([{ library: 'akoya_request', folder: 'Requests/1002379', source: 'dynamics' }])),
    ensureFolderPath: jest.fn(async () => {}),
    uploadFile: jest.fn(async () => ({ id: 'item-1', driveId: 'drive-1', name: 'Consultant Feedback-1002379-Jane Doe-2026-09-01.pdf', size: 5, webUrl: null, versionId: 'v1', eTag: 'etag-1' })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [] })),
    createDocument: jest.fn(async () => ({ wmkf_requestdocumentid: REGISTRY_ID })),
    supersedeDocument: jest.fn(async () => {}),
    scanEnabled: jest.fn(() => false),
    scanBytes: jest.fn(async () => ({ scan_result: 'clean' })),
    getUploadMaxMb: jest.fn(async () => ({ maxMb: 25 })),
    createPortalUpload: jest.fn(async () => ({ stagingId: STAGING_ID, pathname: 'x', clientToken: 't' })),
    recordPortalUploadCandidate: jest.fn(async () => {}),
    discardPortalUploadCandidate: jest.fn(async () => true),
    writeFeedbackEntry: jest.fn(async () => ({ id: '9' })),
    updateFeedbackEntry: jest.fn(async () => ({ id: '9' })),
    getFeedbackEntryForFilename: jest.fn(async () => ({ consultantName: 'Jane Doe', receivedOn: '2026-09-01' })),
    randomUUID: jest.fn(() => 'claim-token'),
    ...overrides,
  };
}

function file(overrides = {}) {
  return { buffer: Buffer.from('%PDF-'), filename: 'x.pdf', mimeType: 'application/pdf', sha256: 'a'.repeat(64), leaseToken: 'lease-1', ...overrides };
}

describe('mintAttachmentUpload', () => {
  test('restricts to PDF/DOCX and rejects an oversize request before minting', async () => {
    const deps = baseDeps();
    await mintAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, filename: 'x.pdf', contentType: 'application/pdf', size: 1000 }, deps);
    expect(deps.createPortalUpload).toHaveBeenCalledWith(expect.objectContaining({
      scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK,
      resourceId: REQUEST_ID,
      allowedContentTypes: CONSULTANT_FEEDBACK_CONTENT_TYPES,
    }));
    await expect(mintAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, filename: 'x.pdf', contentType: 'application/pdf', size: 999_999_999 }, deps))
      .rejects.toMatchObject({ httpStatus: 400 });
  });

  test('rejects a non-GUID requestId', async () => {
    await expect(mintAttachmentUpload({ requestId: 'not-a-guid', actorProfileId: 7, filename: 'x.pdf', contentType: 'application/pdf', size: 10 }, baseDeps()))
      .rejects.toMatchObject({ httpStatus: 400 });
  });
});

describe('finalizeAttachmentUpload — happy paths', () => {
  test('binds a new entry (writeFeedbackEntry), records the candidate BEFORE the registry create', async () => {
    const callOrder = [];
    const deps = baseDeps({
      recordPortalUploadCandidate: jest.fn(async () => { callOrder.push('candidate'); }),
      createDocument: jest.fn(async () => { callOrder.push('registry-create'); return { wmkf_requestdocumentid: REGISTRY_ID }; }),
    });
    const newEntry = { oneOff: { name: 'Jane Doe' }, receivedOn: '2026-09-01', consultantName: 'Jane Doe' };
    const result = await finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, newEntry }, deps);
    expect(callOrder).toEqual(['candidate', 'registry-create']);
    expect(result).toEqual({ requestdocumentId: REGISTRY_ID, feedbackId: '9', filename: expect.any(String) });
    expect(deps.writeFeedbackEntry).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST_ID, requestdocumentId: REGISTRY_ID }));
  });

  test('binds an existing entry (updateFeedbackEntry)', async () => {
    const deps = baseDeps();
    const result = await finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps);
    expect(deps.updateFeedbackEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 9, requestId: REQUEST_ID, patch: { requestdocumentId: REGISTRY_ID } }));
    expect(result.requestdocumentId).toBe(REGISTRY_ID);
  });

  test('uses conflictBehavior "rename" and derives the filename from the target entry (entryId) or newEntry fields, not a hardcoded placeholder', async () => {
    const deps = baseDeps({ getFeedbackEntryForFilename: jest.fn(async () => ({ consultantName: 'Ada Lovelace', receivedOn: '2026-08-01' })) });
    await finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps);
    expect(deps.getFeedbackEntryForFilename).toHaveBeenCalledWith({ id: 9, requestId: REQUEST_ID });
    const [, , filenameArg, , , optionsArg] = deps.uploadFile.mock.calls[0];
    expect(filenameArg).toContain('Ada Lovelace');
    expect(filenameArg).toContain('2026-08-01');
    expect(optionsArg).toEqual({ conflictBehavior: 'rename' });
  });

  test('two attachments on one request produce two distinct SharePoint names and two registry rows', async () => {
    const first = baseDeps({
      uploadFile: jest.fn(async () => ({ id: 'item-1', driveId: 'drive-1', name: 'Consultant Feedback-1002379-Jane Doe-2026-09-01.pdf' })),
      createDocument: jest.fn(async () => ({ wmkf_requestdocumentid: 'registry-1' })),
    });
    const firstResult = await finalizeAttachmentUpload({
      requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID,
      newEntry: { oneOff: { name: 'Jane Doe' }, receivedOn: '2026-09-01', consultantName: 'Jane Doe' },
    }, first);

    const second = baseDeps({
      uploadFile: jest.fn(async () => ({ id: 'item-2', driveId: 'drive-1', name: 'Consultant Feedback-1002379-John Smith-2026-09-02.pdf' })),
      createDocument: jest.fn(async () => ({ wmkf_requestdocumentid: 'registry-2' })),
    });
    const secondResult = await finalizeAttachmentUpload({
      requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: '44444444-4444-4444-8444-444444444444',
      newEntry: { oneOff: { name: 'John Smith' }, receivedOn: '2026-09-02', consultantName: 'John Smith' },
    }, second);

    expect(first.uploadFile.mock.calls[0][2]).not.toBe(second.uploadFile.mock.calls[0][2]);
    expect(firstResult.requestdocumentId).not.toBe(secondResult.requestdocumentId);
    expect(first.uploadFile.mock.calls[0][5]).toEqual({ conflictBehavior: 'rename' });
    expect(second.uploadFile.mock.calls[0][5]).toEqual({ conflictBehavior: 'rename' });
  });

  test('fail after step 6 (lost response after the registry create committed): replay reuses the existing registry row with no second Graph upload', async () => {
    const deps = baseDeps({
      findDocumentByGenerationKey: jest.fn(async () => ({ records: [{ wmkf_requestdocumentid: REGISTRY_ID, wmkf_filename: 'existing.pdf', wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000 }] })),
    });
    await finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.updateFeedbackEntry).toHaveBeenCalledWith(expect.objectContaining({ patch: { requestdocumentId: REGISTRY_ID } }));
  });
});

describe('finalizeAttachmentUpload — crash points and loser-side cleanup', () => {
  test('bind conflict (attachment_conflict): supersedes the just-created row, discards the Graph item, and rethrows the conflict', async () => {
    const conflictError = new ServiceHttpError('conflict', { httpStatus: 409, code: 'attachment_conflict', body: { reason: 'attachment_conflict' } });
    const deps = baseDeps({
      updateFeedbackEntry: jest.fn().mockRejectedValue(conflictError),
      findDocumentByGenerationKey: jest.fn()
        .mockResolvedValueOnce({ records: [] }) // no replay before upload
        .mockResolvedValueOnce({ records: [{ wmkf_requestdocumentid: REGISTRY_ID, wmkf_sharepointdriveid: 'drive-1', wmkf_sharepointitemid: 'item-1' }] }), // loser-side lookup
    });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 409, code: 'attachment_conflict' });
    expect(deps.supersedeDocument).toHaveBeenCalledWith(REGISTRY_ID);
    expect(deps.discardPortalUploadCandidate).toHaveBeenCalledWith({ driveId: 'drive-1', itemId: 'item-1' });
  });

  test('a failing loser-side supersede/discard does not mask the original conflict error', async () => {
    const conflictError = new ServiceHttpError('conflict', { httpStatus: 409, code: 'attachment_conflict', body: { reason: 'attachment_conflict' } });
    const deps = baseDeps({
      updateFeedbackEntry: jest.fn().mockRejectedValue(conflictError),
      supersedeDocument: jest.fn().mockRejectedValue(new Error('dataverse down')),
      findDocumentByGenerationKey: jest.fn()
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [{ wmkf_requestdocumentid: REGISTRY_ID }] }),
    });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 409, code: 'attachment_conflict' });
  });

  test('requires exactly one of entryId / newEntry', async () => {
    const deps = baseDeps();
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID }, deps))
      .rejects.toMatchObject({ httpStatus: 400, body: expect.objectContaining({ reason: 'invalid_bind_target' }) });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9, newEntry: {} }, deps))
      .rejects.toMatchObject({ httpStatus: 400, body: expect.objectContaining({ reason: 'invalid_bind_target' }) });
  });

  test('forged/stale roster id in newEntry is rejected via the shared eligibility path (writeFeedbackEntry); the registry row is left Ready, not superseded', async () => {
    const eligibilityError = Object.assign(new Error('not eligible'), { httpStatus: 400, body: { reason: 'consultant_not_eligible' } });
    const deps = baseDeps({ writeFeedbackEntry: jest.fn().mockRejectedValue(eligibilityError) });
    await expect(finalizeAttachmentUpload({
      requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID,
      newEntry: { consultantRosterId: 999, receivedOn: '2026-09-01' },
    }, deps)).rejects.toMatchObject({ httpStatus: 400 });
    // Only an `attachment_conflict` bind failure triggers loser-side
    // cleanup. An eligibility rejection (or any other non-conflict bind
    // failure) must leave the registry row Ready and unbound — superseding
    // it here would strand the just-uploaded SharePoint item behind a
    // Superseded row that a client retry (same staging id) would then find
    // by generation key and bind to as dead (the bug this test guards).
    expect(deps.supersedeDocument).not.toHaveBeenCalled();
    expect(deps.discardPortalUploadCandidate).not.toHaveBeenCalled();
  });

  test('fail after step 5 (candidate recorded, crash before the registry create ever commits): a retry re-uploads (accepted residual — rename makes the duplicate harmless) but produces exactly one feedback row, bound to the retry\'s registry row', async () => {
    const deps = baseDeps({
      createDocument: jest.fn()
        .mockRejectedValueOnce(new Error('crash before commit'))
        .mockResolvedValueOnce({ wmkf_requestdocumentid: REGISTRY_ID }),
    });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps))
      .rejects.toThrow();
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.updateFeedbackEntry).not.toHaveBeenCalled();

    // Retry: findDocumentByGenerationKey still finds nothing (the first
    // create never committed), so it re-uploads under 'rename' rather than
    // hanging forever — a harmless duplicate SharePoint item, reclaimed later
    // by the staging cleanup sweep as unbound-with-no-registry-row.
    const result = await finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps);
    expect(deps.uploadFile).toHaveBeenCalledTimes(2);
    expect(deps.createDocument).toHaveBeenCalledTimes(2);
    expect(deps.updateFeedbackEntry).toHaveBeenCalledTimes(1);
    expect(result.requestdocumentId).toBe(REGISTRY_ID);
  });

  test('fail after step 7 (bind attempt failed, non-conflict): a retry after a non-conflict bind failure finds the Ready registry row by generation key and performs only the bind — no second Graph upload', async () => {
    const eligibilityError = Object.assign(new Error('not eligible'), { httpStatus: 400, body: { reason: 'consultant_not_eligible' } });
    const deps = baseDeps({ writeFeedbackEntry: jest.fn().mockRejectedValue(eligibilityError) });
    await expect(finalizeAttachmentUpload({
      requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID,
      newEntry: { consultantRosterId: 999, receivedOn: '2026-09-01' },
    }, deps)).rejects.toMatchObject({ httpStatus: 400 });
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);

    // Retry: the same generation key now resolves to the Ready row the
    // first attempt created (still READY / Draft — never superseded above).
    deps.findDocumentByGenerationKey.mockResolvedValue({
      records: [{ wmkf_requestdocumentid: REGISTRY_ID, wmkf_filename: 'x.pdf', wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000 }],
    });
    deps.writeFeedbackEntry.mockResolvedValue({ id: '9' });
    const result = await finalizeAttachmentUpload({
      requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID,
      newEntry: { consultantRosterId: 5, receivedOn: '2026-09-01' },
    }, deps);
    expect(result.requestdocumentId).toBe(REGISTRY_ID);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1); // still just the one, from the first attempt
  });

  test('a replayed generation key whose registry row is Superseded is permanently rejected (attachment_replay_dead), never bound', async () => {
    const deps = baseDeps({
      findDocumentByGenerationKey: jest.fn(async () => ({
        records: [{ wmkf_requestdocumentid: REGISTRY_ID, wmkf_filename: 'x.pdf', wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000003 }],
      })),
    });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 409, code: 'attachment_replay_dead' });
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.updateFeedbackEntry).not.toHaveBeenCalled();
  });

  test('an ambiguous generation-key match (more than one registry row) is a 409, never re-uploads or re-creates', async () => {
    const deps = baseDeps({
      findDocumentByGenerationKey: jest.fn(async () => ({
        records: [{ wmkf_requestdocumentid: REGISTRY_ID }, { wmkf_requestdocumentid: 'other-id' }],
      })),
    });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 409, code: 'attachment_replay_ambiguous' });
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
  });

  test('two staging ids finalizing against one entry: the loser is superseded+discarded and returns 409; the winner is bound', async () => {
    const winner = baseDeps();
    await finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, winner);
    expect(winner.updateFeedbackEntry).toHaveBeenCalledTimes(1);

    const conflictError = new ServiceHttpError('conflict', { httpStatus: 409, code: 'attachment_conflict', body: { reason: 'attachment_conflict' } });
    const OTHER_REGISTRY_ID = 'other-registry-id';
    const loser = baseDeps({
      createDocument: jest.fn(async () => ({ wmkf_requestdocumentid: OTHER_REGISTRY_ID })),
      updateFeedbackEntry: jest.fn().mockRejectedValue(conflictError),
      findDocumentByGenerationKey: jest.fn()
        .mockResolvedValueOnce({ records: [] }) // no replay before upload
        .mockResolvedValueOnce({ records: [{ wmkf_requestdocumentid: OTHER_REGISTRY_ID, wmkf_sharepointdriveid: 'drive-2', wmkf_sharepointitemid: 'item-2' }] }),
    });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file({ leaseToken: 'lease-2' }), stagingId: '44444444-4444-4444-8444-444444444444', entryId: 9 }, loser))
      .rejects.toMatchObject({ httpStatus: 409, code: 'attachment_conflict' });
    expect(loser.supersedeDocument).toHaveBeenCalledWith(OTHER_REGISTRY_ID);
    expect(loser.discardPortalUploadCandidate).toHaveBeenCalledWith({ driveId: 'drive-2', itemId: 'item-2' });
  });

  test('scan_infected stops before any Graph upload', async () => {
    const deps = baseDeps({ scanEnabled: jest.fn(() => true), scanBytes: jest.fn(async () => ({ scan_result: 'infected' })) });
    await expect(finalizeAttachmentUpload({ requestId: REQUEST_ID, actorProfileId: 7, file: file(), stagingId: STAGING_ID, entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 422, code: 'scan_infected' });
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });
});

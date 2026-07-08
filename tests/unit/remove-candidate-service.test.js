/**
 * Unit tests for lib/services/reviewer-finder/remove-candidate-service.js
 * (docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md — permanent reviewer removal,
 * post-Codex-review no-block / audit-centric model).
 *
 * Adapters, the changeset transport, ReviewDraftService, NotificationService,
 * and AlertService are all mocked — this pins the SERVICE's orchestration
 * logic: atomic-changeset composition + ordering, the pre-delete-audit-then-
 * delete sequencing (abort on audit failure), the cross-store Postgres
 * ordering (audit → changeset → Postgres → audit-result update), and the
 * fail-closed applicant-excluded guard (reused from findById, not
 * reimplemented here).
 */

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const HONORARIUM_ID = '33333333-3333-4333-8333-333333333333';
const POTENTIAL_REVIEWER_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR = 'su-1';
const REVIEW_FOLDER = 'REQ-1_22222222222242228222222222222222/Reviewer_Uploads/11111111-1111-4111-8111-111111111111';
const REVIEW_FILENAME = 'review.pdf';

const findById = jest.fn();
const findAllByPotentialReviewer = jest.fn(async () => []);
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  findAllByPotentialReviewer: (...a) => findAllByPotentialReviewer(...a),
  ENTITY_SET_NAME: 'wmkf_appreviewersuggestions',
}));

const getPotentialReviewerById = jest.fn(async () => null);
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: (...a) => getPotentialReviewerById(...a),
}));

const getByIdWithSelect = jest.fn(async () => ({}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getByIdWithSelect: (...a) => getByIdWithSelect(...a),
  ENTITY_SET_NAME: 'contacts',
}));

const getRequestById = jest.fn(async () => null);
const queryAllRequests = jest.fn(async () => ({ records: [] }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
  queryAllRequests: (...a) => queryAllRequests(...a),
  SELECT_PROFILES: { IDENTITY: ['akoya_requestid', 'akoya_requestnum'] },
}));

const fetchAnswersBySuggestion = jest.fn(async () => ({}));
const answerRowKeyPredicate = jest.fn((sid, key) => `_wmkf_appreviewersuggestion_value=${sid},wmkf_questionkey='${key}'`);
jest.mock('../../lib/dataverse/adapters/review-answer', () => ({
  fetchAnswersBySuggestion: (...a) => fetchAnswersBySuggestion(...a),
  answerRowKeyPredicate: (...a) => answerRowKeyPredicate(...a),
  ENTITY_SET_NAME: 'wmkf_appreviewanswers',
}));

const runChangeset = jest.fn(async () => ({ ok: true }));
const atomicParentWithChildren = jest.fn(({ parent, children = [] }) => [...children, parent]);
jest.mock('../../lib/dataverse/core/changeset', () => ({
  runChangeset: (...a) => runChangeset(...a),
  atomicParentWithChildren: (...a) => atomicParentWithChildren(...a),
}));

const deleteBySuggestion = jest.fn(async () => 1);
jest.mock('../../lib/services/review-draft-service', () => ({
  __esModule: true,
  default: { deleteBySuggestion: (...a) => deleteBySuggestion(...a) },
}));

const notify = jest.fn(async () => ({ id: 42 }));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: (...a) => notify(...a) },
}));

const updateAlertMetadata = jest.fn(async () => ({}));
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: { updateAlertMetadata: (...a) => updateAlertMetadata(...a) },
}));

const getDriveId = jest.fn(async () => 'drive-1');
const listFiles = jest.fn(async () => []);
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    getDriveId: (...a) => getDriveId(...a),
    listFiles: (...a) => listFiles(...a),
  },
}));

const cleanupSharePointItems = jest.fn(async () => true);
jest.mock('../../lib/services/sharepoint-cleanup', () => ({
  cleanupSharePointItems: (...a) => cleanupSharePointItems(...a),
}));

let removeCandidateEntirely;
let describeRemoval;
let RemoveCandidateError;
beforeAll(async () => {
  const mod = await import('../../lib/services/reviewer-finder/remove-candidate-service');
  removeCandidateEntirely = mod.removeCandidateEntirely;
  describeRemoval = mod.describeRemoval;
  RemoveCandidateError = mod.RemoveCandidateError;
});

function baseSuggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_honorariumrequest_value: null,
    _wmkf_potentialreviewer_value: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewsharepointfolder: null,
    wmkf_reviewfilename: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(baseSuggestion());
  findAllByPotentialReviewer.mockResolvedValue([]);
  getPotentialReviewerById.mockResolvedValue(null);
  getByIdWithSelect.mockResolvedValue({});
  getRequestById.mockResolvedValue({ akoya_requestid: REQUEST_ID, akoya_requestnum: 'R-1' });
  queryAllRequests.mockResolvedValue({ records: [] });
  fetchAnswersBySuggestion.mockResolvedValue({});
  runChangeset.mockResolvedValue({ ok: true });
  deleteBySuggestion.mockResolvedValue(1);
  notify.mockResolvedValue({ id: 42 });
  updateAlertMetadata.mockResolvedValue({});
  getDriveId.mockResolvedValue('drive-1');
  listFiles.mockResolvedValue([]);
  cleanupSharePointItems.mockResolvedValue(true);
});

describe('removeCandidateEntirely — full bundle', () => {
  test('honorarium + answer rows + suggestion deleted in ONE changeset, then Postgres draft cleanup', async () => {
    findById.mockResolvedValue(baseSuggestion({ _wmkf_honorariumrequest_value: HONORARIUM_ID }));
    getRequestById.mockImplementation(async (id) => {
      if (id === HONORARIUM_ID) return { akoya_requestid: HONORARIUM_ID, akoya_requestnum: 'H-1', akoya_recommendedamount: 500 };
      return { akoya_requestid: REQUEST_ID, akoya_requestnum: 'R-1' };
    });
    fetchAnswersBySuggestion.mockResolvedValue({
      [SUGGESTION_ID]: [{ questionKey: 'impact' }, { questionKey: 'comments' }],
    });

    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });

    expect(out).toEqual(expect.objectContaining({
      success: true,
      suggestionId: SUGGESTION_ID,
      honorariumDeleted: true,
      answerRowsDeleted: 2,
      contactDeleted: false,
      contactDeleteAttempted: false,
      contactDeleteError: null,
      draftDeleted: true,
      postgresError: null,
      warnings: [],
      partialFailure: null,
      auditAlertId: 42,
    }));

    // ONE changeset call.
    expect(runChangeset).toHaveBeenCalledTimes(1);
    const [operations, opts] = runChangeset.mock.calls[0];
    expect(opts).toEqual({ actingUserSystemId: ACTOR });
    // Ordering: answer rows (leaf) → suggestion → honorarium (root-most).
    expect(operations.map((o) => o.entitySet)).toEqual([
      'wmkf_appreviewanswers',
      'wmkf_appreviewanswers',
      'wmkf_appreviewersuggestions',
      'akoya_requests',
    ]);
    expect(operations.every((o) => o.method === 'DELETE')).toBe(true);
    expect(operations[2].key).toBe(SUGGESTION_ID);
    expect(operations[3].key).toBe(HONORARIUM_ID);

    // Audit BEFORE the changeset.
    expect(notify).toHaveBeenCalledTimes(1);
    const notifyCallOrder = notify.mock.invocationCallOrder[0];
    const changesetCallOrder = runChangeset.mock.invocationCallOrder[0];
    expect(notifyCallOrder).toBeLessThan(changesetCallOrder);

    // Postgres AFTER the changeset.
    expect(deleteBySuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
    const draftCallOrder = deleteBySuggestion.mock.invocationCallOrder[0];
    expect(draftCallOrder).toBeGreaterThan(changesetCallOrder);

    // Audit-result update AFTER Postgres.
    expect(updateAlertMetadata).toHaveBeenCalledWith(42, { result: expect.objectContaining({ status: 'success' }) });
  });
});

describe('removeCandidateEntirely — honorarium absent', () => {
  test('no honorarium op in the changeset; honorariumDeleted:false', async () => {
    findById.mockResolvedValue(baseSuggestion({ _wmkf_honorariumrequest_value: null }));
    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });
    expect(out.honorariumDeleted).toBe(false);
    const [operations] = runChangeset.mock.calls[0];
    expect(operations.some((o) => o.entitySet === 'akoya_requests')).toBe(false);
  });
});

describe('removeCandidateEntirely — review-answer / draft absent', () => {
  test('no answer rows → only the suggestion delete op; draftDeleted:false when deleteBySuggestion returns 0', async () => {
    fetchAnswersBySuggestion.mockResolvedValue({});
    deleteBySuggestion.mockResolvedValue(0);
    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });
    expect(out.answerRowsDeleted).toBe(0);
    expect(out.draftDeleted).toBe(false);
    const [operations] = runChangeset.mock.calls[0];
    expect(operations).toHaveLength(1);
    expect(operations[0].entitySet).toBe('wmkf_appreviewersuggestions');
  });
});

describe('removeCandidateEntirely — Action B (deleteContact)', () => {
  test('runs contact delete in a separate changeset after Action A and surfaces the full association count', async () => {
    findById.mockResolvedValue(baseSuggestion({ _wmkf_potentialreviewer_value: POTENTIAL_REVIEWER_ID }));
    getPotentialReviewerById.mockResolvedValue({ _wmkf_contact_value: CONTACT_ID, wmkf_name: 'Dr X' });
    getByIdWithSelect.mockResolvedValue({ wmkf_portaloid: 'oid-1', wmkf_billcomid: 'bc-1' });
    findAllByPotentialReviewer.mockResolvedValue([
      { wmkf_appreviewersuggestionid: SUGGESTION_ID },
      { wmkf_appreviewersuggestionid: 'other-suggestion-1' },
    ]);
    queryAllRequests.mockResolvedValue({ records: [{ akoya_requestid: 'other-req-1' }] });

    const out = await removeCandidateEntirely({
      suggestionId: SUGGESTION_ID,
      deleteContact: true,
      actingUserSystemId: ACTOR,
    });

    expect(out.contactDeleteAttempted).toBe(true);
    expect(out.contactDeleted).toBe(true);
    expect(runChangeset).toHaveBeenCalledTimes(2);

    const [requiredOperations] = runChangeset.mock.calls[0];
    expect(requiredOperations.some((o) => o.entitySet === 'contacts')).toBe(false);

    const [contactOperations] = runChangeset.mock.calls[1];
    expect(contactOperations).toEqual([
      expect.objectContaining({ method: 'DELETE', entitySet: 'contacts', key: CONTACT_ID }),
    ]);
    expect(runChangeset.mock.invocationCallOrder[1]).toBeGreaterThan(runChangeset.mock.invocationCallOrder[0]);

    // The audit metadata carries the full comprehensive association snapshot.
    const auditMetadata = notify.mock.calls[0][0].metadata;
    expect(auditMetadata.disclosure.contactAssociations).toEqual(expect.objectContaining({
      contactId: CONTACT_ID,
      otherEngagementCount: 1, // excludes the current suggestion itself
      otherGrantOrHonorariumRequestCount: 1,
      portalIdentityLinked: true,
      billVendorLinked: true,
    }));
  });

  test('contact delete failure is isolated from Action A and recorded as partial', async () => {
    findById.mockResolvedValue(baseSuggestion({ _wmkf_potentialreviewer_value: POTENTIAL_REVIEWER_ID }));
    getPotentialReviewerById.mockResolvedValue({ _wmkf_contact_value: CONTACT_ID, wmkf_name: 'Dr X' });
    runChangeset
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('contact restrict relationship'));

    const out = await removeCandidateEntirely({
      suggestionId: SUGGESTION_ID,
      deleteContact: true,
      actingUserSystemId: ACTOR,
    });

    expect(runChangeset).toHaveBeenCalledTimes(2);
    const [requiredOperations] = runChangeset.mock.calls[0];
    expect(requiredOperations.some((o) => o.entitySet === 'contacts')).toBe(false);
    const [contactOperations] = runChangeset.mock.calls[1];
    expect(contactOperations).toEqual([
      expect.objectContaining({ method: 'DELETE', entitySet: 'contacts', key: CONTACT_ID }),
    ]);

    expect(deleteBySuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(out).toEqual(expect.objectContaining({
      success: true,
      contactDeleteAttempted: true,
      contactDeleted: false,
      contactDeleteError: 'contact restrict relationship',
      partialFailure: 'contact_delete_failed',
      warnings: ['contact_delete_failed'],
    }));
    expect(updateAlertMetadata).toHaveBeenCalledWith(42, {
      result: expect.objectContaining({
        status: 'partial_contact_delete_failed',
        contactDeleted: false,
        contactDeleteError: 'contact restrict relationship',
      }),
    });
  });

  test('deleteContact:false (default) never adds a contact op even when a contact is linked', async () => {
    findById.mockResolvedValue(baseSuggestion({ _wmkf_potentialreviewer_value: POTENTIAL_REVIEWER_ID }));
    getPotentialReviewerById.mockResolvedValue({ _wmkf_contact_value: CONTACT_ID });
    await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });
    const [operations] = runChangeset.mock.calls[0];
    expect(operations.some((o) => o.entitySet === 'contacts')).toBe(false);
  });
});

describe('removeCandidateEntirely — excluded fail-closed', () => {
  test('findById throwing on an applicant-excluded row propagates BEFORE any write', async () => {
    findById.mockRejectedValue(new Error('reviewer-suggestion.findById: refusing to act on an applicant-excluded suggestion'));
    await expect(removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR }))
      .rejects.toThrow(/applicant-excluded/);
    expect(notify).not.toHaveBeenCalled();
    expect(runChangeset).not.toHaveBeenCalled();
  });
});

describe('removeCandidateEntirely — audit-write-fails', () => {
  test('aborts BEFORE any delete when the pre-delete audit write throws', async () => {
    notify.mockRejectedValue(new Error('system_alerts insert failed'));
    await expect(removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR }))
      .rejects.toThrow('system_alerts insert failed');
    expect(runChangeset).not.toHaveBeenCalled();
    expect(deleteBySuggestion).not.toHaveBeenCalled();
  });
});

describe('removeCandidateEntirely — Dataverse-changeset-fails', () => {
  test('nothing deleted (atomic); audit row updated with changeset_failed; Postgres never touched', async () => {
    runChangeset.mockRejectedValue(new Error('batch failed: 412'));
    await expect(removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR }))
      .rejects.toThrow('batch failed: 412');
    expect(deleteBySuggestion).not.toHaveBeenCalled();
    expect(updateAlertMetadata).toHaveBeenCalledWith(42, {
      result: expect.objectContaining({ status: 'changeset_failed' }),
    });
  });
});

describe('removeCandidateEntirely — SharePoint review-file cleanup', () => {
  test('records folder/filename in the audit snapshot and best-effort deletes listed files after Action A', async () => {
    findById.mockResolvedValue(baseSuggestion({
      wmkf_reviewreceivedat: '2026-07-01',
      wmkf_reviewsharepointfolder: REVIEW_FOLDER,
      wmkf_reviewfilename: REVIEW_FILENAME,
    }));
    listFiles.mockResolvedValue([
      { id: 'sp-1', name: REVIEW_FILENAME },
      { id: 'sp-2', name: 'supplement.docx' },
    ]);

    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });

    expect(getDriveId).toHaveBeenCalledWith('akoya_request');
    expect(listFiles).toHaveBeenCalledWith('akoya_request', REVIEW_FOLDER, { recursive: false });
    expect(cleanupSharePointItems).toHaveBeenCalledWith(
      'drive-1',
      [
        { id: 'sp-1', name: REVIEW_FILENAME },
        { id: 'sp-2', name: 'supplement.docx' },
      ],
      'remove-candidate-review-files',
    );
    expect(out).toEqual(expect.objectContaining({
      reviewFile: expect.objectContaining({
        folder: REVIEW_FOLDER,
        filename: REVIEW_FILENAME,
        wmkf_reviewsharepointfolder: REVIEW_FOLDER,
        wmkf_reviewfilename: REVIEW_FILENAME,
      }),
      sharePointCleanupAttempted: true,
      sharePointReviewFilesDeleted: true,
      sharePointReviewFilesDeletedCount: 2,
      warnings: [],
    }));

    const auditMetadata = notify.mock.calls[0][0].metadata;
    expect(auditMetadata).toEqual(expect.objectContaining({
      reviewSharePointFolder: REVIEW_FOLDER,
      reviewFilename: REVIEW_FILENAME,
      disclosure: expect.objectContaining({
        reviewSharePointFolder: REVIEW_FOLDER,
        reviewFilename: REVIEW_FILENAME,
        reviewFile: expect.objectContaining({
          wmkf_reviewsharepointfolder: REVIEW_FOLDER,
          wmkf_reviewfilename: REVIEW_FILENAME,
        }),
      }),
    }));
    expect(updateAlertMetadata).toHaveBeenCalledWith(42, {
      result: expect.objectContaining({
        sharePointCleanup: expect.objectContaining({
          attempted: true,
          filesFound: 2,
          deleted: true,
          error: null,
        }),
      }),
    });
  });

  test('SharePoint cleanup failure is recorded as partial and does not undo Action A', async () => {
    findById.mockResolvedValue(baseSuggestion({
      wmkf_reviewreceivedat: '2026-07-01',
      wmkf_reviewsharepointfolder: REVIEW_FOLDER,
      wmkf_reviewfilename: REVIEW_FILENAME,
    }));
    listFiles.mockResolvedValue([{ id: 'sp-1', name: REVIEW_FILENAME }]);
    cleanupSharePointItems.mockResolvedValue(false);

    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });

    expect(runChangeset).toHaveBeenCalledTimes(1);
    expect(deleteBySuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(out).toEqual(expect.objectContaining({
      success: true,
      partialFailure: 'sharepoint_review_file_cleanup_failed',
      warnings: ['sharepoint_review_file_cleanup_failed'],
      sharePointReviewFilesDeleted: false,
    }));
    expect(updateAlertMetadata).toHaveBeenCalledWith(42, {
      result: expect.objectContaining({
        status: 'partial_sharepoint_review_file_cleanup_failed',
        sharePointCleanup: expect.objectContaining({
          attempted: true,
          deleted: false,
          error: 'one_or_more_sharepoint_deletes_failed',
        }),
      }),
    });
  });
});

describe('removeCandidateEntirely — Postgres-fails-after-changeset', () => {
  test('recorded as a partial result, not silent — the Dataverse deletes already committed', async () => {
    deleteBySuggestion.mockRejectedValue(new Error('pg connection reset'));
    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });
    // The overall call still resolves (the Dataverse changeset succeeded) —
    // the failure is recorded on the audit row, not thrown/swallowed.
    expect(out.success).toBe(true);
    expect(out.draftDeleted).toBe(false);
    expect(out.postgresError).toBe('pg connection reset');
    expect(out.partialFailure).toBe('postgres_draft_delete_failed');
    expect(out.warnings).toEqual(['postgres_draft_delete_failed']);
    expect(updateAlertMetadata).toHaveBeenCalledWith(42, {
      result: expect.objectContaining({
        status: 'partial_postgres_draft_delete_failed',
        postgresError: 'pg connection reset',
      }),
    });
  });

  test('audit-result update failure emits a fallback durable alert with the partial result', async () => {
    deleteBySuggestion.mockRejectedValue(new Error('pg connection reset'));
    updateAlertMetadata.mockRejectedValue(new Error('system_alerts update failed'));

    const out = await removeCandidateEntirely({ suggestionId: SUGGESTION_ID, actingUserSystemId: ACTOR });

    expect(out.partialFailure).toBe('postgres_draft_delete_failed');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0]).toEqual(expect.objectContaining({
      type: 'reviewer_candidate_remove_audit_update_failed',
      severity: 'error',
      metadata: expect.objectContaining({
        suggestionId: SUGGESTION_ID,
        actingUserSystemId: ACTOR,
        auditAlertId: 42,
        updateError: 'system_alerts update failed',
        resultPatch: expect.objectContaining({
          status: 'partial_postgres_draft_delete_failed',
          postgresError: 'pg connection reset',
          warnings: ['postgres_draft_delete_failed'],
        }),
      }),
    }));
  });
});

describe('removeCandidateEntirely — validation', () => {
  test('missing/invalid suggestionId → RemoveCandidateError 400, no reads/writes', async () => {
    const err = await removeCandidateEntirely({ suggestionId: 'not-a-guid' }).catch((e) => e);
    expect(err).toBeInstanceOf(RemoveCandidateError);
    expect(err.httpStatus).toBe(400);
    expect(findById).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('describeRemoval — preflight', () => {
  test('returns the disclosure without writing anything', async () => {
    findById.mockResolvedValue(baseSuggestion({ _wmkf_honorariumrequest_value: HONORARIUM_ID, wmkf_reviewreceivedat: '2026-07-01' }));
    getRequestById.mockImplementation(async (id) => {
      if (id === HONORARIUM_ID) return { akoya_requestid: HONORARIUM_ID, akoya_requestnum: 'H-1', akoya_recommendedamount: 500 };
      return { akoya_requestid: REQUEST_ID, akoya_requestnum: 'R-1' };
    });
    fetchAnswersBySuggestion.mockResolvedValue({ [SUGGESTION_ID]: [{ questionKey: 'impact' }] });

    const out = await describeRemoval({ suggestionId: SUGGESTION_ID });

    expect(out).toEqual(expect.objectContaining({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      requestNumber: 'R-1',
      honorarium: { id: HONORARIUM_ID, requestNumber: 'H-1', amount: 500 },
      hasSubmittedReview: true,
      answerRowCount: 1,
      contactId: null,
      reviewFile: {
        folder: null,
        filename: null,
        wmkf_reviewsharepointfolder: null,
        wmkf_reviewfilename: null,
      },
      reviewSharePointFolder: null,
      reviewFilename: null,
    }));
    expect(notify).not.toHaveBeenCalled();
    expect(runChangeset).not.toHaveBeenCalled();
  });

  test('includes SharePoint folder/filename pointers and treats them as submitted-review evidence', async () => {
    findById.mockResolvedValue(baseSuggestion({
      wmkf_reviewsharepointfolder: REVIEW_FOLDER,
      wmkf_reviewfilename: REVIEW_FILENAME,
    }));
    fetchAnswersBySuggestion.mockResolvedValue({});

    const out = await describeRemoval({ suggestionId: SUGGESTION_ID });

    expect(out).toEqual(expect.objectContaining({
      hasSubmittedReview: true,
      reviewSharePointFolder: REVIEW_FOLDER,
      reviewFilename: REVIEW_FILENAME,
      reviewFile: {
        folder: REVIEW_FOLDER,
        filename: REVIEW_FILENAME,
        wmkf_reviewsharepointfolder: REVIEW_FOLDER,
        wmkf_reviewfilename: REVIEW_FILENAME,
      },
    }));
    expect(notify).not.toHaveBeenCalled();
    expect(runChangeset).not.toHaveBeenCalled();
  });

  test('invalid suggestionId → RemoveCandidateError 400', async () => {
    const err = await describeRemoval({ suggestionId: null }).catch((e) => e);
    expect(err).toBeInstanceOf(RemoveCandidateError);
    expect(err.httpStatus).toBe(400);
  });
});

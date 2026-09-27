/**
 * Test Request Factory slice 4a, Recipe 4: the exporter's Pre-Site draft
 * reader (`readPreSiteVisitDraftForExport`). Fake dependencies only (no
 * Dataverse); this suite never runs against production.
 *
 * @jest-environment node
 */
import {
  readPreSiteVisitDraftForExport, preSiteVisitRowIdentity,
} from '../../lib/services/test-requests/source-bundle-presite.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  PRE_SITE_VISIT_CONTRACT,
  PRE_SITE_DISTRIBUTION_CONTRACT,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
const OTHER_REQUEST_ID = 'ffffffff-698f-f111-8076-6045bd018a07';
const WORD_ROW_ID = 'cccccccc-0000-0000-0000-000000000001';

/**
 * A full, realistic row carrying every governed field (including every field
 * this reader must NEVER export) -- the shape the reader is deliberately
 * given so its allowlist projection is the thing under test, not a
 * dependency that conveniently omits the dangerous fields for us.
 */
function fullRow(over = {}) {
  return {
    wmkf_requestdocumentid: WORD_ROW_ID,
    '@odata.etag': 'W/"12345678"',
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
    wmkf_producer: 'request-workbench',
    wmkf_presiteexecutivesummary: 'Executive summary.',
    wmkf_presiteimpactoverview: 'Impact overview.',
    wmkf_presitemethodologyoverview: 'Methodology overview.',
    wmkf_presitepersonneloverview: 'Personnel overview.',
    wmkf_presitekeckfundingrationale: 'Keck funding rationale.',
    wmkf_presitebackgroundandimpact: 'Background and impact.',
    wmkf_presitedetailedmethodology: 'Detailed methodology.',
    wmkf_presitepersonneldetails: 'Personnel details.',
    wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: { a: 1 }, diagnostics: [] }),
    // Fields this reader must NEVER export (design doc "Pointers, registry
    // identities, generation keys, source links, AI-run links" copy rule):
    wmkf_presiteinputsnapshotjson: JSON.stringify({ schemaVersion: 4, secret: 'do-not-export' }),
    wmkf_inputfingerprint: 'deadbeef'.repeat(8),
    wmkf_generationkey: 'feedface'.repeat(8),
    wmkf_claimtoken: 'claim-token-should-never-leave',
    _wmkf_airun_value: '11111111-0000-0000-0000-000000000000',
    ...over,
  };
}

function deps({ request, rows }) {
  return {
    getRequest: jest.fn(async () => request),
    listPreSiteDocuments: jest.fn(async () => rows),
  };
}

describe('readPreSiteVisitDraftForExport', () => {
  test('uses the current-pointer row when set and it is a Pre-Site Word artifact', async () => {
    const row = fullRow();
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
    const { draft } = await readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [row] }));
    expect(draft.requestDocumentId).toBe(WORD_ROW_ID);
    expect(draft.sectionFields.wmkf_presiteexecutivesummary).toBe('Executive summary.');
    expect(draft.proposalCoreJson).toEqual({ schemaVersion: 4, proposalCore: { a: 1 }, diagnostics: [] });
  });

  test('falls back to the single candidate when the pointer is null (e.g. the Pre-Site has moved to Final Writeup)', async () => {
    const row = fullRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL });
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
    const { draft } = await readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [row] }));
    expect(draft.requestDocumentId).toBe(WORD_ROW_ID);
  });

  test('refuses when the pointer does not resolve to any candidate row', async () => {
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: 'ffffffff-0000-0000-0000-000000000000' };
    await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [fullRow()] })))
      .rejects.toThrow(/current Pre-Site pointer does not resolve/);
  });

  test('refuses with zero candidates when the pointer is null', async () => {
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
    await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [] })))
      .rejects.toThrow(/no Pre-Site Word artifact to export/);
  });

  test('refuses with more than one candidate when the pointer is null', async () => {
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
    const rows = [fullRow(), fullRow({ wmkf_requestdocumentid: 'dddddddd-0000-0000-0000-000000000002' })];
    await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows })))
      .rejects.toThrow(/more than one candidate Pre-Site Word artifact/);
  });

  test('excludes a distribution snapshot from the pointer-null fallback candidate set', async () => {
    const snapshot = fullRow({
      wmkf_requestdocumentid: 'dddddddd-0000-0000-0000-000000000003',
      wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-docx`,
    });
    const real = fullRow();
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
    const { draft } = await readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [snapshot, real] }));
    expect(draft.requestDocumentId).toBe(WORD_ROW_ID);
  });

  test('excludes a SUPERSEDED row from the pointer-null fallback candidate set', async () => {
    const superseded = fullRow({
      wmkf_requestdocumentid: 'dddddddd-0000-0000-0000-000000000004',
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    });
    const real = fullRow();
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
    const { draft } = await readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [superseded, real] }));
    expect(draft.requestDocumentId).toBe(WORD_ROW_ID);
  });

  test('refuses when the source request cannot be resolved', async () => {
    await expect(readPreSiteVisitDraftForExport(
      { requestId: REQUEST_ID },
      deps({ request: null, rows: [fullRow()] }),
    )).rejects.toThrow(/could not be resolved/);
  });

  test('refuses an invalid requestId before any dependency call', async () => {
    const getRequest = jest.fn();
    const listPreSiteDocuments = jest.fn();
    await expect(readPreSiteVisitDraftForExport({ requestId: 'not-a-guid' }, { getRequest, listPreSiteDocuments }))
      .rejects.toThrow(/valid requestId/);
    expect(getRequest).not.toHaveBeenCalled();
    expect(listPreSiteDocuments).not.toHaveBeenCalled();
  });

  // The load-bearing test: even though the dependency hands the reader a
  // FULL row carrying the input snapshot, fingerprint, generation key, claim
  // token and AI-run link, the returned draft (an explicit allowlist
  // projection, never a delete-list) carries none of them.
  test('never carries the source input snapshot, fingerprint, generation key, claim token or AI-run link even when the row has them', async () => {
    const row = fullRow();
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
    const { draft } = await readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [row] }));
    const json = JSON.stringify(draft);
    expect(json).not.toContain('do-not-export');
    expect(json).not.toContain(row.wmkf_inputfingerprint);
    expect(json).not.toContain(row.wmkf_generationkey);
    expect(json).not.toContain(row.wmkf_claimtoken);
    expect(json).not.toContain(row._wmkf_airun_value);
    for (const forbiddenKey of [
      'wmkf_presiteinputsnapshotjson', 'wmkf_inputfingerprint', 'wmkf_generationkey',
      'wmkf_claimtoken', '_wmkf_airun_value', 'wmkf_lifecyclestate',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(draft, forbiddenKey)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(draft.sectionFields, forbiddenKey)).toBe(false);
    }
  });

  test('refuses when the chosen row has no proposal-core JSON', async () => {
    const row = fullRow({ wmkf_presiteproposalcorejson: null });
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
    await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [row] })))
      .rejects.toThrow(/no proposal-core JSON/);
  });

  test('refuses when the chosen row\'s proposal-core JSON is unreadable', async () => {
    const row = fullRow({ wmkf_presiteproposalcorejson: '{not json' });
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
    await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [row] })))
      .rejects.toThrow(/unreadable/);
  });

  test('excludes a row with an unknown/other content type or artifact type from candidacy', async () => {
    const wrongArtifact = fullRow({
      wmkf_requestdocumentid: 'dddddddd-0000-0000-0000-000000000005',
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    });
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
    await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [wrongArtifact] })))
      .rejects.toThrow(/no Pre-Site Word artifact/);
  });

  // Opus round-1 P2: the app itself treats only a READY Word row as current
  // (artifact-lineage.js verifyReadyLineage's pointer check AND its
  // activeReadyWords fallback census both require
  // wmkf_operationstatus === READY); the same rule must hold on BOTH paths
  // here.
  describe('wmkf_operationstatus gating (Opus round-1 P2)', () => {
    test('a lone Pending (GENERATING) row is refused by the pointer-null fallback', async () => {
      const pending = fullRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [pending] })))
        .rejects.toThrow(/no Pre-Site Word artifact/);
    });

    test('a pointer to a Failed row is refused', async () => {
      const failed = fullRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [failed] })))
        .rejects.toThrow(/current Pre-Site pointer does not resolve/);
    });

    test('a pointer to a Ready row is accepted', async () => {
      const ready = fullRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
      const { draft } = await readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [ready] }));
      expect(draft.requestDocumentId).toBe(WORD_ROW_ID);
    });
  });

  // Opus round-1 P3-3: refusal paths isCandidateRow already enforces but
  // that had no direct test -- SUPERSEDED/distribution-snapshot on the
  // POINTER path (not just the fallback path, already covered above), and
  // cross-request rows on both paths.
  describe('isCandidateRow refusal paths not previously tested (Opus round-1 P3-3)', () => {
    test('a pointer to a SUPERSEDED row is refused', async () => {
      const superseded = fullRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [superseded] })))
        .rejects.toThrow(/current Pre-Site pointer does not resolve/);
    });

    test('a pointer to a distribution snapshot is refused', async () => {
      const snapshot = fullRow({ wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-docx` });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [snapshot] })))
        .rejects.toThrow(/current Pre-Site pointer does not resolve/);
    });

    test('a pointer to a row belonging to a DIFFERENT request is refused', async () => {
      const otherRequestRow = fullRow({ _wmkf_request_value: OTHER_REQUEST_ID });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [otherRequestRow] })))
        .rejects.toThrow(/current Pre-Site pointer does not resolve/);
    });

    test('a pointer-null fallback candidate belonging to a DIFFERENT request is excluded (refuses with zero candidates)', async () => {
      const otherRequestRow = fullRow({ _wmkf_request_value: OTHER_REQUEST_ID });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: null };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [otherRequestRow] })))
        .rejects.toThrow(/no Pre-Site Word artifact to export/);
    });
  });

  // Codex adversarial round-1 finding 1: an eTag-less row fails closed
  // (mirrors the reviewer fence's assertNonEmptyEtag -- a comparison with no
  // eTag on either side proves nothing about whether the row changed).
  describe('preSiteVisitRowIdentity (Codex adversarial round-1 finding 1)', () => {
    test('refuses a row with no @odata.etag', async () => {
      const row = fullRow({ '@odata.etag': undefined });
      const request = { akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: WORD_ROW_ID };
      await expect(readPreSiteVisitDraftForExport({ requestId: REQUEST_ID }, deps({ request, rows: [row] })))
        .rejects.toThrow(/no readable eTag/);
    });

    test('refuses a row with an empty-string @odata.etag', () => {
      expect(() => preSiteVisitRowIdentity(fullRow({ '@odata.etag': '' }))).toThrow(/no readable eTag/);
    });

    test('returns requestDocumentId/eTag/operationstatus/lifecyclestate for a well-formed row', () => {
      const row = fullRow();
      expect(preSiteVisitRowIdentity(row)).toEqual({
        requestDocumentId: WORD_ROW_ID,
        eTag: row['@odata.etag'],
        operationstatus: row.wmkf_operationstatus,
        lifecyclestate: row.wmkf_lifecyclestate,
      });
    });
  });
});

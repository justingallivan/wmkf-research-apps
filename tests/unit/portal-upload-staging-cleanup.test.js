/** @jest-environment node */
/**
 * Slice 2 prerequisite (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §4
 * "Slice 2 prerequisite", Codex AR-3): scope-specific, fail-closed
 * reconciliation of a `candidate_result` recorded after the Graph upload but
 * before the finalize's later steps commit, run inside
 * `cleanupExpiredPortalUploads`'s expiry sweep.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@vercel/blob', () => ({ del: jest.fn(), get: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: jest.fn() }));
jest.mock('../../lib/services/sharepoint-cleanup', () => ({ cleanupSharePointItemsDetailed: jest.fn() }));

import { sql } from '@vercel/postgres';
import { del } from '@vercel/blob';
import {
  PORTAL_UPLOAD_SCOPES,
  cleanupExpiredPortalUploads,
} from '../../lib/services/portal-upload-staging';

const REGISTRY_ID = '33333333-3333-4333-8333-333333333333';

function candidateRow({ scope, candidate, id = 'row-1', status = 'expired' }) {
  return { id, pathname: `portal-staging/${scope}/${id}`, scope, status, candidate_result: candidate };
}

/** Did any tagged-template `sql` call's literal text contain this substring? */
function sqlCalledWith(substring) {
  return sql.mock.calls.some(([strings]) => Array.isArray(strings) && strings.join('').includes(substring));
}

function makeDependencies(overrides = {}) {
  return {
    findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [] }),
    supersedeDocument: jest.fn().mockResolvedValue({}),
    discardCandidate: jest.fn().mockResolvedValue(true),
    isConsultantFeedbackBound: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.UPLOADS_BLOB_RW_TOKEN = 'vercel_blob_rw_test_private';
  del.mockResolvedValue(undefined);
});

/** Every call: eligible-row select, then the sweep's mutations, then the prune. */
function mockSql(rows) {
  sql.mockReset();
  sql.mockResolvedValueOnce({ rows }); // eligible-row select
  // Every subsequent tagged-template call (clear-candidate / expire UPDATE / prune) resolves empty.
  sql.mockResolvedValue({ rows: [], rowCount: 0 });
}

describe('consultant_feedback scope', () => {
  test('an ambiguous generation-key match (more than one registry row) is retained, never discarded', async () => {
    const candidate = { generationKey: 'gk-ambiguous', driveId: 'd', itemId: 'i' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [{ wmkf_requestdocumentid: 'a' }, { wmkf_requestdocumentid: 'b' }] }),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(deps.supersedeDocument).not.toHaveBeenCalled();
    expect(result.retained).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });

  test('committed crash (bound via registry + feedback row): row expires, candidate untouched, nothing discarded', async () => {
    const candidate = { generationKey: 'gk-1', driveId: 'd', itemId: 'i' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [{ wmkf_requestdocumentid: REGISTRY_ID }] }),
      isConsultantFeedbackBound: jest.fn().mockResolvedValue(true),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.supersedeDocument).not.toHaveBeenCalled();
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('portal-staging/consultant_feedback/row-1', expect.any(Object));
    expect(result.deleted).toBe(1);
    expect(result.retained).toBe(0);
  });

  test('uncommitted crash after registry create (Ready, unbound): supersede runs BEFORE discard', async () => {
    const candidate = { generationKey: 'gk-2', driveId: 'd', itemId: 'i' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const callOrder = [];
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [{ wmkf_requestdocumentid: REGISTRY_ID }] }),
      isConsultantFeedbackBound: jest.fn().mockResolvedValue(false),
      supersedeDocument: jest.fn().mockImplementation(async () => { callOrder.push('supersede'); }),
      discardCandidate: jest.fn().mockImplementation(async () => { callOrder.push('discard'); return true; }),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.supersedeDocument).toHaveBeenCalledWith(REGISTRY_ID);
    expect(callOrder).toEqual(['supersede', 'discard']);
    expect(result.retained).toBe(0);
  });

  test('uncommitted crash after Graph upload, before registry create: discards with no supersede', async () => {
    const candidate = { generationKey: 'gk-3', driveId: 'd', itemId: 'i' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [] }),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.supersedeDocument).not.toHaveBeenCalled();
    expect(deps.discardCandidate).toHaveBeenCalledWith(candidate);
    expect(result.retained).toBe(0);
  });

  test('a failing supersede retains the row (no discard, no expiry)', async () => {
    const candidate = { generationKey: 'gk-4', driveId: 'd', itemId: 'i' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [{ wmkf_requestdocumentid: REGISTRY_ID }] }),
      isConsultantFeedbackBound: jest.fn().mockResolvedValue(false),
      supersedeDocument: jest.fn().mockRejectedValue(new Error('dataverse down')),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(result.retained).toBe(1);
    expect(result.deleted).toBe(0);
  });

  test('a failing discard retains the row even though supersede already ran', async () => {
    const candidate = { generationKey: 'gk-5', driveId: 'd', itemId: 'i' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [{ wmkf_requestdocumentid: REGISTRY_ID }] }),
      isConsultantFeedbackBound: jest.fn().mockResolvedValue(false),
      discardCandidate: jest.fn().mockResolvedValue(false),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.supersedeDocument).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(result.retained).toBe(1);
  });
});

describe('site_visit_material scope', () => {
  test('committed (registry row exists): row expires, nothing discarded', async () => {
    const candidate = { generationKey: 'sv-gk-1' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [{ wmkf_requestdocumentid: REGISTRY_ID }] }),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
    expect(result.retained).toBe(0);
  });

  test('uncommitted (no registry row): discards the candidate', async () => {
    const candidate = { generationKey: 'sv-gk-2' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL, candidate })]);
    const deps = makeDependencies({
      findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [] }),
    });
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.discardCandidate).toHaveBeenCalledWith(candidate);
    expect(result.retained).toBe(0);
  });
});

describe('grantee_image / staff_grantee_image scopes', () => {
  test('always retained — no binding proof is wired for image candidates', async () => {
    const candidate = { imageRef: 'some-ref' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, candidate })]);
    const deps = makeDependencies();
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(deps.findDocumentByGenerationKey).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(result.retained).toBe(1);
  });

  test('staff_grantee_image is likewise always retained', async () => {
    const candidate = { imageRef: 'some-ref' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.STAFF_GRANTEE_IMAGE, candidate })]);
    const result = await cleanupExpiredPortalUploads({}, makeDependencies());
    expect(result.retained).toBe(1);
  });
});

describe('unrecognised candidate shapes', () => {
  test('a consultant_feedback candidate missing generationKey is retained, not discarded', async () => {
    const candidate = { unexpected: true };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate })]);
    const deps = makeDependencies();
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(deps.findDocumentByGenerationKey).not.toHaveBeenCalled();
    expect(result.retained).toBe(1);
  });

  test('an entirely unknown scope on a row is retained, not discarded', async () => {
    const candidate = { anything: true };
    mockSql([candidateRow({ scope: 'some_future_scope', candidate })]);
    const result = await cleanupExpiredPortalUploads({}, makeDependencies());
    expect(result.retained).toBe(1);
  });
});

describe('consumed rows (regression: a consumed candidate must still expire and prune)', () => {
  test('a consumed grantee_image row with a candidate is expired (blob deleted, candidate cleared) with no Dataverse round-trip', async () => {
    const candidate = { imageRef: 'some-ref' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE, candidate, status: 'consumed' })]);
    const deps = makeDependencies();
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.findDocumentByGenerationKey).not.toHaveBeenCalled();
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('portal-staging/grantee_image/row-1', expect.any(Object));
    expect(sqlCalledWith('candidate_result = NULL')).toBe(true);
    expect(result.retained).toBe(0);
    expect(result.deleted).toBe(1);
  });

  test('a consumed consultant_feedback row with a candidate is likewise expired and its candidate cleared, with no registry lookup', async () => {
    const candidate = { generationKey: 'gk-consumed' };
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate, status: 'consumed' })]);
    const deps = makeDependencies();
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.findDocumentByGenerationKey).not.toHaveBeenCalled();
    expect(deps.isConsultantFeedbackBound).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('portal-staging/consultant_feedback/row-1', expect.any(Object));
    expect(sqlCalledWith('candidate_result = NULL')).toBe(true);
    expect(result.retained).toBe(0);
    expect(result.deleted).toBe(1);
  });
});

describe('null candidate (existing behavior unaffected)', () => {
  test('a row with no candidate expires as before, with no reconciliation calls', async () => {
    mockSql([candidateRow({ scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK, candidate: null })]);
    const deps = makeDependencies();
    const result = await cleanupExpiredPortalUploads({}, deps);
    expect(deps.findDocumentByGenerationKey).not.toHaveBeenCalled();
    expect(deps.discardCandidate).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
    expect(result.deleted).toBe(1);
    expect(result.retained).toBe(0);
  });
});

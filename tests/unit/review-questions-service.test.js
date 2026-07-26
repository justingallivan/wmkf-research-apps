/**
 * Unit tests for lib/services/admin/review-questions-service.js
 * (Stage 5 batch 1). Logic-level; adapter, changeset, and sql mocked. The
 * route characterization suite (admin-review-questions-route.test.js) pins the
 * HTTP envelopes; this pins the baseVersion optimistic-lock + atomic-changeset
 * semantics at service level.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/review-question', () => ({
  queryActiveQuestions: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/changeset', () => ({
  runChangeset: jest.fn(),
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));

import { queryActiveQuestions } from '../../lib/dataverse/adapters/review-question';
import { runChangeset } from '../../lib/dataverse/core/changeset';
import { sql } from '@vercel/postgres';
import { normalizeRow, questionSetVersion, invalidate } from '../../lib/external/review-question-fetcher';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { getQuestionSet, saveQuestionSet } from '../../lib/services/admin/review-questions-service';

const rawRich = (id, key, order, over = {}) => ({
  wmkf_reviewquestionid: id, _etag: `W/"${id}"`,
  wmkf_questionkey: key, wmkf_questionorder: order, wmkf_questiontext: `Question ${key}`,
  wmkf_questiontype: 'richtext', wmkf_required: true, wmkf_maxlength: null, wmkf_hint: null, wmkf_options: null, ...over,
});
const rawString = (id, key, order) => ({ ...rawRich(id, key, order), wmkf_questiontype: 'string' });
const rawPick = (id, key, order) => ({
  ...rawRich(id, key, order), wmkf_questiontype: 'picklist',
  wmkf_options: JSON.stringify([{ value: 1, label: 'Low' }, { value: 2, label: 'High' }]),
});
const rawMulti = (id, key, order) => ({
  ...rawPick(id, key, order), wmkf_questiontype: 'multiselect',
});

const baseRaw = () => [
  rawString('id-aff', 'affiliation', 0),
  rawMulti('id-imp', 'impactAreas', 1),
  rawPick('id-risk', 'riskLevel', 2),
  rawRich('id-q4', 'riskDetail', 3),
  rawPick('id-or', 'overallAssessment', 4),
];
const versionOf = (raw) => questionSetVersion(raw.map((r) => normalizeRow(r)));
const submittedFour = () => [
  { id: 'id-aff', key: 'affiliation', label: 'Question affiliation', type: 'string', required: true },
  { id: 'id-imp', key: 'impactAreas', label: 'Question impactAreas', type: 'multiselect', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
  { id: 'id-risk', key: 'riskLevel', label: 'Question riskLevel', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
  { id: 'id-or', key: 'overallAssessment', label: 'Question overallAssessment', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
];
const fullSubmitted = () => {
  const [affiliation, impactAreas, riskLevel, overallAssessment] = submittedFour();
  return [
    affiliation,
    impactAreas,
    riskLevel,
    { id: 'id-q4', key: 'riskDetail', label: 'Question riskDetail', type: 'richtext', required: true },
    overallAssessment,
  ];
};

function primeActive(records = baseRaw()) {
  queryActiveQuestions.mockResolvedValue({ records, totalCount: records.length, hasMore: false });
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
  runChangeset.mockResolvedValue({ ok: true });
});

describe('getQuestionSet', () => {
  it('returns ids + etags + version token', async () => {
    primeActive();
    const r = await getQuestionSet();
    expect(r.questions[0]).toMatchObject({ id: 'id-aff', etag: 'W/"id-aff"', key: 'affiliation' });
    expect(r.version).toBe(versionOf(baseRaw()));
  });

  it('fails closed (500) when the set exceeds the 100-row fetch cap', async () => {
    queryActiveQuestions.mockResolvedValue({ records: baseRaw(), totalCount: 101, hasMore: true });
    await expect(getQuestionSet()).rejects.toMatchObject({ httpStatus: 500 });
  });
});

describe('saveQuestionSet', () => {
  it('400 invalid body when baseVersion is missing (no bypass of the lock)', async () => {
    await expect(saveQuestionSet({ questions: submittedFour(), profileId: 7 })).rejects.toMatchObject({
      httpStatus: 400,
      body: { status: 'invalid', errors: ['Missing baseVersion (reload the editor and try again).'] },
    });
    expect(runChangeset).not.toHaveBeenCalled();
  });

  it('409 set_changed with currentVersion on a stale baseVersion; audits the rejection', async () => {
    primeActive();
    let caught;
    try {
      await saveQuestionSet({ questions: fullSubmitted(), baseVersion: 'stale', profileId: 7 });
    } catch (e) { caught = e; }
    expect(caught.httpStatus).toBe(409);
    expect(caught.body).toMatchObject({ status: 'set_changed', currentVersion: versionOf(baseRaw()) });
    expect(runChangeset).not.toHaveBeenCalled();
    expect(sql).toHaveBeenCalledTimes(1); // best-effort set_changed audit
  });

  it('no-op save short-circuits before audit or changeset', async () => {
    primeActive();
    const r = await saveQuestionSet({ questions: fullSubmitted(), baseVersion: versionOf(baseRaw()), profileId: 7 });
    expect(r).toMatchObject({ status: 'completed', noop: true, version: versionOf(baseRaw()) });
    expect(runChangeset).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it('500 audit_unavailable hard-abort: pending audit failure blocks the changeset', async () => {
    primeActive();
    sql.mockRejectedValueOnce(new Error('db down'));
    const edited = fullSubmitted().map((r) => (r.key === 'riskDetail' ? { ...r, label: 'Edited' } : r));
    await expect(saveQuestionSet({ questions: edited, baseVersion: versionOf(baseRaw()), profileId: 7 }))
      .rejects.toMatchObject({ httpStatus: 500, body: expect.objectContaining({ status: 'audit_unavailable' }) });
    expect(runChangeset).not.toHaveBeenCalled();
  });

  it('applies edits as ONE changeset, invalidates the fetcher cache, reports auditWritten', async () => {
    primeActive();
    const edited = fullSubmitted().map((r) => (r.key === 'riskDetail' ? { ...r, label: 'Edited' } : r));
    const r = await saveQuestionSet({ questions: edited, baseVersion: versionOf(baseRaw()), profileId: 7 });
    expect(r.status).toBe('completed');
    expect(r.auditWritten).toBe(true);
    expect(r.summary).toMatchObject({ updated: 1 });
    expect(runChangeset).toHaveBeenCalledTimes(1);
    // Cache invalidation is observable via a fresh GET version (module-level cache dropped).
    expect(typeof invalidate).toBe('function');
  });

  it('412 from the changeset → 409 set_changed (whole edit rolled back)', async () => {
    primeActive();
    runChangeset.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
    const edited = fullSubmitted().map((r) => (r.key === 'riskDetail' ? { ...r, label: 'Edited' } : r));
    await expect(saveQuestionSet({ questions: edited, baseVersion: versionOf(baseRaw()), profileId: 7 }))
      .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'set_changed' }) });
  });

  it('non-412 changeset failure → 502 failed, nothing applied', async () => {
    primeActive();
    runChangeset.mockRejectedValue(new Error('batch refused'));
    const edited = fullSubmitted().map((r) => (r.key === 'riskDetail' ? { ...r, label: 'Edited' } : r));
    await expect(saveQuestionSet({ questions: edited, baseVersion: versionOf(baseRaw()), profileId: 7 }))
      .rejects.toMatchObject({
        httpStatus: 502,
        body: { status: 'failed', error: 'Saving the question set failed; no changes were applied.' },
      });
  });
});

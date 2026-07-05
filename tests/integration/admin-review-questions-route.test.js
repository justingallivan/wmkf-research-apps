/**
 * @jest-environment node
 *
 * /api/admin/review-questions — the superuser question-set editor route.
 * Covers the GET shape and the POST save protocol: atomic changeset for
 * create/update/delete, optimistic 409 (stale version + 412 concurrent write),
 * required baseVersion, parent-bound-key guard, validation + key-immutability,
 * the audit-availability precondition, and the no-op short-circuit.
 */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 7 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => (typeof labelOrFn === 'function' ? labelOrFn() : maybeFn()),
  // core/changeset.js#runChangeset asserts a trusted DAL context (Stage 7,
  // docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md); this route's own bypass above
  // is mocked to a no-op passthrough, so the assertion is mocked too — the
  // route establishes a real context in production.
  assertTrustedDalContext: () => {},
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(),
    executeChangeset: jest.fn(async () => ({ ok: true, operations: [] })),
  },
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));

import handler from '../../pages/api/admin/review-questions';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { sql } from '@vercel/postgres';
import { normalizeRow, questionSetVersion } from '../../lib/external/review-question-fetcher';

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

const rawRich = (id, key, order, over = {}) => ({
  wmkf_reviewquestionid: id, _etag: `W/"${id}"`,
  wmkf_questionkey: key, wmkf_questionorder: order, wmkf_questiontext: `Question ${key}`,
  wmkf_questiontype: 'richtext', wmkf_required: true, wmkf_maxlength: null, wmkf_hint: null, wmkf_options: null, ...over,
});
const rawString = (id, key, order, over = {}) => ({ ...rawRich(id, key, order), wmkf_questiontype: 'string', ...over });
const rawPick = (id, key, order, over = {}) => ({
  ...rawRich(id, key, order), wmkf_questiontype: 'picklist',
  wmkf_options: JSON.stringify([{ value: 1, label: 'Low' }, { value: 2, label: 'High' }]), ...over,
});

// A realistic live set: the four parent-bound rows (affiliation + 3 ratings) + a narrative.
const baseRaw = () => [
  rawString('id-aff', 'affiliation', 0),
  rawPick('id-imp', 'impact', 1),
  rawPick('id-risk', 'risk', 2),
  rawPick('id-or', 'overallRating', 3),
  rawRich('id-q4', 'q4', 4),
];
const versionOf = (raw) => questionSetVersion(raw.map((r) => normalizeRow(r)));

// The four parent-bound rows as the editor would resubmit them (ids + shapes match baseRaw).
const submittedFour = () => [
  { id: 'id-aff', key: 'affiliation', label: 'Question affiliation', type: 'string', required: true },
  { id: 'id-imp', key: 'impact', label: 'Question impact', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
  { id: 'id-risk', key: 'risk', label: 'Question risk', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
  { id: 'id-or', key: 'overallRating', label: 'Question overallRating', type: 'picklist', required: true, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
];

beforeEach(() => {
  DynamicsService.queryRecords.mockReset();
  DynamicsService.executeChangeset.mockReset();
  DynamicsService.executeChangeset.mockResolvedValue({ ok: true, operations: [] });
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
});

describe('GET', () => {
  it('returns the active set (with ids) and a version token', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.questions).toHaveLength(5);
    expect(res.body.questions[0]).toMatchObject({ id: 'id-aff', key: 'affiliation' });
    expect(res.body.version).toBe(versionOf(baseRaw()));
  });
});

describe('POST save', () => {
  const post = (questions, baseVersion) => ({ method: 'POST', query: {}, body: { questions, ...(baseVersion !== undefined ? { baseVersion } : {}) } });

  it('applies create + edit + delete as ONE atomic changeset, invalidates, audits, 200 completed', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    const res = mockRes();
    const submit = [
      ...submittedFour().map((r) => (r.key === 'impact' ? { ...r, label: 'Edited impact' } : r)), // edit impact
      { key: 'q12', label: 'Brand new', type: 'richtext', required: false },                       // create
      // id-q4 'q4' dropped → soft-delete
    ];
    await handler(post(submit, versionOf(baseRaw())), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.summary).toMatchObject({ created: 1, updated: 1, deleted: 1 });
    expect(DynamicsService.executeChangeset).toHaveBeenCalledTimes(1);
    const ops = DynamicsService.executeChangeset.mock.calls[0][0];
    expect(ops.some((o) => o.method === 'POST')).toBe(true);                                        // create (no ifMatch)
    expect(ops.some((o) => o.url.includes('id-imp') && o.ifMatch === 'W/"id-imp"')).toBe(true);     // edit w/ If-Match
    expect(ops.some((o) => o.url.includes('id-q4') && o.body.statecode === 1 && o.ifMatch === 'W/"id-q4"')).toBe(true); // soft-delete w/ If-Match
    expect(sql.mock.calls.length).toBeGreaterThanOrEqual(2); // pending + final audit
  });

  it('400 when baseVersion is missing (Codex P1-1 — no bypass)', async () => {
    const res = mockRes();
    await handler(post(submittedFour()), res); // no baseVersion
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(' ')).toMatch(/baseVersion/i);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('400 when a parent-bound key is removed (Codex P1-3)', async () => {
    const res = mockRes();
    const withoutRisk = submittedFour().filter((r) => r.key !== 'risk');
    await handler(post(withoutRisk, 'any-token'), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(' ')).toMatch(/can't be removed/i);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('400 over the 100-row cap (Codex P1-2)', async () => {
    const res = mockRes();
    const tooMany = Array.from({ length: 101 }, (_, i) => ({ key: `qq${i}`, label: `L${i}`, type: 'richtext', required: true }));
    await handler(post(tooMany, 'any-token'), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(' ')).toMatch(/too many/i);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('409 set_changed when baseVersion is stale (no write)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    const res = mockRes();
    await handler(post(submittedFour(), 'stale-version'), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.status).toBe('set_changed');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('409 set_changed when the changeset 412s (concurrent write lost the race)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    DynamicsService.executeChangeset.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));
    const res = mockRes();
    const submit = submittedFour().map((r) => (r.key === 'impact' ? { ...r, label: 'edit' } : r));
    await handler(post(submit, versionOf(baseRaw())), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.status).toBe('set_changed');
  });

  it('400 when an existing row\'s key is changed (immutability, no write)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    const res = mockRes();
    // Keep all four parents; rename the non-parent q4 row by id → immutability error.
    const submit = [...submittedFour(), { id: 'id-q4', key: 'q4_renamed', label: 'x', type: 'richtext', required: true }];
    await handler(post(submit, versionOf(baseRaw())), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(' ')).toMatch(/can't be changed/i);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('HARD-ABORTS (500 audit_unavailable) if the pending audit write fails — no Dataverse mutation', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    sql.mockRejectedValueOnce(new Error('db down')); // pending audit insert fails
    const res = mockRes();
    const submit = [...submittedFour(), { key: 'q12', label: 'New', type: 'richtext', required: true }];
    await handler(post(submit, versionOf(baseRaw())), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('audit_unavailable');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('no-op save (identical set) short-circuits without a changeset', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: baseRaw() });
    const res = mockRes();
    // Resubmit the live set unchanged (four parents + q4).
    const submit = [...submittedFour(), { id: 'id-q4', key: 'q4', label: 'Question q4', type: 'richtext', required: true }];
    await handler(post(submit, versionOf(baseRaw())), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.noop).toBe(true);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });
});

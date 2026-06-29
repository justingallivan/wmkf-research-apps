/**
 * @jest-environment node
 *
 * /api/admin/review-questions — the superuser question-set editor route.
 * Covers the GET shape and the POST save protocol: atomic changeset for
 * create/update/delete, optimistic 409, validation + key-immutability 400,
 * the audit-availability precondition, and the no-op short-circuit.
 */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 7 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => (typeof labelOrFn === 'function' ? labelOrFn() : maybeFn()),
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

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

const rawRich = (id, key, order, over = {}) => ({
  wmkf_reviewquestionid: id,
  wmkf_questionkey: key,
  wmkf_questionorder: order,
  wmkf_questiontext: `Question ${key}`,
  wmkf_questiontype: 'richtext',
  wmkf_required: true,
  wmkf_maxlength: null,
  wmkf_hint: null,
  wmkf_options: null,
  ...over,
});

beforeEach(() => {
  DynamicsService.queryRecords.mockReset();
  DynamicsService.executeChangeset.mockClear();
  DynamicsService.executeChangeset.mockResolvedValue({ ok: true, operations: [] });
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
});

describe('GET', () => {
  it('returns the active set (with ids) and a version token', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0), rawRich('id-2', 'q4', 1)] });
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.questions[0]).toMatchObject({ id: 'id-1', key: 'q2' });
    expect(typeof res.body.version).toBe('string');
  });
});

describe('POST save', () => {
  const submit = (questions, baseVersion) => ({ method: 'POST', query: {}, body: { questions, ...(baseVersion ? { baseVersion } : {}) } });

  it('applies create + edit + delete as ONE atomic changeset, invalidates, audits, 200 completed', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0), rawRich('id-2', 'q4', 1)] });
    const res = mockRes();
    await handler(submit([
      { id: 'id-1', key: 'q2', label: 'Edited q2', type: 'richtext', required: true }, // edit
      { key: 'q12', label: 'Brand new', type: 'richtext', required: false },           // create
      // id-2 'q4' dropped → soft-delete
    ]), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.summary).toMatchObject({ created: 1, updated: 1, deleted: 1 });
    expect(DynamicsService.executeChangeset).toHaveBeenCalledTimes(1);
    const ops = DynamicsService.executeChangeset.mock.calls[0][0];
    expect(ops.some((o) => o.method === 'POST')).toBe(true);                                 // create
    expect(ops.some((o) => o.method === 'PATCH' && o.url.includes('id-1'))).toBe(true);       // edit
    expect(ops.some((o) => o.method === 'PATCH' && o.url.includes('id-2') && o.body.statecode === 1)).toBe(true); // soft-delete
    // pending + final audit rows written
    expect(sql.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('409 set_changed when baseVersion is stale (no write)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0)] });
    const res = mockRes();
    await handler(submit([{ id: 'id-1', key: 'q2', label: 'x', type: 'richtext', required: true }], 'stale-version'), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.status).toBe('set_changed');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('400 invalid on a malformed submitted set (no write)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0)] });
    const res = mockRes();
    await handler(submit([{ key: '1bad', label: '', type: 'date', required: 'no' }]), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('invalid');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('400 when an existing row\'s key is changed (immutability, no write)', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0)] });
    const res = mockRes();
    await handler(submit([{ id: 'id-1', key: 'renamed', label: 'x', type: 'richtext', required: true }]), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('invalid');
    expect(res.body.errors.join(' ')).toMatch(/can't be changed/i);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('HARD-ABORTS (500 audit_unavailable) if the pending audit write fails — no Dataverse mutation', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0)] });
    sql.mockRejectedValueOnce(new Error('db down')); // pending audit insert fails
    const res = mockRes();
    await handler(submit([{ key: 'q12', label: 'New', type: 'richtext', required: true }]), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('audit_unavailable');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('no-op save (identical set) short-circuits without a changeset', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [rawRich('id-1', 'q2', 0)] });
    const res = mockRes();
    await handler(submit([{ id: 'id-1', key: 'q2', label: 'Question q2', type: 'richtext', required: true }]), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.noop).toBe(true);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });
});

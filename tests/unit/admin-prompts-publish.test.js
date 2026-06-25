/**
 * @jest-environment node
 */
/**
 * Admin versioned-publish endpoint (/api/admin/prompts/[name]) — covers the
 * key branches of the policies.js-style protocol: validation gate, no_current_row,
 * duplicate_current_rows, and the happy create→flip→verify path (S222).
 */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 7 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => (typeof labelOrFn === 'function' ? labelOrFn() : maybeFn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(),
    getRecord: jest.fn(async () => ({ wmkf_ai_promptid: 'prior', _etag: 'W/"1"' })),
    createRecord: jest.fn(async () => ({ wmkf_ai_promptid: 'new-row' })),
    updateRecord: jest.fn(async () => ({})),
  },
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));

import handler from '../../pages/api/admin/prompts/[name]';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { sql } from '@vercel/postgres';
import { ANALYZE_USER_PROMPT_TEMPLATE } from '../../shared/config/prompts/reviewer-finder-dynamics';

const NAME = 'reviewer-finder.analyze';
const VALID_BODY = ANALYZE_USER_PROMPT_TEMPLATE;

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function currentRow({ version = 3, id = 'prior', body = VALID_BODY, model = 'sonnet' } = {}) {
  return { wmkf_ai_promptid: id, wmkf_ai_promptname: NAME, wmkf_promptversion: version, wmkf_ai_iscurrent: true, wmkf_ai_promptbody: body, wmkf_ai_model: model };
}

beforeEach(() => {
  DynamicsService.queryRecords.mockReset();
  DynamicsService.createRecord.mockClear();
  DynamicsService.updateRecord.mockClear();
  sql.mockClear();
});

describe('PUT /api/admin/prompts/[name]', () => {
  it('rejects an invalid body (400 invalid_body)', async () => {
    const res = mockRes();
    await handler({ method: 'PUT', query: { name: NAME }, body: { body: 'too short, no labels' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('invalid_body');
    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  });

  it('returns no_current_row (404) when nothing is current', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] }); // current-rows query → empty
    const res = mockRes();
    await handler({ method: 'PUT', query: { name: NAME }, body: { body: VALID_BODY } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.status).toBe('no_current_row');
  });

  it('flags duplicate_current_rows (500) on non-resumable multi-current', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [currentRow({ version: 3, id: 'a' }), currentRow({ version: 8, id: 'b' })], // not consecutive
    });
    const res = mockRes();
    await handler({ method: 'PUT', query: { name: NAME }, body: { body: VALID_BODY } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('duplicate_current_rows');
    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  });

  it('happy path: creates v+1, flips prior, verifies one current → completed', async () => {
    // 1st query: current rows (one). 2nd query: post-flip verify (one).
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [currentRow({ version: 3, id: 'prior', model: 'Sonnet' })] })
      .mockResolvedValueOnce({ records: [{ wmkf_ai_promptid: 'new-row', wmkf_promptversion: 4 }] });
    const res = mockRes();
    await handler({ method: 'PUT', query: { name: NAME }, body: { body: `${VALID_BODY}\nEDIT` } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.targetVersion).toBe(4);
    // New row created iscurrent=true v4; prior flipped with If-Match.
    expect(DynamicsService.createRecord).toHaveBeenCalledTimes(1);
    const created = DynamicsService.createRecord.mock.calls[0][1];
    expect(created.wmkf_ai_iscurrent).toBe(true);
    expect(created.wmkf_promptversion).toBe(4);
    expect(created.wmkf_ai_model).toBe('sonnet');
    // S269: every admin-published version carries a domain publish time (parity w/ seed).
    expect(typeof created.wmkf_ai_publisheddatetime).toBe('string');
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_ai_prompts', 'prior', { wmkf_ai_iscurrent: false }, expect.objectContaining({ ifMatch: 'W/"1"' }));
  });

  it('rejects an unreviewed concrete Claude model before audit or create', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [currentRow({ version: 3, id: 'prior', model: 'claude-future-99' })],
    });
    const res = mockRes();
    await handler({ method: 'PUT', query: { name: NAME }, body: { body: `${VALID_BODY}\nEDIT` } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('invalid_model');
    expect(res.body.code).toBe('unreviewed_claude_model');
    expect(sql).toHaveBeenCalledTimes(1); // idempotency preflight only; no pending/final audit row.
    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  it('flags an invariant violation (partial) when >1 current remains after flip', async () => {
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [currentRow({ version: 3, id: 'prior' })] })
      .mockResolvedValueOnce({ records: [{ wmkf_ai_promptid: 'new-row' }, { wmkf_ai_promptid: 'prior' }] }); // 2 current!
    const res = mockRes();
    await handler({ method: 'PUT', query: { name: NAME }, body: { body: `${VALID_BODY}\nEDIT` } }, res);
    expect(res.body.status).toBe('partial');
    expect(res.body.warnings.join(' ')).toMatch(/invariant_violation_current_count_2/);
  });
});

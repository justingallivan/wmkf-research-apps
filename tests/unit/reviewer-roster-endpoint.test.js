/**
 * @jest-environment node
 *
 * /api/workbench/reviewer-roster (S224) — auth gate, GUID validation, method
 * dispatch, and payload contracts. The store is mocked; `pruneCandidateForRoster`
 * runs for real (pure) so we also confirm the route prunes server-side.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 5 })) }));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  listForRequest: jest.fn(async () => ({ active: [], excluded: [], allNames: [] })),
  recordSurfaced: jest.fn(async () => 0),
  setExcluded: jest.fn(async () => {}),
  promote: jest.fn(async () => ({ name: 'Bob Roe' })),
  markSaved: jest.fn(async () => 1),
}));

import handler from '../../pages/api/workbench/reviewer-roster';
import { requireAppAccess } from '../../lib/utils/auth';
import * as store from '../../lib/services/reviewer-roster-store';

const REQ = '11111111-1111-1111-1111-111111111111';

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 5 });
});

describe('auth', () => {
  it('short-circuits without calling the store when access is denied', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);
    expect(store.listForRequest).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('400 on a non-GUID requestId', async () => {
    const r = res();
    await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.listForRequest).not.toHaveBeenCalled();
  });

  it('lists the roster for a valid requestId', async () => {
    store.listForRequest.mockResolvedValueOnce({ active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] });
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.listForRequest).toHaveBeenCalledWith(REQ);
    expect(r.body.active).toEqual([{ name: 'Ann' }]);
  });
});

describe('POST recordSurfaced', () => {
  it('400 on a missing candidates array', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('400 when too many candidates', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `R${i}` }));
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: many } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.recordSurfaced).not.toHaveBeenCalled();
  });

  it('prunes server-side and records named candidates', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [
      { name: 'Ann Lee', hIndex: 9, contactEnrichment: { email: 'a@x.edu', tierResults: { secret: 1 }, identity: { status: 'unresolved' } } },
      { name: '' }, // dropped (no name)
    ] } }, r);
    expect(r.statusCode).toBe(200);
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed).toHaveLength(1);
    expect(passed[0].name).toBe('Ann Lee');
    expect(passed[0].hIndex).toBe(9);
    // A render-safe contactEnrichment SUBSET is kept (email), but raw resolver
    // internals (tierResults / identity) are NOT persisted.
    expect(passed[0].contactEnrichment.email).toBe('a@x.edu');
    expect(passed[0].contactEnrichment.tierResults).toBeUndefined();
    expect(passed[0].contactEnrichment.identity).toBeUndefined();
    expect(passed[0].tierResults).toBeUndefined();
    // The resolver verdict survives as a safe boolean flag (unresolved → block).
    expect(passed[0].identityPersistAllowed).toBe(false);
  });
});

describe('PATCH', () => {
  it('exclude → setExcluded with the pruned candidate', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude', candidate: { name: 'Bob Roe' } } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({ name: 'Bob Roe' }));
  });

  it('exclude → 400 without a candidate', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude' } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('promote → returns the restored blob', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', name: 'Bob Roe' } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.promote).toHaveBeenCalledWith(REQ, 'Bob Roe');
    expect(r.body.candidate).toEqual({ name: 'Bob Roe' });
  });

  it('saved → markSaved with the names', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'saved', names: ['Ann Lee'] } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.markSaved).toHaveBeenCalledWith(REQ, ['Ann Lee']);
  });

  it('unknown action → 400', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'frobnicate' } }, r);
    expect(r.statusCode).toBe(400);
  });
});

describe('method', () => {
  it('405 on an unsupported method', async () => {
    const r = res();
    await handler({ method: 'PUT', body: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(405);
  });
});

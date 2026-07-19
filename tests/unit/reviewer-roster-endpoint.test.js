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
  confirmIdentity: jest.fn(async () => ({ confirmationId: 'confirm-1', candidate: { name: 'Ann Lee' } })),
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
    // A render-safe contactEnrichment subset is kept. Raw resolver internals
    // and tierResults are dropped, while the compact identity decision needed
    // by the W4.1 save boundary survives the roster round trip.
    expect(passed[0].contactEnrichment.email).toBe('a@x.edu');
    expect(passed[0].contactEnrichment.tierResults).toBeUndefined();
    expect(passed[0].contactEnrichment.identity).toEqual({
      status: 'unresolved',
      confidenceBand: null,
      resolverVersion: null,
      resolvedAt: null,
      evidenceSummary: null,
      anchors: null,
    });
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
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:bob' } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.promote).toHaveBeenCalledWith(REQ, 'candidate:bob');
    expect(r.body.candidate).toEqual({ name: 'Bob Roe' });
  });

  it('saved → markSaved with exact pruned candidates', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{ name: 'Ann Lee', candidateKey: 'candidate:ann' }],
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.markSaved).toHaveBeenCalledWith(
      REQ,
      [expect.objectContaining({ name: 'Ann Lee', candidateKey: 'candidate:ann' })],
    );
  });

  it('confirm_identity records an actor-bound server confirmation', async () => {
    requireAppAccess.mockResolvedValueOnce({
      profileId: 5,
      session: { user: { dynamicsSystemuserId: 'SYS-5' } },
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: { name: 'Ann Lee', email: 'ANN@EXAMPLE.EDU', affiliation: 'Example U' },
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.confirmIdentity).toHaveBeenCalledWith(
      REQ,
      expect.objectContaining({ name: 'Ann Lee', email: 'ANN@EXAMPLE.EDU' }),
      { actorProfileId: 5, actorSystemUserId: 'SYS-5' },
    );
    expect(r.body.confirmationId).toBe('confirm-1');
  });

  it('confirm_identity returns 409 when the active roster row is gone', async () => {
    store.confirmIdentity.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: { name: 'Ann Lee', email: 'ann@example.edu' },
    } }, r);
    expect(r.statusCode).toBe(409);
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

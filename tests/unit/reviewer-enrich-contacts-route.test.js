/**
 * @jest-environment node
 *
 * Focused contract tests for /api/reviewer-finder/enrich-contacts timeout
 * partial-return behavior. The service owns the abort mechanics; this route
 * must opt in and stream partial results as a compatible complete frame.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 'profile-1' })),
}));

jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: jest.fn(() => jest.fn(async () => true)),
}));

jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(async () => {}),
}));

jest.mock('../../lib/services/reviewer-time-budget', () => ({
  getReviewerTimeBudgetSeconds: jest.fn(async () => 600),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

jest.mock('../../lib/services/proposal-pi-identity', () => ({
  resolveProposalPI: jest.fn(),
  piInstitutions: jest.fn(() => []),
}));

jest.mock('../../lib/services/contact-enrichment-service', () => ({
  ContactEnrichmentService: {
    estimateCost: jest.fn(),
    enrichCandidates: jest.fn(),
  },
}));

jest.mock('../../lib/services/reviewer-candidate-attestation', () => ({
  createServerIdentityDecisionReceipt: jest.fn(() => ({
    version: 1,
    source: 'automated_resolver',
    identityDigest: 'server-digest',
  })),
  mintAutomatedIdentityAttestation: jest.fn(async ({ candidate }) => `receipt:${candidate.name}`),
  verifyAutomatedIdentityAttestation: jest.fn(async () => ({ valid: true, identityDecisionBound: true })),
}));

jest.mock('../../lib/services/reviewer-contact-reconciliation', () => ({
  reconcileReviewerContacts: jest.fn(async (candidates) => candidates),
}));

import handler from '../../pages/api/reviewer-finder/enrich-contacts';
import { ContactEnrichmentService } from '../../lib/services/contact-enrichment-service';
import { mintAutomatedIdentityAttestation } from '../../lib/services/reviewer-candidate-attestation';
import { reconcileReviewerContacts } from '../../lib/services/reviewer-contact-reconciliation';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    frames: [],
    ended: false,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    write(chunk) {
      const data = String(chunk).trim().replace(/^data: /, '');
      if (data) this.frames.push(JSON.parse(data));
    },
    end() { this.ended = true; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ContactEnrichmentService.estimateCost.mockReturnValue({ total: 2, actualCost: 0 });
});

test('opts into partial abort results and streams partial complete metadata', async () => {
  ContactEnrichmentService.enrichCandidates.mockResolvedValue({
    enriched: [{ name: 'Dr. A', contactEnrichment: { email: 'a@example.edu' } }],
    stats: { total: 2, completed: 1, partial: true, timeout: true },
    partial: true,
    timeout: true,
    completedCount: 1,
    requestedCount: 2,
  });

  const res = mockRes();
  await handler({
    method: 'POST',
    body: {
      candidates: [{ name: 'Dr. A' }, { name: 'Dr. B' }],
      options: { usePubmed: true, useClaudeSearch: true },
    },
  }, res);

  expect(ContactEnrichmentService.enrichCandidates).toHaveBeenCalledWith(
    [{ name: 'Dr. A' }, { name: 'Dr. B' }],
    expect.objectContaining({
      usePubmed: true,
      useClaudeSearch: true,
      returnPartialOnAbort: true,
    }),
  );
  expect(res.frames).toEqual([
    { type: 'estimate', estimate: { total: 2, actualCost: 0 } },
    {
      type: 'complete',
      results: [{ name: 'Dr. A', contactEnrichment: { email: 'a@example.edu' } }],
      stats: { total: 2, completed: 1, partial: true, timeout: true },
      partial: true,
      timeout: true,
      completedCount: 1,
      requestedCount: 2,
    },
  ]);
  expect(res.ended).toBe(true);
  expect(reconcileReviewerContacts).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ skip: true, requestId: null }),
  );
});

test('adds a server identity receipt to enriched candidates when requestId is present', async () => {
  ContactEnrichmentService.enrichCandidates.mockResolvedValue({
    enriched: [{ name: 'Dr. A', contactEnrichment: { identity: { status: 'probable' } } }],
    stats: {},
  });
  const req = {
    method: 'POST',
    body: {
      requestId: '11111111-1111-1111-1111-111111111111',
      candidates: [{ name: 'Dr. A' }],
      options: {},
    },
  };
  const res = mockRes();
  await handler(req, res);
  const complete = res.frames.find((frame) => frame.type === 'complete');
  expect(mintAutomatedIdentityAttestation).toHaveBeenCalled();
  expect(complete.results[0].automatedIdentityAttestation).toBe('receipt:Dr. A');
  expect(complete.results[0].serverIdentityDecisionReceipt).toMatchObject({
    source: 'automated_resolver',
    identityDigest: 'server-digest',
  });
  expect(reconcileReviewerContacts.mock.calls[0][0][0].serverIdentityDecisionReceipt)
    .toMatchObject({ identityDigest: 'server-digest' });
  expect(reconcileReviewerContacts).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({
      skip: false,
      requestId: '11111111-1111-1111-1111-111111111111',
    }),
  );
});

test('fails open when reconciliation setup throws and still streams complete results', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  ContactEnrichmentService.enrichCandidates.mockResolvedValue({
    enriched: [{ name: 'Dr. A', contactEnrichment: { email: 'a@example.edu' } }],
    stats: {},
  });
  reconcileReviewerContacts.mockRejectedValueOnce(new Error('unexpected setup failure'));

  const res = mockRes();
  await handler({
    method: 'POST',
    body: { candidates: [{ name: 'Dr. A' }], options: {} },
  }, res);

  expect(res.frames.some((frame) => frame.type === 'error')).toBe(false);
  expect(res.frames.find((frame) => frame.type === 'complete')).toMatchObject({
    results: [{ name: 'Dr. A', contactEnrichment: { email: 'a@example.edu' } }],
  });
  expect(errorSpy).toHaveBeenCalledWith(
    '[enrich-contacts] Dataverse reconciliation failed (fail-open):',
    'unexpected setup failure',
  );
  errorSpy.mockRestore();
});

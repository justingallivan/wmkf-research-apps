/** @jest-environment node */

import fs from 'fs';
import {
  produceReviewerContactEvidence,
} from '../../../lib/services/workbench/reviewer-stage-producers/contact';

const NOW = '2026-08-02T12:00:00.000Z';
const EXPECTED_SOURCE = 'f'.repeat(64);

function tierApi(overrides = {}) {
  return {
    applyTier0: jest.fn(() => 'continue'),
    applyTier1: jest.fn((_candidate, result) => {
      result.contactEnrichment.email = 'jane@example.edu';
      result.contactEnrichment.emailSource = 'orcid';
      result.contactEnrichment.emailIsRecent = true;
      result.contactEnrichment.emailPersistAllowed = true;
      result.contactEnrichment.tiersUsed.push('pubmed');
      return 'continue';
    }),
    applyTier2: jest.fn(async () => 'continue'),
    applyScholarlyTier: jest.fn(async () => 'continue'),
    applyTier3: jest.fn(async () => 'continue'),
    applyTier4: jest.fn(async () => 'continue'),
    claudeWebSearch: jest.fn(),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    candidate: {
      name: 'Jane Smith',
      affiliation: 'Example University',
      contactEnrichment: { identity: { status: 'confirmed' } },
    },
    institutionDomains: ['example.edu'],
    sourceVersion: 'contact-input-v1',
    expectedSourceVersion: EXPECTED_SOURCE,
    policy: { usePubmed: true },
    now: () => NOW,
    ...overrides,
  };
}

test('runs the explicit contact tiers and emits a bounded ready contact projection', async () => {
  const api = tierApi();

  const result = await produceReviewerContactEvidence(input({ tierApi: api }));

  expect(api.applyTier0).toHaveBeenCalledTimes(1);
  expect(api.applyTier1).toHaveBeenCalledTimes(1);
  expect(api.applyTier2).toHaveBeenCalledTimes(1);
  expect(api.applyScholarlyTier).toHaveBeenCalledTimes(1);
  expect(api.applyTier4).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: {
      email: 'jane@example.edu',
      emailSource: 'orcid',
      emailAction: 'ready',
      contactTierSummary: { providerError: false },
    },
    receipt: { state: 'current', completedAt: NOW },
  });
});

test('does not enable a paid provider unless server policy enables that tier', async () => {
  const claudeWebSearch = jest.fn();
  const api = tierApi({
    applyTier3: jest.fn(async (_candidate, _result, options) => {
      if (options.useClaudeSearch) await options.service.claudeWebSearch();
      return 'continue';
    }),
    claudeWebSearch,
  });

  await produceReviewerContactEvidence(input({ tierApi: api, policy: { usePubmed: true } }));

  expect(api.applyTier3).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ useClaudeSearch: false }));
  expect(claudeWebSearch).not.toHaveBeenCalled();
});

test('hard-disables the non-cancellable legacy Serp tier for manual refresh', async () => {
  const api = tierApi();

  const result = await produceReviewerContactEvidence(input({
    tierApi: api,
    policy: { useSerpSearch: true },
  }));

  expect(api.applyTier0).not.toHaveBeenCalled();
  expect(api.applyTier4).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'incomplete',
    receipt: { state: 'incomplete', failureCode: 'missing_required_input' },
  });
});

test('stops before every tier when identity authority is absent', async () => {
  const api = tierApi();
  const result = await produceReviewerContactEvidence(input({
    candidate: {
      name: 'Jane Smith',
      identityDecision: 'ambiguous',
      identityEvidence: { decision: 'ambiguous' },
    },
    tierApi: api,
  }));

  expect(api.applyTier0).not.toHaveBeenCalled();
  expect(api.applyTier1).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'not_applicable',
    receipt: { reasonCode: 'identity_not_authoritative', completedAt: NOW },
  });
});

test.each(['confirmed', 'probable'])(
  'accepts projector-shaped %s identity evidence before running contact tiers',
  async (decision) => {
    const api = tierApi();
    const result = await produceReviewerContactEvidence(input({
      candidate: {
        name: 'Jane Smith',
        affiliation: 'Example University',
        identityDecision: decision,
        identityEvidence: { decision },
      },
      tierApi: api,
    }));

    expect(api.applyTier0).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'current', receipt: { state: 'current' } });
  },
);

test('accepts a valid staff identity confirmation when the resolver has no decision', async () => {
  const api = tierApi();
  const result = await produceReviewerContactEvidence(input({
    candidate: {
      name: 'Jane Smith',
      affiliation: 'Example University',
      identityEvidence: {
        staffConfirmation: {
          state: 'confirmed',
          canonicalPersonId: '11111111-1111-4111-8111-111111111111',
          canonicalPersonEtag: 'W/"etag-1"',
          actorId: 'staff-1',
          confirmedAt: NOW,
        },
      },
    },
    tierApi: api,
  }));

  expect(api.applyTier0).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ outcome: 'current', receipt: { state: 'current' } });
});

test('does not let a partial staff confirmation unlock contact tiers', async () => {
  const api = tierApi();
  const result = await produceReviewerContactEvidence(input({
    candidate: {
      name: 'Jane Smith',
      affiliation: 'Example University',
      identityEvidence: {
        staffConfirmation: {
          state: 'confirmed',
          canonicalPersonId: 'person-1',
          confirmedAt: NOW,
        },
      },
    },
    tierApi: api,
  }));

  expect(api.applyTier0).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'not_applicable',
    receipt: { reasonCode: 'identity_not_authoritative' },
  });
});

test('treats a completed no-trusted-domains result as contact-only work, not an incomplete stage', async () => {
  const api = tierApi({ applyTier1: jest.fn(() => 'continue') });
  const result = await produceReviewerContactEvidence(input({
    institutionDomains: [],
    tierApi: api,
  }));

  expect(api.applyTier0).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: { emailAction: 'missing_email' },
    receipt: { state: 'current', completedAt: NOW },
  });
  expect(result.evidencePatch).not.toHaveProperty('addressTrustStatus');
});

test('does not invoke the composite finalizer or its identity/eligibility/metrics/persistence edges', () => {
  const source = fs.readFileSync(require.resolve('../../../lib/services/workbench/reviewer-stage-producers/contact'), 'utf8');

  expect(source).not.toMatch(/\.finalize\(/);
  expect(source).not.toMatch(/attachEligibilityEvidence/);
  expect(source).not.toMatch(/attachOpenAlexMetrics/);
  expect(source).not.toMatch(/saveToDatabase/);
  expect(source).not.toMatch(/evaluateExistingResult|evaluateSuggestion/);
});

test('fails closed before contact tiers when the shared expected source is missing or malformed', async () => {
  const api = tierApi();
  const result = await produceReviewerContactEvidence(input({ expectedSourceVersion: 'forged', tierApi: api }));

  expect(api.applyTier0).not.toHaveBeenCalled();
  expect(result).toMatchObject({ outcome: 'failed', receipt: { state: 'failed', completedAt: null } });
});

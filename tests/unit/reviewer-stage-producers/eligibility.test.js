/** @jest-environment node */

const {
  produceEligibilityEvidence,
} = require('../../../lib/services/workbench/reviewer-stage-producers/eligibility');

const NOW = '2026-08-02T12:00:00.000Z';
const EXPECTED_SOURCE = 'e'.repeat(64);

function input(overrides = {}) {
  return {
    candidate: { name: 'Jane Smith' },
    trustedDomains: ['example.edu'],
    sourceVersion: 'eligibility-input-v1',
    expectedSourceVersion: EXPECTED_SOURCE,
    credentials: { serpApiKey: 'server-only-key' },
    now: () => NOW,
    ...overrides,
  };
}

test('records a complete unknown when the bounded first-party search has no direct lead', async () => {
  const searchOrganicResults = jest.fn().mockResolvedValue([]);
  const fetchInstitutionPage = jest.fn();

  const result = await produceEligibilityEvidence(input({ searchOrganicResults, fetchInstitutionPage }));

  expect(searchOrganicResults).toHaveBeenCalledTimes(1);
  expect(fetchInstitutionPage).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: { eligibilityStatus: 'unknown', eligibilityCheckStatus: 'complete' },
    receipt: { state: 'current', completedAt: NOW, failureCode: null },
  });
});

test('distinguishes a first-party emeritus classification from unknown', async () => {
  const searchOrganicResults = jest.fn().mockResolvedValue([{
    link: 'https://people.example.edu/jane-smith',
    title: 'Jane Smith, Professor Emerita',
    snippet: 'Jane Smith is Professor Emerita.',
  }]);
  const fetchInstitutionPage = jest.fn().mockResolvedValue({
    ok: true,
    finalUrl: 'https://people.example.edu/jane-smith',
    text: '<html><h1>Jane Smith</h1><p>Jane Smith is Professor Emerita.</p></html>',
  });

  const result = await produceEligibilityEvidence(input({ searchOrganicResults, fetchInstitutionPage }));

  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: {
      eligibilityStatus: 'emeritus',
      eligibilityCheckStatus: 'complete',
      eligibilityEvidence: expect.objectContaining({ sourceDomain: 'people.example.edu' }),
    },
  });
});

test('does not turn a provider failure into complete unknown', async () => {
  const result = await produceEligibilityEvidence(input({
    searchOrganicResults: jest.fn().mockRejectedValue(new Error('Serp unavailable')),
  }));

  expect(result).toMatchObject({
    outcome: 'failed',
    evidencePatch: {},
    receipt: { state: 'failed', completedAt: null, failureCode: 'provider_unavailable' },
  });
});

test('uses deterministic N/A for an authoritative no-domain input without a provider call', async () => {
  const searchOrganicResults = jest.fn();
  const result = await produceEligibilityEvidence(input({ trustedDomains: [], searchOrganicResults }));

  expect(searchOrganicResults).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'not_applicable',
    evidencePatch: { eligibilityCheckStatus: 'not_applicable' },
    receipt: { reasonCode: 'no_trusted_domains', completedAt: NOW },
  });
});

test('marks a direct first-party lead as incomplete when no candidate page can be read', async () => {
  const result = await produceEligibilityEvidence(input({
    searchOrganicResults: jest.fn().mockResolvedValue([{
      link: 'https://people.example.edu/jane-smith',
      title: 'Jane Smith, Professor Emerita',
      snippet: 'Jane Smith is Professor Emerita.',
    }]),
    fetchInstitutionPage: jest.fn().mockResolvedValue({ ok: false, text: null }),
  }));

  expect(result).toMatchObject({
    outcome: 'incomplete',
    receipt: { state: 'incomplete', failureCode: 'provider_unavailable' },
  });
});

test('fails closed before provider work when the shared expected source is missing or malformed', async () => {
  const searchOrganicResults = jest.fn();
  const result = await produceEligibilityEvidence(input({ expectedSourceVersion: 'forged', searchOrganicResults }));

  expect(searchOrganicResults).not.toHaveBeenCalled();
  expect(result).toMatchObject({ outcome: 'failed', receipt: { state: 'failed', completedAt: null } });
});

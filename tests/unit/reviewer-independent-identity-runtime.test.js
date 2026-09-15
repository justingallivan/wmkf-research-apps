/** @jest-environment node */

import {
  evaluateServerCandidateIndependentIdentity,
  proposalCitationWork,
} from '../../lib/services/reviewer-independent-identity-runtime';

const REQUEST = '11111111-1111-1111-1111-111111111111';

test('browser-carried citation provenance cannot become authoritative source work', () => {
  const work = { title: 'Bound work', pmid: '123', year: 2025 };
  const candidate = {
    name: 'Jane Example',
    candidateKey: 'candidate:jane',
    publications: [work],
    provenance: {
      kind: 'cited_reference',
      sources: ['reference_list', 'pubmed'],
      seedRole: 'cited_author',
      groundingWorkIds: ['pmid:123'],
    },
  };
  expect(proposalCitationWork(candidate)).toBeNull();
});

test('forged citation provenance remains not evaluable and never calls a provider', async () => {
  const providers = { getWorkByExternalId: jest.fn() };
  const result = await evaluateServerCandidateIndependentIdentity({
    requestId: REQUEST,
    candidate: {
      name: 'Jane Example',
      candidateKey: 'candidate:jane',
      publications: [{ title: 'Browser-carried work', pmid: '123' }],
      provenance: {
        kind: 'cited_reference',
        sources: ['reference_list', 'pubmed'],
        seedRole: 'cited_author',
        groundingWorkIds: ['pmid:123'],
      },
    },
    authority: 'server_discovery',
    providers,
    now: () => Date.parse('2026-09-14T12:00:00.000Z'),
  });
  expect(result).toMatchObject({
    result: 'not_evaluable',
    reason: 'source_work_lineage_missing',
  });
  expect(providers.getWorkByExternalId).not.toHaveBeenCalled();
});

test('browser authority is rejected before the evaluator or providers run', async () => {
  const providers = { getWorkByExternalId: jest.fn() };
  await expect(evaluateServerCandidateIndependentIdentity({
    requestId: REQUEST,
    candidate: { name: 'Jane Example', candidateKey: 'candidate:jane' },
    authority: 'browser',
    providers,
  })).resolves.toBeNull();
  expect(providers.getWorkByExternalId).not.toHaveBeenCalled();
});

test('a server candidate without closed source lineage is explicitly not evaluable', async () => {
  const providers = { getWorkByExternalId: jest.fn() };
  const result = await evaluateServerCandidateIndependentIdentity({
    requestId: REQUEST,
    candidate: {
      name: 'Jane Example',
      candidateKey: 'candidate:jane',
      publications: [{ title: 'Browser-carried work', pmid: '123' }],
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
        groundingWorkIds: ['pmid:123'],
      },
    },
    authority: 'server_discovery',
    providers,
    now: () => Date.parse('2026-09-14T12:00:00.000Z'),
  });
  expect(result).toMatchObject({
    version: 'independent-identity/v1',
    result: 'not_evaluable',
    reason: 'source_work_lineage_missing',
    requestBinding: REQUEST,
    candidateKey: 'candidate:jane',
    excludesAffiliation: true,
  });
  expect(providers.getWorkByExternalId).not.toHaveBeenCalled();
});

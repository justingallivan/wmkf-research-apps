/** @jest-environment node */

const fs = require('fs');
const {
  produceCoauthorCoiEvidence,
  projectColdCoauthorCoiEvidence,
} = require('../../../lib/services/workbench/reviewer-stage-producers/coauthor-coi');

const NOW = '2026-08-02T12:00:00.000Z';
const EXPECTED_SOURCE = 'c'.repeat(64);

function input(overrides = {}) {
  return {
    candidate: { name: 'Jane Smith' },
    proposalAuthors: ['Alice Author', 'Bob Writer'],
    proposalAuthorVersion: 'a'.repeat(64),
    sourceVersion: 'coauthor-input-v1',
    expectedSourceVersion: EXPECTED_SOURCE,
    now: () => NOW,
    ...overrides,
  };
}

test('records a complete zero-paper decision without a batch call', async () => {
  const check = jest.fn().mockResolvedValue({
    hasCoauthorship: false,
    coauthorships: [],
    sharedPaperTotal: 0,
    maxSharedWithOneAuthor: 0,
    coauthorCheckStatus: 'complete',
    coauthorCheckFailures: [],
  });

  const result = await produceCoauthorCoiEvidence(input({ check }));

  expect(check).toHaveBeenCalledWith('Jane Smith', ['Alice Author', 'Bob Writer'], { signal: undefined });
  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: {
      hasCoauthorCOI: false,
      coauthorCheckStatus: 'complete',
      coauthorCheckFailures: [],
    },
    receipt: {
      state: 'current',
      contractVersion: 1,
      sourceVersion: EXPECTED_SOURCE,
      completedAt: NOW,
      reasonCode: null,
      failureCode: null,
    },
  });
});

test('treats one failed proposal-author check as incomplete even when other authors are clean', async () => {
  const check = jest.fn().mockResolvedValue({
    hasCoauthorship: false,
    coauthorships: [],
    sharedPaperTotal: 0,
    maxSharedWithOneAuthor: 0,
    coauthorCheckStatus: 'incomplete',
    coauthorCheckFailures: [{ proposalAuthor: 'Bob Writer', status: 429, reason: 'rate_limited' }],
  });

  const result = await produceCoauthorCoiEvidence(input({ check }));

  expect(result).toMatchObject({
    outcome: 'incomplete',
    evidencePatch: {
      coauthorCheckStatus: 'incomplete',
      coauthorCheckFailures: [{ proposalAuthor: 'Bob Writer', status: 429, reason: 'rate_limited' }],
    },
    receipt: { state: 'incomplete', completedAt: null, failureCode: 'partial_coverage' },
  });
});

test('does not call a provider when no bounded proposal-author context exists', async () => {
  const check = jest.fn();

  const result = await produceCoauthorCoiEvidence(input({ proposalAuthors: [], check }));

  expect(check).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    outcome: 'not_applicable',
    evidencePatch: { coauthorCheckStatus: 'not_applicable' },
    receipt: { state: 'not_applicable', reasonCode: 'no_proposal_authors', completedAt: NOW },
  });
});

test('preserves abort/deadline control rather than converting it into a clean result', async () => {
  const controller = new AbortController();
  controller.abort(new Error('reviewer_time_budget_exceeded'));

  await expect(produceCoauthorCoiEvidence(input({ signal: controller.signal, check: jest.fn() })))
    .rejects.toThrow('reviewer_time_budget_exceeded');
});

test('never runs a provider or emits current evidence without a shared expected source version', async () => {
  const check = jest.fn();
  const result = await produceCoauthorCoiEvidence(input({ expectedSourceVersion: 'forged', check }));

  expect(check).not.toHaveBeenCalled();
  expect(result).toMatchObject({ outcome: 'failed', receipt: { state: 'failed', completedAt: null } });
});

test('retries only failed proposal-author coverage and retains completed coverage', async () => {
  const check = jest.fn().mockResolvedValue({
    hasCoauthorship: false,
    coauthorships: [],
    sharedPaperTotal: 0,
    maxSharedWithOneAuthor: 0,
    coauthorCheckStatus: 'complete',
    coauthorCheckFailures: [],
  });
  const result = await produceCoauthorCoiEvidence(input({
    check,
    priorAuthorResults: [
      {
        author: 'Alice Author', status: 'complete', sharedPaperCount: 1,
        papers: [{ pmid: '12345', title: 'Prior shared work', year: 2025 }],
      },
      { author: 'Bob Writer', status: 'failed', sharedPaperCount: 0, papers: [] },
    ],
    retryAuthors: ['Bob Writer'],
  }));

  expect(check).toHaveBeenCalledWith('Jane Smith', ['Bob Writer'], { signal: undefined });
  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: {
      hasCoauthorCOI: true,
      coauthorSharedPaperTotal: 1,
      coauthorMaxWithOneAuthor: 1,
      coauthorCOIStrength: 'possible',
      coauthorAuthorResults: expect.arrayContaining([
        expect.objectContaining({ author: 'Alice Author', status: 'complete', sharedPaperCount: 1 }),
        expect.objectContaining({ author: 'Bob Writer', status: 'complete', sharedPaperCount: 0 }),
      ]),
    },
  });
});

test('the targeted producer has no batch-COI dependency', () => {
  const source = fs.readFileSync(require.resolve('../../../lib/services/workbench/reviewer-stage-producers/coauthor-coi'), 'utf8');
  expect(source).not.toContain('checkCoauthorshipsForCandidates');
});

test('cold projection persists coverage for every sealed proposal author, including zero-paper checks', () => {
  const result = projectColdCoauthorCoiEvidence({
    candidate: {
      hasCoauthorCOI: true,
      coauthorCheckStatus: 'complete',
      coauthorships: [{
        proposalAuthor: 'Alice Author',
        paperCount: 1,
        recentPapers: [{ pmid: '12345', title: 'Shared work', year: 2025 }],
      }],
      coauthorCheckFailures: [],
    },
    proposalAuthors: ['Alice Author', 'Bob Writer'],
    proposalAuthorVersion: 'a'.repeat(64),
    sourceVersion: 'shared-cold-source:v2',
    expectedSourceVersion: EXPECTED_SOURCE,
    now: () => NOW,
  });

  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: {
      proposalAuthorVersion: 'a'.repeat(64),
      coauthorAuthorResults: [
        { author: 'Alice Author', status: 'complete', sharedPaperCount: 1 },
        { author: 'Bob Writer', status: 'complete', sharedPaperCount: 0, papers: [] },
      ],
    },
  });
});

test('cold projection refuses to mint a clean coverage receipt when author coverage exceeds its bounded contract', () => {
  const result = projectColdCoauthorCoiEvidence({
    candidate: { coauthorCheckStatus: 'complete', coauthorships: [], coauthorCheckFailures: [] },
    proposalAuthors: Array.from({ length: 17 }, (_, index) => `Author ${index}`),
    proposalAuthorVersion: 'a'.repeat(64),
    sourceVersion: 'shared-cold-source:v2',
    expectedSourceVersion: EXPECTED_SOURCE,
    now: () => NOW,
  });

  expect(result).toMatchObject({
    outcome: 'incomplete',
    receipt: { state: 'incomplete', completedAt: null, failureCode: 'partial_coverage' },
  });
});

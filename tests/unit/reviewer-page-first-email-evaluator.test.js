/**
 * @jest-environment node
 */

const {
  buildManualReviewRows,
  buildQueries,
  experimentDomainEvidence,
  mapWithConcurrency,
  prepassOptions,
  rankCandidatePageUrls,
  selectFrozenPrimarySubjects,
  summarizeResults,
} = require('../../scripts/lib/reviewer-page-first-email');

describe('reviewer page-first email evaluator', () => {
  test('selects the exact frozen no-reference cohort and rejects source drift', () => {
    const artifact = {
      results: [
        { subjectKey: 'a', name: 'Ada Lovelace', affiliation: 'Example University', references: [] },
        { subjectKey: 'b', name: 'Grace Hopper', affiliation: 'Example Institute', references: [] },
      ],
    };
    expect(selectFrozenPrimarySubjects(artifact, ['b', 'a']).map((row) => row.subjectKey))
      .toEqual(['b', 'a']);

    artifact.results[0].references.push({ email: 'ada@example.edu' });
    expect(() => selectFrozenPrimarySubjects(artifact, ['a']))
      .toThrow(/no-reference hard case/);
    expect(() => selectFrozenPrimarySubjects(artifact, ['missing']))
      .toThrow(/missing from source artifact/);
  });

  test('prepass is mechanically read-only and disables every contact-search tier', () => {
    expect(prepassOptions()).toEqual({
      persist: false,
      usePubmed: false,
      useOrcid: false,
      useClaudeSearch: false,
      useSerpSearch: false,
    });
  });

  test('builds the current query and both resolved page-first queries', () => {
    expect(buildQueries(
      { name: 'Dr. Ada Lovelace', affiliation: 'Claimed College' },
      {
        effectiveInstitution: 'Resolved University',
        anchoredDomains: ['resolved.edu'],
      }
    )).toEqual({
      current: '"Ada Lovelace" Claimed College email',
      pageFirst: [
        '"Ada Lovelace" Resolved University',
        '"Ada Lovelace" site:resolved.edu',
      ],
    });
  });

  test('prefers anchored domains and falls back only to strong claimed-institution domains', () => {
    expect(experimentDomainEvidence({
      anchoredDomains: ['anchor.edu'],
      plausibleDomains: ['plausible.edu'],
    })).toEqual({ basis: 'identity_anchored', domains: ['anchor.edu'] });
    expect(experimentDomainEvidence({
      anchoredDomains: [],
      plausibleDomains: ['plausible.edu'],
    })).toEqual({
      basis: 'claimed_institution_strong_match',
      domains: ['plausible.edu'],
    });
    expect(experimentDomainEvidence({})).toEqual({ basis: 'none', domains: [] });
  });

  test('keeps only anchored pages and ranks a candidate profile over a generic directory', () => {
    const organic = [
      {
        position: 1,
        title: 'Directory',
        link: 'https://physics.example.edu/people/',
        snippet: 'Faculty directory with a tempting wrong-person email wrong@example.edu',
      },
      {
        position: 4,
        title: 'Ada Lovelace — Faculty Profile',
        link: 'https://physics.example.edu/faculty/ada-lovelace',
        snippet: 'Research profile',
      },
      {
        position: 2,
        title: 'Ada paper',
        link: 'https://physics.example.edu/papers/lovelace.pdf',
        snippet: 'PDF',
      },
      {
        position: 3,
        title: 'Namesake',
        link: 'https://other.edu/faculty/ada-lovelace',
        snippet: 'Outside the anchored institution',
      },
    ];
    const ranked = rankCandidatePageUrls(
      organic,
      { name: 'Ada Lovelace' },
      ['example.edu'],
      2
    );

    expect(ranked.selected[0].url)
      .toBe('https://physics.example.edu/faculty/ada-lovelace');
    expect(ranked.decisions.find((row) => row.url.endsWith('.pdf')).reason)
      .toBe('document_url');
    expect(ranked.decisions.find((row) => row.host === 'other.edu').reason)
      .toBe('host_not_anchored');
    expect(ranked.selected.some((row) => Object.prototype.hasOwnProperty.call(row, 'email')))
      .toBe(false);
  });

  test('deduplicates ready outcomes across arms and enforces the manual-review cap', () => {
    const ready = {
      email: 'ada@example.edu',
      emailSource: 'institution_page',
      emailAction: 'ready',
      emailEvidence: { sourceUrl: 'https://example.edu/faculty/ada' },
    };
    const result = {
      personKey: 'ada',
      name: 'Ada Lovelace',
      affiliation: 'Example University',
      control: false,
      prepass: { identityStatus: 'probable' },
      arms: { current: ready, pageFirst: { ...ready } },
    };
    expect(buildManualReviewRows([result], 1)).toHaveLength(1);

    const second = {
      ...result,
      arms: {
        current: {
          ...ready,
          email: 'ada2@example.edu',
          emailEvidence: { sourceUrl: 'https://example.edu/faculty/ada/contact' },
        },
      },
    };
    expect(() => buildManualReviewRows([result, second], 1))
      .toThrow(/Manual-review cap exceeded/);
  });

  test('summary preserves partial failures, abstentions, and exact denominators', () => {
    const results = [
      {
        control: false,
        arms: {
          current: { status: 'completed', emailAction: 'ready', searches: [{ latencyMs: 20 }], latencyMs: 30 },
          pageFirst: { status: 'error', emailAction: 'missing', searches: [{ latencyMs: 40 }], latencyMs: 50 },
        },
      },
      {
        control: false,
        arms: {
          current: { status: 'abstained', emailAction: 'missing', searches: [], latencyMs: 0 },
          pageFirst: { status: 'completed', emailAction: 'missing', searches: [{ latencyMs: 60 }], latencyMs: 70 },
        },
      },
    ];
    const summary = summarizeResults(results, 4);
    expect(summary).toMatchObject({
      subjects: 2,
      primarySubjects: 2,
      callsAttempted: 4,
      primary: {
        current: { attemptedSubjects: 2, completed: 1, readySubjects: 1, abstained: 1, errors: 0 },
        pageFirst: { attemptedSubjects: 2, completed: 1, readySubjects: 0, abstained: 0, errors: 1 },
      },
    });
  });

  test('concurrency helper checkpoints only completed stable rows', async () => {
    const snapshots = [];
    const results = await mapWithConcurrency(
      [1, 2, 3],
      2,
      async (value) => ({ key: value }),
      async (_value, _index, partial) => {
        snapshots.push(partial.filter(Boolean).map((row) => row.key).sort());
      }
    );
    expect(results.map((row) => row.key)).toEqual([1, 2, 3]);
    expect(snapshots.at(-1)).toEqual([1, 2, 3]);
  });
});

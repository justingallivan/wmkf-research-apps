/**
 * @jest-environment node
 */

const {
  candidateUsesInitialOnly,
  changedCases,
  combineIdentityDecisions,
  evaluatePromotion,
  resolveWorksFirst,
  scoreDecision,
  worksFirstNameVariants,
} = require('../../lib/services/reviewer-works-first');
const {
  DEFAULT_BENCHMARK,
  DEFAULT_EQUIVALENCE_OVERLAY,
  createAnchorMatcher,
  createEvaluationInstitutionResolver,
  parseCli,
  readEquivalenceOverlay,
  readFrozenBenchmark,
} = require('../../scripts/evaluate-reviewer-works-first');

function authorship({
  authorId,
  displayName,
  institutionId = 'I1',
  orcid = null,
  rawName = displayName,
}) {
  return {
    raw_author_name: rawName,
    author: {
      id: `https://openalex.org/${authorId}`,
      display_name: displayName,
      orcid: orcid ? `https://orcid.org/${orcid}` : null,
    },
    institutions: [{ id: `https://openalex.org/${institutionId}` }],
  };
}

function dependencies(works, profiles = {}) {
  return {
    searchWorks: jest.fn(async () => works),
    searchInstitution: jest.fn(async () => [{
      openAlexId: 'https://openalex.org/I1',
    }]),
    getAuthor: jest.fn(async (authorId) => profiles[authorId] || {
      openAlexId: `https://openalex.org/${authorId}`,
      displayName: 'Li-Huei Tsai',
      orcid: null,
      lastKnownInstitutionId: 'https://openalex.org/I1',
      worksCount: 1,
    }),
    maxVariants: 1,
  };
}

describe('works-first identity evaluation', () => {
  test('name variants retain full/nickname/CJK forms and drop the unsafe initial-only query', () => {
    expect(worksFirstNameVariants('Will Harcombe')).toEqual([
      'Will Harcombe',
      'William Harcombe',
      'Harcombe Will',
    ]);
    expect(candidateUsesInitialOnly('A. Patel')).toBe(true);
    expect(candidateUsesInitialOnly('Ankur Moitra')).toBe(false);
  });

  test('prefers the richest ORCID-anchored institution cluster over a no-ORCID fragment', async () => {
    const works = [{
      authorships: [
        authorship({
          authorId: 'A100',
          displayName: 'Li-Huei Tsai',
          orcid: '0000-0001-5607-113X',
        }),
        authorship({
          authorId: 'A200',
          displayName: 'Li-Huei Tsai',
        }),
      ],
    }];
    const result = await resolveWorksFirst({
      name: 'Li-Huei Tsai',
      claimedAffiliation: 'MIT',
    }, dependencies(works, {
      A100: {
        displayName: 'Li-Huei Tsai',
        orcid: '0000-0001-5607-113X',
        lastKnownInstitutionId: 'https://openalex.org/I1',
        worksCount: 407,
      },
      A200: {
        displayName: 'Li-Huei Tsai',
        orcid: null,
        lastKnownInstitutionId: 'https://openalex.org/I1',
        worksCount: 62,
      },
    }));

    expect(result).toMatchObject({
      decision: 'bind',
      anchor: 'orcid:0000-0001-5607-113X',
      reason: 'orcid_richest_institution_cluster',
    });
  });

  test('collapses same-ORCID fragments but sends every distinct-ORCID cluster to review', async () => {
    const sameOrcid = [{
      authorships: [
        authorship({
          authorId: 'A100',
          displayName: 'Ursula Keller',
          orcid: '0000-0002-1689-8041',
          rawName: 'U. Keller',
        }),
        authorship({
          authorId: 'A200',
          displayName: 'Ursula Keller',
          orcid: '0000-0002-1689-8041',
          rawName: 'U. Keller',
        }),
      ],
    }];
    const collapsed = await resolveWorksFirst({
      name: 'Ursula Keller',
      claimedAffiliation: 'ETH Zurich',
    }, dependencies(sameOrcid, {
      A100: {
        displayName: 'Ursula Keller',
        orcid: '0000-0002-1689-8041',
        lastKnownInstitutionId: 'https://openalex.org/I1',
        worksCount: 1513,
      },
      A200: {
        displayName: 'Ursula Keller',
        orcid: '0000-0002-1689-8041',
        lastKnownInstitutionId: 'https://openalex.org/I1',
        worksCount: 3,
      },
    }));
    expect(collapsed).toMatchObject({
      decision: 'bind',
      anchor: 'orcid:0000-0002-1689-8041',
    });
    expect(collapsed.candidates.find((item) => item.authorId === 'A100').worksCount).toBe(1513);

    sameOrcid[0].authorships[1].author.orcid = 'https://orcid.org/0000-0002-0254-0778';
    const collision = await resolveWorksFirst({
      name: 'Ursula Keller',
      claimedAffiliation: 'ETH Zurich',
    }, dependencies(sameOrcid));
    expect(collision).toMatchObject({
      decision: 'review',
      anchor: null,
      reason: 'multiple_distinct_orcid_clusters',
    });

    const sharedCoauthorTitlesCannotOverride = await resolveWorksFirst({
      name: 'Ursula Keller',
      claimedAffiliation: 'ETH Zurich',
    }, {
      ...dependencies(sameOrcid, {
        A100: {
          displayName: 'Ursula Keller',
          orcid: '0000-0002-1689-8041',
          lastKnownInstitutionId: 'https://openalex.org/I1',
          worksCount: 1513,
        },
        A200: {
          displayName: 'Ursula Keller',
          orcid: '0000-0002-0254-0778',
          lastKnownInstitutionId: 'https://openalex.org/I1',
          worksCount: 3,
        },
      }),
      // Even an injected heuristic claiming equivalence is ignored. Shared
      // coauthored titles do not prove that two ORCIDs identify one person.
      orcidsEquivalent: jest.fn(async () => true),
    });
    expect(sharedCoauthorTitlesCannotOverride).toMatchObject({
      decision: 'review',
      anchor: null,
      reason: 'multiple_distinct_orcid_clusters',
      observedOrcids: [
        '0000-0002-0254-0778',
        '0000-0002-1689-8041',
      ],
    });
  });

  test('fails closed for no durable anchor and high-fragmentation names', async () => {
    const unanchored = await resolveWorksFirst({
      name: 'Nergis Mavalvala',
      claimedAffiliation: 'MIT',
    }, dependencies([{
      authorships: [authorship({
        authorId: 'A300',
        displayName: 'Nergis Mavalvala',
      })],
    }], {
      A300: {
        displayName: 'Nergis Mavalvala',
        orcid: null,
        lastKnownInstitutionId: 'https://openalex.org/I1',
        worksCount: 100,
      },
    }));
    expect(unanchored).toMatchObject({ decision: 'review', reason: 'no_orcid_anchor' });

    const fragmented = [];
    for (let index = 0; index < 10; index += 1) {
      fragmented.push(authorship({
        authorId: `A${index + 1}`,
        displayName: 'Fei-Fei Li',
        institutionId: index === 0 ? 'I1' : 'I2',
        orcid: index === 0 ? '0000-0002-7481-0810' : null,
      }));
    }
    const result = await resolveWorksFirst({
      name: 'Fei-Fei Li',
      claimedAffiliation: 'Stanford',
    }, dependencies([{ authorships: fragmented }], {
      A1: {
        displayName: 'Fei-Fei Li',
        orcid: '0000-0002-7481-0810',
        lastKnownInstitutionId: 'https://openalex.org/I1',
        worksCount: 500,
      },
    }));
    expect(result).toMatchObject({
      decision: 'review',
      anchor: 'orcid:0000-0002-7481-0810',
      reason: 'high_name_fragmentation',
    });
  });

  test('marks an OpenAlex author-profile failure for the promotion gate', async () => {
    const result = await resolveWorksFirst({
      name: 'Li-Huei Tsai',
      claimedAffiliation: 'MIT',
    }, {
      ...dependencies([{
        authorships: [authorship({
          authorId: 'A100',
          displayName: 'Li-Huei Tsai',
          orcid: '0000-0001-5607-113X',
        })],
      }]),
      getAuthor: jest.fn(async () => {
        throw new Error('OpenAlex unavailable');
      }),
    });

    expect(result).toMatchObject({
      decision: 'review',
      reason: 'author_profile_fetch_failed',
      providerFailure: 'openalex_author_profile',
    });
  });

  test('combined policy adds safe rescues and vetoes ambiguous initial-only spine binds', () => {
    const rescued = combineIdentityDecisions(
      { name: 'Will Harcombe' },
      { decision: 'abstain', anchor: null },
      { decision: 'bind', anchor: 'orcid:0000-0001-8445-2052' },
    );
    expect(rescued).toMatchObject({
      decision: 'bind',
      anchor: 'orcid:0000-0001-8445-2052',
      reason: 'works_rescue',
    });

    const vetoed = combineIdentityDecisions(
      { name: 'A. Patel' },
      { decision: 'bind', anchor: 'orcid:wrong' },
      { decision: 'abstain', anchor: null, reason: 'ambiguous' },
    );
    expect(vetoed).toMatchObject({
      decision: 'review',
      reason: 'initial_only_not_works_corroborated',
    });
  });

  test('combined policy requires arm consensus and treats malformed results as review', () => {
    const disagreement = combineIdentityDecisions(
      { name: 'Li-Huei Tsai' },
      { decision: 'bind', anchor: 'orcid:first' },
      { decision: 'bind', anchor: 'orcid:second' },
      { anchorsAgree: false },
    );
    expect(disagreement).toMatchObject({
      decision: 'review',
      reason: 'resolver_anchor_disagreement',
    });

    const malformed = combineIdentityDecisions(
      { name: 'Someone' },
      { decision: 'mystery', anchor: 'orcid:first' },
      { decision: 'bind', anchor: null },
    );
    expect(malformed.decision).toBe('review');
  });

  test('a full-name spine bind is retained when works only lacks independent corroboration', () => {
    const retained = combineIdentityDecisions(
      { name: 'David Yong' },
      { decision: 'bind', anchor: 'orcid:one' },
      { decision: 'review', anchor: null, reason: 'multiple_non_equivalent_orcid_clusters' },
    );
    expect(retained).toMatchObject({
      decision: 'bind',
      anchor: 'orcid:one',
      reason: 'spine_retained_without_works_contradiction',
    });
  });

  test('scores review as non-automatic and enforces the recall-plus-safety gate', async () => {
    const matcher = async (left, right) => left === right;
    await expect(scoreDecision(
      { abstain: false, personAnchor: 'orcid:one' },
      { decision: 'review', anchor: 'orcid:one' },
      matcher,
    )).resolves.toBe('miss');
    await expect(scoreDecision(
      { abstain: true, personAnchor: null },
      { decision: 'review', anchor: 'orcid:one' },
      matcher,
    )).resolves.toBe('correct_abstain');

    const rows = [];
    for (let index = 0; index < 14; index += 1) {
      rows.push({
        caseId: `existing-${index}`,
        spine: { decision: 'bind', anchor: `a-${index}`, outcome: 'correct_bind' },
        combined: { decision: 'bind', anchor: `a-${index}`, outcome: 'correct_bind' },
      });
    }
    for (let index = 0; index < 3; index += 1) {
      rows.push({
        caseId: `gain-${index}`,
        spine: { decision: 'abstain', anchor: null, outcome: 'miss' },
        combined: { decision: 'bind', anchor: `g-${index}`, outcome: 'correct_bind' },
      });
    }
    for (let index = 0; index < 8; index += 1) {
      rows.push({
        caseId: `miss-${index}`,
        spine: { decision: 'abstain', anchor: null, outcome: 'miss' },
        combined: { decision: 'abstain', anchor: null, outcome: 'miss' },
      });
    }
    for (let index = 0; index < 15; index += 1) {
      rows.push({
        caseId: `abstain-${index}`,
        spine: { decision: 'abstain', anchor: null, outcome: 'correct_abstain' },
        combined: { decision: 'abstain', anchor: null, outcome: 'correct_abstain' },
      });
    }
    expect(evaluatePromotion(rows).pass).toBe(true);
    expect(changedCases(rows).map((row) => row.caseId)).toEqual([
      'gain-0',
      'gain-1',
      'gain-2',
    ]);

    rows.push({
      caseId: 'research-only-anchor',
      spine: { decision: 'abstain', anchor: null, outcome: 'correct_abstain' },
      combined: {
        decision: 'review',
        anchor: 'orcid:research-lead',
        outcome: 'correct_abstain',
      },
    });
    expect(changedCases(rows).some((row) => row.caseId === 'research-only-anchor')).toBe(false);

    rows[0].combined.outcome = 'false_bind';
    expect(evaluatePromotion(rows).pass).toBe(false);

    rows[0].combined.outcome = 'correct_bind';
    rows[0].works = {
      decision: 'review',
      reason: 'error:OpenAlex request failed: 429',
    };
    const providerFailure = evaluatePromotion(rows);
    expect(providerFailure.pass).toBe(false);
    expect(providerFailure.gates.providerFailures).toEqual({
      actual: 1,
      maximum: 0,
      pass: false,
    });

    rows[0].works = {
      decision: 'review',
      reason: 'author_profile_fetch_failed',
      providerFailure: 'openalex_author_profile',
    };
    expect(evaluatePromotion(rows).gates.providerFailures).toEqual({
      actual: 1,
      maximum: 0,
      pass: false,
    });
  });

  test('CLI and benchmark loading fail closed', () => {
    expect(() => parseCli(['--unknown'])).toThrow('Unknown argument');
    expect(() => parseCli(['--case'])).toThrow('require non-empty values');
    expect(() => readFrozenBenchmark(__filename)).toThrow();
    expect(() => readEquivalenceOverlay(__filename, {
      benchmarkVersion: 'reviewer-identity-v2',
      cases: [],
    })).toThrow();
  });

  test('tracked evaluation assets remain frozen and hash-pinned', () => {
    const benchmark = readFrozenBenchmark(DEFAULT_BENCHMARK);
    const overlay = readEquivalenceOverlay(DEFAULT_EQUIVALENCE_OVERLAY, benchmark);
    expect(benchmark.cases).toHaveLength(40);
    expect(overlay.overlayVersion).toBe('reviewer-identity-w2-person-equivalence-v1');
  });

  test('the scorer honors a frozen person-equivalence overlay without weakening other pairs', async () => {
    const scoringMatcher = createAnchorMatcher({
      equivalenceOverlay: {
        equivalences: [{
          anchors: ['orcid:first', 'orcid:second'],
        }],
      },
    });
    const resolverMatcher = createAnchorMatcher();
    await expect(scoringMatcher('orcid:first', 'orcid:second')).resolves.toBe(true);
    await expect(scoringMatcher('orcid:first', 'orcid:third')).resolves.toBe(false);
    await expect(resolverMatcher('orcid:first', 'orcid:second')).resolves.toBe(false);

    const combined = combineIdentityDecisions(
      { name: 'Li-Huei Tsai' },
      { decision: 'bind', anchor: 'orcid:first' },
      { decision: 'bind', anchor: 'orcid:second' },
      { anchorsAgree: await resolverMatcher('orcid:first', 'orcid:second') },
    );
    expect(combined).toMatchObject({
      decision: 'review',
      reason: 'resolver_anchor_disagreement',
    });
  });

  test('the evaluator routes institution claims through the production W0 resolver', async () => {
    const openAlex = {
      searchInstitutions: jest.fn(async () => [{
        openAlexId: 'https://openalex.org/I1',
        displayName: 'Massachusetts Institute of Technology',
      }, {
        openAlexId: 'https://openalex.org/I2',
        displayName: 'MIT Media Lab',
      }]),
      getInstitution: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I1',
        displayName: 'Massachusetts Institute of Technology',
        associatedInstitutions: [],
      })),
    };
    const resolver = createEvaluationInstitutionResolver(openAlex);

    await expect(resolver.resolve('MIT')).resolves.toMatchObject({
      openAlexId: 'https://openalex.org/I1',
      displayName: 'Massachusetts Institute of Technology',
    });
    expect(openAlex.searchInstitutions).toHaveBeenCalledWith(
      'MIT',
      { signal: undefined, limit: 10 },
    );
    expect(openAlex.getInstitution).toHaveBeenCalledWith(
      'https://openalex.org/I1',
      { signal: undefined },
    );

    openAlex.searchInstitutions.mockResolvedValueOnce([{
      openAlexId: 'https://openalex.org/I3',
      displayName: 'Example University',
    }, {
      openAlexId: 'https://openalex.org/I4',
      displayName: 'Example University',
    }]);
    await expect(resolver.resolve('Example University')).resolves.toBeNull();
  });

  test('evaluation adapters propagate hidden provider failures instead of scoring them', async () => {
    const searchFailure = new Error('institution search unavailable');
    const strictSearchResolver = createEvaluationInstitutionResolver({
      searchInstitutions: jest.fn(async () => {
        throw searchFailure;
      }),
      getInstitution: jest.fn(),
    });
    await expect(strictSearchResolver.resolve('MIT')).rejects.toBe(searchFailure);

    const hydrationFailure = new Error('institution hydration unavailable');
    const strictHydrationResolver = createEvaluationInstitutionResolver({
      searchInstitutions: jest.fn(async () => [{
        openAlexId: 'https://openalex.org/I1',
        displayName: 'Massachusetts Institute of Technology',
      }]),
      getInstitution: jest.fn(async () => {
        throw hydrationFailure;
      }),
    });
    await expect(strictHydrationResolver.resolve('MIT')).rejects.toBe(hydrationFailure);

    const canonicalFailure = new Error('author lookup unavailable');
    const strictAnchorMatcher = createAnchorMatcher({
      getAuthorById: jest.fn(async () => {
        throw canonicalFailure;
      }),
      propagateProviderErrors: true,
    });
    await expect(strictAnchorMatcher(
      'openalex:A1',
      'orcid:0000-0001-8445-2052',
    )).rejects.toBe(canonicalFailure);
  });

  test('the artifact labels its OpenAlex accounting as partial, not a total', () => {
    const script = require('fs').readFileSync(
      require.resolve('../../scripts/evaluate-reviewer-works-first'),
      'utf8',
    );
    expect(script).toContain('w2AndScoringOpenAlex');
    expect(script).toContain('excludes: \'current-spine internal OpenAlex requests\'');
    expect(script).not.toMatch(/\bopenAlex:\s*openAlex\.metrics\(\)/);
  });
});

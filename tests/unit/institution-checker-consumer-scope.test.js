/**
 * Consumer-scope assertion (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
 * owner decision 3, "Agent-runnable evaluation harness" deliverable 3).
 *
 * The Stage 1 segment-comparison opt-in must stay confined to the
 * affiliation-mismatch alert; the enrichment and identity-evidence consumers
 * must keep constructing the checker with its legacy (segmentComparison:
 * false) default. This test re-derives the call-site set by scanning the
 * live repo tree rather than trusting a fixed list, so a NEW call site or a
 * scope leak fails the test instead of silently expanding scope.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_ROOTS = ['lib', 'pages', 'shared'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', '.next.nosync', 'node_modules.nosync']);

function listJsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJsFiles(fullPath));
    } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function allSourceFiles() {
  return SCAN_ROOTS.flatMap((root) => listJsFiles(path.join(REPO_ROOT, root)));
}

function relPath(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

describe('institution consistency checker: consumer scope', () => {
  const files = allSourceFiles();

  const callSiteRegex = /createInstitutionConsistencyChecker\s*\(/g;
  const callSitesByFile = new Map();
  const segmentComparisonTrueByFile = new Map();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const callMatches = content.match(callSiteRegex);
    if (callMatches) callSitesByFile.set(relPath(file), callMatches.length);

    const segMatches = content.match(/segmentComparison\s*:\s*true/g);
    if (segMatches) segmentComparisonTrueByFile.set(relPath(file), segMatches.length);
  }

  test('the scan itself found source files (a scan failure must fail a test, not silently pass an empty scope)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('call sites are exactly the expected set, one occurrence each: definition + the three known consumers', () => {
    // Map equality (not just key-set equality) so a SECOND call added inside
    // an already-expected file (e.g. a stray extra checker construction in
    // enrich-recommended-service.js) fails this test too, not just a call in
    // a brand-new file.
    const expected = new Map([
      ['lib/services/institution-affiliation-consistency.js', 1], // definition (the factory itself)
      ['lib/services/alert-reviewer-affiliation-mismatch.js', 1],
      ['lib/services/workbench/enrich-recommended-service.js', 1],
      ['lib/services/reviewer-identity-evidence.js', 1],
    ]);
    expect(callSitesByFile).toEqual(expected);
  });

  test('segmentComparison: true appears exactly once, only in the affiliation-mismatch alert', () => {
    expect(segmentComparisonTrueByFile).toEqual(new Map([
      ['lib/services/alert-reviewer-affiliation-mismatch.js', 1],
    ]));
  });

  test('the factory default is off: institution-affiliation-consistency.js destructures segmentComparison = false', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/services/institution-affiliation-consistency.js'),
      'utf8',
    );
    expect(source).toMatch(/segmentComparison\s*=\s*false/);
  });

  test('enrich-recommended-service.js constructs the checker with no options (bare call)', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/services/workbench/enrich-recommended-service.js'),
      'utf8',
    );
    expect(source).toMatch(/createInstitutionConsistencyChecker\(\s*\)/);
    // Guard against a bare-looking call that secretly passes an options
    // object across a line break (e.g. "createInstitutionConsistencyChecker(\n  {").
    const callMatch = source.match(/createInstitutionConsistencyChecker\(([^)]*)\)/);
    expect(callMatch).not.toBeNull();
    expect(callMatch[1].trim()).toBe('');
  });
});

/**
 * Behavioral capture (Wave 3 item C — Codex bypass finding): the lexical
 * scan above is a cheap belt, but it only reads source TEXT. A consumer
 * that wrote `createInstitutionConsistencyChecker({ segmentComparison:
 * someComputedFlag })`, imported a pre-built options object, or called the
 * factory through an alias would still read as "passes an object" or "bare
 * call" to a regex, while actually passing an arbitrary runtime VALUE. These
 * tests mock the real `institution-affiliation-consistency` module's
 * `createInstitutionConsistencyChecker` export with a `jest.fn()` spy, drive
 * (or evaluate the default-parameter evaluation of) each consumer's REAL
 * construction call, and assert on the captured argument VALUES — immune to
 * aliasing, computed options, and line-break formatting.
 *
 * Provenance per consumer (verified by reading each file):
 *   - alert-reviewer-affiliation-mismatch.js: constructs the checker as a
 *     DEFAULT PARAMETER value (`institutionConsistency = createInstitution
 *     ConsistencyChecker({ segmentComparison: true })`) destructured from
 *     `deps` at function-entry time. A default parameter expression is only
 *     evaluated when the caller omits that key, so calling the export with
 *     `deps` that omits `institutionConsistency` fires the real factory
 *     immediately, before any other body logic runs (the call short-circuits
 *     to `{ skipped: 'no_contact' }` right after, which is irrelevant here).
 *   - enrich-recommended-service.js: constructs the checker at a fixed POINT
 *     inside the `enrichRecommended` pipeline (after PubMed verification,
 *     COI checks, and contact/bibliometric enrichment), not as an injected
 *     default parameter. Reaching it requires actually driving the pipeline
 *     with minimal stubs for its many collaborators; the outer function
 *     catches any downstream error and resolves via an `error` SSE event, so
 *     the capture only depends on the mocks being sufficient to reach that
 *     point, not on the rest of the pipeline succeeding.
 *   - reviewer-identity-evidence.js: constructs the checker at a fixed point
 *     inside the static `evaluateSuggestion` method, right after the
 *     OpenAlex author search resolves. Reaching it only requires stubbing
 *     OpenAlexService.searchAuthors to resolve.
 */
describe('institution consistency checker: consumer scope (behavioral, value-based)', () => {
  function mockCheckerFactory() {
    const factory = jest.fn(() => ({
      areConsistent: jest.fn().mockResolvedValue(false),
      resolve: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('../../lib/services/institution-affiliation-consistency', () => ({
      createInstitutionConsistencyChecker: factory,
      institutionsConsistent: jest.fn(() => false),
    }));
    return factory;
  }

  test('alert-reviewer-affiliation-mismatch: factory called with exactly { segmentComparison: true }', async () => {
    let alertReviewerAffiliationMismatch;
    const factory = mockCheckerFactory();
    jest.isolateModules(() => {
      ({ alertReviewerAffiliationMismatch } = require('../../lib/services/alert-reviewer-affiliation-mismatch.js'));
    });

    // Omitting `institutionConsistency` from deps is what fires the default
    // parameter's factory call. `contactId`/`reviewer` are left empty so the
    // function short-circuits to `{ skipped: 'no_contact' }` right after —
    // the factory has already been invoked by then (default-param evaluation
    // happens at function entry, before the body runs).
    const out = await alertReviewerAffiliationMismatch({}, {});

    expect(out).toEqual({ skipped: 'no_contact' });
    expect(factory).toHaveBeenCalledTimes(1);
    // Deep-equal on the captured VALUE: a bypass shape like
    // `{ segmentComparison: someVar }` would only pass this assertion if
    // someVar's runtime value is literally `true`.
    expect(factory.mock.calls[0]).toEqual([{ segmentComparison: true }]);
  });

  test('enrich-recommended-service: factory called with no arguments', async () => {
    const factory = mockCheckerFactory();
    let enrichRecommended;
    jest.isolateModules(() => {
      jest.doMock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
        findApplicantRecommendedByRequest: jest.fn().mockResolvedValue([
          { _wmkf_potentialreviewer_value: 'pr-1' },
        ]),
        setMatchReason: jest.fn(),
      }));
      jest.doMock('../../lib/dataverse/adapters/potential-reviewer', () => ({
        getById: jest.fn(), findByEmailCandidates: jest.fn(), update: jest.fn(),
      }));
      jest.doMock('../../lib/dataverse/adapters/researcher', () => ({
        upsertByPotentialReviewer: jest.fn(), writeIdentityDecision: jest.fn(), clearIdentityFields: jest.fn(),
      }));
      jest.doMock('../../lib/services/discovery-service', () => ({
        DiscoveryService: {
          YEARS_LOOKBACK: 5,
          pubMedVerificationContract: jest.fn(() => ({ enabled: false })),
          isClearlyNonBiomedicalVerifierArea: jest.fn(() => true),
          verifyClaudeSuggestions: jest.fn().mockImplementation(async (suggestions) => ({
            verified: [], unverified: suggestions,
          })),
          checkCoauthorshipsForCandidates: jest.fn().mockImplementation(async (c) => c),
        },
      }));
      jest.doMock('../../lib/services/deduplication-service', () => ({
        DeduplicationService: { markInstitutionCOIResolved: jest.fn().mockImplementation(async (c) => c) },
      }));
      jest.doMock('../../lib/services/contact-enrichment-service', () => ({
        ContactEnrichmentService: { enrichCandidates: jest.fn().mockResolvedValue({ enriched: [] }) },
      }));
      jest.doMock('../../lib/services/openalex-service', () => ({
        OpenAlexService: { searchInstitutions: jest.fn(), getInstitution: jest.fn(), getWorksByAuthor: jest.fn() },
      }));
      jest.doMock('../../lib/services/claude-reviewer-service', () => ({
        ClaudeReviewerService: { analyzeProposal: jest.fn() },
      }));
      jest.doMock('../../lib/services/proposal-pi-identity', () => ({
        resolveProposalPI: jest.fn().mockResolvedValue(null),
        appendPiName: jest.fn((names) => names || []),
        piInstitutions: jest.fn(() => []),
      }));
      jest.doMock('../../lib/utils/proposal-authors', () => ({ deriveProposalAuthorNames: jest.fn(() => []) }));
      jest.doMock('../../lib/services/reviewer-identity-resolver', () => ({
        mayPersistIdentity: jest.fn(() => false), RESOLVER_SOURCED_FIELDS: [],
      }));
      jest.doMock('../../lib/services/backprop-reviewer-orcid', () => ({
        backPropReviewerOrcidToContact: jest.fn(),
      }));
      jest.doMock('../../lib/services/reviewer-time-budget', () => ({
        getReviewerTimeBudgetSeconds: jest.fn().mockResolvedValue(60),
      }));
      jest.doMock('../../lib/services/reviewer-request-context', () => ({
        loadReviewerRequestContext: jest.fn(),
      }));
      jest.doMock('../../shared/components/reviewers/reviewer-search-logic', () => ({
        APPLICANT_ENRICHMENT_CACHE_VERSION: 4,
        pruneCandidateForRoster: jest.fn((c) => c),
      }));
      jest.doMock('../../lib/services/reviewer-roster-store', () => ({
        recordSurfaced: jest.fn().mockResolvedValue(0),
        findCandidateBySuggestion: jest.fn().mockResolvedValue(null),
      }));
      jest.doMock('../../lib/services/workbench/applicant-known-reviewer-service', () => ({
        loadApplicantKnownReviewerContext: jest.fn().mockResolvedValue({
          applicantKnownReviewer: { status: 'known', name: 'Test Reviewer', affiliation: 'Test University' },
          contactId: null,
        }),
      }));
      jest.doMock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn() }));

      ({ enrichRecommended } = require('../../lib/services/workbench/enrich-recommended-service'));
    });

    const onEvent = jest.fn();
    await enrichRecommended({
      requestId: 'req-1',
      blobUrl: undefined,
      analysisResult: { proposalInfo: { authorInstitution: 'Some University' } },
      proposalKey: 'proposal-key-1',
      apiKey: 'fake-api-key',
      actingUserSystemId: null,
      userProfileId: null,
    }, onEvent);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]).toEqual([]);
  });

  test('reviewer-identity-evidence: factory called with no arguments', async () => {
    const factory = mockCheckerFactory();
    let ReviewerIdentityEvidence;
    jest.isolateModules(() => {
      jest.doMock('../../lib/services/openalex-service', () => ({
        OpenAlexService: {
          searchAuthors: jest.fn().mockResolvedValue({ records: [], totalCount: 0 }),
          getWorksByAuthor: jest.fn(),
        },
      }));
      jest.doMock('../../lib/services/orcid-service', () => ({
        ORCIDService: { findContact: jest.fn(), getWorks: jest.fn(), getProfile: jest.fn() },
      }));
      jest.doMock('../../lib/services/reviewer-identity-resolver', () => ({
        resolveIdentity: jest.fn(() => ({ status: 'abstain', evidenceSummary: '' })),
      }));
      jest.doMock('../../lib/utils/contact-parser', () => ({
        ContactParser: { stripHonorifics: jest.fn((s) => s) },
      }));

      ({ ReviewerIdentityEvidence } = require('../../lib/services/reviewer-identity-evidence'));
    });

    const result = await ReviewerIdentityEvidence.evaluateSuggestion(
      { name: 'Test Person', suggestedInstitution: null },
      { proposalInfo: {} },
    );

    expect(result.status).toBe('abstain');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]).toEqual([]);
  });
});

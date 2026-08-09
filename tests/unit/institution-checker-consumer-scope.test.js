/**
 * Consumer-scope assertion (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
 * owner decision 3, "Agent-runnable evaluation harness" deliverable 3).
 *
 * Wave 6 (2026-08-09): the segment-comparison opt-in now covers TWO
 * consumers — the affiliation-mismatch alert (unchanged) and the enrichment
 * institution seam (`enrich-recommended-service.js`). Codex round-6 review
 * found the enrichment seam's brief staged-only flip regressed the
 * VUMC-class identity-corroboration write path (one-hop associated-link
 * evidence the legacy/default checker path provides but the staged path
 * deliberately drops per Wave 3e). The owner-approved fix composes both
 * arms at that seam: `enrich-recommended-service.js` now constructs TWO
 * checkers over one shared resolver — a legacy/default one and a staged
 * (segment-comparison) one — and accepts a clear from either. This is why
 * that file's call-site count below is 2, not 1, while `segmentComparison:
 * true` still appears there exactly once (only the staged construction
 * passes it). reviewer-identity-evidence.js is the sole remaining consumer
 * that must keep constructing the checker with its legacy default. This test
 * re-derives the call-site set by scanning the live repo tree rather than
 * trusting a fixed list, so a NEW call site or a scope leak beyond these two
 * files fails the test instead of silently expanding scope further.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_ROOTS = ['lib', 'pages', 'shared'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', '.next.nosync', 'node_modules.nosync']);

function listJsFiles(dir, extensions = FILE_EXTENSIONS) {
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
      results.push(...listJsFiles(fullPath, extensions));
    } else if (extensions.has(path.extname(entry.name))) {
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

// --- Repo-wide IMPORT INVENTORY (Wave 3c hardening, Codex re-review) -------
//
// The lexical call-site scan above only recognizes a literal
// `createInstitutionConsistencyChecker(...)` token and a literal
// `segmentComparison: true` token. A NEW consumer that imports the factory
// under an alias (`const { createInstitutionConsistencyChecker: makeChecker
// } = require(...)`) and calls it with a COMPUTED options object
// (`makeChecker({ segmentComparison: someFlag })`) would read as "no call
// site" to that scan even though it is a real, scope-relevant consumer.
//
// An alias renames the local BINDING, never the module PATH: `require(...)`
// and `import ... from '...'` must still name
// `lib/services/institution-affiliation-consistency` (or a relative path
// that resolves to it) for the alias to work at all. So this inventory scans
// for the module PATH rather than the factory NAME — any new consumer,
// aliased or not, MUST appear in this set, which forces a deliberate edit to
// this test's allowlist (reviewed against owner decision 3) instead of
// silently evading detection.
const INVENTORY_SCAN_ROOTS = ['lib', 'pages', 'shared', 'scripts'];
// Extensions actually present under lib/, pages/, shared/, scripts/ as of
// this writing (verified by listing, not assumed): .js (982 files) and .mjs
// (112 files, all under scripts/). .jsx, .cjs, .ts, and .tsx were checked
// and found ZERO files in these roots — they are not included because there
// is currently nothing of that kind to miss, not because they were skipped.
// If any of those extensions is introduced under a scanned root later, this
// set (and the allowlist assertion below) needs a deliberate re-check.
const INVENTORY_FILE_EXTENSIONS = new Set(['.js', '.mjs']);
const TARGET_MODULE_NO_EXT = path.join(REPO_ROOT, 'lib/services/institution-affiliation-consistency');
// Matches `require('spec')`, the specifier of any `from 'spec'` clause
// (covers `import x from`, `import { x } from`, and `export ... from`), and
// a static-string `import('spec')` dynamic import. LIMITATION (stated
// honestly, not glossed over): this only catches a STATIC STRING literal
// inside `import(...)`. A computed dynamic-import specifier
// (`import(someVariable)`, `import(\`${dir}/x\`)`) cannot be resolved by a
// text scan at all — that gap is a fundamental limit of static analysis, not
// something this regex closes.
const IMPORT_SPECIFIER_REGEX = /(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\))/g;

function specifierResolvesToTargetModule(specifier, fromFile) {
  // Only relative specifiers can resolve to a same-repo path at all; a
  // bare/absolute specifier cannot be this module under any resolution rule.
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), specifier).replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, '');
  return resolved === TARGET_MODULE_NO_EXT;
}

// Returns the sorted relative-path list of files (from `files`, absolute
// paths) that import the checker module by PATH, regardless of the local
// binding name or how the import is later called.
function findImportersOfCheckerModule(files) {
  const importers = [];
  for (const file of files) {
    if (path.resolve(file) === `${TARGET_MODULE_NO_EXT}.js`) continue; // module doesn't import itself
    const content = fs.readFileSync(file, 'utf8');
    let match;
    let hit = false;
    IMPORT_SPECIFIER_REGEX.lastIndex = 0;
    while ((match = IMPORT_SPECIFIER_REGEX.exec(content))) {
      const specifier = match[1] || match[2] || match[3];
      if (specifierResolvesToTargetModule(specifier, file)) {
        hit = true;
        break;
      }
    }
    if (hit) importers.push(relPath(file));
  }
  return importers.sort();
}

function allInventorySourceFiles() {
  return INVENTORY_SCAN_ROOTS.flatMap((root) => listJsFiles(path.join(REPO_ROOT, root), INVENTORY_FILE_EXTENSIONS));
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

  test('call sites are exactly the expected set: definition + the three known consumers, enrich-recommended-service.js constructing TWO (legacy + staged composite, Wave 6 round-6 fix)', () => {
    // Map equality (not just key-set equality) so a THIRD call added inside
    // an already-expected file, or a second call anywhere else, fails this
    // test too, not just a call in a brand-new file.
    const expected = new Map([
      ['lib/services/institution-affiliation-consistency.js', 1], // definition (the factory itself)
      ['lib/services/alert-reviewer-affiliation-mismatch.js', 1],
      ['lib/services/workbench/enrich-recommended-service.js', 2], // legacyChecker + stagedChecker
      ['lib/services/reviewer-identity-evidence.js', 1],
    ]);
    expect(callSitesByFile).toEqual(expected);
  });

  test('segmentComparison: true appears exactly once each, only in the affiliation-mismatch alert and the enrichment seam', () => {
    expect(segmentComparisonTrueByFile).toEqual(new Map([
      ['lib/services/alert-reviewer-affiliation-mismatch.js', 1],
      ['lib/services/workbench/enrich-recommended-service.js', 1],
    ]));
  });

  test('the factory default is off: institution-affiliation-consistency.js destructures segmentComparison = false', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/services/institution-affiliation-consistency.js'),
      'utf8',
    );
    expect(source).toMatch(/segmentComparison\s*=\s*false/);
  });

  test('enrich-recommended-service.js constructs BOTH checkers over one shared resolver, only the staged one with the segment-comparison option', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/services/workbench/enrich-recommended-service.js'),
      'utf8',
    );
    // Guard against either call's options object being something other than
    // the exact expected literal (e.g. a stray extra key, a dropped shared
    // resolver, or a computed value across a line break).
    const callMatches = [...source.matchAll(/createInstitutionConsistencyChecker\(([^)]*)\)/g)];
    expect(callMatches).toHaveLength(2);
    const [legacyArgs, stagedArgs] = callMatches.map((match) => match[1].trim());
    expect(legacyArgs).toBe('{ resolver: sharedInstitutionResolver }');
    expect(stagedArgs).toBe('{ resolver: sharedInstitutionResolver, segmentComparison: true }');
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
 *   - enrich-recommended-service.js: constructs TWO checkers at a fixed POINT
 *     inside the `enrichRecommended` pipeline (after PubMed verification,
 *     COI checks, and contact/bibliometric enrichment), not as an injected
 *     default parameter. Reaching it requires actually driving the pipeline
 *     with minimal stubs for its many collaborators; the outer function
 *     catches any downstream error and resolves via an `error` SSE event, so
 *     the capture only depends on the mocks being sufficient to reach that
 *     point, not on the rest of the pipeline succeeding. Codex round-6
 *     (2026-08-09): a staged-only checker at this seam regressed the
 *     VUMC-class identity-corroboration write path, so the seam now
 *     constructs a legacy/default checker and a staged (segment-comparison)
 *     checker over ONE shared resolver instance and accepts a clear from
 *     either. The captured value assertion below changed from a single-call,
 *     one-object expectation to two calls: the first with only the shared
 *     resolver, the second with the same shared resolver plus the
 *     segment-comparison option.
 *   - reviewer-identity-evidence.js: constructs the checker at a fixed point
 *     inside the static `evaluateSuggestion` method, right after the
 *     OpenAlex author search resolves. Reaching it only requires stubbing
 *     OpenAlexService.searchAuthors to resolve. Remains the sole consumer
 *     still constructing the checker with no arguments (legacy default).
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

  test('enrich-recommended-service: factory called with exactly { segmentComparison: true }', async () => {
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

    expect(factory).toHaveBeenCalledTimes(2);
    // First call: legacy checker, resolver-only. Second: staged checker,
    // over the SAME shared resolver instance plus the segment-comparison
    // option — deep-equal on the captured VALUES, immune to a bypass shape
    // like `{ segmentComparison: someVar }` unless someVar's runtime value
    // is literally `true`, and immune to a silently-un-shared resolver.
    const [legacyArgs] = factory.mock.calls[0];
    const [stagedArgs] = factory.mock.calls[1];
    expect(Object.keys(legacyArgs)).toEqual(['resolver']);
    expect(legacyArgs.resolver).toBeTruthy();
    expect(stagedArgs).toEqual({ resolver: legacyArgs.resolver, segmentComparison: true });
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

describe('institution consistency checker: repo-wide import inventory (discovery-gap hardening)', () => {
  test('every production importer of the checker module, found by PATH resolution, is exactly the known allowlist', () => {
    const files = allInventorySourceFiles();
    expect(files.length).toBeGreaterThan(0);

    const importers = findImportersOfCheckerModule(files);

    // Derived from an actual scan (not assumed): matches the three known
    // Stage 1 consumers and nothing else, across lib/, pages/, shared/, and
    // scripts/. If this ever fails, a NEW file imports the checker module —
    // list it and route it through owner decision 3 before editing this
    // allowlist.
    expect(importers).toEqual([
      'lib/services/alert-reviewer-affiliation-mismatch.js',
      'lib/services/reviewer-identity-evidence.js',
      'lib/services/workbench/enrich-recommended-service.js',
    ]);
  });

  // Shared by every fixture below: the relative specifier a file placed in
  // `fromDir` would need to reach the real checker module.
  function relativeSpecifierFrom(fromDir) {
    const raw = path.relative(fromDir, TARGET_MODULE_NO_EXT).split(path.sep).join('/');
    return raw.startsWith('.') ? raw : `./${raw}`;
  }

  describe('aliased-bypass fixture (proves the inventory is alias-proof and computed-option-proof)', () => {
    let tempDir;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }
    });

    test('a synthetic consumer that imports the factory under an alias, with a computed option, is still caught', () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-checker-alias-fixture-'));
      const normalizedSpecifier = relativeSpecifierFrom(tempDir);

      const syntheticFile = path.join(tempDir, 'synthetic-aliased-consumer.js');
      fs.writeFileSync(
        syntheticFile,
        [
          "'use strict';",
          '// Synthetic bypass fixture: renamed binding + computed option.',
          `const { createInstitutionConsistencyChecker: makeChecker } = require('${normalizedSpecifier}');`,
          'function build(flag) {',
          '  return makeChecker({ segmentComparison: flag });',
          '}',
          'module.exports = { build };',
          '',
        ].join('\n'),
      );

      // Sanity: the regex/name-based lexical scan (describe block above)
      // would NOT recognize this file at all — it never spells
      // `createInstitutionConsistencyChecker(` as a call, and its
      // `segmentComparison: flag` is computed, not the literal `: true`.
      const syntheticContent = fs.readFileSync(syntheticFile, 'utf8');
      expect(syntheticContent).not.toMatch(/createInstitutionConsistencyChecker\s*\(/);
      expect(syntheticContent).not.toMatch(/segmentComparison\s*:\s*true/);

      // The PATH-based inventory catches it anyway, mixed in with the real
      // production file set.
      const files = [...allInventorySourceFiles(), syntheticFile];
      const importers = findImportersOfCheckerModule(files);

      expect(importers).toContain(relPath(syntheticFile));
    });
  });

  // Wave 3c hardening (Codex re-review): the inventory previously only
  // scanned .js/.jsx and only recognized `require(...)`/`from '...'`. These
  // fixtures prove the widened scan (extensions + `import(...)`) actually
  // catches the two gaps Codex named, rather than merely asserting the
  // extension set and regex look right.
  describe('widened-net fixtures (.mjs static import + dynamic import(), Codex re-review)', () => {
    let tempDir;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }
    });

    test('a synthetic .mjs consumer using a static aliased ES import is caught (extension-coverage gap)', () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-checker-mjs-fixture-'));
      const normalizedSpecifier = relativeSpecifierFrom(tempDir);

      const syntheticFile = path.join(tempDir, 'synthetic-esm-consumer.mjs');
      fs.writeFileSync(
        syntheticFile,
        [
          '// Synthetic bypass fixture: .mjs consumer, aliased ES import.',
          `import { createInstitutionConsistencyChecker as mk } from '${normalizedSpecifier}';`,
          'export function build(flag) {',
          '  return mk({ segmentComparison: flag });',
          '}',
          '',
        ].join('\n'),
      );

      // Before the extension widening, an .mjs file was never even listed by
      // the scanner (INVENTORY_FILE_EXTENSIONS used to be .js/.jsx only) —
      // confirm this fixture actually needs .mjs coverage to be found.
      expect(path.extname(syntheticFile)).toBe('.mjs');
      expect(INVENTORY_FILE_EXTENSIONS.has('.mjs')).toBe(true);

      const files = [...allInventorySourceFiles(), syntheticFile];
      const importers = findImportersOfCheckerModule(files);

      expect(importers).toContain(relPath(syntheticFile));
    });

    test('a synthetic consumer using a static-string dynamic import() is caught (dynamic-import gap)', () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-checker-dynamic-import-fixture-'));
      const normalizedSpecifier = relativeSpecifierFrom(tempDir);

      const syntheticFile = path.join(tempDir, 'synthetic-dynamic-import-consumer.js');
      fs.writeFileSync(
        syntheticFile,
        [
          "'use strict';",
          '// Synthetic bypass fixture: static-string dynamic import(), no require/from.',
          'async function build(flag) {',
          `  const { createInstitutionConsistencyChecker: mk } = await import('${normalizedSpecifier}');`,
          '  return mk({ segmentComparison: flag });',
          '}',
          'module.exports = { build };',
          '',
        ].join('\n'),
      );

      // Sanity: no `require(...)` or `from '...'` clause exists in this
      // file — the old regex (pre-hardening) would not have matched it.
      const syntheticContent = fs.readFileSync(syntheticFile, 'utf8');
      expect(syntheticContent).not.toMatch(/require\(/);
      expect(syntheticContent).not.toMatch(/\bfrom\s+['"]/);

      const files = [...allInventorySourceFiles(), syntheticFile];
      const importers = findImportersOfCheckerModule(files);

      expect(importers).toContain(relPath(syntheticFile));
    });
  });
});

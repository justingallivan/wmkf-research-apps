/**
 * Offline unit tests for the institution-pair-consistency live replay CLI's
 * core (benchmarks/institution-pair-consistency/run-pair-gates.js). No
 * network — every checker is an injected stub. This is the red gate for the
 * CLI's gate logic (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md,
 * "Agent-runnable evaluation harness" deliverable 2).
 */

const path = require('path');

const fs = require('fs');
const os = require('os');

const {
  runPairGates,
  gatePasses,
  isForbiddenVerdict,
  missingRequiredFields,
  parseArgs,
  loadCaseFile,
  loadAllCases,
  gateOk,
  sha256File,
  buildProvenance,
  assertRequiredCaseFiles,
  REQUIRED_CASE_FILES,
} = require(path.join('..', '..', '..', 'benchmarks', 'institution-pair-consistency', 'run-pair-gates.js'));
const { createInstitutionConsistencyChecker } = require(path.join('..', '..', '..', 'lib', 'services', 'institution-affiliation-consistency.js'));
const { createInstitutionIdentityResolver } = require(path.join('..', '..', '..', 'lib', 'services', 'institution-identity-resolver.js'));

function stubChecker(verdictsByPairKey) {
  return {
    areConsistent: jest.fn(async (left, right) => {
      const key = `${left}|||${right}`;
      const entry = verdictsByPairKey[key];
      if (entry instanceof Error) throw entry;
      if (typeof entry === 'function') return entry();
      return Boolean(entry);
    }),
  };
}

describe('run-pair-gates core: runPairGates', () => {
  test('all-pass: every case clears its gate, ok=true, summary shape reflects a clean run', async () => {
    const cases = [
      { caseId: 'c1', family: 'fam-a', left: 'Harvard University', right: 'Harvard University', expected: 'same' },
      { caseId: 'c2', family: 'fam-a', left: 'UCSD', right: 'UCLA', expected: 'distinct' },
      { caseId: 'c3', family: 'fam-b', left: 'UCSD', right: 'University of California', expected: 'related-surface' },
    ];
    const incumbentChecker = stubChecker({
      'Harvard University|||Harvard University': true,
      'UCSD|||UCLA': false,
      'UCSD|||University of California': false,
    });
    const stagedChecker = stubChecker({
      'Harvard University|||Harvard University': true,
      'UCSD|||UCLA': false,
      'UCSD|||University of California': false,
    });

    const result = await runPairGates({ cases, incumbentChecker, stagedChecker });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({
      total: 3, passed: 3, failed: 0, skipped: 0, errors: 0, forbidden: 0,
    });
    expect(result.families['fam-a'].total).toBe(2);
    expect(result.families['fam-b'].total).toBe(1);
    for (const row of result.rows) {
      expect(row.status).toBe('ok');
      expect(row.passed).toBe(true);
      expect(row.forbidden).toBe(false);
      expect(['same-or-related', 'not-cleared']).toContain(row.incumbentVerdict);
      expect(['same-or-related', 'not-cleared']).toContain(row.stagedVerdict);
    }
  });

  test('forbidden verdict: a distinct/related-surface pair auto-cleared by the staged config fails the run', async () => {
    const cases = [
      { caseId: 'sibling-1', family: 'uc-sibling', left: 'UCSD', right: 'UCLA', expected: 'distinct' },
    ];
    const incumbentChecker = stubChecker({ 'UCSD|||UCLA': false });
    // Staged config wrongly auto-clears a sibling pair — this is the
    // forbidden-verdict class the plan's safety invariant 1 exists to catch.
    const stagedChecker = stubChecker({ 'UCSD|||UCLA': true });

    const result = await runPairGates({ cases, incumbentChecker, stagedChecker });

    expect(result.ok).toBe(false);
    expect(result.summary.forbidden).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.rows[0].forbidden).toBe(true);
    expect(result.rows[0].passed).toBe(false);
  });

  test('skipped case: a row missing a required field is skipped without calling either checker, and fails the run', async () => {
    const cases = [
      { caseId: 'malformed-1', family: 'fam-a', left: 'Harvard University', expected: 'same' }, // no `right`
    ];
    const incumbentChecker = stubChecker({});
    const stagedChecker = stubChecker({});

    const result = await runPairGates({ cases, incumbentChecker, stagedChecker });

    expect(result.ok).toBe(false);
    expect(result.summary.skipped).toBe(1);
    expect(result.rows[0].status).toBe('skipped');
    expect(incumbentChecker.areConsistent).not.toHaveBeenCalled();
    expect(stagedChecker.areConsistent).not.toHaveBeenCalled();
  });

  test('provider/transport error: a checker rejection is caught per-case, counted, and fails the run', async () => {
    const cases = [
      { caseId: 'flaky-1', family: 'fam-a', left: 'Columbia University', right: 'Columbia University', expected: 'same' },
    ];
    const incumbentChecker = stubChecker({ 'Columbia University|||Columbia University': true });
    const stagedChecker = stubChecker({
      'Columbia University|||Columbia University': new Error('OpenAlex request failed'),
    });

    const result = await runPairGates({ cases, incumbentChecker, stagedChecker });

    expect(result.ok).toBe(false);
    expect(result.summary.errors).toBe(1);
    expect(result.rows[0].status).toBe('error');
    expect(result.rows[0].error).toMatch(/OpenAlex request failed/);
  });

  test('empty case set never reports a clean pass', async () => {
    const incumbentChecker = stubChecker({});
    const stagedChecker = stubChecker({});
    const result = await runPairGates({ cases: [], incumbentChecker, stagedChecker });
    expect(result.ok).toBe(false);
    expect(result.summary.total).toBe(0);
  });
});

describe('run-pair-gates core: gate helpers', () => {
  test('gatePasses: expected "same" passes only when staged=true', () => {
    expect(gatePasses('same', true)).toBe(true);
    expect(gatePasses('same', false)).toBe(false);
  });

  test('gatePasses: expected "distinct"/"related-surface" passes only when staged=false', () => {
    expect(gatePasses('distinct', false)).toBe(true);
    expect(gatePasses('distinct', true)).toBe(false);
    expect(gatePasses('related-surface', false)).toBe(true);
    expect(gatePasses('related-surface', true)).toBe(false);
  });

  test('isForbiddenVerdict: only a non-"same" expectation auto-cleared by staged is forbidden', () => {
    expect(isForbiddenVerdict('distinct', true)).toBe(true);
    expect(isForbiddenVerdict('related-surface', true)).toBe(true);
    expect(isForbiddenVerdict('same', true)).toBe(false);
    expect(isForbiddenVerdict('distinct', false)).toBe(false);
  });

  test('missingRequiredFields: flags absent caseId/left/right/expected', () => {
    expect(missingRequiredFields({
      caseId: 'x', left: 'a', right: 'b', expected: 'same',
    })).toEqual([]);
    expect(missingRequiredFields({ left: 'a', right: 'b', expected: 'same' })).toContain('caseId');
    expect(missingRequiredFields({ caseId: 'x', left: 'a', expected: 'same' })).toContain('right');
  });
});

describe('run-pair-gates core: case-file loading (pure fs, no network)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-gates-offline-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loadCaseFile throws on a missing/unreadable file', () => {
    const missingPath = path.join(tmpDir, 'does-not-exist.jsonl');
    expect(() => loadCaseFile(missingPath)).toThrow(/not found or unreadable/);
  });

  test('loadCaseFile throws on an unparseable JSONL line, naming the file and line number', () => {
    const badPath = path.join(tmpDir, 'bad.jsonl');
    fs.writeFileSync(badPath, '{"caseId":"ok","left":"a","right":"b","expected":"same"}\nnot json\n');
    expect(() => loadCaseFile(badPath)).toThrow(/bad\.jsonl:2/);
  });

  test('loadCaseFile attaches `family` as the file basename and parses valid rows', () => {
    const goodPath = path.join(tmpDir, 'good-cases.jsonl');
    fs.writeFileSync(goodPath, '{"caseId":"c1","left":"a","right":"b","expected":"same"}\n');
    const rows = loadCaseFile(goodPath);
    expect(rows).toEqual([{
      caseId: 'c1', left: 'a', right: 'b', expected: 'same', family: 'good-cases.jsonl',
    }]);
  });

  test('loadAllCases loads the three real Stage 1 fixtures (5 + 148 + 3 = 156 rows) plus any extras', () => {
    const rows = loadAllCases([]);
    expect(rows.length).toBe(156);
    const families = new Set(rows.map((r) => r.family));
    expect(families).toEqual(new Set([
      'request-1002903-pairs.jsonl', 'uc-sibling-pairs.jsonl', 'named-relationship-pairs.jsonl',
    ]));
  });

  test('loadAllCases throws (propagates) when a missing extra case file is requested — the CLI turns this into a nonzero exit', () => {
    expect(() => loadAllCases([path.join(tmpDir, 'missing-extra.jsonl')])).toThrow(/not found or unreadable/);
  });
});

// -----------------------------------------------------------------------
// Wave 5: required-case-file enforcement (final Codex finding — the runner
// silently passes whatever case files it's given, so the named-relationship
// regressions (Harvard<->HMS, VUMC<->Vanderbilt, Dana-Farber<->Harvard) were
// never actually live-gated). assertRequiredCaseFiles fails a run BEFORE any
// provider work — pure function over an already-loaded case array, no
// network involved in exercising it.
// -----------------------------------------------------------------------
describe('run-pair-gates core: assertRequiredCaseFiles (required-family enforcement, fails before any live call)', () => {
  test('REQUIRED_CASE_FILES names all three tracked case files by basename', () => {
    expect(REQUIRED_CASE_FILES).toEqual(new Set([
      'request-1002903-pairs.jsonl', 'uc-sibling-pairs.jsonl', 'named-relationship-pairs.jsonl',
    ]));
  });

  test('a case set missing a required family throws, naming the missing file', () => {
    const cases = [
      { caseId: 'a', family: 'request-1002903-pairs.jsonl' },
      { caseId: 'b', family: 'uc-sibling-pairs.jsonl' },
      // named-relationship-pairs.jsonl absent entirely.
    ];
    expect(() => assertRequiredCaseFiles(cases)).toThrow(/named-relationship-pairs\.jsonl/);
  });

  test('a required family present but contributing zero rows still throws (same as absent)', () => {
    // Simulates a required file that loaded successfully but was empty —
    // the family never appears in the row set either way.
    const cases = [
      { caseId: 'a', family: 'request-1002903-pairs.jsonl' },
      { caseId: 'b', family: 'uc-sibling-pairs.jsonl' },
      { caseId: 'c', family: 'named-relationship-pairs.jsonl' },
    ].filter((row) => row.family !== 'named-relationship-pairs.jsonl');
    expect(() => assertRequiredCaseFiles(cases)).toThrow(/named-relationship-pairs\.jsonl/);
  });

  test('all three required families present with at least one row each passes silently', () => {
    const cases = [
      { caseId: 'a', family: 'request-1002903-pairs.jsonl' },
      { caseId: 'b', family: 'uc-sibling-pairs.jsonl' },
      { caseId: 'c', family: 'named-relationship-pairs.jsonl' },
    ];
    expect(() => assertRequiredCaseFiles(cases)).not.toThrow();
  });

  test('the real loaded default case set (all three tracked files) satisfies the required-family check', () => {
    const cases = loadAllCases([]);
    expect(() => assertRequiredCaseFiles(cases)).not.toThrow();
  });

  test('a custom requiredBasenames set can be passed explicitly (used by main() with the module default)', () => {
    const cases = [{ caseId: 'a', family: 'some-other-file.jsonl' }];
    expect(() => assertRequiredCaseFiles(cases, new Set(['some-other-file.jsonl']))).not.toThrow();
    expect(() => assertRequiredCaseFiles(cases, new Set(['missing-file.jsonl']))).toThrow(/missing-file\.jsonl/);
  });
});

describe('run-pair-gates core: CLI arg parsing (no network, no process.exit)', () => {
  test('parseArgs: --help is captured', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });

  test('parseArgs: --slug, --cases (repeatable), --timeout-ms are captured', () => {
    const args = parseArgs(['--slug', 'my-run', '--cases', 'a.jsonl', '--cases', 'b.jsonl', '--timeout-ms', '5000']);
    expect(args.slug).toBe('my-run');
    expect(args.extraCases).toEqual(['a.jsonl', 'b.jsonl']);
    expect(args.timeoutMs).toBe(5000);
  });

  test('parseArgs: missing slug leaves slug null', () => {
    expect(parseArgs([]).slug).toBeNull();
  });
});

// -----------------------------------------------------------------------
// Wave 3 B1/B2: provider-error propagation and provider-failure gating
// (Codex F2 — the default resolver config silently degrades provider
// exceptions to null resolutions, so distinct/related-surface rows pass
// vacuously). These tests drive the REAL resolver + REAL checker over a
// throwing OpenAlex-shaped stub adapter — no network — to prove the fix at
// the integration seam the CLI actually uses, not just at the stub-checker
// level the rest of this file exercises. Per the Wave 3 brief, these assert
// runner mechanics only (error propagation, gating, provenance) — never
// step-2 segment-comparison verdict specifics, which are owned by a
// concurrently-changing module.
// -----------------------------------------------------------------------
describe('run-pair-gates core: provider-error propagation (F2 fix, real resolver + real checker)', () => {
  function throwingOpenAlexAdapter() {
    return {
      searchInstitutions: jest.fn(async () => { throw new Error('OpenAlex unavailable (stub)'); }),
      getInstitution: jest.fn(async () => { throw new Error('OpenAlex unavailable (stub)'); }),
    };
  }

  test('propagateProviderErrors:true resolver + throwing provider fails the run instead of vacuously passing', async () => {
    const resolver = createInstitutionIdentityResolver({
      openAlexService: throwingOpenAlexAdapter(),
      propagateProviderErrors: true,
    });
    const incumbentChecker = createInstitutionConsistencyChecker({ resolver, segmentComparison: false });
    const stagedChecker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    const cases = [
      {
        caseId: 'live-throw-1', family: 'stub-family', left: 'Some Never Before Seen University', right: 'A Totally Different Institute', expected: 'distinct',
      },
    ];

    const result = await runPairGates({ cases, incumbentChecker, stagedChecker });

    // With the old default (propagateProviderErrors: false) this row would
    // have passed vacuously: provider throw -> null resolution -> checker
    // abstains to false -> "distinct" expectation trivially satisfied.
    expect(result.ok).toBe(false);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.passed).toBe(0);
    expect(result.rows[0].status).toBe('error');
    expect(resolver.metrics.providerFailures).toBeGreaterThan(0);
  });

  test('propagateProviderErrors:false (old default) is the vacuous-pass mechanism this fix closes — documented for contrast, not exercised by the live CLI', async () => {
    const resolver = createInstitutionIdentityResolver({
      openAlexService: throwingOpenAlexAdapter(),
      propagateProviderErrors: false,
    });
    const incumbentChecker = createInstitutionConsistencyChecker({ resolver, segmentComparison: false });
    const stagedChecker = createInstitutionConsistencyChecker({ resolver, segmentComparison: true });

    const cases = [
      {
        caseId: 'live-throw-2', family: 'stub-family', left: 'Some Never Before Seen University', right: 'A Totally Different Institute', expected: 'distinct',
      },
    ];

    const result = await runPairGates({ cases, incumbentChecker, stagedChecker });

    // Row-level gate passes vacuously under the old default...
    expect(result.ok).toBe(true);
    // ...which is exactly why B2's separate metrics-based gate exists: even
    // though every row "passed", the resolver recorded a provider failure.
    expect(resolver.metrics.providerFailures).toBeGreaterThan(0);
    expect(gateOk(result, resolver.metrics)).toBe(false);
  });
});

describe('run-pair-gates core: gateOk (F2 defense-in-depth — resolver-metrics provider-failure gate)', () => {
  test('all rows pass, zero provider failures -> gate passes', () => {
    const result = { ok: true };
    expect(gateOk(result, { providerFailures: 0 })).toBe(true);
  });

  test('all rows pass, but resolver metrics report a nonzero provider failure -> gate FAILS', () => {
    // Simulates a failure on a query that a different, later query resolved
    // successfully: the row-level result looks clean, but the cumulative
    // counter is nonzero and must still fail the run.
    const result = { ok: true };
    expect(gateOk(result, { providerFailures: 1 })).toBe(false);
  });

  test('row-level gate already failed -> gate FAILS regardless of resolver metrics', () => {
    const result = { ok: false };
    expect(gateOk(result, { providerFailures: 0 })).toBe(false);
  });

  test('no resolverMetrics argument -> falls back to the row-level gate only', () => {
    expect(gateOk({ ok: true }, undefined)).toBe(true);
    expect(gateOk({ ok: false }, undefined)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Wave 3 B3: provenance block (Codex F4 — artifacts must be revision-
// reproducible: git sha, dirty state, source/fixture hashes, node version,
// and an env-key-presence boolean, never env values).
// -----------------------------------------------------------------------
describe('run-pair-gates core: buildProvenance (F4 provenance block)', () => {
  let tmpDir;
  let scriptPath;
  let caseFilePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-gates-provenance-'));
    scriptPath = path.join(tmpDir, 'fake-script.js');
    fs.writeFileSync(scriptPath, '// fake script fixture\n');
    caseFilePath = path.join(tmpDir, 'fake-cases.jsonl');
    fs.writeFileSync(caseFilePath, '{"caseId":"x","left":"a","right":"b","expected":"same"}\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sha256File hashes file contents deterministically', () => {
    const first = sha256File(scriptPath);
    const second = sha256File(scriptPath);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test('buildProvenance returns the full provenance block shape', () => {
    const provenance = buildProvenance({ scriptPath, caseFiles: [caseFilePath] });

    expect(provenance.scriptSha256).toBe(sha256File(scriptPath));
    expect(provenance.caseFileHashes).toEqual([
      { file: path.relative(process.cwd(), caseFilePath), sha256: sha256File(caseFilePath) },
    ]);
    expect(provenance.nodeVersion).toBe(process.version);
    expect(typeof provenance.openAlexApiKeyPresent).toBe('boolean');
    expect(provenance).toHaveProperty('git');
    expect(provenance.git).toHaveProperty('sha');
    expect(provenance.git).toHaveProperty('dirty');
  });

  test('buildProvenance never leaks env values — only a boolean presence flag', () => {
    const withoutKey = { ...process.env };
    delete withoutKey.OPENALEX_API_KEY;
    const original = process.env.OPENALEX_API_KEY;
    process.env.OPENALEX_API_KEY = 'super-secret-value-must-not-appear';
    try {
      const provenance = buildProvenance({ scriptPath, caseFiles: [caseFilePath] });
      expect(provenance.openAlexApiKeyPresent).toBe(true);
      const serialized = JSON.stringify(provenance);
      expect(serialized).not.toContain('super-secret-value-must-not-appear');
    } finally {
      if (original === undefined) delete process.env.OPENALEX_API_KEY;
      else process.env.OPENALEX_API_KEY = original;
    }
  });

  test('git revision info resolves against this real repo (sanity check, not mocked)', () => {
    const provenance = buildProvenance({ scriptPath, caseFiles: [caseFilePath] });
    // This repo IS a git checkout at test-run time, so a real sha should
    // resolve — a null here would mean gitRevisionInfo's cwd or command is
    // wrong, not that git is unavailable.
    expect(provenance.git.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof provenance.git.dirty).toBe('boolean');
  });
});

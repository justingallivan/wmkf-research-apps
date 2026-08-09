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
} = require(path.join('..', '..', '..', 'benchmarks', 'institution-pair-consistency', 'run-pair-gates.js'));

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

  test('loadAllCases loads the two real Stage 1 fixtures (5 + 140 = 145 rows) plus any extras', () => {
    const rows = loadAllCases([]);
    expect(rows.length).toBe(145);
    const families = new Set(rows.map((r) => r.family));
    expect(families).toEqual(new Set(['request-1002903-pairs.jsonl', 'uc-sibling-pairs.jsonl']));
  });

  test('loadAllCases throws (propagates) when a missing extra case file is requested — the CLI turns this into a nonzero exit', () => {
    expect(() => loadAllCases([path.join(tmpDir, 'missing-extra.jsonl')])).toThrow(/not found or unreadable/);
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

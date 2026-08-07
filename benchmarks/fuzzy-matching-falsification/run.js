#!/usr/bin/env node
/**
 * Falsification-suite runner.
 *
 * First executed 2026-08-06 (S405, owner-authorized) to freeze the incumbent
 * baseline — see baseline/incumbent-2026-08-06.md. Ships with no adapters of
 * its own and refuses to run bare; each system under test supplies an
 * adapter set (the incumbent's lives in adapters-incumbent.js).
 *
 * Adapter contract:
 *   const { runSuite } = require('./run');
 *   runSuite({
 *     institutionResolve:        async (input) => ({ outcome, target, multiOrg }),
 *     institutionPairConsistent: async (input) => ({ outcome, consistent }),
 *     personMatch:               async (input) => ({ outcome, match }),
 *     contactAttribute:          async (input) => ({ outcome, attach }),
 *     affiliationCurrent:        async (input) => ({ outcome, current, historical }),
 *   })
 * Each adapter wraps ONE system under test (incumbent predicates, ROR
 * chosen:true, S2AFF, the future shared scorer, ...). runSuite never mutates
 * anything and never talks to the network itself; providers live behind the
 * adapters, so an offline system can be tested offline.
 *
 * Scoring: a case PASSES when the adapter's outcome matches expected.outcome
 * AND every field asserted in `expected` (consistent/match/attach/current/
 * must_not_resolve_to) is satisfied. `must_not_resolve_to` is a hard veto
 * assertion: resolving to any listed name fails the case regardless of
 * outcome. Cases with label_status "assumed" are reported separately — they
 * are owner-adjudication items, not settled ground truth.
 *
 * Judging sharp edge: target-name comparison is exact-string; provider name
 * renderings that differ only in punctuation score as fails (4 known cases
 * in the 2026-08-06 baseline). Prefer normalized-name or ROR-id comparison
 * once the pinned ROR dump exists.
 */

const fs = require('fs');
const path = require('path');

const CASES_DIR = path.join(__dirname, 'cases');

const ADAPTER_BY_KIND = {
  resolve: 'institutionResolve',
  'pair-consistency': 'institutionPairConsistent',
  'pair-match': 'personMatch',
  attribution: 'contactAttribute',
  conflict: 'contactAttribute',
  validation: 'contactAttribute',
  'current-affiliation': 'affiliationCurrent',
};

function loadCases() {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.jsonl')).sort();
  const cases = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(CASES_DIR, file), 'utf8').split('\n').filter(Boolean);
    lines.forEach((line, i) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}:${i + 1} is not valid JSON: ${err.message}`);
      }
      cases.push({ ...parsed, _file: file });
    });
  }
  return cases;
}

function judge(c, actual) {
  const failures = [];
  const exp = c.expected;
  if (actual.outcome !== exp.outcome) {
    failures.push(`outcome: expected ${exp.outcome}, got ${actual.outcome}`);
  }
  for (const key of ['consistent', 'match', 'attach']) {
    if (key in exp && exp[key] !== null && actual[key] !== exp[key]) {
      failures.push(`${key}: expected ${exp[key]}, got ${actual[key]}`);
    }
  }
  const banned = exp.must_not_resolve_to ?? [];
  const resolvedName = actual.target?.name ?? null;
  if (resolvedName && banned.includes(resolvedName)) {
    failures.push(`VETO: resolved to banned entity "${resolvedName}"`);
  }
  // Harness fix (2026-08-06, baseline-freeze run): the original judge() never
  // compared the resolved target's NAME against expected.target.name for
  // 'resolve'-kind cases — it only checked the veto list. A case that
  // resolves to outcome 'resolved' but the WRONG institution (not on the veto
  // list) would have scored a silent pass. Skipped when expected.target is
  // null/absent (abstention expected, nothing to compare) or is the
  // structural "MULTIPLE" sentinel (multi-org cases; the incumbent has no
  // multi-org output shape to compare against).
  if (c.kind === 'resolve' && exp.outcome === 'resolved'
    && exp.target?.name && exp.target.name !== 'MULTIPLE') {
    if (resolvedName !== exp.target.name) {
      failures.push(`target.name: expected "${exp.target.name}", got ${JSON.stringify(resolvedName)}`);
    }
  }
  if (exp.current) {
    const got = new Set(actual.current ?? []);
    for (const inst of exp.current) {
      if (!got.has(inst)) failures.push(`current: missing "${inst}"`);
    }
  }
  return failures;
}

async function runSuite(adapters, { onResult } = {}) {
  if (!adapters || Object.keys(adapters).length === 0) {
    throw new Error(
      'No adapters wired. Pass an adapter set for the system under test — ' +
      'e.g. require("./adapters-incumbent") — or use run-baseline.js.'
    );
  }
  const cases = loadCases();
  const results = [];
  for (const c of cases) {
    const adapterName = ADAPTER_BY_KIND[c.kind];
    const adapter = adapters[adapterName];
    if (!adapter) {
      // Harness fix (2026-08-06, baseline-freeze run): this branch omitted the
      // onResult callback, so a driver that streams results via onResult
      // (rather than reading the final `results` array) silently lost every
      // no-adapter-wired case — all 6 affiliation-current.jsonl cases here.
      const noAdapterResult = { id: c.id, status: 'skipped', reason: `no ${adapterName} adapter` };
      results.push(noAdapterResult);
      if (onResult) onResult(noAdapterResult, c);
      continue;
    }
    let result;
    try {
      const actual = await adapter(c.input);
      // Harness fix (2026-08-06, baseline-freeze run): an adapter may itself
      // decide a case has no runnable incumbent seam (e.g. structural
      // placeholders it can't compare, or a predicate that isn't
      // require()-able read-only). It signals this with `{ skipped: true,
      // reason }` rather than an outcome, and it is counted as skipped, not
      // judged pass/fail. This was unreachable before any adapter existed.
      if (actual && actual.skipped) {
        result = {
          id: c.id,
          status: 'skipped',
          reason: actual.reason || `${adapterName} adapter declined this case`,
        };
        results.push(result);
        if (onResult) onResult(result, c);
        continue;
      }
      const failures = judge(c, actual);
      result = {
        id: c.id,
        status: failures.length === 0 ? 'pass' : 'fail',
        assumed: c.label_status === 'assumed',
        failures,
        actual,
      };
    } catch (err) {
      result = { id: c.id, status: 'error', assumed: c.label_status === 'assumed', error: err.message };
    }
    results.push(result);
    if (onResult) onResult(result, c);
  }
  const settled = results.filter((r) => !r.assumed && r.status !== 'skipped');
  return {
    results,
    summary: {
      total: results.length,
      pass: settled.filter((r) => r.status === 'pass').length,
      fail: settled.filter((r) => r.status === 'fail').length,
      error: settled.filter((r) => r.status === 'error').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      assumedLabelCases: results.filter((r) => r.assumed).map((r) => r.id),
    },
  };
}

if (require.main === module) {
  // Intentionally refuses: see header. Loading/validating cases is allowed;
  // running matchers is not.
  runSuite(undefined).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { loadCases, runSuite, ADAPTER_BY_KIND };

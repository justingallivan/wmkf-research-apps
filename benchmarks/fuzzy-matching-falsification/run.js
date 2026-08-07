#!/usr/bin/env node
/**
 * Falsification-suite runner — BUILT, DELIBERATELY NOT EXECUTED.
 *
 * Owner decision 2026-08-06 (S405): build the suite but do not execute it.
 * "Execute" means running any matching system — the incumbent predicates or a
 * candidate scorer — against the cases. Accordingly this runner ships with NO
 * adapters wired and refuses to run until one is passed in a later,
 * separately-authorized session (the consensus step-0 baseline freeze).
 *
 * Contract for that later session:
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
 * THIS FILE IS SYNTAX-CHECKED BUT HAS NEVER BEEN RUN. Treat the scoring
 * logic as unverified until the first authorized execution.
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
      'No adapters wired. Execution of this suite is deferred by owner decision ' +
      '2026-08-06 (build, don\'t execute) — wire an adapter set in a session where ' +
      'the baseline freeze / comparator run is explicitly authorized.'
    );
  }
  const cases = loadCases();
  const results = [];
  for (const c of cases) {
    const adapterName = ADAPTER_BY_KIND[c.kind];
    const adapter = adapters[adapterName];
    if (!adapter) {
      results.push({ id: c.id, status: 'skipped', reason: `no ${adapterName} adapter` });
      continue;
    }
    let result;
    try {
      const actual = await adapter(c.input);
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

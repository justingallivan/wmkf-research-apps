#!/usr/bin/env node
'use strict';

/**
 * Institution final-decision falsification benchmark v3.
 *
 * v3 reuses the hash-pinned v2 cases and canonical ROR labels, but judges the
 * local resolver's final resolved/review/unresolved outcome and selected IDs.
 * The production application does not import this runner or resolver.
 */
const { loadCases } = require('../v2/run');
const { createInstitutionDecisionResolver } = require('./resolver');

function sameIds(actual, expected) {
  return JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...new Set(expected)].sort());
}

function judgeResolve(c, decision) {
  const failures = [];
  if (decision.outcome !== c.expected.outcome) {
    failures.push(`outcome: expected ${c.expected.outcome}, got ${decision.outcome}`);
  }
  if (c.expected.outcome === 'resolved'
    && !sameIds(decision.selected_ror_ids, c.v2.expected_ror_ids)) {
    failures.push(
      `selected ids: expected ${c.v2.expected_ror_ids.join(', ') || 'none'}, got ${decision.selected_ror_ids.join(', ') || 'none'}`,
    );
  }
  const forbidden = decision.selected_ror_ids.filter((id) => c.v2.must_not_ror_ids.includes(id));
  if (forbidden.length) failures.push(`unsafe selected ids: ${forbidden.join(', ')}`);
  return failures;
}

function judgePair(c, comparison) {
  const failures = [];
  if (comparison.outcome !== c.expected.outcome) {
    failures.push(`outcome: expected ${c.expected.outcome}, got ${comparison.outcome}`);
  }
  if (comparison.outcome === 'resolved') {
    if (!comparison.left_ror_ids.includes(c.v2.listed_ror_id)) {
      failures.push(`listed id: missing ${c.v2.listed_ror_id}`);
    }
    if (!comparison.right_ror_ids.includes(c.v2.evidence_canonical_ror_id)) {
      failures.push(`evidence id: missing canonical ${c.v2.evidence_canonical_ror_id}`);
    }
  }
  return failures;
}

async function runSuite(candidateAdapter, { onResult } = {}) {
  const resolver = createInstitutionDecisionResolver({ candidateAdapter });
  const cases = loadCases();
  const results = [];
  for (const c of cases) {
    let result;
    if (c.decision !== 'institution') {
      result = { id: c.id, status: 'skipped', reason: 'v3 is institution-decision-only' };
    } else if (!c.v2) {
      result = { id: c.id, status: 'error', error: 'missing v2 canonical label' };
    } else {
      try {
        const actual = c.kind === 'resolve'
          ? await resolver.resolve(c.input)
          : await resolver.compare({ listed: c.input.listed, evidence: c.input.evidence });
        const failures = c.kind === 'resolve' ? judgeResolve(c, actual) : judgePair(c, actual);
        result = {
          id: c.id,
          status: failures.length ? 'fail' : 'pass',
          assumed: c.label_status === 'assumed',
          failures,
          actual,
        };
      } catch (error) {
        result = {
          id: c.id,
          status: 'error',
          assumed: c.label_status === 'assumed',
          error: error.message,
        };
      }
    }
    results.push(result);
    if (onResult) onResult(result, c);
  }
  const settled = results.filter((result) => !result.assumed && result.status !== 'skipped');
  return {
    results,
    summary: {
      total: results.length,
      pass: settled.filter((result) => result.status === 'pass').length,
      fail: settled.filter((result) => result.status === 'fail').length,
      error: settled.filter((result) => result.status === 'error').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      wrong_auto_resolutions: settled.filter((result) => (
        result.status === 'fail'
        && result.actual?.outcome === 'resolved'
      )).length,
      assumedLabelCases: results.filter((result) => result.assumed).map((result) => result.id),
      adapter_metrics: candidateAdapter.metrics || null,
    },
  };
}

module.exports = { judgePair, judgeResolve, runSuite };

#!/usr/bin/env node
'use strict';

/**
 * Institution candidate-retrieval benchmark v2.
 *
 * v1 cases and judge remain byte-identical. This runner overlays canonical ROR
 * IDs and judges retrieval recall plus relationship evidence. It deliberately
 * does not judge a final resolution: candidate generators may expose provider
 * rank/chosen as provenance, but may not return a verdict.
 */
const fs = require('fs');
const path = require('path');
const { loadCases: loadV1Cases } = require('../../run');
const { assertCandidateSet } = require('./candidate-contract');
const { relationshipsAcross } = require('./relationship');

const LABELS_PATH = path.join(__dirname, 'case-labels.jsonl');

function loadLabels() {
  const labels = fs.readFileSync(LABELS_PATH, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  return new Map(labels.map((label) => [label.id, label]));
}

function loadCases() {
  const labels = loadLabels();
  return loadV1Cases().map((c) => ({ ...c, v2: labels.get(c.id) || null }));
}

function ids(candidateSet) {
  return new Set(candidateSet.candidates.map((candidate) => candidate.ror_id));
}

function judgeResolve(label, candidateSet) {
  const failures = [];
  const got = ids(candidateSet);
  for (const expectedId of label.expected_ror_ids) {
    if (!got.has(expectedId)) failures.push(`candidate recall: missing ${expectedId}`);
  }
  return {
    failures,
    evidence: {
      candidate_ror_ids: [...got].sort(),
      expected_ror_ids: label.expected_ror_ids,
      // Presence is recorded, not failed: a high-recall generator may return a
      // sibling/parent candidate. The later veto layer, not retrieval, must
      // prevent it from becoming authoritative.
      present_veto_ror_ids: label.must_not_ror_ids.filter((id) => got.has(id)),
    },
  };
}

function candidatesForExpected(set, canonicalId, sourceId = canonicalId) {
  return set.candidates.filter((candidate) => (
    candidate.ror_id === canonicalId || candidate.ror_id === sourceId
  ));
}

function judgePair(label, listedSet, evidenceSet) {
  const failures = [];
  const listedMatches = candidatesForExpected(listedSet, label.listed_ror_id);
  const evidenceMatches = candidatesForExpected(
    evidenceSet,
    label.evidence_canonical_ror_id,
    label.evidence_source_ror_id,
  );
  if (!listedMatches.length) failures.push(`listed candidate recall: missing ${label.listed_ror_id}`);
  if (!evidenceMatches.length) {
    failures.push(
      `evidence candidate recall: missing ${label.evidence_source_ror_id}`
      + (label.evidence_source_ror_id === label.evidence_canonical_ror_id
        ? ''
        : ` or canonical ${label.evidence_canonical_ror_id}`),
    );
  }
  const actualRelationships = relationshipsAcross(listedMatches, evidenceMatches);
  if (listedMatches.length && evidenceMatches.length
    && !actualRelationships.includes(label.expected_relationship)) {
    failures.push(
      `relationship: expected ${label.expected_relationship}, got ${actualRelationships.join(', ') || 'none'}`,
    );
  }
  return {
    failures,
    evidence: {
      listed_candidate_ror_ids: [...ids(listedSet)].sort(),
      evidence_candidate_ror_ids: [...ids(evidenceSet)].sort(),
      actual_relationships: actualRelationships,
      expected_relationship: label.expected_relationship,
    },
  };
}

async function runSuite(adapter, { onResult } = {}) {
  if (!adapter?.institutionCandidates) {
    throw new Error('adapter must export institutionCandidates(input)');
  }
  const cases = loadCases();
  const results = [];
  for (const c of cases) {
    let result;
    if (c.decision !== 'institution') {
      result = { id: c.id, status: 'skipped', reason: 'v2 is institution-candidate-only' };
    } else if (!c.v2) {
      result = { id: c.id, status: 'error', error: 'missing v2 canonical label' };
    } else {
      try {
        let judged;
        let actual;
        if (c.kind === 'resolve') {
          const candidateSet = assertCandidateSet(await adapter.institutionCandidates(c.input));
          judged = judgeResolve(c.v2, candidateSet);
          actual = { candidate_set: candidateSet, ...judged.evidence };
        } else {
          const listedSet = assertCandidateSet(await adapter.institutionCandidates({
            affiliation_string: c.input.listed,
          }));
          const evidenceSet = assertCandidateSet(await adapter.institutionCandidates({
            affiliation_string: c.input.evidence,
          }));
          judged = judgePair(c.v2, listedSet, evidenceSet);
          actual = { listed_set: listedSet, evidence_set: evidenceSet, ...judged.evidence };
        }
        result = {
          id: c.id,
          status: judged.failures.length ? 'fail' : 'pass',
          assumed: c.label_status === 'assumed',
          failures: judged.failures,
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
      assumedLabelCases: results.filter((result) => result.assumed).map((result) => result.id),
    },
  };
}

module.exports = { judgePair, judgeResolve, loadCases, loadLabels, runSuite };

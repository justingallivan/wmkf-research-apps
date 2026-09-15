#!/usr/bin/env node

/**
 * Read-only, non-authoritative ROR proposals for stored candidate-affiliation
 * and suggested-institution text pairs. These are not necessarily the operands
 * used by runtime enrichment. This does not infer source/currentness, person
 * identity, COI, staff actions, or candidate selectability. The input
 * must be a locally retained --cases output from the companion audit script.
 * Redirect output to a gitignored artifact; never commit case-level data.
 *
 * Usage: node scripts/replay-institution-affiliation-retrospective.js
 *        outputs/institution-affiliation-retrospective-cases-YYYY-MM-DD.json
 *        [--limit=N]
 */

'use strict';

const fs = require('node:fs');
const {
  createRorCandidateUnionAdapter,
} = require('../lib/services/ror-institution-candidate-adapter');
const {
  createRorAffiliationAssertionResolver,
} = require('../lib/services/ror-affiliation-assertion-resolver');
const {
  assessAffiliationRelationship,
} = require('../lib/services/institution-affiliation-assessment');

function parseArgs(argv) {
  if (!argv[0] || argv.length > 2) throw new Error('expected local input JSON path and optional --limit=N');
  const limitArg = argv[1];
  if (limitArg && !/^--limit=[1-9]\d*$/.test(limitArg)) throw new Error('--limit requires a positive integer');
  return { path: argv[0], limit: limitArg ? Number(limitArg.slice(8)) : Infinity };
}

function skipReason(row) {
  if (!row.candidateAffiliation || !row.suggestedInstitution) return 'missing_operand';
  // Slash is not a supported multi-organization delimiter in the production
  // parser. Some roster suggestions contain joint appointments or alternatives;
  // neither may be counted as a single safely compatible organization.
  if (row.candidateAffiliation.includes('/') || row.suggestedInstitution.includes('/')) {
    return 'unparsed_slash_affiliations';
  }
  // These stored suggestions are staff/model decisions, not organization names.
  // The conservative filter affects this replay only and is reported as a skip.
  if (/^\s*\(|^\s*not a fit\b|^\s*insufficient(?:ly)?\b|^\s*unable to\b|^\s*not confidently\b/i
    .test(row.suggestedInstitution)) return 'suggested_text_not_institution';
  return null;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = String(key(row) || 'unknown');
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function replay(rows, { limit = Infinity, onProgress = () => {} } = {}) {
  const adapter = createRorCandidateUnionAdapter({
    requestTimeoutMs: 4000,
    resolutionTimeoutMs: 8000,
    maxProviderRequestsPerResolution: 12,
  });
  const resolver = createRorAffiliationAssertionResolver({ candidateAdapter: adapter });
  const results = [];
  for (const row of rows.slice(0, limit)) {
    const skipped = skipReason(row);
    if (skipped) {
      results.push({ caseId: row.caseId, status: 'skipped', reason: skipped });
      continue;
    }
    try {
      const [left, right] = await Promise.all([
        resolver.resolve({
          rawText: row.candidateAffiliation,
          sourceType: 'applicant_record',
          currentness: 'unknown',
          authorSpecific: 'unknown',
        }),
        resolver.resolve({
          rawText: row.suggestedInstitution,
          sourceType: 'applicant_record',
          currentness: 'unknown',
          authorSpecific: 'unknown',
        }),
      ]);
      const assessment = assessAffiliationRelationship({
        evidenceAssertion: left,
        recordedAssertion: right,
      });
      const segments = [...left.segments, ...right.segments];
      results.push({
        caseId: row.caseId,
        status: 'replayed',
        relationship: assessment.relationship,
        relationshipReason: assessment.reason,
        leftSegments: left.segments.length,
        rightSegments: right.segments.length,
        additionalAffiliations: assessment.additionalAffiliations.length,
        unresolvedSegments: segments.filter((segment) => segment.resolution.status !== 'resolved').length,
        providerFailureSegments: segments.filter((segment) => segment.resolution.reason === 'provider_failure').length,
      });
    } catch (error) {
      results.push({
        caseId: row.caseId,
        status: 'error',
        reason: 'replay_error',
      });
    }
    if (results.length % 5 === 0) onProgress(results.length, Math.min(rows.length, limit));
  }
  return {
    summary: {
      inputCases: rows.length,
      processedCases: results.length,
      byStatus: countBy(results, (row) => row.status),
      bySkipReason: countBy(results.filter((row) => row.status === 'skipped'), (row) => row.reason),
      byRelationship: countBy(results.filter((row) => row.status === 'replayed'), (row) => row.relationship),
      providerFailureRows: results.filter((row) => row.providerFailureSegments > 0).length,
      metrics: adapter.metrics,
      authority: 'relationship proposals only; no source/time, identity, COI, or selection decision',
    },
    cases: results,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const input = JSON.parse(fs.readFileSync(opts.path, 'utf8'));
  if (!Array.isArray(input.cases)) throw new Error('input must contain cases from --cases audit');
  const result = await replay(input.cases, {
    limit: opts.limit,
    onProgress: (done, total) => process.stderr.write(`replayed ${done}/${total}\n`),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, skipReason, replay };

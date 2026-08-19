#!/usr/bin/env node

/**
 * Live, read-only ROR capture for the source-aware 25-case benchmark.
 * Writes a new normalized provider snapshot and refuses to overwrite it.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRorCandidateUnionAdapter } = require('../../../lib/services/ror-institution-candidate-adapter');
const { createRorAffiliationAssertionResolver } = require('../../../lib/services/ror-affiliation-assertion-resolver');

const ROOT = __dirname;
const CASES_PATH = path.join(ROOT, 'cases', 'source-aware-25.json');
const OUTPUT_PATH = path.join(ROOT, 'provider-snapshots', 'ror-2026-08-19d.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function unresolvedAssertion(assertion, reason) {
  return {
    ...assertion,
    segments: assertion.segments.map((segment) => ({
      ...segment,
      resolution: {
        status: 'unresolved',
        reason,
        provider: 'forced-offline-fixture',
        confidence: 'unresolved',
      },
    })),
    resolutionSummary: {
      resolverVersion: 'forced-offline-fixture/v1',
      resolvedSegments: 0,
      unresolvedSegments: assertion.segments.length,
    },
  };
}

function pruneAssertion(assertion) {
  return {
    ...assertion,
    segments: assertion.segments.map(({ decision: _decision, ...segment }) => segment),
  };
}

function applyResolutionOverrides(sourceAssertion, resolvedAssertion) {
  const sourceSegments = sourceAssertion.segments || [];
  return {
    ...resolvedAssertion,
    segments: resolvedAssertion.segments.map((segment, index) => {
      const override = sourceSegments[index]?.resolutionOverride;
      if (!override) return segment;
      return {
        ...segment,
        resolution: {
          ...override,
          provider: 'manual_adjudication_overlay',
          reason: override.reason || 'adjudicated_organization_scope',
          confidence: override.confidence || 'adjudicated',
          provenance: {
            resolverVersion: 'manual-adjudication-overlay/v1',
            sourceReference: sourceAssertion.sourceReference,
          },
        },
      };
    }),
  };
}

async function resolveAssertion(sourceAssertion, resolver) {
  const sourceSegments = sourceAssertion.segments || [];
  if (sourceSegments.length > 0 && sourceSegments.every((segment) => segment.resolutionOverride)) {
    return applyResolutionOverrides(sourceAssertion, {
      ...sourceAssertion,
      segments: sourceSegments.map((segment) => ({
        rawText: segment.rawText,
        role: segment.role || 'primary_or_unknown',
        resolution: { status: 'unresolved', reason: 'overridden' },
      })),
      resolutionSummary: {
        resolverVersion: 'manual-adjudication-overlay/v1',
        resolvedSegments: sourceSegments.length,
        unresolvedSegments: 0,
      },
    });
  }
  return applyResolutionOverrides(sourceAssertion, await resolver.resolve(sourceAssertion));
}

async function main() {
  const diagnoseArg = process.argv.find((value) => value.startsWith('--diagnose='));
  const diagnoseCaseId = diagnoseArg ? diagnoseArg.slice('--diagnose='.length) : null;
  if (!diagnoseCaseId && fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`Refusing to overwrite frozen provider snapshot: ${OUTPUT_PATH}`);
  }
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  if (!Array.isArray(fixture.cases) || fixture.cases.length !== 25) {
    throw new Error('source-aware fixture must contain exactly 25 cases');
  }
  const adapter = createRorCandidateUnionAdapter({ observedOn: '2026-08-19' });
  const resolver = createRorAffiliationAssertionResolver({ candidateAdapter: adapter });
  const cases = [];
  const selectedCases = diagnoseCaseId
    ? fixture.cases.filter((testCase) => testCase.caseId === diagnoseCaseId)
    : fixture.cases;
  if (diagnoseCaseId && selectedCases.length !== 1) throw new Error('diagnostic case not found');
  for (const testCase of selectedCases) {
    process.stderr.write(`Resolving ${testCase.caseId}\n`);
    if (testCase.providerMode === 'forced_failure') {
      cases.push({
        caseId: testCase.caseId,
        evidenceAssertion: unresolvedAssertion(testCase.evidenceAssertion, 'provider_failure'),
        recordedAssertion: unresolvedAssertion(testCase.recordedAssertion, 'provider_failure'),
      });
      continue;
    }
    const evidenceAssertion = await resolveAssertion(testCase.evidenceAssertion, resolver);
    const recordedAssertion = await resolveAssertion(testCase.recordedAssertion, resolver);
    if (diagnoseCaseId) {
      process.stdout.write(`${JSON.stringify({
        caseId: testCase.caseId,
        evidenceAssertion,
        recordedAssertion,
        metrics: adapter.metrics,
      }, null, 2)}\n`);
      return;
    }
    cases.push({
      caseId: testCase.caseId,
      evidenceAssertion: pruneAssertion(evidenceAssertion),
      recordedAssertion: pruneAssertion(recordedAssertion),
    });
  }
  const output = {
    schemaVersion: 'institution-affiliation-provider-snapshot/v1',
    capturedAt: new Date().toISOString(),
    authority: 'read_only_ror_snapshot_shadow_only',
    casesSha256: sha256(CASES_PATH),
    provider: adapter.metadata,
    metrics: adapter.metrics,
    cases,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath: OUTPUT_PATH, cases: cases.length, metrics: adapter.metrics }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

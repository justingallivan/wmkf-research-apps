#!/usr/bin/env node
/**
 * Deterministic before/after smoke over the frozen unresolved-case capture.
 *
 * "Before" is the observed production disposition that selected each row:
 * every case was an active unresolved institution-mismatch card. "After" is
 * the shadow-only provider-independent structural classifier. This script
 * performs no network calls and no production writes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  classifyStructuralInstitutionSameness,
} = require('../../lib/services/institution-structural-sameness');
const { buildProvenance } = require('./run-pair-gates');

const FIXTURE = path.join(__dirname, 'smoke', 'unresolved-25-2026-08-18.json');
const RESULTS_DIR = path.join(__dirname, 'results');
const SLUG = 'unresolved-25-before-after-2026-08-18';

function smokeDecision(testCase) {
  if (testCase.caseKind !== 'institution_pair') {
    return {
      verdict: 'insufficient',
      disposition: 'surface',
      reasonCode: 'insufficient_pair_evidence',
      remedyId: 'confirm_identity',
    };
  }
  return classifyStructuralInstitutionSameness(
    testCase.evidenceInstitution,
    testCase.recordedInstitution,
  );
}

function clip(value, max = 72) {
  const text = String(value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function buildArtifact(fixture) {
  const rows = fixture.cases.map((testCase) => {
    const after = smokeDecision(testCase);
    return {
      ...testCase,
      before: {
        disposition: 'surface',
        reasonLabel: 'Suggested because:',
        remedyId: 'confirm_identity',
        source: 'observed_production_capture',
      },
      after: {
        ...after,
        reasonLabel: after.disposition === 'surface' ? 'Why this needs review:' : null,
      },
      expectedMatch: after.disposition === testCase.expectedDisposition,
      unsafeAutoClear: after.disposition === 'auto_clear' && testCase.expectedDisposition === 'surface',
      manufacturedReviewRemaining: after.disposition === 'surface' && testCase.expectedDisposition === 'auto_clear',
      actionableIfSurfaced: after.disposition !== 'surface' || Boolean(after.remedyId),
    };
  });

  const count = (predicate) => rows.filter(predicate).length;
  const summary = {
    totalCases: rows.length,
    comparableInstitutionPairs: count((row) => row.caseKind === 'institution_pair'),
    insufficientPairEvidence: count((row) => row.caseKind === 'insufficient_pair_evidence'),
    expectedAutoClears: count((row) => row.expectedDisposition === 'auto_clear'),
    beforeAutoClears: 0,
    proposedAutoClears: count((row) => row.after.disposition === 'auto_clear'),
    manufacturedReviewsBefore: count((row) => row.expectedDisposition === 'auto_clear'),
    manufacturedReviewsRemaining: count((row) => row.manufacturedReviewRemaining),
    unsafeProposedAutoClears: count((row) => row.unsafeAutoClear),
    surfacedWithoutRemedy: count((row) => !row.actionableIfSurfaced),
    expectedDispositionMatches: count((row) => row.expectedMatch),
  };

  return {
    title: 'Unresolved institution identity smoke — before and after',
    generatedAt: new Date().toISOString(),
    authority: 'shadow_only_not_wired_to_production',
    selection: fixture.selection,
    capturedAt: fixture.capturedAt,
    population: fixture.population,
    interpretation: {
      before: 'Observed production state from the frozen roster capture; every selected row was surfaced unresolved.',
      after: 'Deterministic provider-independent Tier-0 structural classifier plus the proposed review-label/remedy contract.',
      expected: 'Human adjudication of the captured institution strings. Relationship/granularity and insufficient cases stay surfaced.',
    },
    summary,
    rows,
    provenance: buildProvenance({ scriptPath: __filename, caseFiles: [FIXTURE] }),
  };
}

function markdown(artifact) {
  const { summary } = artifact;
  const lines = [
    '# Unresolved institution identity smoke — before and after',
    '',
    `Generated: ${artifact.generatedAt}`,
    '',
    `Status: **shadow only; not wired to production authority**`,
    '',
    '## What was tested',
    '',
    artifact.selection,
    '',
    `The sample contains ${summary.comparableInstitutionPairs} cards with both compared institutions and ${summary.insufficientPairEvidence} cards where the persisted evidence could not reconstruct a pair. “Before” is the observed production result; “after” is the deterministic proposed classifier, not a new live provider call.`,
    '',
    '## Headline',
    '',
    `- Expected obvious same-organization clears: **${summary.expectedAutoClears}**`,
    `- Before automatic clears: **${summary.beforeAutoClears}**`,
    `- Proposed automatic clears: **${summary.proposedAutoClears}**`,
    `- Manufactured reviews remaining: **${summary.manufacturedReviewsRemaining}**`,
    `- Unsafe proposed automatic clears: **${summary.unsafeProposedAutoClears}**`,
    `- Surfaced cases without a remedy: **${summary.surfacedWithoutRemedy}**`,
    `- Cases matching the adjudicated disposition: **${summary.expectedDispositionMatches}/${summary.totalCases}**`,
    '',
    '## Case results',
    '',
    '| Case | Compared institutions / available evidence | Expected | Before | Proposed after | Reason / remedy |',
    '|---|---|---:|---:|---:|---|',
  ];

  for (const row of artifact.rows) {
    const evidence = row.caseKind === 'institution_pair'
      ? `${clip(row.evidenceInstitution)} ↔ ${clip(row.recordedInstitution)}`
      : `Only one institution retained: ${clip(row.suggestedInstitution)}`;
    const remedy = row.after.disposition === 'surface'
      ? `${row.after.reasonCode}; action: Confirm identity or Not a fit`
      : `${row.after.reasonCode}; no action required`;
    lines.push(`| ${row.caseId} | ${evidence} | ${row.expectedDisposition} | surface | ${row.after.disposition} | ${remedy} |`);
  }

  lines.push(
    '',
    '## Interpretation',
    '',
    '- An automatic clear means only that the narrow structural classifier proved the same organization after safe academic/locality decoration. It does not authorize relationship-based equivalence.',
    '- A surfaced result is not called a mismatch unless another authority proves a conflict. The user is told why review is needed and can choose Confirm identity or Not a fit.',
    '- Any proposed automatic clear on a case adjudicated for review is a hard safety failure.',
    '- The ten insufficient-evidence rows remain surfaced by design; their purpose is to test honest wording and a real remedy, not institution equivalence.',
    '',
    '## Stop boundary',
    '',
    'This artifact evaluates the approved narrow slice. Registry-backed sameness and organizational relationships remain outside production authority and require a later shadow/adjudication promotion decision.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (!Array.isArray(fixture.cases) || fixture.cases.length !== 25) {
    throw new Error('Smoke fixture must contain exactly 25 cases.');
  }
  const artifact = buildArtifact(fixture);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = path.join(RESULTS_DIR, `${SLUG}.json`);
  const markdownPath = path.join(RESULTS_DIR, `${SLUG}.md`);
  for (const outputPath of [jsonPath, markdownPath]) {
    if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite frozen artifact: ${outputPath}`);
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(artifact));
  console.log(JSON.stringify({ jsonPath, markdownPath, summary: artifact.summary }, null, 2));
  if (artifact.summary.unsafeProposedAutoClears > 0 || artifact.summary.surfacedWithoutRemedy > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { buildArtifact, markdown, smokeDecision };

#!/usr/bin/env node
/**
 * generate-sibling-pairs.js
 *
 * Deterministic generator for the UC sibling-campus pair-consistency case
 * file used by Stage 1 of docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
 * (safety invariant 1: sibling campuses never auto-clear).
 *
 * Frozen semantics: this file is append-only in behavior — once the emitted
 * case file is checked in, do not change the campus list, form definitions,
 * or ordering in a way that reorders or renumbers existing caseIds. Add new
 * case families as new files instead.
 *
 * No Date.now(), Math.random(), or other non-deterministic input. Running
 * `node generate-sibling-pairs.js` regenerates
 * cases/uc-sibling-pairs.jsonl byte-identically every time.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Sorted alphabetically by acronym (fixed, load-bearing order for caseIds).
const CAMPUSES = [
  { acronym: 'UCI', full: 'University of California, Irvine' },
  { acronym: 'UCLA', full: 'University of California, Los Angeles' },
  { acronym: 'UCR', full: 'University of California, Riverside' },
  { acronym: 'UCSB', full: 'University of California, Santa Barbara' },
  { acronym: 'UCSC', full: 'University of California, Santa Cruz' },
  { acronym: 'UCSD', full: 'University of California, San Diego' },
  { acronym: 'UCSF', full: 'University of California, San Francisco' },
];

const UC_SYSTEM = 'University of California';

const SOURCE =
  'generated: benchmarks/institution-pair-consistency/generate-sibling-pairs.js (deterministic UC campus matrix)';

function decorate(fullName) {
  return `${fullName}, CA, USA`;
}

/**
 * Builds the full, ordered array of case rows. Pure function of the
 * CAMPUSES table above — no randomness, no clock reads.
 */
function buildRows() {
  const rows = [];

  // Cross-campus pairs: every ordered distinct (left campus, right campus)
  // pair, in three operand forms. All expected "distinct" per safety
  // invariant 1 — sibling campuses never auto-clear regardless of shared
  // UC parentage.
  for (const left of CAMPUSES) {
    for (const right of CAMPUSES) {
      if (left.acronym === right.acronym) continue;

      rows.push({
        caseId: `uc-cross-${left.acronym}-${right.acronym}-f1`,
        source: SOURCE,
        left: left.full,
        right: right.full,
        expected: 'distinct',
        notes: `Cross-campus pair (full name, full name): ${left.acronym} vs ${right.acronym}. Sibling campuses under the same UC system parent must never auto-clear.`,
      });

      rows.push({
        caseId: `uc-cross-${left.acronym}-${right.acronym}-f2`,
        source: SOURCE,
        left: left.acronym,
        right: right.full,
        expected: 'distinct',
        notes: `Cross-campus pair (acronym, full name): ${left.acronym} vs ${right.acronym}. Sibling campuses under the same UC system parent must never auto-clear.`,
      });

      rows.push({
        caseId: `uc-cross-${left.acronym}-${right.acronym}-f3`,
        source: SOURCE,
        left: decorate(left.full),
        right: right.full,
        expected: 'distinct',
        notes: `Cross-campus pair (decorated full name, full name): ${left.acronym} vs ${right.acronym}. Sibling campuses under the same UC system parent must never auto-clear.`,
      });
    }
  }

  // Identity pairs: acronym vs full name of the SAME campus. Expected same.
  for (const campus of CAMPUSES) {
    rows.push({
      caseId: `uc-identity-${campus.acronym}`,
      source: SOURCE,
      left: campus.acronym,
      right: campus.full,
      expected: 'same',
      notes: `Identity pair: ${campus.acronym} acronym vs its own full campus name — the same organization.`,
    });
  }

  // Parent-system pairs: full campus name vs "University of California"
  // system. Expected related-surface — parent evidence must never
  // auto-clear per safety invariant 1 and owner decision 2.
  for (const campus of CAMPUSES) {
    rows.push({
      caseId: `uc-parent-${campus.acronym}`,
      source: SOURCE,
      left: campus.full,
      right: UC_SYSTEM,
      expected: 'related-surface',
      notes: `Parent-system pair: ${campus.acronym} vs the "University of California" system. Parent/system evidence must be surfaced, never auto-cleared (safety invariant 1, owner decision 2).`,
    });
  }

  return rows;
}

function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

function buildJsonl() {
  return toJsonl(buildRows());
}

const OUTPUT_PATH = path.join(__dirname, 'cases', 'uc-sibling-pairs.jsonl');

function main() {
  fs.writeFileSync(OUTPUT_PATH, buildJsonl());
  // eslint-disable-next-line no-console
  console.log(`Wrote ${buildRows().length} rows to ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildRows, buildJsonl, toJsonl, CAMPUSES, UC_SYSTEM, OUTPUT_PATH };

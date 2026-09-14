#!/usr/bin/env node

/**
 * Select a bounded, varied adjudication intake queue from local, gitignored
 * source-recovery and exploratory-replay artifacts. The replay is used only
 * for sampling; its predictions are never copied into the reviewer packet.
 * This is not a representative sample or a labeled acceptance corpus.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../outputs');
const SOURCE = path.join(ROOT, 'institution-affiliation-source-packet-2026-09-14.json');
const REPLAY = path.join(ROOT, 'institution-affiliation-retrospective-replay-2026-09-14.json');
const OUTPUT = path.join(ROOT, 'institution-affiliation-adjudication-queue-2026-09-14.json');
const LIMITS = Object.freeze({ same: 2, distinct: 4, unparsed_slash_affiliations: 10, unresolved: 10 });

function replayBucket(row) {
  if (row?.status === 'replayed' && ['same', 'distinct', 'unresolved'].includes(row.relationship)) {
    return row.relationship;
  }
  if (row?.status === 'skipped' && row.reason === 'unparsed_slash_affiliations') {
    return row.reason;
  }
  return null;
}

function selectCases(sourceCases, replayCases) {
  const replayById = new Map(replayCases.map((row) => [row.caseId, row]));
  const selected = [];
  const bySamplingBucket = {};
  for (const bucket of Object.keys(LIMITS)) {
    const eligible = sourceCases.filter((row) => row.triage === 'source_candidate_for_adjudication'
      && replayBucket(replayById.get(row.caseId)) === bucket)
      .sort((a, b) => a.caseId.localeCompare(b.caseId));
    const chosen = eligible.slice(0, LIMITS[bucket]);
    bySamplingBucket[bucket] = { available: eligible.length, selected: chosen.length };
    selected.push(...chosen);
  }
  // Sorting by opaque case ID keeps the output from disclosing sampling strata.
  selected.sort((a, b) => a.caseId.localeCompare(b.caseId));
  return { selected, bySamplingBucket };
}

function main() {
  if (process.argv.length > 2) throw new Error('this cohort selector takes no arguments');
  const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const replay = JSON.parse(fs.readFileSync(REPLAY, 'utf8'));
  if (!Array.isArray(source.cases) || !Array.isArray(replay.cases)) throw new Error('invalid source or replay packet');
  const { selected, bySamplingBucket } = selectCases(source.cases, replay.cases);
  const packet = {
    kind: 'adjudication_intake_only',
    cohort: source.cohort,
    sourceFetchedAt: source.fetchedAt,
    instructions: [
      'Assess each cited author-specific source and the stored text independently; the stored pair may not be the original decision pair.',
      'Do not infer person identity from a same-name publication byline or an ORCID profile alone.',
      'Record source date, author attribution, all distinct affiliation segments, and whether the source proves currentness.',
      'Keep institution-only clearance, person identity, extra-affiliation COI, and final selectability as separate labels.',
      'Use unknown when original source, author attribution, timing, or recorded institution cannot be established.',
      'No case in this packet is pre-approved for automatic selection or a durable write.',
    ],
    cases: selected.map((row) => ({
      caseId: row.caseId,
      candidateName: row.candidateName,
      storedCandidateAffiliation: row.storedCandidateAffiliation,
      storedSuggestedInstitution: row.storedSuggestedInstitution,
      storedAffiliationSource: row.storedAffiliationSource,
      sourceKind: row.sourceKind,
      retainedProfileUrl: row.retainedProfileUrl,
      sourceRecords: row.sourceRecords,
      labels: row.labels,
    })),
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(OUTPUT, 0o600);
  console.log(JSON.stringify({ output: OUTPUT, selected: selected.length, bySamplingBucket }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error?.code || error?.name || 'queue selection failed');
    process.exitCode = 1;
  }
}

module.exports = { replayBucket, selectCases };

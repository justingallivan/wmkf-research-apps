#!/usr/bin/env node
/**
 * Schema lint for the falsification-suite case files. Build QA only — reads
 * fixture JSONL, checks structure, prints per-file and per-decision counts.
 * Touches NO matching code, so running it does not violate the owner's
 * build-don't-execute decision.
 */

const { loadCases, ADAPTER_BY_KIND } = require('./run');

const DECISIONS = new Set(['institution', 'person', 'affiliation', 'contact', 'authorship']);
const OUTCOMES = new Set(['resolved', 'review', 'unresolved']);
const ORIGINS = new Set(['real', 'synthetic']);
const LABEL_STATUSES = new Set(['verified', 'assumed']);

// Tracked fixtures must not contain real deliverable addresses. Allowed email
// shapes: structural placeholders (<...>) and reserved example domains.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SAFE_EMAIL_RE = /@([A-Za-z0-9.-]+\.)?(example\.(com|org|net|edu)|[A-Za-z0-9-]+\.example\.(com|org|net|edu)|example-university\.edu|university-a\.example\.edu)$/;

function main() {
  const cases = loadCases();
  const problems = [];
  const seen = new Set();
  const byDecision = {};
  const byFile = {};
  const byOrigin = { real: 0, synthetic: 0 };
  const assumed = [];

  for (const c of cases) {
    const where = `${c._file} → ${c.id ?? '<no id>'}`;
    if (!c.id) problems.push(`${where}: missing id`);
    else if (seen.has(c.id)) problems.push(`${where}: duplicate id`);
    else seen.add(c.id);

    if (!DECISIONS.has(c.decision)) problems.push(`${where}: bad decision "${c.decision}"`);
    if (!(c.kind in ADAPTER_BY_KIND)) problems.push(`${where}: kind "${c.kind}" has no adapter mapping`);
    if (!ORIGINS.has(c.origin)) problems.push(`${where}: bad origin "${c.origin}"`);
    if (!LABEL_STATUSES.has(c.label_status)) problems.push(`${where}: bad label_status "${c.label_status}"`);
    if (!c.source) problems.push(`${where}: missing source provenance`);
    if (!c.input || typeof c.input !== 'object') problems.push(`${where}: missing input`);
    if (!c.expected || !OUTCOMES.has(c.expected.outcome)) problems.push(`${where}: expected.outcome must be one of ${[...OUTCOMES]}`);
    if (c.origin === 'real' && !/\.md|SESSION_PROMPT|wiki/.test(c.source)) {
      problems.push(`${where}: origin "real" requires a repo-doc source citation`);
    }

    const raw = JSON.stringify(c);
    for (const email of raw.match(EMAIL_RE) ?? []) {
      if (!SAFE_EMAIL_RE.test(email)) problems.push(`${where}: non-placeholder email "${email}" in tracked fixture`);
    }

    byDecision[c.decision] = (byDecision[c.decision] ?? 0) + 1;
    byFile[c._file] = (byFile[c._file] ?? 0) + 1;
    byOrigin[c.origin] = (byOrigin[c.origin] ?? 0) + 1;
    if (c.label_status === 'assumed') assumed.push(c.id);
  }

  console.log(`cases: ${cases.length} total`);
  for (const [file, count] of Object.entries(byFile)) console.log(`  ${file}: ${count}`);
  console.log(`by decision: ${JSON.stringify(byDecision)}`);
  console.log(`by origin: ${JSON.stringify(byOrigin)}`);
  console.log(`assumed-label (owner-adjudication) cases: ${assumed.length ? assumed.join(', ') : 'none'}`);

  if (cases.length < 150) {
    console.log(`NOTE: ${cases.length} < 150 — below the consensus floor; regenerate with --full or add cases.`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('schema OK');
}

main();

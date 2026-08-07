#!/usr/bin/env node
/**
 * Deterministic generator for the UC-system adversarial matrix
 * (fuzzy-matching falsification suite, consensus §1 step 0).
 *
 * Emits JSONL to cases/institution-uc-matrix.jsonl. Deterministic: same
 * input table → byte-identical output, so the generated file is tracked and
 * reviewable like hand-written fixtures.
 *
 * Default emission samples 2 siblings per campus (cyclic neighbors) for the
 * substitution families; `--full` emits the complete 9-sibling cross product.
 * The README records both denominators.
 *
 * Entity policy under test (docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
 * "UC system falsification test bed"):
 *   - the UC system is distinct from every campus; campuses are distinct from siblings
 *   - parent-only evidence must never silently become a campus
 *   - campus assignment requires campus evidence; contradictory evidence → review
 *
 * ror_id is intentionally null everywhere: populating it belongs to the
 * pinned-ROR-dump work (consensus step 2), and guessing IDs here would be a
 * fabricated-value hazard.
 */

const fs = require('fs');
const path = require('path');

// Hand-curated, well-known campus facts. This table is the authority for the
// generated cases — no network fetch, no ROR dump (not yet authorized).
const SYSTEM = {
  key: 'uc-system',
  name: 'University of California',
  short: 'UC system',
  city: 'Oakland',
  domain: 'universityofcalifornia.edu',
};

const CAMPUSES = [
  { key: 'berkeley', name: 'University of California, Berkeley', short: 'UC Berkeley', acronym: null, city: 'Berkeley', domain: 'berkeley.edu' },
  { key: 'ucla', name: 'University of California, Los Angeles', short: 'UC Los Angeles', acronym: 'UCLA', city: 'Los Angeles', domain: 'ucla.edu' },
  { key: 'ucsd', name: 'University of California, San Diego', short: 'UC San Diego', acronym: 'UCSD', city: 'La Jolla', domain: 'ucsd.edu' },
  { key: 'ucsf', name: 'University of California, San Francisco', short: 'UC San Francisco', acronym: 'UCSF', city: 'San Francisco', domain: 'ucsf.edu' },
  { key: 'davis', name: 'University of California, Davis', short: 'UC Davis', acronym: null, city: 'Davis', domain: 'ucdavis.edu' },
  { key: 'irvine', name: 'University of California, Irvine', short: 'UC Irvine', acronym: 'UCI', city: 'Irvine', domain: 'uci.edu' },
  { key: 'ucsb', name: 'University of California, Santa Barbara', short: 'UC Santa Barbara', acronym: 'UCSB', city: 'Santa Barbara', domain: 'ucsb.edu' },
  { key: 'ucsc', name: 'University of California, Santa Cruz', short: 'UC Santa Cruz', acronym: 'UCSC', city: 'Santa Cruz', domain: 'ucsc.edu' },
  { key: 'ucr', name: 'University of California, Riverside', short: 'UC Riverside', acronym: 'UCR', city: 'Riverside', domain: 'ucr.edu' },
  { key: 'merced', name: 'University of California, Merced', short: 'UC Merced', acronym: null, city: 'Merced', domain: 'ucmerced.edu' },
];

// Real non-UC institutions that string-similarity confuses with UC entities.
// Touro is the documented live ROR-ranking failure (Codex probe, 2026-08-04).
const DISTRACTORS = [
  { input: 'Touro University California', target: 'Touro University California', note: 'ROR affiliation-match ranked this ABOVE the UC system for "University of California" (live probe 2026-08-04). Must resolve to Touro, never any UC entity.' },
  { input: 'Touro University California, Vallejo, CA, USA', target: 'Touro University California', note: 'Decorated Touro byline; never UC.' },
  { input: 'California State University, Los Angeles', target: 'California State University, Los Angeles', note: 'CSU sibling-namespace distractor; never UCLA.' },
  { input: 'University of Southern California', target: 'University of Southern California', note: 'USC is not a UC entity despite maximal token overlap with the system name.' },
  { input: 'San Diego State University', target: 'San Diego State University', note: 'Shares city and "San Diego University" tokens with UCSD; never UC San Diego.' },
];

function siblingsOf(campus, all, count) {
  const i = all.findIndex((c) => c.key === campus.key);
  const out = [];
  for (let step = 1; out.length < count; step += 1) {
    out.push(all[(i + step) % all.length]);
  }
  return out;
}

function makeCase(id, family, input, expected, note) {
  return {
    id,
    decision: 'institution',
    kind: input.kind,
    family,
    origin: 'synthetic',
    source: 'benchmarks/fuzzy-matching-falsification/generate-uc-matrix.js',
    label_status: 'verified', // policy-derived label; the policy table is owner-endorsed research
    input: { affiliation_string: input.string, domain_evidence: input.domainEvidence ?? null },
    expected,
    note: note ?? null,
  };
}

function resolvedTo(name) {
  return { outcome: 'resolved', target: { name, ror_id: null }, must_not_resolve_to: [] };
}

function reviewNever(names, note) {
  return { outcome: 'review', target: null, must_not_resolve_to: names, note };
}

function generate({ full }) {
  const cases = [];
  let n = 0;
  const id = (slug) => `inst-uc-${String((n += 1)).padStart(3, '0')}-${slug}`;

  // Family 1: positive resolution forms per campus.
  for (const c of CAMPUSES) {
    cases.push(makeCase(id(`${c.key}-official`), 'uc-positive',
      { kind: 'resolve', string: c.name },
      resolvedTo(c.name)));
    cases.push(makeCase(id(`${c.key}-short`), 'uc-positive',
      { kind: 'resolve', string: c.short },
      resolvedTo(c.name)));
    if (c.acronym) {
      cases.push(makeCase(id(`${c.key}-acronym`), 'uc-positive',
        { kind: 'resolve', string: c.acronym },
        resolvedTo(c.name),
        'Exact acronym must retrieve the campus (ROR affiliation API returned NOTHING for "UCSD" — live probe 2026-08-04).'));
    }
    cases.push(makeCase(id(`${c.key}-punct`), 'uc-positive',
      { kind: 'resolve', string: c.short.replace(/^UC /, 'U.C. ') },
      resolvedTo(c.name),
      'Punctuation variant must survive normalization.'));
    cases.push(makeCase(id(`${c.key}-byline`), 'uc-positive',
      { kind: 'resolve', string: `Department of Chemistry, ${c.name}, ${c.city}, California, USA` },
      resolvedTo(c.name),
      'Decorated byline: campus must survive parsing (S400 failure class 1: decorated strings got zero provider results).'));
  }

  // Families 2–4: sibling substitution matrix. Negative evidence must matter.
  for (const c of CAMPUSES) {
    const sibs = siblingsOf(c, CAMPUSES, full ? CAMPUSES.length - 1 : 2);
    for (const s of sibs) {
      const sMark = s.acronym ?? s.short;
      cases.push(makeCase(id(`${c.key}-sib-acr-${s.key}`), 'uc-sibling-acronym',
        { kind: 'resolve', string: `${c.name} (${sMark})` },
        reviewNever([c.name, s.name], 'Name of one campus with a sibling\'s acronym appended: contradictory; never auto-resolve either sibling.')));
      cases.push(makeCase(id(`${c.key}-sib-city-${s.key}`), 'uc-sibling-city',
        { kind: 'resolve', string: `Department of Physics, ${c.short}, ${s.city}, California, USA` },
        reviewNever([c.name, s.name], 'Campus name with a sibling\'s city: contradictory location evidence; never auto-resolve either sibling.')));
      cases.push(makeCase(id(`${c.key}-sib-dom-${s.key}`), 'uc-sibling-domain',
        { kind: 'resolve', string: c.short, domainEvidence: s.domain },
        reviewNever([c.name, s.name], 'Campus string with a sibling\'s domain evidence: contradictory; never auto-resolve either sibling.')));
    }
  }

  // Family 5: parent/system policy.
  cases.push(makeCase(id('system-bare'), 'uc-parent',
    { kind: 'resolve', string: 'University of California' },
    { outcome: 'review', target: { name: SYSTEM.name, ror_id: null }, must_not_resolve_to: CAMPUSES.map((c) => c.name), note: 'System-level output OR ambiguous-by-policy; NEVER a campus guess.' },
    'Parent-only evidence must never silently become a campus (AffRo/OpenAlex policy; consensus §1 step 2).'));
  cases.push(makeCase(id('system-uop'), 'uc-parent',
    { kind: 'resolve', string: 'University of California, Office of the President' },
    { outcome: 'resolved', target: { name: SYSTEM.name, ror_id: null }, must_not_resolve_to: CAMPUSES.map((c) => c.name) }));
  cases.push(makeCase(id('system-word'), 'uc-parent',
    { kind: 'resolve', string: 'University of California system' },
    { outcome: 'resolved', target: { name: SYSTEM.name, ror_id: null }, must_not_resolve_to: CAMPUSES.map((c) => c.name) }));

  // Family 6: parent name + mixed sibling evidence (Codex minimum-case table row 8).
  const mixes = full ? CAMPUSES.length : 5;
  for (let i = 0; i < mixes; i += 1) {
    const s1 = CAMPUSES[i % CAMPUSES.length];
    const s2 = CAMPUSES[(i + 3) % CAMPUSES.length];
    const mark = s2.acronym ?? s2.short;
    cases.push(makeCase(id(`mixed-${s1.key}-${s2.key}`), 'uc-parent-mixed',
      { kind: 'resolve', string: `University of California, ${s1.city} (${mark})` },
      reviewNever([SYSTEM.name, s1.name, s2.name], 'Parent name plus one sibling\'s city and another\'s acronym: ambiguous/contradictory.')));
  }

  // Family 7: non-UC distractors.
  for (const d of DISTRACTORS) {
    cases.push(makeCase(id(`distractor-${d.target.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 24)}`), 'uc-distractor',
      { kind: 'resolve', string: d.input },
      { outcome: 'resolved', target: { name: d.target, ror_id: null }, must_not_resolve_to: [SYSTEM.name, ...CAMPUSES.map((c) => c.name)] },
      d.note));
  }

  return cases;
}

function main() {
  const full = process.argv.includes('--full');
  const cases = generate({ full });
  const outPath = path.join(__dirname, 'cases', 'institution-uc-matrix.jsonl');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  const fullCount = generate({ full: true }).length;
  console.log(`wrote ${cases.length} cases to ${outPath} (${full ? 'FULL matrix' : `sampled; full matrix would be ${fullCount}`})`);
}

if (require.main === module) main();
module.exports = { generate, CAMPUSES, SYSTEM };

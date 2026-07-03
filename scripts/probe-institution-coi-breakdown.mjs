#!/usr/bin/env node
/**
 * READ-ONLY: size and classify the institution-COI flagged population in the
 * reviewer Find roster, to measure how exposed the Contract-5 hard drop is to
 * OpenAlex affiliation mis-maps (the candidate-level analog of the S320/S321
 * email domain-contradiction finding — see docs/REVIEWER_GATING_STRATEGY_REDESIGN.md §5).
 *
 * What it can and cannot see:
 *   - CAN: roster rows flagged hasInstitutionCOI (displayed then save-rejected or
 *     never selected) with the matcher's own {piInstitution, reviewerInstitution}.
 *   - CAN: cross-signal disagreement (ORCID vs OpenAlex vs discovery affiliation)
 *     as a mis-map proxy across the whole roster population.
 *   - CAN after Contract 5 Phase A: discovery-time hard drops recorded as
 *     reviewer_find_roster.status='coi_dropped'.
 *
 * Postgres is read-only; no Dynamics calls needed.
 * Usage: node scripts/probe-institution-coi-breakdown.mjs [days=120]
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;
const DAYS = Number(process.argv[2] || 120);
const sinceIso = new Date(Date.now() - DAYS * 86400_000).toISOString();

const { DeduplicationService } = await import('../lib/services/deduplication-service.js');
const { sql } = await import('@vercel/postgres');
const M = (a, b) => DeduplicationService.institutionsMatchForCOI(a, b);

const res = await sql.query(
  `SELECT request_id, display_name, status, source_kind, candidate FROM reviewer_find_roster WHERE first_seen_at >= $1`,
  [sinceIso]
);

let total = 0, coiFlagged = 0, coiFlaggedVisible = 0, coiDropped = 0;
const coiRows = [], coiDropRows = [], disagree = [], openalexPinned = [];
for (const row of res.rows) {
  total++;
  const c = row.candidate || {}; const enr = c.contactEnrichment || {};
  const orcidAff = enr.orcidAffiliation || null;
  const oaAff = enr.openAlexAffiliation || null;
  const affSource = enr.affiliationSource || null;
  const aff = c.affiliation || enr.affiliation || null;

  // Mis-map proxy across the whole population: OpenAlex-pinned affiliation that
  // an independent ORCID-current affiliation contradicts.
  if (affSource === 'openalex_current') {
    openalexPinned.push(row.display_name);
    if (orcidAff && !M(orcidAff, oaAff || aff)) {
      disagree.push({ name: row.display_name, orcidAff, oaAff: oaAff || aff });
    }
  }

  if (row.status === 'coi_dropped') {
    coiDropped++;
    const det = c.institutionCOIDetails || {};
    coiDropRows.push({
      name: row.display_name,
      sourceKind: row.source_kind,
      pi: det.piInstitution || null,
      revInst: det.reviewerInstitution || c.affiliation || null,
      matchSource: det.matchSource || null,
      dropStage: det.dropStage || null,
      decision: det.dropDecision || 'dropped',
      reason: det.corroborationReason || null,
      matchedSource: det.matchedAffiliationSource || null,
      contradictedBy: det.contradictoryAffiliationSource || null,
    });
  }

  if (!c.hasInstitutionCOI) continue;
  coiFlagged++;
  if (row.status !== 'coi_dropped') coiFlaggedVisible++;
  const det = c.institutionCOIDetails || {};
  const pi = det.piInstitution || null;
  const revInst = det.reviewerInstitution || null;
  // Corroboration check: does ANY independent signal also match the PI institution?
  const signals = { orcid: orcidAff, openalex: oaAff, discovery: c.affiliation || null };
  const agreeing = Object.entries(signals).filter(([, v]) => v && pi && M(v, pi)).map(([k]) => k);
  const present = Object.entries(signals).filter(([, v]) => v).map(([k]) => k);
  coiRows.push({
    name: row.display_name, sourceKind: row.source_kind, pi, revInst,
    affSource, present, agreeing,
    status: row.status,
    decision: det.dropDecision || null,
    reason: det.corroborationReason || null,
    matchedSource: det.matchedAffiliationSource || null,
    contradictedBy: det.contradictoryAffiliationSource || null,
    singleSource: agreeing.length <= 1 && present.length <= 1,
    contradicted: present.length > 1 && agreeing.length < present.length,
  });
}

console.log(`Window: last ${DAYS}d (since ${sinceIso.slice(0, 10)})`);
console.log(`Roster candidates: ${total}; visible hasInstitutionCOI flagged: ${coiFlaggedVisible}; all hasInstitutionCOI blobs: ${coiFlagged}; discovery COI drop ledger: ${coiDropped}`);
console.log(`OpenAlex-pinned affiliations: ${openalexPinned.length}; ORCID-contradicted (mis-map proxy): ${disagree.length}`);
if (disagree.length) {
  console.log('\nORCID-vs-OpenAlex affiliation disagreements (mis-map proxy cases):');
  for (const d of disagree.slice(0, 15)) console.log(`  - ${d.name}: orcid="${d.orcidAff}" vs openalex="${d.oaAff}"`);
}
if (coiDropRows.length) {
  console.log('\nDiscovery-time COI drop ledger rows:');
  for (const r of coiDropRows) {
    console.log(`  - ${r.name} [${r.sourceKind || '?'}] matched PI="${r.pi}" via reviewerInst="${r.revInst}" (decision=${r.decision}; reason=${r.reason || 'n/a'}; matchedSource=${r.matchedSource || 'n/a'}; contradictedBy=${r.contradictedBy || 'n/a'}; stage=${r.dropStage || 'n/a'}; source=${r.matchSource || 'n/a'})`);
  }
}
if (coiRows.length) {
  console.log('\nCOI-flagged rows (affiliation-signal corroboration):');
  for (const r of coiRows) {
    console.log(`  - ${r.name} [${r.status}/${r.sourceKind || '?'}] matched PI="${r.pi}" via reviewerInst="${r.revInst}" (decision=${r.decision || 'n/a'}; reason=${r.reason || 'n/a'}; matchedSource=${r.matchedSource || r.affSource || 'n/a'}; contradictedBy=${r.contradictedBy || 'n/a'}; signals present=${r.present.join('/') || 'none'}; agreeing=${r.agreeing.join('/') || 'none'})${r.contradicted ? '  ⚠ CONTRADICTED' : ''}${r.singleSource ? '  ⚠ SINGLE-SOURCE' : ''}`);
  }
}

// ---- Offline matcher false-positive suite (no data needed) ------------------
const DISTINCT_PAIRS = [
  ['University of California, San Francisco', 'University of California, Berkeley'],
  ['University of Maryland', 'University of Maryland, Baltimore County'],
  ['University of Michigan', 'Michigan State University'],
  ['Indiana University', 'Indiana University of Pennsylvania'],
  ['California University of Pennsylvania', 'University of Pennsylvania'],
  ['Miami University', 'University of Miami'],
  ['University of Washington', 'Washington University in St. Louis'],
  ['New York University', 'City University of New York'],
  ['Columbia University', 'University of British Columbia'],
  ['University of Texas at Austin', 'University of Texas at Dallas'],
];
const SAME_PAIRS = [
  ['MIT', 'Massachusetts Institute of Technology'],
  ['University of Michigan, Ann Arbor', 'University of Michigan'],
  ['Dept of Chemistry, Stanford University', 'Stanford University'],
];
console.log('\nMatcher offline suite — DISTINCT institutions that MATCH = false positive:');
let fp = 0;
for (const [a, b] of DISTINCT_PAIRS) { const hit = M(a, b); if (hit) fp++; console.log(`  ${hit ? '✗ FALSE-POSITIVE' : '✓ distinct'}: "${a}" vs "${b}"`); }
let fn = 0;
console.log('Matcher offline suite — SAME institution that MISSES = false negative:');
for (const [a, b] of SAME_PAIRS) { const hit = M(a, b); if (!hit) fn++; console.log(`  ${hit ? '✓ match' : '✗ MISS'}: "${a}" vs "${b}"`); }
console.log(`\nSummary: ${fp}/${DISTINCT_PAIRS.length} false positives, ${fn}/${SAME_PAIRS.length} false negatives in the curated suite.`);
process.exit(0);

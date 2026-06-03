#!/usr/bin/env node
/**
 * READ-ONLY smoke of the Phase 2 PR1 identity resolver against REAL candidates.
 * Runs ContactEnrichmentService.enrichCandidate with persist:false (side-effect
 * free — no Dataverse writes) and prints, for each candidate:
 *   - the Scholar tier result (scholarId, displayName, nameMismatch, instMismatch)
 *   - the ORCID tier result (status, orcidId)  [only if ORCID creds present]
 *   - the resolver verdict (status, band, evidenceSummary, anchors/rejectedAnchors)
 *   - the gate the write paths would apply (blockByIdentity / blockScholar) and
 *     which identity-bearing fields would be persisted vs nulled.
 *
 * No writes anywhere. Costs SerpAPI (1 Scholar lookup/candidate) + ORCID (free)
 * + optional Claude web-search.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const { ContactEnrichmentService } = await import('../lib/services/contact-enrichment-service.js');
const { mayPersistIdentity, RESOLVER_SOURCED_FIELDS } = await import('../lib/services/reviewer-identity-resolver.js');

const hasOrcid = !!(process.env.ORCID_CLIENT_ID && process.env.ORCID_CLIENT_SECRET);
console.log(`ORCID creds: ${hasOrcid ? 'present' : 'MISSING (Scholar-only arms only)'}\n`);

// Real candidates pulled from req 1002788's saved/recommended set, plus a
// deliberately-common name to probe ORCID ambiguity (only meaningful w/ ORCID).
const candidates = [
  {
    name: 'Ram Madabhushi',
    affiliation: 'University of Texas Southwestern Medical Center, Dallas, TX',
    _note: 'real saved candidate (clean-match expectation; currently has Scholar h=15 persisted, NO identity decision)',
  },
  {
    name: 'Li-Huei Tsai',
    affiliation: 'Picower Institute for Learning and Memory, MIT, Cambridge, MA',
    _note: 'canonical false-match testbed (Tsai→lab-member). Scholar displayed-name guard should anchor-REJECT a mismatched profile.',
  },
  {
    name: 'Wei Zhang',
    affiliation: 'Department of Chemistry, Stanford University',
    _note: 'common-name ORCID-ambiguity probe (only meaningful with ORCID creds)',
  },
];

const credentials = {
  claudeApiKey: process.env.CLAUDE_API_KEY,
  orcidClientId: process.env.ORCID_CLIENT_ID,
  orcidClientSecret: process.env.ORCID_CLIENT_SECRET,
  serpApiKey: process.env.SERP_API_KEY,
};

for (const cand of candidates) {
  console.log('═'.repeat(82));
  console.log(`CANDIDATE: ${cand.name}  —  ${cand.affiliation}`);
  console.log(`  (${cand._note})`);
  let result;
  try {
    result = await ContactEnrichmentService.enrichCandidate(cand, {
      credentials,
      usePubmed: false,         // no publications array on hand; not needed for the verdict
      useOrcid: hasOrcid,
      useSerpSearch: true,      // drives the Scholar displayed-name guard
      useClaudeSearch: false,   // keep it cheap/deterministic
      persist: false,           // ← side-effect free
    });
  } catch (e) {
    console.log(`  ENRICH ERROR: ${e.message}`);
    continue;
  }
  const ce = result.contactEnrichment || {};
  const sp = ce.tierResults?.scholar_profile || null;
  const orcid = ce.tierResults?.orcid || null;
  const identity = ce.identity || null;

  console.log('\n  ── Scholar tier ──');
  if (sp) {
    console.log(`     scholarId=${sp.scholarId || '—'} displayName=${JSON.stringify(sp.scholarDisplayName || null)}`);
    console.log(`     nameMismatch=${!!sp.nameMismatch} institutionMismatch=${!!sp.institutionMismatch} skipped=${sp.skipped || '—'}`);
    console.log(`     url=${sp.scholarProfileUrl || ce.googleScholarUrl || '—'} h=${ce.hIndex ?? '—'} cites=${ce.totalCitations ?? '—'}`);
  } else {
    console.log('     (no scholar_profile tier result)');
  }

  console.log('\n  ── ORCID tier ──');
  console.log(orcid ? `     status=${orcid.status || '—'} orcidId=${orcid.orcidId || '—'} count=${orcid.candidateCount ?? '—'}` : '     (not run / no result)');

  console.log('\n  ── RESOLVER VERDICT ──');
  if (identity) {
    console.log(`     status=${identity.status}  band=${identity.confidenceBand || 'null'}  ver=${identity.resolverVersion}`);
    console.log(`     summary: ${identity.evidenceSummary}`);
    console.log(`     anchors(${identity.anchors.length}): ${identity.anchors.map((a) => `${a.type}[${a.verdict}]`).join(', ') || '—'}`);
    console.log(`     rejectedAnchors(${identity.rejectedAnchors.length}): ${identity.rejectedAnchors.map((a) => `${a.type}(${a.reason})`).join(', ') || '—'}`);
    if (identity.competitors?.length) console.log(`     competitors: ${JSON.stringify(identity.competitors)}`);

    // Replicate the exact write-path gate (enrich-recommended.js:238-248).
    const scholarSkipped = !!sp?.skipped;
    const blockByIdentity = !mayPersistIdentity(identity.status);
    const blockScholar = scholarSkipped || blockByIdentity;
    console.log('\n  ── WRITE GATE (what would persist) ──');
    console.log(`     mayPersist=${mayPersistIdentity(identity.status)} blockByIdentity=${blockByIdentity} blockScholar=${blockScholar}`);
    console.log(`     → scholar id/url/metrics: ${blockScholar ? 'BLOCKED (null)' : 'persisted'}`);
    console.log(`     → orcid id/url:           ${blockByIdentity ? 'BLOCKED (null)' : 'persisted'}`);
    console.log(`     → clearIdentityFields:    ${blockByIdentity ? `YES (nulls ${RESOLVER_SOURCED_FIELDS.length} fields)` : 'no'}`);
  } else {
    console.log('     (no identity verdict attached!)');
  }
  console.log('');
}
console.log('═'.repeat(82));
console.log('Done (read-only).');

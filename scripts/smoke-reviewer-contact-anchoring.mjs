#!/usr/bin/env node
/**
 * SMOKE BATTERY — reviewer contact-enrichment anchoring (S234, Fixes A–D +
 * Scholar-verified-domain validation). Read-only (persist:false): never writes
 * to Dataverse. Verifies the SHIPPED enrichment behavior end-to-end.
 *
 * Two layers:
 *   OFFLINE (deterministic, no network) — always runs:
 *     - `_validateEmailAgainstVerifiedDomain` decision matrix (match / clear
 *       contradiction / subdomain / boundary-not-substring / trusted-source /
 *       no-verified-domain).
 *     - the no-anchor ABSTAIN path (decided before any network call).
 *   LIVE (real ORCID + SerpAPI/Scholar) — runs when creds are present, else SKIP:
 *     - ORCID-anchored email RECOVERY (Smirnova → @mbi-berlin.de).
 *     - affiliation-anchored emails kept (Keller @ETH, Travers @Heriot-Watt).
 *     - invariants that must hold regardless of external drift (no namesake
 *       domain, no generic mailbox, anchored candidates never false-abstain,
 *       persist-flag coherence).
 *
 * Live assertions are split into INVARIANTS (hard FAIL) and BEST-EFFORT (WARN) so
 * normal external-search variance doesn't cry wolf; only a real regression fails.
 *
 *   node scripts/smoke-reviewer-contact-anchoring.mjs            # offline + live
 *   node scripts/smoke-reviewer-contact-anchoring.mjs --offline  # offline only (no creds/network)
 *   node scripts/smoke-reviewer-contact-anchoring.mjs --verbose  # dump each enrichment result
 *
 * Exit code is non-zero if any hard assertion FAILED.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
}

const OFFLINE_ONLY = process.argv.includes('--offline');
const VERBOSE = process.argv.includes('--verbose');

const { ContactEnrichmentService } = await import('../lib/services/contact-enrichment-service.js');

// --- tiny assert framework ----------------------------------------------------
const results = { pass: 0, fail: 0, warn: 0, skip: 0 };
const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[90m', off: '\x1b[0m' };
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ${C.ok}PASS${C.off} ${name}`); }
  else { results.fail++; console.log(`  ${C.bad}FAIL${C.off} ${name}${detail ? ` — ${detail}` : ''}`); }
}
function expect(name, cond, detail = '') { check(name, cond, detail); } // alias
function warnIf(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ${C.ok}PASS${C.off} ${name}`); }
  else { results.warn++; console.log(`  ${C.warn}WARN${C.off} ${name}${detail ? ` — ${detail}` : ''} (external variance; not a regression)`); }
}
function section(t) { console.log(`\n${C.dim}=== ${t} ===${C.off}`); }

const GENERIC = /@(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|proton|protonmail)\.[a-z.]+$/i;
const domainOf = (email) => (email && email.includes('@') ? email.split('@').pop().toLowerCase() : null);

// =============================================================================
// OFFLINE LAYER
// =============================================================================
section('OFFLINE — _validateEmailAgainstVerifiedDomain decision matrix');
function validate(email, verifiedInstitutionDomain, emailSource = 'serp_search') {
  const ce = {
    email, emailSource, emailPersistAllowed: true, verifiedInstitutionDomain,
    website: 'https://example.org/x', websiteSource: 'serp_search', websitePersistAllowed: true,
    facultyPageUrl: 'https://example.org/fac',
  };
  ContactEnrichmentService._validateEmailAgainstVerifiedDomain(ce);
  return ce;
}
{
  // Slice 1b: the verified domain is now the OpenAlex institution homepage registrable
  // domain (bare, e.g. mbiberlin.de) instead of Scholar's "Verified email at X" string.
  let ce = validate('olga.smirnova@mbi-berlin.de', 'mbiberlin.de');
  expect('hyphen-insensitive MATCH keeps email + sets persistAllowed (mbi-berlin ↔ mbiberlin)',
    ce.email === 'olga.smirnova@mbi-berlin.de' && ce.emailPersistAllowed === true);

  ce = validate('keller@phys.ethz.ch', 'ethz.ch');
  expect('subdomain MATCH keeps email (phys.ethz.ch ↔ ethz.ch)', ce.email === 'keller@phys.ethz.ch');

  ce = validate('olga.smirnova@metalab.ifmo.ru', 'mbiberlin.de');
  expect('clear CONTRADICTION drops a search-sourced namesake email (ifmo vs mbiberlin)',
    ce.email === null && ce.contactStatusReason === 'verified_domain_contradiction');

  ce = validate('prof@summit.edu', 'mit.edu');
  expect('boundary-only: summit.edu does NOT match mit.edu (dropped, not falsely kept)', ce.email === null);

  ce = validate('x@notred.ac.uk.evil', 'ed.ac.uk');
  expect('boundary-only: notred.ac.uk.evil does NOT match ed.ac.uk (dropped)', ce.email === null);

  ce = validate('olga@personal-domain.org', 'mbiberlin.de', 'orcid');
  expect('TRUSTED source (orcid) email survives a verified-domain mismatch', ce.email === 'olga@personal-domain.org' && ce.emailPersistAllowed === true);

  ce = validate('someone@unverifiable.edu', null);
  expect('NO verified domain → no-op, trust the scoped search', ce.email === 'someone@unverifiable.edu');
}

section('OFFLINE — no-anchor ABSTAIN (decided pre-network; no creds needed)');
{
  const out = await ContactEnrichmentService.enrichCandidate(
    { name: 'Smoke NoAnchor', orcid: null, affiliation: null, identityNote: 'keep me', publications: [{ title: 'x', year: 2023 }] },
    { credentials: {}, usePubmed: false, useOrcid: true, useClaudeSearch: true, useSerpSearch: true, persist: false },
  );
  const e = out.contactEnrichment || {};
  expect('no anchor → contactStatus unresolved', e.contactStatus === 'unresolved');
  expect('no anchor → reason identity_anchor_required', e.contactStatusReason === 'identity_anchor_required');
  expect('no anchor → email null, emailPersistAllowed false', e.email === null && e.emailPersistAllowed === false);
  expect('abstain preserves identity/publications', out.identityNote === 'keep me' && out.publications.length === 1);
}

// =============================================================================
// LIVE LAYER
// =============================================================================
const cred = {
  orcidClientId: process.env.ORCID_CLIENT_ID, orcidClientSecret: process.env.ORCID_CLIENT_SECRET,
  serpApiKey: process.env.SERP_API_KEY, claudeApiKey: process.env.ANTHROPIC_API_KEY,
};
const haveLive = !!(cred.serpApiKey && cred.orcidClientId && cred.orcidClientSecret);

if (OFFLINE_ONLY || !haveLive) {
  section('LIVE — SKIPPED');
  results.skip++;
  console.log(`  ${C.dim}${OFFLINE_ONLY ? '--offline flag set' : 'missing SERP_API_KEY / ORCID creds in .env.local'}${C.off}`);
} else {
  async function enrich(cand) {
    return ContactEnrichmentService.enrichCandidate(cand, {
      credentials: cred, usePubmed: false, useOrcid: true, useClaudeSearch: false, useSerpSearch: true, persist: false,
    });
  }

  section('LIVE — ORCID-anchored email RECOVERY (Olga Smirnova)');
  {
    const out = await enrich({ name: 'Olga Smirnova', orcid: '0000-0002-7746-5733', affiliation: null, publications: [] });
    const e = out.contactEnrichment || {};
    if (VERBOSE) console.log('   ', JSON.stringify({ email: e.email, persist: e.emailPersistAllowed, status: e.contactStatus, verifiedDomain: e.verifiedInstitutionDomain }));
    const dom = domainOf(e.email);
    // INVARIANTS
    expect('anchored candidate is not false-abstained', e.contactStatus !== 'unresolved');
    expect('email is NOT the ITMO namesake domain', !dom || !dom.includes('ifmo'));
    expect('email is NOT a generic mailbox', !e.email || !GENERIC.test(e.email));
    expect('email present ⇒ emailPersistAllowed coherent (true)', e.email == null || e.emailPersistAllowed === true);
    // BEST-EFFORT (the actual recovery)
    warnIf('RECOVERS her real Max-Born email (@mbi-berlin.de)', !!dom && dom.includes('mbi-berlin'), `got ${e.email ?? 'no email'}`);
  }

  section('LIVE — no-anchor ABSTAIN against real APIs (Yanjun Chen)');
  {
    const out = await enrich({ name: 'Yanjun Chen', orcid: null, affiliation: null, publications: [{ title: 'Coulomb time lag in strong-field tunneling ionization', year: 2022 }] });
    const e = out.contactEnrichment || {};
    if (VERBOSE) console.log('   ', JSON.stringify({ email: e.email, status: e.contactStatus }));
    expect('abstains: contactStatus unresolved', e.contactStatus === 'unresolved');
    expect('abstains: no email / no website / no h-index (no pianist)', e.email == null && e.website == null && e.hIndex == null);
  }

  section('LIVE — affiliation-anchored emails KEPT (Keller @ETH, Travers @Heriot-Watt)');
  for (const c of [
    { name: 'Ursula Keller', affiliation: 'ETH Zurich', want: 'ethz' },
    { name: 'John C. Travers', affiliation: 'Heriot-Watt University', want: 'hw' },
  ]) {
    const out = await enrich({ name: c.name, orcid: null, affiliation: c.affiliation, publications: [] });
    const e = out.contactEnrichment || {};
    if (VERBOSE) console.log(`    ${c.name}:`, JSON.stringify({ email: e.email, persist: e.emailPersistAllowed }));
    const dom = domainOf(e.email);
    expect(`${c.name}: anchored, not false-abstained`, e.contactStatus !== 'unresolved');
    expect(`${c.name}: any email is not generic and persist-coherent`, !e.email || (!GENERIC.test(e.email) && e.emailPersistAllowed === true));
    warnIf(`${c.name}: keeps a real institutional email (~${c.want})`, !!dom && dom.includes(c.want), `got ${e.email ?? 'no email'}`);
  }
}

// --- summary ------------------------------------------------------------------
section('SUMMARY');
console.log(`  ${C.ok}${results.pass} pass${C.off}, ${results.fail ? C.bad : ''}${results.fail} fail${C.off}, ${C.warn}${results.warn} warn${C.off}, ${results.skip} skip-group`);
if (results.fail > 0) { console.log(`\n  ${C.bad}SMOKE FAILED${C.off} — ${results.fail} hard assertion(s) failed.`); process.exit(1); }
console.log(`\n  ${C.ok}SMOKE OK${C.off}${results.warn ? ` (${results.warn} best-effort warning(s) — external variance, review if persistent)` : ''}`);
process.exit(0);

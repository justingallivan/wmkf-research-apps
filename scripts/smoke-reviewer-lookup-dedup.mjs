#!/usr/bin/env node
/**
 * SMOKE — Reviewer manual-add cross-store dedup LOOKUP (S237).
 *
 * End-to-end, READ-ONLY verification of the new dedup read path against LIVE
 * Dataverse: the candidate adapters (findBy{Email,Orcid}Candidates, searchByName,
 * findByContactId) and the lookupReviewerIdentity orchestration that backs
 * /api/workbench/reviewer-lookup. NEVER writes (the manual-reviewer create/link
 * path is unit-tested; a write smoke would leave an un-deletable contact in prod).
 *
 * Strategy: DISCOVER real subjects from live data (a reviewer with an email, one
 * with an ORCID, one linked to a contact), then assert the matching logic returns
 * the right person / a valid outcome shape. Subjects vary by environment, so
 * missing-subject cases WARN (skip) rather than FAIL.
 *
 *   node scripts/smoke-reviewer-lookup-dedup.mjs [--verbose]
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

const VERBOSE = process.argv.includes('--verbose');
const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[90m', off: '\x1b[0m' };
const results = { pass: 0, fail: 0, warn: 0 };
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ${C.ok}PASS${C.off} ${name}`); }
  else { results.fail++; console.log(`  ${C.bad}FAIL${C.off} ${name}${detail ? ` — ${detail}` : ''}`); }
}
function warnSkip(name, detail = '') {
  results.warn++; console.log(`  ${C.warn}SKIP${C.off} ${name}${detail ? ` — ${detail}` : ''}`);
}
const log = (...a) => VERBOSE && console.log(C.dim, ...a, C.off);

const VALID_OUTCOMES = new Set(['confident', 'candidates', 'conflict', 'none']);

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const pr = await import('../lib/dataverse/adapters/potential-reviewer.js');
const contact = await import('../lib/dataverse/adapters/contact.js');

// Orchestration core, now a pure lib service (auth-free) — imports cleanly here.
const { lookupReviewerIdentity } = await import('../lib/services/reviewer-identity-lookup.js');

await bypassDynamicsRestrictions('smoke-reviewer-lookup-dedup', async () => {
  // --- Discover subjects from live data --------------------------------------
  const { records: pool } = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
    select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_firstname,wmkf_lastname,wmkf_emailaddress,wmkf_orcid,_wmkf_contact_value',
    filter: 'wmkf_emailaddress ne null',
    top: 50,
  });
  console.log(`\n${C.dim}Discovered ${pool.length} reviewer rows with an email to draw subjects from.${C.off}`);

  const subjEmail = pool.find((p) => p.wmkf_emailaddress && p.wmkf_name);
  const subjOrcid = pool.find((p) => p.wmkf_orcid && p.wmkf_name);
  // Contact-linked reviewers are rare (only the promoted subset), so target them
  // directly rather than hope one lands in the emailed sample above.
  let subjLinked = pool.find((p) => p._wmkf_contact_value && p.wmkf_name);
  if (!subjLinked) {
    const { records: linked } = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
      select: 'wmkf_potentialreviewersid,wmkf_name,_wmkf_contact_value',
      filter: '_wmkf_contact_value ne null',
      top: 1,
    });
    subjLinked = linked[0] || null;
  }

  // ============================ Adapter helpers ==============================
  console.log('\n=== Adapter helpers (live, read-only) ===');

  if (subjEmail) {
    const r = await pr.findByEmailCandidates(subjEmail.wmkf_emailaddress);
    log('findByEmailCandidates →', JSON.stringify(r).slice(0, 200));
    const found = r.one ? r.id : (r.ambiguous ? (r.rows || []).map((x) => x.wmkf_potentialreviewersid) : []);
    const hit = r.one ? r.id === subjEmail.wmkf_potentialreviewersid : (Array.isArray(found) && found.includes(subjEmail.wmkf_potentialreviewersid));
    check('pr.findByEmailCandidates finds the subject by their own email', hit, `got ${JSON.stringify(found)}`);
    check('  → result is a valid shape {one|ambiguous|none}', !!(r.one || r.ambiguous || r.none));
  } else warnSkip('pr.findByEmailCandidates — no emailed subject');

  if (subjOrcid) {
    const r = await pr.findByOrcidCandidates(subjOrcid.wmkf_orcid);
    log('findByOrcidCandidates →', JSON.stringify(r).slice(0, 200));
    const hit = r.one ? r.id === subjOrcid.wmkf_potentialreviewersid
      : (r.ambiguous ? (r.rows || []).some((x) => x.wmkf_potentialreviewersid === subjOrcid.wmkf_potentialreviewersid) : false);
    check('pr.findByOrcidCandidates finds the subject by their own ORCID', hit);
  } else warnSkip('pr.findByOrcidCandidates — no ORCID-bearing subject');

  if (subjEmail) {
    const rows = await pr.searchByName(subjEmail.wmkf_name, { top: 5 });
    log('searchByName →', rows.map((x) => x.wmkf_name));
    check('pr.searchByName returns an array', Array.isArray(rows));
    check('pr.searchByName surfaces the subject for their own name',
      rows.some((x) => x.wmkf_potentialreviewersid === subjEmail.wmkf_potentialreviewersid),
      `name "${subjEmail.wmkf_name}" → ${rows.length} rows`);
  }

  if (subjLinked) {
    const rev = await pr.findByContactId(subjLinked._wmkf_contact_value);
    log('findByContactId →', rev && rev.wmkf_potentialreviewersid);
    check('pr.findByContactId reverse-resolves the linked reviewer',
      !!rev && rev.wmkf_potentialreviewersid === subjLinked.wmkf_potentialreviewersid);
    // And the contact side resolves by id
    const c = await contact.getById(subjLinked._wmkf_contact_value).catch(() => null);
    check('contact.getById resolves the linked contact', !!c && c.contactid === subjLinked._wmkf_contact_value);
  } else warnSkip('pr.findByContactId — no contact-linked subject in sample');

  const none = await pr.findByEmailCandidates('nobody-zzqx-smoke@nowhere.invalid');
  check('pr.findByEmailCandidates returns {none} for a non-existent email', !!none.none);

  // ============================ Orchestration ================================
  if (lookupReviewerIdentity) {
    console.log('\n=== lookupReviewerIdentity orchestration (live, read-only) ===');

    const assertOutcome = async (label, input, expectOneOf, subjectId) => {
      const out = await lookupReviewerIdentity(input);
      log(label, '→', JSON.stringify(out).slice(0, 240));
      check(`${label}: returns a valid outcome`, VALID_OUTCOMES.has(out?.outcome), `got ${out?.outcome}`);
      check(`${label}: outcome ∈ {${expectOneOf.join(',')}}`, expectOneOf.includes(out?.outcome), `got ${out?.outcome}`);
      if (subjectId && out?.outcome === 'confident') {
        check(`${label}: confident match is the subject`, out.match?.reviewerId === subjectId);
      } else if (subjectId && out?.outcome === 'candidates') {
        check(`${label}: subject appears among candidates`,
          (out.candidates || []).some((c) => c.reviewerId === subjectId),
          'expected subject in candidates');
      }
      return out;
    };

    if (subjEmail) {
      await assertOutcome(
        'lookup by name+email (own record)',
        { name: subjEmail.wmkf_name, email: subjEmail.wmkf_emailaddress, orcid: null },
        ['confident', 'candidates'],
        subjEmail.wmkf_potentialreviewersid,
      );
    }
    if (subjOrcid) {
      await assertOutcome(
        'lookup by name+ORCID (own record)',
        { name: subjOrcid.wmkf_name, email: null, orcid: subjOrcid.wmkf_orcid },
        ['confident', 'candidates', 'conflict'],
        subjOrcid.wmkf_potentialreviewersid,
      );
    }
    await assertOutcome(
      'lookup for a non-existent person',
      { name: 'Zzqxby Notreal-Smoke', email: 'zzqx-smoke@nowhere.invalid', orcid: null },
      ['none'],
    );
    if (subjEmail?.wmkf_lastname) {
      await assertOutcome(
        'lookup by last-name only (no key)',
        { name: subjEmail.wmkf_lastname, email: null, orcid: null },
        ['candidates', 'none'],
      );
    }
  }
});

console.log(`\n${results.fail ? C.bad : C.ok}=== ${results.pass} pass · ${results.fail} fail · ${results.warn} skip ===${C.off}`);
process.exit(results.fail ? 1 : 0);

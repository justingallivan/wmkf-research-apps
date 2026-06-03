#!/usr/bin/env node
/**
 * READ-ONLY measurement (S215): of the live reviewer pool, how many resolve to an
 * UNAMBIGUOUS ORCID iD via the real name-scored matcher — and of those, how many
 * are institution-corroborated (safe to treat as authoritative) vs lone name-only
 * (the common-name risk). Informs the "should we capture lone ORCIDs?" decision.
 *
 * For each person in wmkf_potentialreviewerses it calls ORCIDService.searchByName
 * (one ORCID call/reviewer) and classifies with the SAME primitives findContact
 * uses (_nameMatchesTarget, extractInstitutionName), so the numbers mirror prod:
 *   - resolved        : exactly one distinct name-matching ORCID iD
 *       · corroborated : that record's institution contains the reviewer's affiliation token
 *       · lone         : name-match only, institution not corroborated (or no inst data)
 *   - ambiguous       : >1 distinct name-matching ORCID iDs (findContact would abstain)
 *   - none            : 0 results or 0 name matches
 *   - error           : ORCID call failed
 * Also cross-checks against any already-persisted wmkf_orcid.
 *
 * STRICTLY READ-ONLY. No Dataverse writes. ORCID public API is free; throttled.
 *   node scripts/measure-orcid-resolution-rate.js [--limit N]
 * Output: console summary + scripts/.orcid-resolution.jsonl (gitignored).
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const sampleArg = process.argv.indexOf('--sample');
const SAMPLE = sampleArg !== -1 ? parseInt(process.argv[sampleArg + 1], 10) : null;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { ORCIDService } = await import('../lib/services/orcid-service.js');
const { ContactParser } = await import('../lib/utils/contact-parser.js');

const cid = process.env.ORCID_CLIENT_ID, cs = process.env.ORCID_CLIENT_SECRET;
if (!cid || !cs) { console.error('ORCID creds missing — aborting.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mirror findContact's classification from one searchByName result set —
 *  including narrowing by affiliation BEFORE counting distinct IDs (matches
 *  orcid-service.js:298, so ambiguity isn't overstated on same-name records). */
function classify(results, name, affiliation) {
  if (!results.length) return { status: 'none', reason: 'no_results' };
  let pool = results.filter((r) => ORCIDService._nameMatchesTarget(r, name));
  if (!pool.length) return { status: 'none', reason: 'no_name_match' };
  const affToken = affiliation
    ? ContactParser.normalizeNameForMatch(ORCIDService.extractInstitutionName(affiliation) || '') : '';
  if (pool.length > 1 && affToken) {
    const affMatches = pool.filter((r) =>
      (r.institutions || []).some((inst) => ContactParser.normalizeNameForMatch(inst).includes(affToken)));
    if (affMatches.length) pool = affMatches;
  }
  const distinctIds = new Set(pool.map((r) => r.orcidId));
  if (distinctIds.size > 1) {
    // findContact breaks the tie only if exactly one has an email; else ambiguous.
    const withEmail = pool.filter((r) => r.emails && r.emails.length > 0);
    if (withEmail.length !== 1) return { status: 'ambiguous', candidateCount: distinctIds.size };
    pool = withEmail;
  }
  // resolved → single (or email-broken-tie) record. Check institution corroboration.
  const sel = pool[0];
  const insts = (sel.institutions || []).map((i) => ContactParser.normalizeNameForMatch(i));
  const corroborated = !!affToken && insts.some((i) => i.includes(affToken));
  return {
    status: 'resolved', orcidId: sel.orcidId, corroborated,
    hadInstData: insts.length > 0, affToken: affToken || null, insts: sel.institutions || [],
  };
}

const PERSON_SET = 'wmkf_potentialreviewerses';
const SELECT = 'wmkf_potentialreviewersid,wmkf_name,wmkf_primaryaffiliation,wmkf_organizationname,wmkf_orcid';

await bypassDynamicsRestrictions('measure-orcid-resolution', async () => {
  const { records } = await DynamicsService.queryAllRecords(PERSON_SET, {
    select: SELECT, filter: 'wmkf_name ne null',
  });
  let pool = records.filter((r) => (r.wmkf_name || '').trim());
  if (SAMPLE && SAMPLE < pool.length) {
    // Fisher–Yates shuffle, then take SAMPLE for a representative random estimate.
    for (let j = pool.length - 1; j > 0; j--) { const k = Math.floor(Math.random() * (j + 1)); [pool[j], pool[k]] = [pool[k], pool[j]]; }
    pool = pool.slice(0, SAMPLE);
    console.log(`(random sample of ${SAMPLE} from the full pool)`);
  }
  console.log(`Reviewer pool: ${pool.length} named person rows`);
  console.log(`Already have wmkf_orcid persisted: ${pool.filter((r) => (r.wmkf_orcid || '').trim()).length}\n`);

  const tally = { resolved_corroborated: 0, resolved_lone: 0, ambiguous: 0, none: 0, error: 0 };
  let agreePersisted = 0, conflictPersisted = 0, newlyResolved = 0;
  const rows = [];
  let i = 0;
  for (const p of pool) {
    if (i >= LIMIT) break;
    i++;
    const name = p.wmkf_name.trim();
    const aff = (p.wmkf_primaryaffiliation || p.wmkf_organizationname || '').trim() || null;
    let cls;
    try {
      const results = await ORCIDService.searchByName({ name, affiliation: aff, clientId: cid, clientSecret: cs, maxResults: 5 });
      cls = classify(results, name, aff);
    } catch (e) { cls = { status: 'error', error: e.message }; }
    await sleep(220);

    if (cls.status === 'resolved') {
      tally[cls.corroborated ? 'resolved_corroborated' : 'resolved_lone']++;
      const persisted = (p.wmkf_orcid || '').trim();
      if (persisted) { (persisted === cls.orcidId ? agreePersisted++ : conflictPersisted++); }
      else newlyResolved++;
    } else { tally[cls.status]++; }

    rows.push({ id: p.wmkf_potentialreviewersid, name, aff, persistedOrcid: p.wmkf_orcid || null, ...cls });
    if (i % 25 === 0) console.log(`  …${i}/${Math.min(pool.length, LIMIT)} processed`);
  }

  writeFileSync(join(__dirname, '.orcid-resolution.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const n = i, res = tally.resolved_corroborated + tally.resolved_lone;
  const pct = (x) => `${x} (${((x / n) * 100).toFixed(1)}%)`;
  console.log(`\n${'='.repeat(64)}\nProcessed ${n} reviewers\n${'='.repeat(64)}`);
  console.log(`UNAMBIGUOUS ORCID resolved:   ${pct(res)}`);
  console.log(`   · institution-corroborated: ${pct(tally.resolved_corroborated)}`);
  console.log(`   · lone name-match only:      ${pct(tally.resolved_lone)}`);
  console.log(`AMBIGUOUS (multi-match):       ${pct(tally.ambiguous)}`);
  console.log(`NO confident match:            ${pct(tally.none)}`);
  console.log(`ERROR:                         ${pct(tally.error)}`);
  console.log(`\nOf the resolved:`);
  console.log(`   newly discovered (no persisted ORCID): ${newlyResolved}`);
  console.log(`   agree with persisted ORCID:            ${agreePersisted}`);
  console.log(`   CONFLICT with persisted ORCID:         ${conflictPersisted}`);
  console.log(`\nPer-row detail: scripts/.orcid-resolution.jsonl`);
});

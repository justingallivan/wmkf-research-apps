#!/usr/bin/env node
/**
 * READ-ONLY data-governance audit (REVIEWER_IDENTITY_RESOLUTION_PLAN.md §5 +
 * Phase 1 tie-in). Before Phase 1 landed, Scholar metrics could attach to the
 * WRONG person (same institution / lab member / homonym) with no displayed-name
 * guard — e.g. "Li-Huei Tsai" got "Masayuki Nakano"'s h-index. Those bad matches
 * are now durable on wmkf_potentialreviewers. This script flags them.
 *
 * For each person with a persisted Google Scholar author id, it re-fetches the
 * Scholar profile (SerpAPI google_scholar_author) and compares the profile's
 * displayed name against the person's name under the SAME strict comparator the
 * Phase 1 guard uses. A mismatch means the persisted Scholar id/url + h-index/
 * citations probably belong to someone else.
 *
 *   node scripts/audit-persisted-scholar-identity.js              # audit ALL
 *   node scripts/audit-persisted-scholar-identity.js --limit 25   # cheap sample
 *
 * STRICTLY READ-ONLY: no Dataverse writes. Costs one SerpAPI google_scholar_author
 * call per person with a stored Scholar id (~330 → budget accordingly; use
 * --limit first). Output: a console summary + a JSONL of flagged rows at
 * scripts/.scholar-identity-audit.jsonl (gitignored). Remediation (nulling the
 * flagged Scholar fields, or routing rows to staff review) is a SEPARATE,
 * explicitly-authorized step — this script never mutates anything.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { ContactParser } = await import('../lib/utils/contact-parser.js');

const SERP_KEY = process.env.SERP_API_KEY;
if (!SERP_KEY) {
  console.error('SERP_API_KEY not set — cannot re-fetch Scholar profiles. Aborting.');
  process.exit(1);
}

const PERSON_SET = 'wmkf_potentialreviewerses';
const SELECT = [
  'wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_primaryaffiliation',
  'wmkf_googlescholarid', 'wmkf_googlescholarurl', 'wmkf_hindex', 'wmkf_totalcitations',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the Scholar author_id for a person. Prefer the dedicated id field
 * when it is a clean 12-char Scholar token; otherwise extract a valid `user=`
 * token from the profile URL (covers rows where the id lives only in the URL,
 * or where the id field is malformed — e.g. a doubled URL). Returns null for
 * search-fallback URLs (`view_op=search_authors`, no profile pinned).
 */
function resolveAuthorId(person) {
  const ID_RE = /^[A-Za-z0-9_-]{12}$/;
  const idField = (person.wmkf_googlescholarid || '').trim();
  if (ID_RE.test(idField)) return idField;
  const url = person.wmkf_googlescholarurl || '';
  // A real profile URL has user=<12-char token>; pick the first VALID token
  // (skips the doubled-URL artifact whose first user= captures a long string).
  for (const m of url.matchAll(/user=([A-Za-z0-9_-]+)/g)) {
    if (ID_RE.test(m[1])) return m[1];
  }
  return null;
}

/** Fetch the displayed author name for a Scholar author_id (read-only SerpAPI). */
async function fetchScholarAuthorName(authorId) {
  const params = new URLSearchParams({
    engine: 'google_scholar_author', author_id: authorId, hl: 'en', api_key: SERP_KEY,
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const data = await res.json();
  return { name: data?.author?.name || null };
}

await bypassDynamicsRestrictions('audit-persisted-scholar-identity', async () => {
  console.log(`Mode: READ-ONLY audit${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

  // Every person carrying a persisted Scholar URL (the id field is unreliable —
  // it is null for URL-only rows and malformed for at least one). We resolve the
  // real author_id per row below and skip search-fallback URLs.
  const { records: persons } = await DynamicsService.queryAllRecords(PERSON_SET, {
    select: SELECT.join(','),
    filter: 'wmkf_googlescholarurl ne null',
  });
  console.log(`${persons.length} person(s) carry a persisted Google Scholar URL.\n`);

  const flagged = [];
  const idToPersons = new Map(); // resolved authorId -> [personName] (collision detector)
  let checked = 0, errors = 0, ok = 0, unnamed = 0, searchOnly = 0;

  for (const p of persons) {
    if (checked >= LIMIT) break;
    const personName = p.wmkf_name || '';
    const authorId = resolveAuthorId(p);
    if (!authorId) { searchOnly++; continue; } // search-fallback URL — no pinned profile
    checked++;
    idToPersons.set(authorId, [...(idToPersons.get(authorId) || []), personName]);

    const { name: scholarName, error } = await fetchScholarAuthorName(authorId);
    await sleep(250); // be gentle on SerpAPI

    if (error) { errors++; console.log(`  ?  ${personName} — Scholar fetch ${error} (id ${authorId})`); continue; }
    if (!scholarName) { unnamed++; continue; } // can't judge → leave alone (keep-biased)

    const mismatch = !ContactParser.namesMatch(
      ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(personName)),
      ContactParser.normalizeNameForMatch(scholarName),
    );
    if (mismatch) {
      const row = {
        personId: p.wmkf_potentialreviewersid,
        personName,
        scholarName,
        affiliation: p.wmkf_primaryaffiliation || null,
        googleScholarId: authorId,
        googleScholarUrl: p.wmkf_googlescholarurl || null,
        hIndex: p.wmkf_hindex ?? null,
        totalCitations: p.wmkf_totalcitations ?? null,
      };
      flagged.push(row);
      console.log(`  ✗  "${personName}" ⇏ Scholar profile "${scholarName}"  (h=${row.hIndex ?? '—'}, cites=${row.totalCitations ?? '—'})`);
    } else {
      ok++;
    }
  }

  const outPath = path.join(__dirname, '.scholar-identity-audit.jsonl');
  fs.writeFileSync(outPath, flagged.map((r) => JSON.stringify(r)).join('\n'));

  // Collision: the same Scholar author_id persisted on >1 person → at least one wrong.
  const collisions = [...idToPersons.entries()].filter(([, names]) => names.length > 1);

  console.log(`\n── Summary ──`);
  console.log(`  pinned profiles checked: ${checked}`);
  console.log(`  search-fallback (skipped): ${searchOnly}`);
  console.log(`  name OK:        ${ok}`);
  console.log(`  NAME MISMATCH:  ${flagged.length}  ← likely wrong-person metrics`);
  console.log(`  no profile name:${unnamed}`);
  console.log(`  fetch errors:   ${errors}`);
  if (collisions.length) {
    console.log(`\n  ⚠ SHARED author_id across people (at least one is wrong):`);
    for (const [id, names] of collisions) console.log(`    ${id} → ${names.map((n) => `"${n.trim()}"`).join(', ')}`);
  }
  console.log(`\nFlagged rows written to ${outPath} (read-only; no Dataverse changes made).`);
  console.log(`Remediation is a separate, explicitly-authorized step.`);
});

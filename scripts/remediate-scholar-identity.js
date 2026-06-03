#!/usr/bin/env node
/**
 * Remediate wrong/malformed persisted Google Scholar identity on
 * wmkf_potentialreviewers (follow-up to scripts/audit-persisted-scholar-identity.js,
 * S214 — docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md §5 data-governance).
 *
 * Self-verifying: re-derives every action from LIVE state + a fresh SerpAPI
 * displayed-name check (does NOT trust a stale JSONL or hardcoded GUIDs). For
 * each person with a persisted Scholar URL it resolves the author_id and:
 *   - NAME MISMATCH (profile belongs to someone else) → CLEAR wmkf_googlescholarid,
 *     wmkf_googlescholarurl, and the Scholar-derived metrics (hindex/i10/citations).
 *   - id field MALFORMED but the URL resolves to the right person (name OK) →
 *     NORMALIZE wmkf_googlescholarid to the clean 12-char token (keep the URL/metrics).
 *   - otherwise → no action.
 *
 *   node scripts/remediate-scholar-identity.js            # DRY-RUN (default)
 *   node scripts/remediate-scholar-identity.js --execute  # write to prod
 *
 * Costs one SerpAPI google_scholar_author call per pinned profile (~8). Prints
 * every planned PATCH; --execute applies them via DynamicsService.updateRecord
 * (explicit nulls clear the fields).
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

const EXECUTE = process.argv.includes('--execute');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { ContactParser } = await import('../lib/utils/contact-parser.js');

const SERP_KEY = process.env.SERP_API_KEY;
if (!SERP_KEY) { console.error('SERP_API_KEY not set — aborting.'); process.exit(1); }

const PERSON_SET = 'wmkf_potentialreviewerses';
const SELECT = [
  'wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_googlescholarid', 'wmkf_googlescholarurl',
  'wmkf_hindex', 'wmkf_i10index', 'wmkf_totalcitations',
];
const ID_RE = /^[A-Za-z0-9_-]{12}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveAuthorId(person) {
  const idField = (person.wmkf_googlescholarid || '').trim();
  if (ID_RE.test(idField)) return idField;
  const url = person.wmkf_googlescholarurl || '';
  for (const m of url.matchAll(/user=([A-Za-z0-9_-]+)/g)) {
    if (ID_RE.test(m[1])) return m[1];
  }
  return null;
}

async function fetchScholarAuthorName(authorId) {
  const params = new URLSearchParams({ engine: 'google_scholar_author', author_id: authorId, hl: 'en', api_key: SERP_KEY });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const data = await res.json();
  return { name: data?.author?.name || null };
}

await bypassDynamicsRestrictions('remediate-scholar-identity', async () => {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (writing to prod)' : 'DRY-RUN'}\n`);

  const { records: persons } = await DynamicsService.queryAllRecords(PERSON_SET, {
    select: SELECT.join(','), filter: 'wmkf_googlescholarurl ne null',
  });

  const actions = [];
  for (const p of persons) {
    const authorId = resolveAuthorId(p);
    if (!authorId) continue; // search-fallback URL, nothing pinned
    const { name: scholarName, error } = await fetchScholarAuthorName(authorId);
    await sleep(250);
    if (error) { console.log(`  ?  ${(p.wmkf_name || '').trim()} — fetch ${error}, skipping`); continue; }
    if (!scholarName) continue; // can't judge → leave alone (keep-biased)

    const nameOk = ContactParser.namesMatch(
      ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(p.wmkf_name || '')),
      ContactParser.normalizeNameForMatch(scholarName),
    );
    const idFieldClean = ID_RE.test((p.wmkf_googlescholarid || '').trim());

    if (!nameOk) {
      actions.push({
        id: p.wmkf_potentialreviewersid, person: (p.wmkf_name || '').trim(),
        kind: 'CLEAR', reason: `profile is "${scholarName}"`,
        patch: { wmkf_googlescholarid: null, wmkf_googlescholarurl: null, wmkf_hindex: null, wmkf_i10index: null, wmkf_totalcitations: null },
      });
    } else if (!idFieldClean) {
      actions.push({
        id: p.wmkf_potentialreviewersid, person: (p.wmkf_name || '').trim(),
        kind: 'NORMALIZE_ID', reason: `id field malformed; URL resolves to ${authorId} (name OK)`,
        patch: { wmkf_googlescholarid: authorId },
      });
    }
  }

  if (!actions.length) { console.log('No remediation needed — all pinned profiles are clean.'); return; }

  console.log(`Planned actions (${actions.length}):`);
  for (const a of actions) {
    console.log(`  ${a.kind.padEnd(13)} "${a.person}" — ${a.reason}`);
    console.log(`     PATCH ${JSON.stringify(a.patch)}`);
  }

  if (!EXECUTE) { console.log('\nDRY-RUN — no changes written. Re-run with --execute to apply.'); return; }

  console.log('\nApplying...');
  let done = 0, failed = 0;
  for (const a of actions) {
    try {
      await DynamicsService.updateRecord(PERSON_SET, a.id, a.patch);
      console.log(`  ✓ ${a.kind} "${a.person}"`);
      done++;
    } catch (err) {
      console.log(`  ✗ ${a.kind} "${a.person}" — ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone: ${done} applied, ${failed} failed.`);
});

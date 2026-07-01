#!/usr/bin/env node
/**
 * One-off: normalize stored whitespace in wmkf_potentialreviewers.wmkf_name.
 *
 * wmkf_name is a plain, directly-written field (Dynamics does NOT recompute it),
 * and historically the adapter wrote it raw, so various write paths persisted
 * leading/trailing/internal-double-space artifacts (e.g. " Test 3 Reviewer ").
 * The adapter now normalizes on every write (commit 2b4cf9f4), so this script
 * only cleans rows that were already padded before that fix.
 *
 * Fix is normalize-only: wmkf_name := ContactParser.normalizeDisplayName(wmkf_name)
 * (trim ends + collapse internal runs). first/last are NOT touched.
 *
 * We write wmkf_name DIRECTLY via DynamicsService.updateRecord — NOT the adapter
 * update() — because that path's no-op guard (fieldsEqual, trim+lowercase) treats
 * a padded value as "equal" to its clean form and would skip the write.
 *
 * wmkf_name is NOT the alternate key (wmkf_emailaddress_unique is), so writing it
 * does not trigger the email 412. Blind last-write-wins (no ifMatch) is fine for
 * a whitespace normalize.
 *
 * DRY-RUN by default (reports count + sample, writes nothing). Pass --commit to
 * write. Idempotent: a second run after a full commit reports 0 dirty rows.
 *
 * PRECONDITION before --commit: confirm no Power Automate flow / Business Rule
 * keys off wmkf_name changes (a ~4.3k-row write would fan out flow runs).
 */

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const COMMIT = process.argv.includes('--commit');
const ENTITY_SET = 'wmkf_potentialreviewerses';
const SLEEP_MS = 60; // gentle pacing between writes

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const cp = await import('../lib/utils/contact-parser.js');
const ContactParser = cp.ContactParser || (cp.default && cp.default.ContactParser);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logPath = join(__dirname, '..', `cleanup-reviewer-name-whitespace.${COMMIT ? 'commit' : 'dryrun'}.log`);

console.log('# wmkf_name whitespace cleanup');
console.log(`Mode: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}`);
console.log(`Log:  ${logPath}\n`);

await bypassDynamicsRestrictions('cleanup-reviewer-name-whitespace', async () => {
  // queryAllRecords forbids unfiltered full-table dumps; `wmkf_name ne null`
  // satisfies that and still returns every named row (we detect dirtiness in
  // code, so a whitespace-specific OData filter — unreliable for leading spaces —
  // isn't needed and can't cause a miss).
  const { records, totalCount, capped } = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: 'wmkf_potentialreviewersid,wmkf_name',
    filter: 'wmkf_name ne null',
  });
  console.log(`Fetched ${records.length} row(s)${capped ? ' (CAPPED — rerun needed for the remainder)' : ''}; totalCount=${totalCount ?? 'n/a'}\n`);

  const dirty = [];
  for (const r of records) {
    const before = r.wmkf_name;
    if (typeof before !== 'string' || !before) continue;
    const after = ContactParser.normalizeDisplayName(before);
    if (after && after !== before) dirty.push({ id: r.wmkf_potentialreviewersid, before, after });
  }

  console.log(`Dirty (whitespace differs): ${dirty.length} / ${records.length}\n`);
  const sample = dirty.slice(0, 20);
  for (const d of sample) {
    console.log(`  |${d.before}| (${d.before.length}) -> |${d.after}| (${d.after.length})`);
  }
  if (dirty.length > sample.length) console.log(`  … and ${dirty.length - sample.length} more`);
  for (const d of dirty) appendFileSync(logPath, `${JSON.stringify(d)}\n`);

  if (!COMMIT) {
    console.log('\nDRY-RUN complete. Re-run with --commit to write (after confirming no wmkf_name flow side-effects).');
    return;
  }

  console.log(`\nWriting ${dirty.length} row(s)…`);
  let ok = 0;
  let failed = 0;
  for (const d of dirty) {
    try {
      await DynamicsService.updateRecord(ENTITY_SET, d.id, { wmkf_name: d.after });
      ok++;
      if (ok % 100 === 0) console.log(`  … ${ok}/${dirty.length}`);
    } catch (e) {
      failed++;
      appendFileSync(logPath, `${JSON.stringify({ id: d.id, error: String(e.message || e) })}\n`);
      console.error(`  FAIL ${d.id}: ${e.message || e}`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`\nDone. Updated ${ok}, failed ${failed}. Re-run dry-run to verify 0 remain.`);
});

#!/usr/bin/env node
/**
 * ONE-SHOT BACKFILL (appresearcher collapse, S213 — docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md Phase 2).
 *
 * Copies each wmkf_appresearcher sidecar's bibliometric fields onto its linked
 * wmkf_potentialreviewers person row (the 17 fields added in Phase 1). After
 * Phase 4 caller switchover, the sidecar is dropped (Phase 5); this moves the
 * data up first.
 *
 *   node scripts/backfill-appresearcher-to-potentialreviewer.js            # dry-run
 *   node scripts/backfill-appresearcher-to-potentialreviewer.js --execute  # write
 *
 * Semantics:
 *   - Metric fields (hindex, i10index, totalcitations + the *updatedat/lastchecked
 *     stamps) always OVERWRITE (snapshots).
 *   - Descriptive fields FILL-IF-EMPTY on the person (preserve any manual edit;
 *     makes re-runs idempotent).
 *   - Affiliation (D-AFF): write the sidecar's wmkf_primaryaffiliation onto the
 *     person's new wmkf_primaryaffiliation; if the sidecar's is empty but the
 *     person already has wmkf_organizationname, copy that over instead (don't lose
 *     the person's existing affiliation when promoting to the 500-char field).
 *
 * Gates (Codex P0 #1): refuses to write unless the sidecar→person link audit is
 * clean (0 null / 0 dangling / 0 duplicate). Writes a JSONL snapshot of every
 * sidecar row first (rollback insurance).
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

const SIDECAR_FIELDS = [
  'wmkf_appresearcherid',
  '_wmkf_potentialreviewer_value',
  'wmkf_primaryaffiliation', 'wmkf_department', 'wmkf_orcid', 'wmkf_orcidurl',
  'wmkf_googlescholarid', 'wmkf_googlescholarurl', 'wmkf_hindex', 'wmkf_i10index',
  'wmkf_totalcitations', 'wmkf_website', 'wmkf_facultypageurl', 'wmkf_keywords',
  'wmkf_emailsource', 'wmkf_lastchecked', 'wmkf_metricsupdatedat',
  'wmkf_contactenrichedat', 'wmkf_contactenrichmentsource',
];
const METRIC = new Set(['wmkf_hindex', 'wmkf_i10index', 'wmkf_totalcitations', 'wmkf_lastchecked', 'wmkf_metricsupdatedat']);
// Descriptive fields copied 1:1 (skip the id + lookup + affiliation which is special-cased).
const DESCRIPTIVE = SIDECAR_FIELDS.filter(f =>
  !['wmkf_appresearcherid', '_wmkf_potentialreviewer_value', 'wmkf_primaryaffiliation'].includes(f) && !METRIC.has(f));

function isEmpty(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

await bypassDynamicsRestrictions('backfill-appresearcher', async () => {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);

  // ── Load all sidecars ─────────────────────────────────────────────────────
  // queryAllRecords requires a $filter (no unfiltered dumps). Filter on the
  // always-present PK so it matches every row — null *links* are still detected
  // in JS below for the audit.
  const { records: sidecars } = await DynamicsService.queryAllRecords('wmkf_appresearchers', {
    select: SIDECAR_FIELDS.join(','),
    filter: 'wmkf_appresearcherid ne 00000000-0000-0000-0000-000000000000',
  });
  console.log(`Loaded ${sidecars.length} sidecar rows.`);

  // ── Phase 2.0 link-shape audit gate ───────────────────────────────────────
  const nullLinks = sidecars.filter(s => !s._wmkf_potentialreviewer_value);
  const seen = new Map();
  const dupes = [];
  for (const s of sidecars) {
    const pr = s._wmkf_potentialreviewer_value;
    if (!pr) continue;
    if (seen.has(pr)) dupes.push(pr); else seen.set(pr, s.wmkf_appresearcherid);
  }
  // Dangling: linked person doesn't exist. Check each distinct person id.
  const personIds = [...seen.keys()];
  let dangling = 0;
  for (const pid of personIds) {
    try { await DynamicsService.getRecord('wmkf_potentialreviewerses', pid, { select: 'wmkf_potentialreviewersid' }); }
    catch { dangling++; console.log(`  DANGLING: person ${pid} not found`); }
  }
  console.log(`Audit: ${nullLinks.length} null, ${dangling} dangling, ${dupes.length} duplicate links.`);
  if (nullLinks.length || dangling || dupes.length) {
    throw new Error('Link audit FAILED — refusing to backfill. Triage the anomalies first.');
  }
  console.log('Audit CLEAN.\n');

  // ── JSONL snapshot (rollback insurance) ───────────────────────────────────
  const snapPath = path.join(__dirname, `.appresearcher-snapshot.jsonl`);
  fs.writeFileSync(snapPath, sidecars.map(s => JSON.stringify(s)).join('\n'));
  console.log(`Snapshot written: ${snapPath} (${sidecars.length} rows)\n`);

  // ── Backfill ──────────────────────────────────────────────────────────────
  let written = 0, skipped = 0, failed = 0;
  for (const s of sidecars) {
    const pid = s._wmkf_potentialreviewer_value;
    let person;
    try {
      person = await DynamicsService.getRecord('wmkf_potentialreviewerses', pid, {
        select: ['wmkf_organizationname', 'wmkf_primaryaffiliation', ...DESCRIPTIVE].join(','),
      });
    } catch (e) { console.log(`  ✗ person ${pid} read failed: ${e.message}`); failed++; continue; }

    const payload = {};
    // Metrics: always overwrite (when the sidecar has a value).
    for (const f of METRIC) if (s[f] !== null && s[f] !== undefined) payload[f] = s[f];
    // Descriptive: fill-if-empty on the person.
    for (const f of DESCRIPTIVE) if (!isEmpty(s[f]) && isEmpty(person[f])) payload[f] = s[f];
    // Affiliation (D-AFF): prefer the sidecar's 500-char value; else lift the
    // person's existing organizationname so we don't lose it. Fill-if-empty.
    if (isEmpty(person.wmkf_primaryaffiliation)) {
      const aff = !isEmpty(s.wmkf_primaryaffiliation) ? s.wmkf_primaryaffiliation
        : (!isEmpty(person.wmkf_organizationname) ? person.wmkf_organizationname : null);
      if (aff) payload.wmkf_primaryaffiliation = aff;
    }

    if (Object.keys(payload).length === 0) { skipped++; continue; }
    if (!EXECUTE) { written++; continue; }
    try {
      await DynamicsService.updateRecord('wmkf_potentialreviewerses', pid, payload);
      written++;
    } catch (e) { console.log(`  ✗ person ${pid} write failed: ${e.message}`); failed++; }
  }

  console.log(`\n${EXECUTE ? 'Wrote' : 'Would write'} ${written}, skipped ${skipped} (nothing to fill), failed ${failed}.`);
  if (!EXECUTE) console.log('Dry run — re-run with --execute to apply.');
});

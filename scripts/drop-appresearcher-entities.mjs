#!/usr/bin/env node
/**
 * ONE-SHOT DROP (appresearcher collapse, S213 — docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md Phase 5).
 * POINT OF NO RETURN. Drops the wmkf_appresearcher sidecar + the two empty
 * publication tables AFTER the caller cutover (Phases 3–4) is live and smoke-
 * verified. The bibliometric data already lives on wmkf_potentialreviewers
 * (Phase 2 backfill) + a JSONL snapshot (scripts/.appresearcher-snapshot.jsonl).
 *
 *   node scripts/drop-appresearcher-entities.mjs            # dry-run
 *   node scripts/drop-appresearcher-entities.mjs --execute  # DROP
 *
 * Drop order: junction (apppublicationauthor) → publication → appresearcher
 * (the junction FKs the other two). Each step: EntityDefinitions existence
 * check (skip if already 404), then DELETE EntityDefinitions(LogicalName=...).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
  let [, k, v] = m; env[k] = v.trim().replace(/^"(.*)"$/, '$1');
}
const URL = env.DYNAMICS_URL;
const EXECUTE = process.argv.includes('--execute');

const tok = await (await fetch(`https://login.microsoftonline.com/${env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.DYNAMICS_CLIENT_ID, client_secret: env.DYNAMICS_CLIENT_SECRET, scope: `${URL}/.default` }),
})).json().then(j => j.access_token);
const H = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
const api = `${URL}/api/data/v9.2`;

// Junction first (it FKs the other two), then publication, then sidecar.
const ORDER = ['wmkf_apppublicationauthor', 'wmkf_apppublication', 'wmkf_appresearcher'];

console.log(`Target: ${URL}\nMode: ${EXECUTE ? 'EXECUTE (DROP)' : 'DRY-RUN'}\n`);

for (const logical of ORDER) {
  const r = await fetch(`${api}/EntityDefinitions(LogicalName='${logical}')?$select=LogicalName,IsCustomEntity,IsManaged`, { headers: H });
  if (r.status === 404) { console.log(`· ${logical}: already 404 (gone) — skip`); continue; }
  if (!r.ok) { console.log(`✗ ${logical}: existence check ${r.status} — STOP`); process.exit(1); }
  const meta = await r.json();
  console.log(`  ${logical}: EXISTS (IsCustomEntity=${meta.IsCustomEntity}, IsManaged=${meta.IsManaged})`);
  if (!EXECUTE) { console.log(`  [dry-run] would DELETE EntityDefinitions(LogicalName='${logical}')`); continue; }
  const del = await fetch(`${api}/EntityDefinitions(LogicalName='${logical}')`, { method: 'DELETE', headers: H });
  if (del.ok || del.status === 204) { console.log(`  ✓ DROPPED ${logical}`); }
  else { console.log(`  ✗ DROP ${logical} failed (${del.status}): ${(await del.text()).slice(0, 400)} — STOP`); process.exit(1); }
}

// Re-verify all gone (only meaningful after execute).
console.log('\nPost-check:');
for (const logical of ORDER) {
  const r = await fetch(`${api}/EntityDefinitions(LogicalName='${logical}')?$select=LogicalName`, { headers: H });
  console.log(`  ${logical}: ${r.status === 404 ? '404 (gone) ✓' : `${r.status} (still present)`}`);
}
if (!EXECUTE) console.log('\nDry run — re-run with --execute to DROP.');

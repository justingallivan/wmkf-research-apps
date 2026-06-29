#!/usr/bin/env node
/**
 * Phase E2 — DROP the three retired reviewer rating columns from the Dataverse
 * `wmkf_appreviewersuggestion` entity:
 *   wmkf_reviewerimpact / wmkf_reviewerrisk / wmkf_revieweroverallrating
 *
 * These columns are DEAD post-Phase-E1 (S305): nothing reads or writes them —
 * ratings live solely in the `wmkf_appreviewanswer` snapshot. This script
 * removes the now-dormant metadata.
 *
 * ⚠️ DESTRUCTIVE + IRREVERSIBLE. Preconditions (all must hold before --execute):
 *   1. E1 is fully deployed to prod and has baked — NO code PATCHes these columns
 *      anymore (grep-verified at E1; confirm the deploy is the only live bundle).
 *      Never roll back past E1 after running this (Codex E2 P0-2).
 *   2. Schema-as-code no longer defines these attrs — done: the 3 Picklist blocks
 *      were removed from
 *      `lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json`
 *      so the create-only applier can't resurrect them (Codex E2 P0-1).
 *   3. The ratings are preserved in the snapshot (Phase D backfill ran; the data
 *      is not lost by dropping these columns).
 *
 * Idempotent + safe-to-rerun: a 404 (attribute already gone) is treated as
 * success, mirroring scripts/wave2-reshape-drop.js.
 *
 * Usage:
 *   node scripts/drop-reviewer-rating-columns.mjs            # DRY RUN — probes presence, logs the planned deletes
 *   node scripts/drop-reviewer-rating-columns.mjs --execute  # PROD: deletes the 3 attributes (irreversible)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

const ENTITY_LOGICAL = 'wmkf_appreviewersuggestion';
const ATTRS = ['wmkf_reviewerimpact', 'wmkf_reviewerrisk', 'wmkf_revieweroverallrating'];
const EXECUTE = process.argv.includes('--execute');

function attrPath(attr, select = '') {
  return `/EntityDefinitions(LogicalName='${ENTITY_LOGICAL}')/Attributes(LogicalName='${attr}')${select}`;
}

async function main() {
  loadEnvLocal();
  const url = process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  // dryRun on the client logs + skips every non-GET (so GET probes still run live).
  const client = createClient({ resourceUrl: url, token, dryRun: !EXECUTE });

  console.log(`\n=== Phase E2: drop reviewer rating columns (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

  let present = 0;
  let dropped = 0;
  let alreadyGone = 0;
  let failed = 0;

  for (const attr of ATTRS) {
    // Confirm presence first — GET runs even in dry-run mode.
    const got = await client.get(attrPath(attr, '?$select=LogicalName,AttributeType'));
    if (got.status === 404) {
      console.log(`  · gone      ${attr} (already dropped)`);
      alreadyGone++;
      continue;
    }
    if (!got.ok) {
      console.log(`  ✗ probe failed ${attr}: status ${got.status} ${got.body?.error?.message || ''}`);
      failed++;
      continue;
    }
    present++;
    console.log(`  • present   ${attr} (${got.body?.AttributeType})`);

    const del = await client.delete_(attrPath(attr));
    if (del.dryRun) continue;
    if (del.ok || del.status === 404) {
      console.log(`  ✓ dropped   ${attr}`);
      dropped++;
    } else {
      console.log(`  ✗ delete failed ${attr}: status ${del.status} ${del.body?.error?.message || ''}`);
      failed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Present at start:  ${present}`);
  console.log(`Already gone:      ${alreadyGone}`);
  console.log(`Dropped:           ${EXECUTE ? dropped : '(dry run)'}`);
  if (failed) console.log(`FAILED:            ${failed}`);
  if (!EXECUTE) console.log('\nDRY RUN — re-run with --execute to drop (IRREVERSIBLE).\n');
  else console.log('\nDone.\n');
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error('\nE2 drop failed:', e.message);
  process.exit(1);
});

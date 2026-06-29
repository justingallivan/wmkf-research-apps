#!/usr/bin/env node
/**
 * Phase A seed — populate the wmkf_reviewquestion entity with the current
 * review-form question set from lib/external/review-form-schema.js, so the
 * ReviewQuestionFetcher serves exactly today's questions (Phase B is then a
 * behavior-preserving swap from the static array to the fetched set).
 *
 * Idempotent: each row is UPSERTED by its alternate key
 * `wmkf_reviewquestion_key` on (wmkf_questionkey) — a PATCH to
 *   wmkf_reviewquestions(wmkf_questionkey='<key>')
 * creates the row on first run and updates it in place on re-run (no dupes).
 * Safe to re-run after editing the static schema (e.g. to correct wording before
 * the admin editor ships).
 *
 * The affiliation field has no `order` in the static schema (it is the identity
 * field, not one of the 11 questions); it is seeded with order 0 so it sorts
 * first and satisfies the fetcher's finite-order sanity check. Its mapping to the
 * parent wmkf_revieweraffiliation column stays in code, not in this entity.
 *
 * Usage:
 *   node scripts/seed-review-questions.mjs                     # DRY RUN — prints the planned upserts, no writes
 *   node scripts/seed-review-questions.mjs --execute           # PROD writes (the entity lives only in prod)
 *
 * Requires the wave9 entity to exist first:
 *   node scripts/apply-dataverse-schema.js --target=prod --wave=9-review-questions --execute
 *
 * The alternate-key INDEX can lag behind metadata creation. This script gates
 * its --execute writes on `EntityKeyIndexStatus === Active` (Codex Phase-A P1) —
 * if the key isn't Active yet, it aborts with a clear message rather than racing
 * the index (which would create duplicate rows instead of upserting). Just wait
 * and re-run.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const { reviewFormSchema } = await import('../lib/external/review-form-schema.js');
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const ENTITY_SET = 'wmkf_reviewquestions';
const ENTITY_LOGICAL = 'wmkf_reviewquestion';
const ALT_KEY_LOGICAL = 'wmkf_reviewquestion_key';

/**
 * Refuse to write until the alternate-key index is Active — otherwise an
 * upsert-by-key races the index and creates duplicates instead of updating.
 */
async function assertAltKeyActive() {
  const key = await bypassDynamicsRestrictions('seed-review-questions', async () =>
    DynamicsService.getEntityKey(ENTITY_LOGICAL, ALT_KEY_LOGICAL),
  );
  if (!key) {
    throw new Error(
      `Alternate key '${ALT_KEY_LOGICAL}' not found on '${ENTITY_LOGICAL}'. Create the wave9 entity first (apply-dataverse-schema.js --wave=9-review-questions --execute).`,
    );
  }
  if (key.EntityKeyIndexStatus !== 'Active') {
    throw new Error(
      `Alternate key '${ALT_KEY_LOGICAL}' index is '${key.EntityKeyIndexStatus}', not 'Active'. Wait for the index to activate, then re-run (upserting against a non-Active key would create duplicate rows).`,
    );
  }
}

function parseArgs(argv) {
  const out = { execute: false };
  for (const a of argv.slice(2)) {
    if (a === '--execute') out.execute = true;
    else if (a === '--help' || a === '-h') { console.log('See header for usage.'); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); process.exit(1); }
  }
  return out;
}

function rowForField(field) {
  return {
    wmkf_name: field.key,
    wmkf_questionkey: field.key,
    wmkf_questionorder: Number.isFinite(field.order) ? field.order : 0,
    wmkf_questiontext: field.label,
    wmkf_questiontype: field.type,
    wmkf_required: field.required === true,
    wmkf_maxlength: Number.isFinite(field.maxLength) ? field.maxLength : null,
    wmkf_hint: field.hint || null,
    wmkf_options: Array.isArray(field.options)
      ? JSON.stringify(field.options.map((o) => ({ value: o.value, label: o.label })))
      : null,
  };
}

function altKeyUrl(key) {
  // Single-attribute alt key — simple URL form (no lookup component).
  return `wmkf_questionkey='${String(key).replace(/'/g, "''")}'`;
}

async function main() {
  const args = parseArgs(process.argv);
  const fields = reviewFormSchema.fields;

  console.log(`Seed wmkf_reviewquestion — ${fields.length} field(s) from review-form-schema.js`);
  console.log(args.execute ? 'MODE: EXECUTE (prod writes)\n' : 'MODE: DRY RUN (no writes)\n');

  if (args.execute) {
    await assertAltKeyActive();
    console.log(`  [ok]  alternate key '${ALT_KEY_LOGICAL}' index is Active\n`);
  }

  let created = 0;
  for (const field of fields) {
    const row = rowForField(field);
    const url = altKeyUrl(field.key);
    if (!args.execute) {
      console.log(`  [dry] upsert ${ENTITY_SET}(${url})  order=${row.wmkf_questionorder} type=${row.wmkf_questiontype} required=${row.wmkf_required}`);
      continue;
    }
    await bypassDynamicsRestrictions('seed-review-questions', async () => {
      await DynamicsService.updateRecord(ENTITY_SET, url, row);
    });
    created += 1;
    console.log(`  [ok]  upsert ${ENTITY_SET}(${url})`);
  }

  if (!args.execute) {
    console.log('\nThis was a dry run. Re-run with --execute to upsert into prod.');
  } else {
    console.log(`\nDone — ${created} row(s) upserted.`);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

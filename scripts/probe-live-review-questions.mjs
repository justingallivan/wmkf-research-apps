#!/usr/bin/env node
/**
 * READ-ONLY probe — dump the LIVE `wmkf_reviewquestion` set so a question-set
 * change can be planned against what production actually serves, not against the
 * seeded static schema in `lib/external/review-form-schema.js`.
 *
 * The set is staff-editable through /admin → Review Questions, so the seed and
 * the live set can diverge at any time. Every planning diff must start here.
 *
 * Performs NO writes. Reads from local require the sanctioned prod-read flag:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-live-review-questions.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const ENTITY_SET = 'wmkf_reviewquestions';
const FIELDS = [
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_required',
  'wmkf_maxlength',
  'wmkf_hint',
  'wmkf_options',
  'statecode',
];

async function main() {
  // queryRecords returns { records, count, totalCount, hasMore } — NOT a raw
  // OData envelope (lib/services/dynamics/read-ops.js:92-101).
  const { records: list, totalCount, hasMore } = await bypassDynamicsRestrictions(
    { reason: 'read-only review-question set probe (scripts/probe-live-review-questions.mjs)' },
    // A $filter is mandatory (unfiltered full-table dumps are refused). This one
    // matches every row in either state, so active AND soft-deleted questions are
    // both visible — a retired row still matters when planning key reuse.
    () => DynamicsService.queryAllRecords(ENTITY_SET, {
      select: FIELDS.join(','),
      filter: 'statecode eq 0 or statecode eq 1',
      orderby: 'wmkf_questionorder asc',
    }),
  );

  if (hasMore) console.log('WARNING: more rows exist than were returned.');
  if (totalCount != null) console.log(`totalCount reported by Dataverse: ${totalCount}`);
  console.log(`\nLIVE question rows: ${list.length}\n${'='.repeat(70)}`);

  for (const r of list) {
    const active = r.statecode === 0 ? 'ACTIVE' : `INACTIVE(statecode=${r.statecode})`;
    console.log(`\n[${r.wmkf_questionorder}] ${r.wmkf_questionkey}  (${r.wmkf_questiontype}, ${r.wmkf_required ? 'required' : 'optional'}, ${active})`);
    console.log(`    text: ${r.wmkf_questiontext}`);
    if (r.wmkf_hint) console.log(`    hint: ${r.wmkf_hint}`);
    if (r.wmkf_maxlength != null) console.log(`    maxLength: ${r.wmkf_maxlength}`);
    if (r.wmkf_options) {
      try {
        const opts = JSON.parse(r.wmkf_options);
        for (const o of opts) console.log(`      - ${o.value}: ${o.label}`);
      } catch {
        console.log(`      (unparseable options: ${r.wmkf_options})`);
      }
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});

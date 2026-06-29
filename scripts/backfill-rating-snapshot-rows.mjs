#!/usr/bin/env node
/**
 * Phase D step 2 backfill — populate the wmkf_appreviewanswer snapshot with
 * rating rows for HISTORICAL submitted reviews that wrote only the parent rating
 * columns (wmkf_reviewerimpact / wmkf_reviewerrisk / wmkf_revieweroverallrating)
 * and never wrote child snapshot rows.
 *
 * WHY: before Phase D, the only writer of snapshot rows was the external submit
 * path. The staff upload path (review-upload.js) and the no-file path
 * (mark-received-no-file.js) wrote parent columns ONLY. Step 1 made those two
 * paths dual-write going forward; this backfill fills the rows they already
 * created. It MUST run after step 1 is deployed (so no new parent-only rows
 * appear) and BEFORE the step-3 reader re-point (so re-pointing the DTO/prefill
 * onto the snapshot doesn't null out these historical ratings).
 *
 * SURGICAL + IDEMPOTENT: for each submitted suggestion with a parent rating, we
 * read its existing snapshot rating rows and upsert ONLY the missing ones by the
 * alternate key
 *   wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<id>,wmkf_questionkey='<key>')
 * — the same upsert the live writers use (S302-verified). A row already present
 * (external-submit reviews) is left untouched; a re-run is a no-op. Rows are
 * built by the SAME buildRatingSnapshotRows() helper the writers use, so a
 * backfilled row is byte-identical to a freshly-written one.
 *
 * The "informal feedback" rows (mark-received with no ratings) have null parent
 * columns, are excluded by the filter, and correctly get NO snapshot rows.
 *
 * Usage:
 *   node scripts/backfill-rating-snapshot-rows.mjs            # DRY RUN — prints planned upserts, no writes
 *   node scripts/backfill-rating-snapshot-rows.mjs --execute  # PROD writes
 *
 * Caveat: answerText/questionText/questionOrder are decoded from the CURRENT
 * question set. The reader decodes the displayed label from answerValue (not the
 * stored answerText), so this is display-faithful; only a since-edited option
 * label would make a backfilled row's stored answerText differ from the label in
 * force at the original submit (historical-export nuance only, value is exact).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { getActiveQuestionSet } = await import('../lib/external/review-question-fetcher.js');
const { buildRatingSnapshotRows, answerRowUrl, answerRowBody } = await import('../lib/external/review-answer-snapshot.js');
const { reviewParentColumnByKey } = await import('../lib/external/review-form-schema.js');

const SUGGESTION_ENTITY_SET = 'wmkf_appreviewersuggestions';
const EXECUTE = process.argv.includes('--execute');

// The three parent rating columns, in field-key order.
const RATING_COLUMNS = ['impact', 'risk', 'overallRating'].map((k) => reviewParentColumnByKey[k]);

// FROZEN (Phase E, S305). This one-shot backfill already ran S305 (1 row filled,
// idempotent-verified) and is now obsolete: Phase E retired the parent rating
// columns this script reads (`reviewParentColumnByKey` no longer maps them, so
// the OData filter would be `undefined ne null`) and changed `buildRatingSnapshotRows`
// to take field.key-keyed ratings, not a column-keyed suggestion row. Kept for the
// historical record; refuse to run rather than query dropped/undefined columns.
const FROZEN = true;

async function main() {
  if (FROZEN) {
    console.error(
      'backfill-rating-snapshot-rows is FROZEN (Phase E): the parent rating columns it reads were retired '
      + 'and its helper contract changed. It already ran successfully in S305. Refusing to run.',
    );
    process.exit(1);
  }
  console.log(`\n=== Phase D rating-snapshot backfill (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

  const questionSet = await getActiveQuestionSet();
  const snapshotKeys = new Set(
    questionSet.filter((f) => f.type === 'picklist' || f.type === 'richtext').map((f) => f.key),
  );
  const answerEntitySet = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');

  // Submitted rows carrying at least one parent rating value.
  const ratingNotNull = RATING_COLUMNS.map((c) => `${c} ne null`).join(' or ');
  const { records: suggestions } = await bypassDynamicsRestrictions('backfill-rating-snapshot', () =>
    DynamicsService.queryAllRecords(SUGGESTION_ENTITY_SET, {
      select: ['wmkf_appreviewersuggestionid', ...RATING_COLUMNS].join(','),
      filter: `wmkf_reviewreceivedat ne null and (${ratingNotNull})`,
    }),
  );

  console.log(`Candidate submitted rows with a parent rating: ${suggestions.length}\n`);

  let scanned = 0;
  let alreadyComplete = 0;
  let rowsPlanned = 0;
  let rowsWritten = 0;
  let suggestionsTouched = 0;

  for (const s of suggestions) {
    scanned++;
    const suggestionId = s.wmkf_appreviewersuggestionid;

    // Build the full set of rating rows this suggestion SHOULD have from its
    // parent columns, then subtract the rows already in the snapshot.
    const wanted = buildRatingSnapshotRows(s, questionSet);
    if (wanted.length === 0) continue; // defensive (filter guarantees ≥1)

    const { records: existing } = await bypassDynamicsRestrictions('backfill-rating-snapshot', () =>
      DynamicsService.queryAllRecords(answerEntitySet, {
        select: 'wmkf_questionkey',
        filter: `_wmkf_appreviewersuggestion_value eq ${suggestionId}`,
      }),
    );
    const existingKeys = new Set((existing || []).map((r) => r.wmkf_questionkey));
    const missing = wanted.filter((r) => !existingKeys.has(r.questionKey));

    if (missing.length === 0) {
      alreadyComplete++;
      continue;
    }

    suggestionsTouched++;
    rowsPlanned += missing.length;
    const keys = missing.map((r) => `${r.questionKey}=${r.answerValue}`).join(', ');
    console.log(`  ${suggestionId}: +${missing.length} row(s) [${keys}]`);

    if (EXECUTE) {
      const operations = missing.map((row) => ({
        method: 'PATCH',
        url: answerRowUrl(answerEntitySet, suggestionId, row.questionKey, snapshotKeys),
        body: answerRowBody(row),
      }));
      await bypassDynamicsRestrictions('backfill-rating-snapshot', () =>
        DynamicsService.executeChangeset(operations),
      );
      rowsWritten += missing.length;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Scanned:              ${scanned}`);
  console.log(`Already complete:     ${alreadyComplete}`);
  console.log(`Suggestions to fill:  ${suggestionsTouched}`);
  console.log(`Rating rows ${EXECUTE ? 'WRITTEN' : 'planned'}: ${EXECUTE ? rowsWritten : rowsPlanned}`);
  if (!EXECUTE) console.log('\nDRY RUN — re-run with --execute to write.\n');
  else console.log('\nDone.\n');
}

main().catch((e) => {
  console.error('\nBackfill failed:', e.message);
  process.exit(1);
});

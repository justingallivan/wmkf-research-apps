#!/usr/bin/env node
/**
 * INERT SINCE MIGRATION 018 (S387 note). Every SELECT below reads
 * `reviewer_suggestions`, which `018_drop_reviewer_finder_postgres_tables.sql:85` DROPped
 * along with `researchers`/`publications`/`proposal_searches` — so this script cannot run
 * against the current database; it fails on its first query. Kept for the historical record
 * of how the Postgres→Dataverse migration was performed, NOT as a runnable tool. Retiring
 * or deleting it is an owner decision, not cleanup. Its write call was still brought in
 * line with the address+provenance pairing invariant so a future revival against a restored
 * table cannot reintroduce the split write.
 *
 * Backfill: Postgres reviewer_suggestions → Dataverse
 *
 * Walks every Postgres row that has a request_number, resolves the request to
 * an akoya_request GUID, and runs it through the same three-adapter chain
 * save-candidates uses (potentialReviewer → researcher → suggestion). After
 * the upsert, lifecycle state (invited/accepted/declined, materials/review/
 * reminder timestamps, blob URL, status) is preserved via updateLifecycle.
 *
 * Postgres rows missing request_number are skipped (legacy pre-CRM-link
 * uploads or test rows that were already dual-written by save-candidates).
 *
 * Usage:
 *   node scripts/backfill-postgres-to-dataverse.js --dry-run
 *   node scripts/backfill-postgres-to-dataverse.js              # live
 *   node scripts/backfill-postgres-to-dataverse.js --limit 5    # smoke
 *
 * Idempotent: re-running is a no-op for rows already backfilled. The
 * (potentialreviewer, request) alt-key on wmkf_appreviewersuggestion handles
 * the suggestion side; potentialReviewer is keyed by email.
 */

require('./../lib/dataverse/client').loadEnvLocal();

const { sql } = require('@vercel/postgres');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : null;

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
  const researcherAdapter = await import('../lib/dataverse/adapters/researcher.js');
  const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
  enterDynamicsBypassForScript('backfill-postgres-to-dataverse');

  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE'}${LIMIT ? `  limit=${LIMIT}` : ''}`);

  // 1. Pre-resolve grant cycles (id → short_code)
  const cyclesQ = await sql`SELECT id, short_code FROM grant_cycles`;
  const cycleCodeById = {};
  for (const c of cyclesQ.rows) cycleCodeById[c.id] = c.short_code;

  // 2. Pull every row with a request_number, joined to researcher
  const rowsQ = LIMIT
    ? await sql`
        SELECT
          rs.id, rs.proposal_id, rs.proposal_title, rs.proposal_abstract,
          rs.proposal_authors, rs.proposal_institution, rs.program_area,
          rs.request_number, rs.grant_cycle_id, rs.relevance_score, rs.match_reason,
          rs.sources, rs.selected, rs.invited, rs.accepted, rs.declined, rs.notes,
          rs.email_sent_at, rs.response_received_at, rs.response_type,
          rs.materials_sent_at, rs.reminder_sent_at, rs.reminder_count,
          rs.review_received_at, rs.thankyou_sent_at, rs.review_blob_url,
          rs.review_filename, rs.proposal_url, rs.proposal_password, rs.review_status,
          r.id AS researcher_id, r.name AS researcher_name, r.normalized_name,
          r.primary_affiliation, r.department, r.email, r.email_source, r.website,
          r.orcid, r.orcid_url, r.google_scholar_id, r.google_scholar_url,
          r.h_index, r.i10_index, r.total_citations, r.faculty_page_url
        FROM reviewer_suggestions rs
        JOIN researchers r ON r.id = rs.researcher_id
        WHERE rs.request_number IS NOT NULL AND rs.request_number <> ''
        ORDER BY rs.id ASC
        LIMIT ${LIMIT}
      `
    : await sql`
        SELECT
          rs.id, rs.proposal_id, rs.proposal_title, rs.proposal_abstract,
          rs.proposal_authors, rs.proposal_institution, rs.program_area,
          rs.request_number, rs.grant_cycle_id, rs.relevance_score, rs.match_reason,
          rs.sources, rs.selected, rs.invited, rs.accepted, rs.declined, rs.notes,
          rs.email_sent_at, rs.response_received_at, rs.response_type,
          rs.materials_sent_at, rs.reminder_sent_at, rs.reminder_count,
          rs.review_received_at, rs.thankyou_sent_at, rs.review_blob_url,
          rs.review_filename, rs.proposal_url, rs.proposal_password, rs.review_status,
          r.id AS researcher_id, r.name AS researcher_name, r.normalized_name,
          r.primary_affiliation, r.department, r.email, r.email_source, r.website,
          r.orcid, r.orcid_url, r.google_scholar_id, r.google_scholar_url,
          r.h_index, r.i10_index, r.total_citations, r.faculty_page_url
        FROM reviewer_suggestions rs
        JOIN researchers r ON r.id = rs.researcher_id
        WHERE rs.request_number IS NOT NULL AND rs.request_number <> ''
        ORDER BY rs.id ASC
      `;
  const rows = rowsQ.rows;
  console.log(`Rows to process: ${rows.length}`);

  // 3. Pre-resolve every distinct request_number → GUID (one query each, cached)
  const distinctRequests = [...new Set(rows.map((r) => r.request_number))];
  const guidByRequestNumber = {};
  for (const rn of distinctRequests) {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum',
      filter: `akoya_requestnum eq '${rn.replace(/'/g, "''")}'`,
      top: 1,
    });
    guidByRequestNumber[rn] = records[0]?.akoya_requestid || null;
  }
  const unresolved = distinctRequests.filter((rn) => !guidByRequestNumber[rn]);
  if (unresolved.length) {
    console.log(`WARN: ${unresolved.length} request_numbers did not resolve: ${unresolved.join(', ')}`);
  }

  // 4. Pre-fetch keyword/expertise data per researcher (one batch query)
  const researcherIds = [...new Set(rows.map((r) => r.researcher_id))];
  const kwQ = researcherIds.length
    ? await sql`
        SELECT researcher_id, keyword
        FROM researcher_keywords
        WHERE researcher_id = ANY(${researcherIds})
        ORDER BY relevance_score DESC NULLS LAST
      `
    : { rows: [] };
  const keywordsById = {};
  for (const k of kwQ.rows) {
    if (!keywordsById[k.researcher_id]) keywordsById[k.researcher_id] = [];
    // Skip "source:..." pseudo-keywords; they're not real expertise tags
    if (!k.keyword.startsWith('source:')) keywordsById[k.researcher_id].push(k.keyword);
  }

  // 5. Walk rows
  const stats = { processed: 0, succeeded: 0, skipped: 0, failed: 0, lifecycleApplied: 0 };
  const errors = [];

  for (const row of rows) {
    stats.processed++;
    const requestId = guidByRequestNumber[row.request_number];
    if (!requestId) {
      stats.skipped++;
      console.log(`  [skip ${row.id}] no GUID for request ${row.request_number}`);
      continue;
    }

    const cycleCode = cycleCodeById[row.grant_cycle_id] || null;
    const expertise = (keywordsById[row.researcher_id] || []).join('; ') || null;

    // Sources: stored in Postgres as TEXT[]; potentialReviewer uses comma string
    const sourcesArr = Array.isArray(row.sources) ? row.sources : [];
    const sourcesStr = sourcesArr.join(',') || null;

    // Build the lifecycle delta — only fields with values, mapped to adapter keys
    const lifecycle = {};
    if (row.invited) lifecycle.invited = true;
    if (row.accepted === true) lifecycle.accepted = true;
    else if (row.accepted === false) lifecycle.accepted = false;
    if (row.declined) lifecycle.declined = true;
    if (row.notes) lifecycle.notes = row.notes;
    if (row.email_sent_at) lifecycle.emailSentAt = row.email_sent_at.toISOString();
    if (row.response_type) lifecycle.responseType = row.response_type;
    if (row.response_received_at) lifecycle.responseReceivedAt = row.response_received_at.toISOString();
    if (row.materials_sent_at) lifecycle.materialsSentAt = row.materials_sent_at.toISOString();
    if (row.reminder_sent_at) lifecycle.reminderSentAt = row.reminder_sent_at.toISOString();
    if (row.reminder_count) lifecycle.reminderCount = row.reminder_count;
    if (row.review_received_at) lifecycle.reviewReceivedAt = row.review_received_at.toISOString();
    if (row.thankyou_sent_at) lifecycle.thankYouSentAt = row.thankyou_sent_at.toISOString();
    // review_blob_url intentionally NOT carried over: wmkf_reviewbloburl was
    // retired 2026-05-03 after the Blob → SharePoint cutover. Re-running this
    // backfill must not resurrect the dead field.
    if (row.review_filename) lifecycle.reviewFilename = row.review_filename;
    if (row.proposal_url) lifecycle.proposalUrl = row.proposal_url;
    if (row.proposal_password) lifecycle.proposalPassword = row.proposal_password;
    if (row.review_status) lifecycle.reviewStatus = row.review_status;

    // wmkf_relevancescore is bounded [0,100] in Dataverse. Clamp legacy rows
    // defensively before writing through the adapter.
    let relevance = row.relevance_score;
    if (typeof relevance === 'number' && Number.isFinite(relevance)) {
      if (relevance > 100) relevance = 100;
      else if (relevance < 0) relevance = 0;
    } else {
      relevance = null;
    }

    const matchReason = row.match_reason || null;
    const suggestionLabel = row.proposal_title ? `${row.proposal_title} — ${row.researcher_name}` : null;

    if (DRY_RUN) {
      const lifecycleSummary = Object.keys(lifecycle).length ? Object.keys(lifecycle).join(',') : '(none)';
      console.log(`  [dry ${row.id}] ${row.researcher_name} (${row.email || 'no-email'}) → req ${row.request_number} ${cycleCode} | sources=${sourcesStr || '-'} | lifecycle: ${lifecycleSummary}`);
      stats.succeeded++;
      if (Object.keys(lifecycle).length) stats.lifecycleApplied++;
      continue;
    }

    try {
      const { id: prId } = await potentialReviewerAdapter.upsertByEmail({
        name: row.researcher_name,
        email: row.email,
        // Provenance rides with the address (S387): the researcher upsert below still owns
        // fill/upgrade semantics, but the person row must never exist holding this address
        // with no source because that second write failed.
        emailSource: row.email_source || undefined,
        affiliation: row.primary_affiliation,
        expertise,
        whyChosen: matchReason,
      });

      await researcherAdapter.upsertByPotentialReviewer(prId, {
        name: row.researcher_name,
        normalizedName: row.normalized_name,
        email: row.email,
        emailSource: row.email_source,
        orcid: row.orcid,
        orcidUrl: row.orcid_url,
        googleScholarId: row.google_scholar_id,
        googleScholarUrl: row.google_scholar_url,
        hIndex: row.h_index,
        i10Index: row.i10_index,
        totalCitations: row.total_citations,
        affiliation: row.primary_affiliation,
        department: row.department,
        website: row.website,
        facultyPageUrl: row.faculty_page_url,
        keywords: expertise,
      });

      const { id: suggestionId } = await suggestionAdapter.upsert({
        potentialReviewerId: prId,
        requestId,
        suggestionLabel,
        grantCycleCode: cycleCode,
        programArea: row.program_area || null,
        relevanceScore: relevance,
        matchReason,
        sources: sourcesStr,
        selected: row.selected !== false,
      });

      if (Object.keys(lifecycle).length) {
        await suggestionAdapter.updateLifecycle(suggestionId, lifecycle);
        stats.lifecycleApplied++;
      }

      stats.succeeded++;
      if (stats.processed % 25 === 0) {
        console.log(`  ... ${stats.processed}/${rows.length} (succeeded ${stats.succeeded}, skipped ${stats.skipped}, failed ${stats.failed})`);
      }
    } catch (e) {
      stats.failed++;
      errors.push({ id: row.id, name: row.researcher_name, request: row.request_number, error: e.message });
      console.log(`  [fail ${row.id}] ${row.researcher_name} on ${row.request_number}: ${e.message}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Processed: ${stats.processed}`);
  console.log(`Succeeded: ${stats.succeeded}`);
  console.log(`Lifecycle applied: ${stats.lifecycleApplied}`);
  console.log(`Skipped (no GUID): ${stats.skipped}`);
  console.log(`Failed: ${stats.failed}`);
  if (errors.length) {
    console.log('\nFailures:');
    for (const e of errors) console.log(`  id=${e.id} name="${e.name}" req=${e.request} err=${e.error}`);
  }
  process.exit(stats.failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Backfill aborted:', e);
  process.exit(1);
});

/**
 * Cron service — generate the house-style edited title for newly-Invited
 * research proposals (Route→Service Consolidation Plan, Stage 5).
 *
 * Holds the batch orchestration for /api/cron/generate-grantee-titles; the
 * route is a thin shell (method dispatch, verifyCronSecret byte-untouched,
 * cycle/program validation, model-override warm, DAL context, HTTP mapping).
 * Domain generation itself already lives in lib/services/grantee-title-service.
 *
 * Idempotency (unchanged): write-when-empty + ETag/If-Match — every run is
 * safely re-runnable; a row that fails generation/write is LEFT EMPTY and
 * re-attempted next run (the empty-field predicate is the retry queue).
 * Resilience: bounded concurrency + soft time budget (deferred rows) +
 * per-row Promise.race timeout; per-row fail-soft never aborts the batch.
 * See the route header for the full rationale (S269).
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 summary envelope;
 *   - throws ServiceHttpError 503 with the explicit { error, cycleCode } body
 *     on a top-level query failure (whole run retried next tick);
 *   - ASSUMES a trusted DAL context already exists — the shell establishes it
 *     (historical label 'grantee-titles-cron', same scope).
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { GRANTEE_RESEARCH_PROGRAM_IDS } from '../../../shared/config/granteeResearchPrograms';
import { generateGranteeTitle } from '../grantee-title-service';
import { ServiceHttpError } from '../service-http-error';

const PHASEI_INVITED = 100000003; // wmkf_phaseistatus = Invited (the board flip)
const SELECT = 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_abstract,wmkf_wmkfprojectdescription';
const MIN_ABSTRACT_CHARS = 50;

// Resilience knobs. Concurrency keeps a ~30–60-row cycle batch well inside the 120s
// function cap (pages/api/cron/*.js maxDuration). Two bounds keep us under the hard
// cap even if generation stalls (Codex post-impl ISSUE — the soft budget only gates
// LAUNCHING; the per-row timeout bounds an IN-FLIGHT call, since the shared LLMClient
// timeout is 120s PER ATTEMPT and stacks with 429/529 retries):
//   - TIME_BUDGET_MS stops launching new rows (remainder → deferred to next run).
//   - ROW_TIMEOUT_MS hard-bounds each generation via Promise.race (a stalled call is
//     abandoned + counted failed → retried next run).
// Worst case wall ≈ TIME_BUDGET_MS + ROW_TIMEOUT_MS = 110s < 120s cap.
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 70_000;
const ROW_TIMEOUT_MS = 40_000;

// Valid wmkf_ai_runsource picklist value (executePrompt rejects unknown values).
// 'PowerAutomate Auto' = the closest "automated background" value today; revisit if a
// dedicated 'Vercel Auto' value is added to the option set.
const RUN_SOURCE = 'PowerAutomate Auto';

/**
 * Run one title-generation batch for a board cycle.
 *
 * @param {Object} args
 * @param {string} args.cycleCode - validated by the shell
 * @param {string} args.cycleFilter - the OData meeting-date window for the cycle
 * @returns {Promise<Object>} the historical 200 summary
 * @throws {ServiceHttpError} 503 { error: 'Awardee query failed.', cycleCode }
 */
export async function runGranteeTitleGeneration({ cycleCode, cycleFilter }) {
  const programClause = GRANTEE_RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  const filter =
    `${cycleFilter} and wmkf_phaseistatus eq ${PHASEI_INVITED}` +
    ` and wmkf_wmkfprojectdescription eq null and (${programClause})`;

  let records = [];
  let capped = false;
  let totalCount = 0;
  try {
    // queryAllRecords (paginated) — NOT queryRecords (caps $top at 100); the research
    // Invited set for a cycle can exceed 100. Honor `capped` rather than drop the tail.
    const result = await grantRequestAdapter.queryAllRequests({ select: SELECT, filter });
    records = result.records || [];
    capped = Boolean(result.capped);
    totalCount = result.totalCount || records.length;
  } catch (err) {
    console.error('[generate-grantee-titles] query failed:', err.message);
    throw new ServiceHttpError('Awardee query failed.', {
      httpStatus: 503,
      body: { error: 'Awardee query failed.', cycleCode },
    });
  }

  const summary = {
    cycleCode,
    totalCount,
    scanned: records.length,
    generated: 0,
    skippedNoSource: 0,
    skippedConcurrent: 0,
    failed: 0,
    deferred: 0,
    // `capped` = the query hit MAX_EXPORT_RECORDS and dropped the tail (won't happen
    // for a ~30–60-row research-Invited cycle, but reported honestly). Any capped or
    // budget-deferred remainder is still Invited + empty next run, so the next
    // scheduled run picks it up — the empty-field predicate is the retry.
    capped,
    failures: [],
  };

  const deadline = Date.now() + TIME_BUDGET_MS;
  let nextIndex = 0;
  async function worker() {
    while (true) {
      if (Date.now() > deadline) return; // graceful stop; unclaimed rows defer to next run
      const i = nextIndex++;
      if (i >= records.length) return;
      await processRow(records[i], summary);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length || 1) }, () => worker()));

  // Anything never processed (time-budget stop) is deferred to the next run. If the
  // query was `capped`, the unreturned remainder (totalCount - scanned) is also
  // effectively deferred — still Invited + empty next run.
  const processed = summary.generated + summary.skippedNoSource + summary.skippedConcurrent + summary.failed;
  summary.deferred = (summary.scanned - processed) + (capped ? Math.max(totalCount - summary.scanned, 0) : 0);

  const log = summary.failed > 0 || summary.deferred > 0 || summary.capped ? console.error : console.log;
  log('[generate-grantee-titles] summary', JSON.stringify(summary));
  return summary;
}

/**
 * Generate + persist one row's edited title. Fail-soft per row (never throws to the
 * batch): a failure is recorded and the field is left empty → retried next run.
 */
async function processRow(row, summary) {
  const requestNum = row.akoya_requestnum;
  const title = row.akoya_title;
  const abstract = row.wmkf_abstract;

  if (!title || typeof title !== 'string' || !abstract || typeof abstract !== 'string'
    || abstract.trim().length < MIN_ABSTRACT_CHARS) {
    summary.skippedNoSource++;
    summary.failures.push({ requestNum, reason: 'missing/short title or abstract' });
    return;
  }

  let editedTitle;
  let timer;
  try {
    // Hard-bound each generation so a stalled/retry-heavy call can't run the function
    // into the 120s cap (the shared LLMClient timeout is per-attempt). A timeout
    // abandons the in-flight call and is counted failed → retried next run.
    const out = await Promise.race([
      generateGranteeTitle({ sourceTitle: title, sourceAbstract: abstract, runSource: RUN_SOURCE }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`row timeout after ${ROW_TIMEOUT_MS}ms`)), ROW_TIMEOUT_MS); }),
    ]);
    editedTitle = out.editedTitle;
  } catch (err) {
    // Timeout / refusal / short output / persistent service-unavailable after client
    // retries. Field stays empty → retried next run.
    summary.failed++;
    summary.failures.push({ requestNum, reason: `generation: ${err.message}` });
    return;
  } finally {
    clearTimeout(timer); // release the race timer whichever side won (no leaked handle)
  }

  try {
    // Re-read for a FRESH _etag + re-confirm empty (TOCTOU: staff may have curated it
    // between the batch query and now). Refuse a bare write without an _etag.
    const fresh = await grantRequestAdapter.getById(row.akoya_requestid, {
      select: 'wmkf_wmkfprojectdescription',
    });
    // Empty Memo is stored as null (verified S269: `eq null` matches the empty field),
    // but recheck with a trimmed test so a stray whitespace-only value also counts as
    // "curated, do not overwrite".
    const current = fresh.wmkf_wmkfprojectdescription;
    if (current && String(current).trim()) {
      summary.skippedConcurrent++; // staff (or a prior run) filled it — never overwrite
      return;
    }
    if (!fresh._etag) {
      summary.failed++;
      summary.failures.push({ requestNum, reason: 'no _etag (refused bare write)' });
      return;
    }
    await grantRequestAdapter.updateById(
      row.akoya_requestid,
      { wmkf_wmkfprojectdescription: editedTitle },
      { ifMatch: fresh._etag },
    );
    summary.generated++;
  } catch (err) {
    if (err.status === 412) {
      summary.skippedConcurrent++; // concurrent change since the re-read
      return;
    }
    summary.failed++;
    summary.failures.push({ requestNum, reason: `write: ${err.message}` });
  }
}

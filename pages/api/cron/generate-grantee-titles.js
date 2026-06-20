/**
 * Cron: generate the house-style edited title for newly-Invited research proposals.
 *
 * Fires at the Phase I→II board flip (`wmkf_phaseistatus = Invited`) and fills the
 * EXISTING `akoya_request.wmkf_wmkfprojectdescription` (the board-summary "To [verb] …"
 * objective) ONLY when it is empty — never overwriting staff's manual curation.
 * Generated once here, reused by the Board Book and (later) the abstract assembly.
 * See docs/GRANTEE_PORTAL_SPEC.md (D7) + docs/GRANTEE_PORTAL_BUILD_PLAN.md (chunk 7)
 * + the project-phaseistatus-decision-lifecycle memory.
 *
 * Auth: Vercel CRON_SECRET (`verifyCronSecret`, matches all /api/cron/* routes).
 *
 * Resilience (S269 owner priority = timeout + service-unavailable):
 *  - Idempotent: write-when-empty + ETag/If-Match → every run is safely re-runnable;
 *    a row that fails generation/write is LEFT EMPTY and re-attempted on the next run
 *    (the empty-field predicate is the retry queue — no separate retry state).
 *  - Timeout: bounded concurrency + a soft time budget (stop launching new rows with
 *    headroom under the 120s function cap); unprocessed rows are `deferred` to next run.
 *  - Service-unavailable: the LLM client already retries 429/529 + fallback-swaps on
 *    529; a still-failing row is counted `failed` (left empty, retried next run) and
 *    does NOT abort the batch. A top-level query failure → 503 (whole run retried next).
 *  - Monitor: returns + logs a structured summary (error-level if any failed/deferred).
 *
 * Scope: research grants only (`GRANTEE_RESEARCH_PROGRAM_IDS`), current open board
 * cycle by default; `?cycleCode=` overrides it (one-off backfill / a prior cycle / test).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { cycleCodeToOdataFilter } from '../../../lib/utils/cycle-code';
import { GRANTEE_RESEARCH_PROGRAM_IDS } from '../../../shared/config/granteeResearchPrograms';
import { generateGranteeTitle } from '../../../lib/services/grantee-title-service';

const PHASEI_INVITED = 100000003; // wmkf_phaseistatus = Invited (the board flip)
const ENTITY_SET = 'akoya_requests';
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
 * Current open board cycle from today: first half of the year → the June meeting
 * (`Jyy`), second half → December (`Dyy`). The seasonal schedule only runs this
 * route in Apr–Jun / Oct–Dec, so this always resolves to the cycle in prep.
 * `?cycleCode=` overrides for a one-off backfill of a prior cycle.
 */
function currentCycleCode(now) {
  const month = now.getUTCMonth() + 1;
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  return (month <= 6 ? 'J' : 'D') + yy;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  const cycleCode = (typeof req.query?.cycleCode === 'string' && req.query.cycleCode.trim())
    || currentCycleCode(new Date());
  const cycleFilter = cycleCodeToOdataFilter(cycleCode, 'wmkf_meetingdate');
  if (!cycleFilter) {
    return res.status(400).json({ error: `Invalid cycleCode "${cycleCode}" (expected e.g. J26 / D26).` });
  }
  if (!GRANTEE_RESEARCH_PROGRAM_IDS.length) {
    return res.status(500).json({ error: 'No research programs are configured.' });
  }

  // Warm model overrides BEFORE any model resolution (generateGranteeTitle →
  // executePrompt resolves the prompt's model) — required by check:model-override-warming.
  await loadModelOverrides();

  return bypassDynamicsRestrictions('grantee-titles-cron', async () => {
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
      const result = await DynamicsService.queryAllRecords(ENTITY_SET, { select: SELECT, filter });
      records = result.records || [];
      capped = Boolean(result.capped);
      totalCount = result.totalCount || records.length;
    } catch (err) {
      console.error('[generate-grantee-titles] query failed:', err.message);
      return res.status(503).json({ error: 'Awardee query failed.', cycleCode });
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
    return res.status(200).json(summary);
  });
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
    const fresh = await DynamicsService.getRecord(ENTITY_SET, row.akoya_requestid, {
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
    await DynamicsService.updateRecord(
      ENTITY_SET,
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

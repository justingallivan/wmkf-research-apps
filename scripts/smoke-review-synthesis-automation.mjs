#!/usr/bin/env node
/**
 * Controlled production smoke for automatic review synthesis.
 *
 * Dry-run is the default. The execute path:
 *   1. proves the dedicated Request 1002788 reviewer is clean and the global
 *      automatic-synthesis census has zero eligible requests;
 *   2. stages one synthetic review through the normal Manual Review Entry
 *      producer;
 *   3. proves that request is the only eligible request;
 *   4. invokes the production cron with scanLimit=1 and claimLimit=1;
 *   5. captures the durable job, AI-run, maintenance-run, and synthesis proof;
 *   6. atomically deletes only the staged answer rows and restores the four
 *      parent fields changed by Manual Review Entry.
 *
 * The generated synthesis and append-only audit/ledger rows are intentionally
 * retained. The temporary review is always cleaned up in a finally block.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes \
 *     node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/smoke-review-synthesis-automation.mjs
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes \
 *   DATAVERSE_PROD_WRITE_ACK="review synthesis automatic smoke 2026-07-28" \
 *     node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/smoke-review-synthesis-automation.mjs \
 *     --execute \
 *     --confirm=RUN_REVIEW_SYNTHESIS_AUTOMATIC_SMOKE_2026_07_28
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');
loadEnvLocal();

const { sql } = require('@vercel/postgres');
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const answerAdapter = await import('../lib/dataverse/adapters/review-answer.js');
const { runChangeset } = await import('../lib/dataverse/core/changeset.js');
const {
  getAuthoritativeQuestionSet,
  questionSetVersion,
} = await import('../lib/external/review-question-fetcher.js');
const {
  submitManualReviewEntry,
} = await import('../lib/services/review-manager/manual-review-entry-service.js');
const {
  evaluateReviewSynthesisReadiness,
} = await import('../lib/services/review-synthesis-readiness.js');
const {
  loadReviewSynthesisContext,
} = await import('../lib/services/review-manager/synthesize-reviews-service.js');
const ReviewDraftService = (await import('../lib/services/review-draft-service.js')).default;

enterDynamicsBypassForScript('smoke-review-synthesis-automation');

const EXECUTE = process.argv.includes('--execute');
const CONFIRM_TOKEN = 'RUN_REVIEW_SYNTHESIS_AUTOMATIC_SMOKE_2026_07_28';
const EXPECTED_ACK = 'review synthesis automatic smoke 2026-07-28';
const REQUEST_ID = 'feabe26f-dc1b-f111-8341-000d3a306da2';
const REQUEST_NUMBER = '1002788';
const SUGGESTION_ID = '48c0baac-d17b-f111-ab0f-000d3a306da2';
const POTENTIAL_REVIEWER_ID = '92ff0fab-d17b-f111-ab0f-000d3a3064b7';
const ACTING_USER_SYSTEM_ID = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const EXPECTED_REVIEW_STATUS = 100000001; // Materials Sent
const EXPECTED_AFFILIATION = 'Stanford';
const MARKER = 'CONTROLLED AUTOMATIC SYNTHESIS SMOKE 2026-07-28';
const CRON_URL =
  'https://applications.wmkeck.org/api/cron/drain-review-syntheses?scanLimit=1&claimLimit=1';

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_reviewuploadedbystaff',
  'wmkf_revieweraffiliation',
  'wmkf_emailsentat',
  'wmkf_materialssentat',
  'wmkf_remindersentat',
  'wmkf_remindercount',
  'wmkf_respondremindersentat',
  'wmkf_thankyousentat',
  'wmkf_completedat',
  'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder',
  'wmkf_externaltokenissued',
  'wmkf_externaltokenexpires',
  'wmkf_externaltokenrevoked',
].join(',');

function argValue(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Safety invariant failed: ${message}`);
}

function targetHostname() {
  try {
    return new URL(process.env.DYNAMICS_URL).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash('sha256').update(value == null ? '' : String(value)).digest('hex');
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return iso(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
}

function assertInvocationSafety() {
  invariant(
    process.env.DATAVERSE_ALLOW_PROD_READS === 'yes',
    'DATAVERSE_ALLOW_PROD_READS must equal "yes"',
  );
  invariant(
    targetHostname() === 'wmkf.crm.dynamics.com',
    'DYNAMICS_URL must target wmkf.crm.dynamics.com',
  );
  if (!EXECUTE) return;
  invariant(argValue('confirm') === CONFIRM_TOKEN, `--confirm must equal ${CONFIRM_TOKEN}`);
  invariant(
    process.env.DATAVERSE_PROD_WRITE_ACK === EXPECTED_ACK,
    `DATAVERSE_PROD_WRITE_ACK must equal "${EXPECTED_ACK}"`,
  );
  invariant(process.env.CRON_SECRET, 'CRON_SECRET is required');
}

async function readSuggestion() {
  return DynamicsService.getRecord('wmkf_appreviewersuggestions', SUGGESTION_ID, {
    select: SUGGESTION_SELECT,
  });
}

async function readAnswers() {
  const bySuggestion = await answerAdapter.fetchAnswersBySuggestion([SUGGESTION_ID]);
  return bySuggestion[SUGGESTION_ID] || [];
}

async function readRequest() {
  const row = await DynamicsService.getRecord('akoya_requests', REQUEST_ID, {
    select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_reviewsynthesisjson,modifiedon',
  });
  return {
    id: row.akoya_requestid,
    number: String(row.akoya_requestnum),
    title: row.akoya_title || null,
    modifiedOn: row.modifiedon || null,
    synthesisLength: row.wmkf_reviewsynthesisjson?.length || 0,
    synthesisSha256: sha256(row.wmkf_reviewsynthesisjson),
    synthesisJson: row.wmkf_reviewsynthesisjson ?? null,
  };
}

async function readDraft() {
  return ReviewDraftService.getBySuggestion(SUGGESTION_ID);
}

async function readJobs(since = null) {
  const result = since
    ? await sql`
        SELECT *
          FROM review_synthesis_jobs
         WHERE request_id = ${REQUEST_ID}
           AND created_at >= ${since}
         ORDER BY created_at DESC, id DESC
      `
    : await sql`
        SELECT *
          FROM review_synthesis_jobs
         WHERE request_id = ${REQUEST_ID}
         ORDER BY created_at DESC, id DESC
      `;
  return result.rows;
}

async function readMaintenanceRuns(since = null) {
  const result = since
    ? await sql`
        SELECT *
          FROM maintenance_runs
         WHERE job_name = 'drain-review-syntheses'
           AND started_at >= ${since}
         ORDER BY started_at DESC, id DESC
      `
    : await sql`
        SELECT *
          FROM maintenance_runs
         WHERE job_name = 'drain-review-syntheses'
         ORDER BY started_at DESC, id DESC
         LIMIT 5
      `;
  return result.rows;
}

async function readAiRuns(since = null) {
  const clauses = [`_wmkf_ai_request_value eq ${REQUEST_ID}`];
  if (since) clauses.push(`createdon ge ${new Date(since).toISOString()}`);
  const result = await DynamicsService.queryAllRecords('wmkf_ai_runs', {
    select: [
      'wmkf_ai_runid',
      'wmkf_ai_runnum',
      '_wmkf_ai_request_value',
      'wmkf_ai_tasktype',
      'wmkf_ai_status',
      'wmkf_ai_model',
      'wmkf_ai_promptversion',
      'wmkf_ai_notes',
      'createdon',
      'modifiedon',
    ].join(','),
    filter: clauses.join(' and '),
    orderby: 'createdon desc',
  });
  return result.records || [];
}

function groupByRequest(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const requestId = row?._wmkf_request_value;
    if (!requestId) continue;
    if (!grouped.has(requestId)) grouped.set(requestId, []);
    grouped.get(requestId).push(row);
  }
  return grouped;
}

async function eligibleRequests() {
  const scan = await suggestionAdapter.findReviewSynthesisParticipants();
  invariant(!scan.capped, 'global review-synthesis participant scan must not be capped');
  const grouped = groupByRequest(scan.records);
  const eligible = [];
  for (const [requestId, rows] of grouped) {
    const lifecycle = evaluateReviewSynthesisReadiness(rows);
    if (!lifecycle.ready) continue;
    const context = await loadReviewSynthesisContext(requestId, { suggestions: rows });
    if (context.readiness.ready) {
      eligible.push({
        requestId,
        inputHash: context.readiness.inputHash,
        participantCount: context.readiness.participantCount,
        submittedCount: context.readiness.submittedCount,
      });
    }
  }
  return {
    participantRows: scan.records.length,
    requestCount: grouped.size,
    eligible,
  };
}

async function baselineSnapshot() {
  const [suggestion, answers, request, draft, jobs, maintenanceRuns, aiRuns, census, questions] =
    await Promise.all([
      readSuggestion(),
      readAnswers(),
      readRequest(),
      readDraft(),
      readJobs(),
      readMaintenanceRuns(),
      readAiRuns(),
      eligibleRequests(),
      getAuthoritativeQuestionSet(),
    ]);
  return {
    capturedAt: new Date().toISOString(),
    targetHostname: targetHostname(),
    suggestion,
    answers,
    request,
    draft,
    jobs,
    maintenanceRuns,
    aiRuns,
    census,
    questionSetVersion: questionSetVersion(questions),
    questionKeys: questions.map((question) => question.key),
  };
}

function assertCleanBaseline(snapshot) {
  const { suggestion, request } = snapshot;
  invariant(request.id === REQUEST_ID, 'request GUID drift');
  invariant(request.number === REQUEST_NUMBER, 'request number drift');
  invariant(suggestion.wmkf_appreviewersuggestionid === SUGGESTION_ID, 'suggestion GUID drift');
  invariant(suggestion._wmkf_request_value === REQUEST_ID, 'suggestion request link drift');
  invariant(
    suggestion._wmkf_potentialreviewer_value === POTENTIAL_REVIEWER_ID,
    'suggestion potential-reviewer link drift',
  );
  invariant(suggestion.wmkf_selected === true, 'suggestion must remain selected');
  invariant(suggestion.wmkf_invited === true, 'suggestion must remain invited');
  invariant(suggestion.wmkf_accepted === true, 'suggestion must remain accepted');
  invariant(suggestion.wmkf_declined === false, 'suggestion must remain non-declined');
  invariant(
    suggestion.wmkf_reviewstatus === EXPECTED_REVIEW_STATUS,
    'suggestion must remain at Materials Sent',
  );
  invariant(!suggestion.wmkf_reviewreceivedat, 'suggestion must have no received review');
  invariant(
    suggestion.wmkf_reviewuploadedbystaff === false,
    'suggestion must not already be marked as staff-uploaded',
  );
  invariant(
    suggestion.wmkf_revieweraffiliation === EXPECTED_AFFILIATION,
    'reviewer affiliation drift',
  );
  invariant(snapshot.answers.length === 0, 'suggestion must have zero answer rows');
  invariant(snapshot.draft == null, 'suggestion must have no Postgres draft');
  invariant(snapshot.census.eligible.length === 0, 'global automatic-synthesis census must be zero');
  invariant(snapshot.questionKeys.length === 12, 'live form must contain affiliation plus 11 answers');
}

function syntheticAnswers(questions) {
  return Object.fromEntries(questions.map((question) => {
    if (question.type === 'string') {
      return [question.key, `${EXPECTED_AFFILIATION} — ${MARKER}`];
    }
    if (question.type === 'picklist') {
      const option = question.options?.[Math.min(1, question.options.length - 1)];
      invariant(option, `picklist ${question.key} must have an option`);
      return [question.key, option.value];
    }
    if (question.type === 'multiselect') {
      const options = question.options?.slice(0, 2) || [];
      invariant(options.length > 0, `multiselect ${question.key} must have an option`);
      return [question.key, options.map((option) => option.value)];
    }
    if (question.type === 'richtext') {
      return [
        question.key,
        `<p><strong>${MARKER}</strong></p><p>Synthetic test response for ${question.key}. `
          + 'This is operational verification data, not a substantive peer review.</p>',
      ];
    }
    throw new Error(`Unsupported live question type: ${question.type}`);
  }));
}

async function callCron() {
  const response = await fetch(CRON_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

function sameScalar(actual, expected) {
  return (actual ?? null) === (expected ?? null);
}

function sameInstant(actual, expected) {
  const actualMs = Date.parse(actual);
  const expectedMs = Date.parse(expected);
  return Number.isFinite(actualMs)
    && Number.isFinite(expectedMs)
    && Math.abs(actualMs - expectedMs) < 1000;
}

async function cleanupStagedReview({ baseline, receivedAt, expectedQuestionKeys }) {
  const [suggestion, answers] = await Promise.all([readSuggestion(), readAnswers()]);
  invariant(
    sameInstant(suggestion.wmkf_reviewreceivedat, receivedAt),
    'cleanup parent received timestamp no longer matches this smoke',
  );
  invariant(
    suggestion.wmkf_reviewuploadedbystaff === true,
    'cleanup parent no longer carries this smoke staff-upload marker',
  );
  invariant(answers.length === expectedQuestionKeys.length, 'cleanup answer-row count drift');
  invariant(
    JSON.stringify(answers.map((row) => row.questionKey).sort())
      === JSON.stringify([...expectedQuestionKeys].sort()),
    'cleanup answer-key set drift',
  );
  const richTextRows = answers.filter((row) => row.questionType === 'richtext');
  invariant(
    richTextRows.length > 0
      && richTextRows.every((row) => String(row.answerText || '').includes(MARKER)),
    'cleanup rich-text markers do not match this smoke',
  );

  const snapshotKeys = new Set(expectedQuestionKeys);
  const answerDeletes = answers.map((row) => ({
    method: 'DELETE',
    entitySet: answerAdapter.ENTITY_SET_NAME,
    keyPredicate: answerAdapter.answerRowKeyPredicate(
      SUGGESTION_ID,
      row.questionKey,
      snapshotKeys,
    ),
  }));
  const parentRestore = {
    method: 'PATCH',
    entitySet: suggestionAdapter.ENTITY_SET_NAME,
    key: SUGGESTION_ID,
    ifMatch: suggestion._etag,
    body: {
      wmkf_reviewreceivedat: baseline.suggestion.wmkf_reviewreceivedat ?? null,
      wmkf_reviewstatus: baseline.suggestion.wmkf_reviewstatus ?? null,
      wmkf_revieweraffiliation: baseline.suggestion.wmkf_revieweraffiliation ?? null,
      wmkf_reviewuploadedbystaff: baseline.suggestion.wmkf_reviewuploadedbystaff ?? false,
    },
  };
  await runChangeset([...answerDeletes, parentRestore], {
    actingUserSystemId: ACTING_USER_SYSTEM_ID,
  });

  const [restored, remainingAnswers, draft, census] = await Promise.all([
    readSuggestion(),
    readAnswers(),
    readDraft(),
    eligibleRequests(),
  ]);
  invariant(remainingAnswers.length === 0, 'answer cleanup did not return to zero');
  invariant(draft == null, 'Postgres draft appeared during the smoke');
  for (const field of [
    'wmkf_reviewreceivedat',
    'wmkf_reviewstatus',
    'wmkf_revieweraffiliation',
    'wmkf_reviewuploadedbystaff',
  ]) {
    invariant(
      sameScalar(restored[field], baseline.suggestion[field]),
      `parent field ${field} did not restore exactly`,
    );
  }
  invariant(census.eligible.length === 0, 'post-cleanup automatic-synthesis census must be zero');
  return {
    restoredSuggestion: restored,
    remainingAnswers,
    draft,
    census,
  };
}

async function main() {
  assertInvocationSafety();
  const baseline = await baselineSnapshot();
  assertCleanBaseline(baseline);

  const publicBaseline = {
    ...baseline,
    request: {
      ...baseline.request,
      synthesisJson: undefined,
    },
  };
  console.log('BASELINE_JSON=' + JSON.stringify(clean(publicBaseline)));
  if (!EXECUTE) {
    console.log('DRY_RUN_OK=true');
    return;
  }

  const startedAt = new Date();
  const questions = await getAuthoritativeQuestionSet();
  const setVersion = questionSetVersion(questions);
  invariant(setVersion === baseline.questionSetVersion, 'question set changed after baseline');

  let receivedAt = null;
  let expectedQuestionKeys = [];
  let executionEvidence = null;
  let primaryError = null;
  let cleanupEvidence = null;

  try {
    const staged = await submitManualReviewEntry({
      suggestionId: SUGGESTION_ID,
      answers: syntheticAnswers(questions),
      setVersion,
      actingUserSystemId: ACTING_USER_SYSTEM_ID,
    });
    receivedAt = staged.receivedAt;
    expectedQuestionKeys = questions
      .filter((question) =>
        question.type === 'picklist'
        || question.type === 'multiselect'
        || question.type === 'richtext')
      .map((question) => question.key);

    const [stagedSuggestion, stagedAnswers, stagedCensus] = await Promise.all([
      readSuggestion(),
      readAnswers(),
      eligibleRequests(),
    ]);
    invariant(
      sameInstant(stagedSuggestion.wmkf_reviewreceivedat, receivedAt),
      'staged receivedAt mismatch',
    );
    invariant(stagedSuggestion.wmkf_reviewuploadedbystaff === true, 'staff-upload flag not staged');
    invariant(stagedAnswers.length === expectedQuestionKeys.length, 'staged answer count mismatch');
    invariant(stagedCensus.eligible.length === 1, 'staged census must have exactly one eligible request');
    invariant(
      stagedCensus.eligible[0].requestId === REQUEST_ID,
      'the only staged eligible request must be Request 1002788',
    );

    const cronAttempts = [await callCron()];
    // A prior failed smoke may leave a retryable job whose fingerprint no
    // longer exists after cleanup. One bounded drain cancels that stale lease;
    // a second bounded drain may then claim the newly staged fingerprint.
    if (
      cronAttempts[0].ok
      && cronAttempts[0].body?.completed === 0
      && cronAttempts[0].body?.cancelled === 1
    ) {
      cronAttempts.push(await callCron());
    }
    const cron = cronAttempts[cronAttempts.length - 1];
    const [jobs, maintenanceRuns, aiRuns, request] = await Promise.all([
      readJobs(startedAt),
      readMaintenanceRuns(startedAt),
      readAiRuns(startedAt),
      readRequest(),
    ]);
    const automaticJob = jobs.find((job) => job.mode === 'automatic') || null;
    invariant(cron.ok, `cron returned HTTP ${cron.status}`);
    invariant(cron.body?.enabled === true, 'cron did not report automation enabled');
    invariant(automaticJob, 'no automatic job row was created');
    invariant(automaticJob.status === 'completed', 'automatic job did not complete');
    invariant(automaticJob.attempts === 1, 'automatic job attempts must equal one');
    invariant(automaticJob.run_id, 'automatic job is missing its AI-run ID');
    invariant(
      aiRuns.some((run) => run.wmkf_ai_runid === automaticJob.run_id),
      'matching Dataverse AI-run row was not found',
    );
    invariant(request.synthesisJson, 'request synthesis memo was not written');
    invariant(
      maintenanceRuns.some((run) => run.status === 'completed'),
      'no completed maintenance run was recorded',
    );

    executionEvidence = {
      startedAt: startedAt.toISOString(),
      receivedAt,
      stagedSuggestion,
      stagedAnswerIds: stagedAnswers.map((row) => row.answerId),
      stagedAnswerKeys: stagedAnswers.map((row) => row.questionKey),
      stagedCensus,
      cronAttempts,
      jobs,
      maintenanceRuns,
      aiRuns,
      request: {
        ...request,
        synthesisJson: undefined,
      },
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (receivedAt) {
      try {
        cleanupEvidence = await cleanupStagedReview({
          baseline,
          receivedAt,
          expectedQuestionKeys,
        });
      } catch (cleanupError) {
        console.error('CLEANUP_ERROR=' + (cleanupError?.stack || cleanupError));
        if (!primaryError) primaryError = cleanupError;
      }
    }
  }

  if (executionEvidence) {
    console.log('EXECUTION_JSON=' + JSON.stringify(clean(executionEvidence)));
  }
  if (cleanupEvidence) {
    console.log('CLEANUP_JSON=' + JSON.stringify(clean(cleanupEvidence)));
  }
  if (primaryError) throw primaryError;
  invariant(cleanupEvidence, 'cleanup evidence was not produced');
  console.log('SMOKE_OK=true');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});

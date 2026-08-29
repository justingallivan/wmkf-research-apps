/**
 * Review Manager — AI review-synthesis service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for POST /api/review-manager/synthesize-reviews
 * (workbench Reviews tab Phase 4, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md);
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping). Composes a plain-text digest of every submitted
 * reviewer's answers (never answerHtml — untrusted rich text not needed for
 * the synthesis) and runs it through the shared Executor against the
 * `review-synthesis.generate` prompt, which writes the result to
 * `akoya_request.wmkf_reviewsynthesisjson`.
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns { ok: true, synthesis, runId, writtenToDynamics: true };
 *   - throws SynthesizeReviewsError (extends ServiceHttpError) with an
 *     explicit `body` (this route speaks `{ ok: false, reason }`):
 *       409 no_submitted_reviews (cheap failure, LLM never called),
 *       409 already_exists (+modifiedOn) — the regeneration gate,
 *       409 conflict (+runId, conflicts) — defensive result.blocked handling,
 *       409|502 writeback failure (+runId, writtenToDynamics:false; 409 iff
 *       reason === 'concurrent_edit', else 502);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Regeneration gating lives HERE, not in the Executor: the prompt's output
 * guard is `always-overwrite` (regeneration must always be possible), so this
 * service reads the current column value first and refuses to call the LLM
 * when it is already populated and `overwrite` was not passed.
 */

import { EXECUTOR_BUDGETS } from '../../../shared/config/executorBudgets.js';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request';
import { queryReviewers } from '../../dataverse/adapters/potential-reviewer';
import { parseStoredAnswerValues, queryAllAnswers } from '../../dataverse/adapters/review-answer';
import { executePrompt } from '../execute-prompt';
import { ServiceHttpError } from '../service-http-error';
import { chunk as chunked } from '../../utils/chunk.js';
import {
  buildReviewSynthesisDigest,
  hashReviewSynthesisDigest,
} from '../review-synthesis-content.js';
import { evaluateReviewSynthesisReadiness } from '../review-synthesis-readiness.js';
import {
  completeReviewSynthesisJob,
  recordReviewSynthesisJobFailure,
  startManualReviewSynthesisJob,
} from '../review-synthesis-job-service.js';

const PROMPT_NAME = 'review-synthesis.generate';

const ANSWER_FIELDS = [
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_answervalue',
  'wmkf_answervalues',
  'wmkf_answertext',
  '_wmkf_appreviewersuggestion_value',
];

/**
 * Domain error carrying an HTTP status AND the exact non-`{ error }` JSON
 * body the shell must send (plan Decision 3, `body` set explicitly).
 */
export class SynthesizeReviewsError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'SynthesizeReviewsError';
  }
}

/**
 * Read the answer-snapshot rows (plain metadata + answerText only; the digest
 * never touches answerHtml) for a set of submitted suggestions. Same keyed-child query
 * pattern as `pages/api/review-manager/reviewers.js#fetchAnswersBySuggestion`,
 * kept local rather than extracted since that route's helper isn't exported.
 */
async function fetchAnswerTextsBySuggestion(suggestionIds) {
  if (!suggestionIds?.length) return {};
  const out = {};
  const CHUNK = 20;
  for (const chunk of chunked(suggestionIds, CHUNK)) {
    const orChain = chunk.map((id) => `_wmkf_appreviewersuggestion_value eq ${id}`).join(' or ');
    const { records, capped } = await queryAllAnswers({
      select: ANSWER_FIELDS.join(','),
      filter: orChain,
      orderby: 'wmkf_questionorder',
    });
    if (capped) {
      throw new Error(
        `synthesize-reviews: queryAllRecords truncated at the 5000-row cap for ${chunk.length} suggestion(s) — answer snapshot would be incomplete.`,
      );
    }
    for (const a of records) {
      const sid = a._wmkf_appreviewersuggestion_value;
      if (!sid) continue;
      const isMultiselect = a.wmkf_questiontype === 'multiselect';
      const parsedValues = isMultiselect
        ? parseStoredAnswerValues(a.wmkf_answervalues)
        : { answerValues: null, answerValuesUnreadable: false };
      const answerValuesUnreadable = isMultiselect
        && (parsedValues.answerValuesUnreadable || parsedValues.answerValues === null);
      (out[sid] ||= []).push({
        questionKey: a.wmkf_questionkey || '',
        questionOrder: a.wmkf_questionorder ?? 0,
        questionText: a.wmkf_questiontext || '',
        questionType: a.wmkf_questiontype || '',
        answerValue: a.wmkf_answervalue ?? null,
        answerText: a.wmkf_answertext || '',
        answerValues: parsedValues.answerValues,
        answerValuesUnreadable,
      });
    }
  }
  for (const sid of Object.keys(out)) {
    out[sid].sort((x, y) => x.questionOrder - y.questionOrder);
  }
  return out;
}

async function fetchPersonNames(personIds) {
  if (!personIds?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(personIds, CHUNK)) {
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_name',
      filter: orChain,
      top: 500,
    });
    for (const p of records) out[p.wmkf_potentialreviewersid] = p.wmkf_name || null;
  }
  return out;
}

function isEmptyMemo(v) {
  if (v == null) return true;
  if (typeof v !== 'string') return true;
  return v.trim().length === 0;
}

/**
 * Synthesize a proposal's submitted peer reviews via the shared Executor.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {boolean} args.overwrite - explicit regeneration opt-in
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ ok: true, synthesis: Object|null, runId: string, writtenToDynamics: true }>}
 * @throws {SynthesizeReviewsError} see header for the 409/502 matrix
 */
export async function loadReviewSynthesisContext(requestId, { suggestions: suppliedSuggestions } = {}) {
  const lifecycleSuggestions = suppliedSuggestions
    || await suggestionAdapter.findByRequest(requestId, {
      selectedOnly: true,
      requireComplete: true,
    });
  const suggestions = lifecycleSuggestions
    .filter((s) => s.wmkf_reviewreceivedat);

  if (suggestions.length === 0) {
    throw new SynthesizeReviewsError('no submitted reviews', 409, { ok: false, reason: 'no_submitted_reviews' });
  }

  const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const suggestionIds = suggestions.map((s) => s.wmkf_appreviewersuggestionid);
  const [nameByPerson, answersBySuggestion] = await Promise.all([
    fetchPersonNames(personIds),
    fetchAnswerTextsBySuggestion(suggestionIds),
  ]);

  const reviewers = suggestions.map((s) => ({
    name: nameByPerson[s._wmkf_potentialreviewer_value] || null,
    affiliation: s.wmkf_revieweraffiliation || null,
    answers: answersBySuggestion[s.wmkf_appreviewersuggestionid] || [],
  }));

  const reviewsDigest = buildReviewSynthesisDigest(reviewers);
  const contentHash = hashReviewSynthesisDigest(reviewsDigest);
  const readiness = evaluateReviewSynthesisReadiness(lifecycleSuggestions, { contentHash });
  return {
    lifecycleSuggestions,
    submittedSuggestions: suggestions,
    reviewers,
    reviewsDigest,
    contentHash,
    readiness,
  };
}

function publicReadiness(readiness) {
  return {
    ready: readiness.ready,
    canRunManually: readiness.canRunManually,
    participantCount: readiness.participantCount,
    submittedCount: readiness.submittedCount,
    resolvedCount: readiness.resolvedCount,
    blockingCount: readiness.blockingCount,
  };
}

function automaticFailureIsRetryable(error) {
  if (error instanceof SynthesizeReviewsError) {
    return error.httpStatus >= 500 || error.body?.reason === 'concurrent_edit';
  }
  return true;
}

export async function synthesizeReviews({
  requestId,
  overwrite,
  confirmEarly = false,
  actingUserSystemId,
  mode = 'manual',
  job = null,
}) {
  const context = await loadReviewSynthesisContext(requestId);

  if (mode !== 'manual' && mode !== 'automatic') {
    throw new SynthesizeReviewsError('invalid synthesis mode', 400, {
      ok: false,
      reason: 'invalid_mode',
    });
  }
  if (mode === 'automatic' && !context.readiness.ready) {
    throw new SynthesizeReviewsError('synthesis is not ready', 409, {
      ok: false,
      reason: 'not_ready',
      readiness: publicReadiness(context.readiness),
    });
  }
  if (mode === 'automatic' && (
    !job?.id
    || !job?.lease_token
    || job.input_hash !== context.readiness.inputHash
  )) {
    throw new SynthesizeReviewsError('automatic synthesis job does not match current input', 409, {
      ok: false,
      reason: 'automatic_job_fingerprint_mismatch',
      writtenToDynamics: false,
    });
  }
  if (mode === 'manual' && !context.readiness.ready && confirmEarly !== true) {
    throw new SynthesizeReviewsError('early synthesis requires confirmation', 409, {
      ok: false,
      reason: 'early_confirmation_required',
      readiness: publicReadiness(context.readiness),
    });
  }

  // Regeneration gate lives here, not in the Executor (guard is
  // always-overwrite on the prompt's output). Read the current value and
  // refuse without calling the LLM unless the caller explicitly opted in.
  const currentRow = await getRequestById(requestId, {
    select: 'wmkf_reviewsynthesisjson,modifiedon',
  });
  if (!isEmptyMemo(currentRow?.wmkf_reviewsynthesisjson) && mode !== 'automatic' && !overwrite) {
    throw new SynthesizeReviewsError('synthesis already exists', 409, {
      ok: false,
      reason: 'already_exists',
      modifiedOn: currentRow.modifiedon || null,
    });
  }

  const activeJob = job || await startManualReviewSynthesisJob({
    requestId,
    inputHash: context.readiness.inputHash,
    actingUserSystemId,
  });
  if (!activeJob?.id || !activeJob?.lease_token) {
    throw new SynthesizeReviewsError('synthesis tracking could not start', 503, {
      ok: false,
      reason: 'tracking_unavailable',
      writtenToDynamics: false,
    });
  }

  const executeArgs = {
    promptName: PROMPT_NAME,
    requestId,
    overrideVariables: { reviews_digest: context.reviewsDigest },
    // wmkf_ai_runsource has no Vercel-cron option. Match the established
    // background-generation convention used by generate-grantee-titles.
    runSource: mode === 'automatic' ? 'PowerAutomate Auto' : 'Vercel Interactive',
    forceOverwrite: mode === 'automatic' || !!overwrite,
    actingUserSystemId,
  };
  let result;
  try {
    try {
      result = await executePrompt(executeArgs);
    } catch (err) {
      // One semantic retry, and only for a provider-confirmed output-budget
      // termination. executePrompt attempts to record the failed first invocation
      // before rethrowing, so the append-only AI-run ledger has one audit attempt
      // per model invocation. Ordinary malformed JSON, refusals, schema failures,
      // and context-window failures remain terminal.
      if (err?.code !== 'claude_output_truncated') throw err;
      const firstBudget = Number.isInteger(err.maxTokens) ? err.maxTokens : 0;
      const { floor, ceiling } = EXECUTOR_BUDGETS[PROMPT_NAME];
      if (firstBudget <= 0 || firstBudget >= ceiling) throw err;
      const retryBudget = Math.min(Math.max(firstBudget * 2, floor), ceiling);
      if (retryBudget <= firstBudget) throw err;
      result = await executePrompt({
        ...executeArgs,
        maxTokensOverride: retryBudget,
        semanticAttempt: 2,
        retryOfRunId: err.runId || null,
      });
    }

    // Not expected given guard:'always-overwrite' on every output, but
    // handled defensively rather than assumed away.
    if (result.blocked) {
      throw new SynthesizeReviewsError('executor blocked', 409, {
        ok: false, reason: 'conflict', runId: result.runId, conflicts: result.conflicts,
      });
    }

    const write = result.writeResults?.results?.find((r) => r.output === 'synthesis');
    if (!write?.ok) {
      const reason = write?.reason || 'writeback_failed';
      const status = reason === 'concurrent_edit' ? 409 : 502;
      throw new SynthesizeReviewsError('synthesis writeback failed', status, {
        ok: false,
        reason,
        runId: result.runId,
        writtenToDynamics: false,
      });
    }

    let completedJob;
    try {
      completedJob = await completeReviewSynthesisJob(activeJob, { runId: result.runId });
    } catch (trackingError) {
      console.error('[review synthesis] tracking completion failed after Dataverse write:', trackingError);
      throw new SynthesizeReviewsError('synthesis was written but tracking completion failed', 502, {
        ok: false,
        reason: 'tracking_completion_failed',
        runId: result.runId,
        writtenToDynamics: true,
      });
    }
    if (!completedJob) {
      throw new SynthesizeReviewsError('synthesis was written but tracking completion failed', 502, {
        ok: false,
        reason: 'tracking_completion_failed',
        runId: result.runId,
        writtenToDynamics: true,
      });
    }

    return {
      ok: true,
      synthesis: result.parsed?.synthesis || null,
      runId: result.runId,
      writtenToDynamics: !!write?.ok,
      ...(result.meta?.retryOfRunId ? { retryOfRunId: result.meta.retryOfRunId } : {}),
    };
  } catch (error) {
    try {
      await recordReviewSynthesisJobFailure(activeJob, error, {
        retryable: mode === 'automatic' && automaticFailureIsRetryable(error),
      });
    } catch (trackingError) {
      console.error('[review synthesis] failed to record generation failure:', trackingError);
    }
    throw error;
  }
}

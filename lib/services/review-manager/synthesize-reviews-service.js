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

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request';
import { queryReviewers } from '../../dataverse/adapters/potential-reviewer';
import { queryAllAnswers } from '../../dataverse/adapters/review-answer';
import { executePrompt } from '../execute-prompt';
import { ServiceHttpError } from '../service-http-error';

const PROMPT_NAME = 'review-synthesis.generate';

const ANSWER_FIELDS = [
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_answervalue',
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
  for (let i = 0; i < suggestionIds.length; i += CHUNK) {
    const chunk = suggestionIds.slice(i, i + CHUNK);
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
      (out[sid] ||= []).push({
        questionKey: a.wmkf_questionkey || '',
        questionOrder: a.wmkf_questionorder ?? 0,
        questionText: a.wmkf_questiontext || '',
        questionType: a.wmkf_questiontype || '',
        answerValue: a.wmkf_answervalue ?? null,
        answerText: a.wmkf_answertext || '',
      });
    }
  }
  for (const sid of Object.keys(out)) {
    out[sid].sort((x, y) => x.questionOrder - y.questionOrder);
  }
  return out;
}

/**
 * Plain-text digest of every submitted reviewer's answers — reviewer name/
 * affiliation heading, then each question's stable key/type/text plus answer
 * value/text. This is the text that reaches the LLM as the `reviews_digest`
 * untrusted override variable (see shared/config/prompts/review-synthesis.js).
 */
function hasAnswerValue(a) {
  return a.answerValue !== null && a.answerValue !== undefined && a.answerValue !== '';
}

function formatAnswerForDigest(a) {
  const lines = [
    `Question key: ${a.questionKey || 'unknown'}`,
    `Question type: ${a.questionType || 'unknown'}`,
    `Question text: ${a.questionText || ''}`,
  ];
  if (hasAnswerValue(a)) lines.push(`Answer value: ${a.answerValue}`);
  lines.push(`Answer text: ${a.answerText || ''}`);
  return lines.join('\n');
}

function buildReviewsDigest(reviewers) {
  return reviewers
    .map((r) => {
      const heading = `Reviewer: ${r.name || 'Unnamed reviewer'}${r.affiliation ? ` (${r.affiliation})` : ''}`;
      const body = (r.answers || [])
        .filter((a) => (a.answerText && a.answerText.trim().length > 0) || hasAnswerValue(a))
        .map(formatAnswerForDigest)
        .join('\n\n');
      return `${heading}\n${body}`;
    })
    .join('\n\n---\n\n');
}

async function fetchPersonNames(personIds) {
  if (!personIds?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK);
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
export async function synthesizeReviews({ requestId, overwrite, actingUserSystemId }) {
  // Gather submitted reviewers + their answer snapshot.
  const suggestions = (await suggestionAdapter.findByRequest(requestId, { selectedOnly: true }))
    .filter((s) => s.wmkf_accepted === true && s.wmkf_reviewreceivedat);

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

  // Regeneration gate lives here, not in the Executor (guard is
  // always-overwrite on the prompt's output). Read the current value and
  // refuse without calling the LLM unless the caller explicitly opted in.
  const currentRow = await getRequestById(requestId, {
    select: 'wmkf_reviewsynthesisjson,modifiedon',
  });
  if (!isEmptyMemo(currentRow?.wmkf_reviewsynthesisjson) && !overwrite) {
    throw new SynthesizeReviewsError('synthesis already exists', 409, {
      ok: false,
      reason: 'already_exists',
      modifiedOn: currentRow.modifiedon || null,
    });
  }

  const reviewsDigest = buildReviewsDigest(reviewers);

  const result = await executePrompt({
    promptName: PROMPT_NAME,
    requestId,
    overrideVariables: { reviews_digest: reviewsDigest },
    runSource: 'Vercel Interactive',
    forceOverwrite: !!overwrite,
    actingUserSystemId,
  });

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

  return {
    ok: true,
    synthesis: result.parsed?.synthesis || null,
    runId: result.runId,
    writtenToDynamics: !!write?.ok,
  };
}

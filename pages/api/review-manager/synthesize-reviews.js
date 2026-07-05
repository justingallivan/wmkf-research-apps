/**
 * POST /api/review-manager/synthesize-reviews
 *
 * AI synthesis of a proposal's SUBMITTED peer reviews (workbench Reviews tab
 * Phase 4, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md). Composes a plain-text
 * digest of every submitted reviewer's answers (reviewer name/affiliation +
 * each question's key/type/text + answerValue/answerText - never answerHtml,
 * which is untrusted rich text not needed for the synthesis) and runs it
 * through the shared
 * Executor (`lib/services/execute-prompt.js`) against the
 * `review-synthesis.generate` prompt, which writes the result to
 * `akoya_request.wmkf_reviewsynthesisjson`.
 *
 * Body: { requestId: string, overwrite?: boolean } — requestId is a Dataverse
 * GUID, validated BEFORE it reaches any Dataverse selector.
 *
 * Regeneration gating lives HERE, not in the Executor: the prompt's output
 * guard is `always-overwrite` (regeneration must always be possible), so this
 * route reads the current column value first and refuses to call the LLM
 * when it is already populated and `overwrite` was not passed — mirroring the
 * conflict shape `/api/phase-i-dynamics/summarize-v2` uses for its
 * skip-if-populated guard, just enforced at the caller instead of the
 * Executor.
 *
 * Zero submitted reviews is a distinct, cheaper failure: 409
 * {ok:false, reason:'no_submitted_reviews'} WITHOUT calling the LLM.
 *
 * Data boundary: staff-shared, matching every other `/api/review-manager/*`
 * route — any `review-manager`/`reviewers` user can synthesize any proposal's
 * reviews.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById } from '../../../lib/dataverse/adapters/grant-request';
import { queryReviewers } from '../../../lib/dataverse/adapters/potential-reviewer';
import { queryAllAnswers } from '../../../lib/dataverse/adapters/review-answer';
import { executePrompt } from '../../../lib/services/execute-prompt';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    const { requestId, overwrite = false } = req.body || {};

    if (!requestId || typeof requestId !== 'string' || !isGuid(requestId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['requestId must be a valid GUID.'] });
    }

    return await bypassDynamicsRestrictions('review-manager-synthesize-reviews', async () => {
      // Gather submitted reviewers + their answer snapshot.
      const suggestions = (await suggestionAdapter.findByRequest(requestId, { selectedOnly: true }))
        .filter((s) => s.wmkf_accepted === true && s.wmkf_reviewreceivedat);

      if (suggestions.length === 0) {
        return res.status(409).json({ ok: false, reason: 'no_submitted_reviews' });
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
        return res.status(409).json({
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
        return res.status(409).json({ ok: false, reason: 'conflict', runId: result.runId, conflicts: result.conflicts });
      }

      const write = result.writeResults?.results?.find((r) => r.output === 'synthesis');
      if (!write?.ok) {
        const reason = write?.reason || 'writeback_failed';
        const status = reason === 'concurrent_edit' ? 409 : 502;
        return res.status(status).json({
          ok: false,
          reason,
          runId: result.runId,
          writtenToDynamics: false,
        });
      }

      return res.status(200).json({
        ok: true,
        synthesis: result.parsed?.synthesis || null,
        runId: result.runId,
        writtenToDynamics: !!write?.ok,
      });
    });
  } catch (error) {
    console.error('[review-manager synthesize-reviews] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

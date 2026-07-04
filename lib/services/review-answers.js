/**
 * Shared reader for reviewer answer-snapshot child rows (`wmkf_appreviewanswers`).
 *
 * Hoisted out of `pages/api/review-manager/reviewers.js` (its original home) so
 * BOTH the workbench Reviews-tab GET and the thank-you sweep
 * (`lib/services/reviewer-thankyou-sweep.js`) read the report-ready answer shape
 * through ONE code path instead of duplicating the keyed query + re-sanitize.
 *
 * A SEPARATE keyed query per the design (no 1:N child-expand precedent on the
 * suggestion adapter) — `_wmkf_appreviewersuggestion_value eq <id>`, ordered by
 * question order. Paginated (queryAllRecords) so a reviewer's ~11 rows × a chunk
 * of suggestions can't hit the 100-row top cap. answerHtml is RE-SANITIZED here
 * (defense in depth — stored content is sanitized on write, but the read is the
 * last server step before render).
 */

import { DynamicsService } from './dynamics-service.js';
import { sanitizeReviewHtml } from '../external/sanitize-review-html.js';

export const ANSWER_FIELDS = [
  'wmkf_questionkey',
  'wmkf_questionorder',
  'wmkf_questiontext',
  'wmkf_questiontype',
  'wmkf_answerhtml',
  'wmkf_answertext',
  'wmkf_answervalue',
  '_wmkf_appreviewersuggestion_value',
];

/**
 * @returns {Promise<Record<string, Array<{questionKey,questionOrder,questionText,questionType,answerHtml,answerText,answerValue}>>>}
 *   keyed by suggestion GUID; each list ordered by questionOrder.
 */
export async function fetchAnswersBySuggestion(suggestionIds) {
  if (!suggestionIds?.length) return {};
  const out = {};
  const CHUNK = 20; // bound OR-chain URL length; pagination handles row volume
  for (let i = 0; i < suggestionIds.length; i += CHUNK) {
    const chunk = suggestionIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `_wmkf_appreviewersuggestion_value eq ${id}`).join(' or ');
    const { records, capped } = await DynamicsService.queryAllRecords('wmkf_appreviewanswers', {
      select: ANSWER_FIELDS.join(','),
      filter: orChain,
      orderby: 'wmkf_questionorder',
    });
    // Fail loud rather than silently drop answers. With ~11 rows/reviewer and a
    // chunk of 20, this is far under the 5000 cap — capped here means the volume
    // assumption broke (e.g. a far larger question set), and a partial snapshot
    // must not pass for a complete one.
    if (capped) {
      throw new Error(
        `fetchAnswersBySuggestion: queryAllRecords truncated at the 5000-row cap for ${chunk.length} suggestion(s) — answer snapshot would be incomplete.`,
      );
    }
    for (const a of records) {
      const sid = a._wmkf_appreviewersuggestion_value;
      if (!sid) continue;
      (out[sid] ||= []).push({
        questionKey: a.wmkf_questionkey || null,
        questionOrder: a.wmkf_questionorder ?? null,
        questionText: a.wmkf_questiontext || '',
        questionType: a.wmkf_questiontype || '',
        answerHtml: a.wmkf_answerhtml ? sanitizeReviewHtml(a.wmkf_answerhtml) : '',
        answerText: a.wmkf_answertext || '',
        answerValue: a.wmkf_answervalue ?? null,
      });
    }
  }
  // Defensive: guarantee per-reviewer questionOrder ordering even if a future
  // read spans pages/chunks for the same suggestion.
  for (const sid of Object.keys(out)) {
    out[sid].sort((x, y) => (x.questionOrder ?? 0) - (y.questionOrder ?? 0));
  }
  return out;
}

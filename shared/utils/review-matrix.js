/**
 * deriveReviewMatrix — pure, schema-free derivation of the workbench
 * Reviews-tab comparison matrix (docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md,
 * Phase 2) from raw answer-snapshot rows.
 *
 * NO DOM, NO React, NO Dataverse/network imports — this module must stay
 * browser+server-safe pure code so it can run in both `ReviewsTab.js` (client)
 * and, later, a server-side export/composition path (Phase 3's future input).
 * The return value is a plain, JSON-serializable object.
 *
 * Governing decisions (owner-confirmed, S326 — see the plan doc):
 *  1. Schema-free: everything is derived from the answer snapshot rows
 *     (`questionKey/Order/Text/Type`, `answerText/Html/Value`) already on the
 *     GET /api/review-manager/reviewers DTO. NO hardcoded question keys here,
 *     and this module never reads `lib/external/review-form-schema.js` or the
 *     legacy `reviewerImpact`/`reviewerRisk`/`reviewerOverallRating`
 *     projections — rating labels come from each row's own `answerText`.
 *  2. Ordering: questions present in the LIVE question set
 *     (`review-question-fetcher.js#getActiveQuestionSet()`) are ordered by
 *     the live set's `order`. A snapshot `questionKey` absent from the live
 *     set (a prior-cycle question) is appended after, ordered by its own
 *     snapshot `questionOrder`, and flagged `retired: true`.
 *  3. Drift: the question list is the UNION of keys across all reviewers'
 *     `answers[]`. Averages/spread for a rating question are computed only
 *     across reviewers who answered THAT key. A reviewer with no row for a
 *     key renders `state: 'not-asked'` — distinct from an `'empty'` row
 *     (a row exists but carries no content) and an `'answered'` row.
 *
 * Duplicate `questionKey` with differing snapshot `questionText`/`questionType`
 * across reviewers (expected across cycles as staff edit question wording):
 * FIRST-WINS. The first reviewer (in array order) to carry a row for a key
 * sets that key's snapshot text/type; later reviewers' rows only supply their
 * own cell value. When the key IS present in the live set, live `label`/`type`
 * are used instead regardless of snapshot text, so this only matters for
 * retired (non-live) keys. This is a deliberate, documented choice, not a
 * correctness claim about which snapshot is "right".
 *
 * @param {Array<{suggestionId:string, name?:string, answers?:Array<{
 *   questionKey:string, questionOrder:number, questionText:string,
 *   questionType:string, answerHtml:(string|null), answerText:(string|null),
 *   answerValue:(number|null)
 * }>}>} reviewers - the SUBMITTED reviewer list (each with `.answers`
 *   populated from the DTO). A reviewer with no `answers` array/empty array
 *   contributes no rows (not an error). Callers pass the tab's existing
 *   `submitted` filter — this module does not re-filter by submission status.
 * @param {Array<{key:string, order:number, text:string, type:string}>|null|undefined} liveQuestions
 *   the live admin-panel question set, or null/undefined if the fetch failed
 *   (fail-soft — see pages/api/review-manager/reviewers.js). When null, every
 *   question falls back to snapshot order and none is marked retired (there is
 *   no live set to compare against).
 * @returns {{
 *   reviewers: Array<{suggestionId:string, name:(string|null)}>,
 *   questions: Array<{
 *     key:string, type:(string|null), text:string, retired:boolean,
 *     cells: Array<{suggestionId:string, state:('answered'|'empty'|'not-asked'),
 *       answerText:(string|null), answerHtml:(string|null), answerValue:(number|null)}>,
 *     average?:(number|null), min?:(number|null), max?:(number|null),
 *     answeredCount?:number, totalReviewers?:number,
 *   }>,
 * }}
 */
export function deriveReviewMatrix(reviewers, liveQuestions) {
  const reviewerList = Array.isArray(reviewers) ? reviewers : [];

  // Whether a live set is known at all (vs. the fetcher having failed — the
  // fail-soft `liveQuestions: null` case). Only when a live set is KNOWN do we
  // mark a key absent from it as retired; a null/undefined liveQuestions means
  // we simply don't know, so nothing is flagged retired (would be misleading).
  const haveLiveSet = Array.isArray(liveQuestions);
  const liveByKey = new Map();
  if (haveLiveSet) {
    for (const q of liveQuestions) {
      if (q && typeof q.key === 'string') liveByKey.set(q.key, q);
    }
  }

  // First pass: union of question keys, first-seen snapshot text/type/order,
  // and each reviewer's raw answer row for that key.
  const byKey = new Map(); // key -> { type, text, order, cells: Map<suggestionId, row> }

  for (const reviewer of reviewerList) {
    const suggestionId = reviewer.suggestionId;
    const answers = Array.isArray(reviewer.answers) ? reviewer.answers : [];
    for (const row of answers) {
      const key = row && row.questionKey;
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          type: row.questionType || null,
          text: row.questionText || '',
          order: Number.isFinite(row.questionOrder) ? row.questionOrder : 0,
          cells: new Map(),
        });
      }
      byKey.get(key).cells.set(suggestionId, row);
    }
  }

  // Ordering per decision 2: live-set order first, then retired keys by
  // snapshot questionOrder.
  const liveKeysPresent = [];
  const retiredKeys = [];
  for (const key of byKey.keys()) {
    if (liveByKey.has(key)) liveKeysPresent.push(key);
    else retiredKeys.push(key);
  }
  liveKeysPresent.sort((a, b) => liveByKey.get(a).order - liveByKey.get(b).order);
  retiredKeys.sort((a, b) => byKey.get(a).order - byKey.get(b).order);
  const orderedKeys = [...liveKeysPresent, ...retiredKeys];

  const questions = orderedKeys.map((key) => {
    const snap = byKey.get(key);
    const live = liveByKey.get(key) || null;
    const retired = haveLiveSet && !live;
    const type = live ? live.type : snap.type;
    const text = live ? live.text : snap.text;

    const cells = reviewerList.map((reviewer) => {
      const row = snap.cells.get(reviewer.suggestionId);
      if (!row) {
        return {
          suggestionId: reviewer.suggestionId,
          state: 'not-asked',
          answerText: null,
          answerHtml: null,
          answerValue: null,
        };
      }
      const hasText = typeof row.answerText === 'string' && row.answerText.trim().length > 0;
      const hasHtml = typeof row.answerHtml === 'string' && row.answerHtml.trim().length > 0;
      const hasValue = row.answerValue !== null && row.answerValue !== undefined;
      const state = hasText || hasHtml || hasValue ? 'answered' : 'empty';
      return {
        suggestionId: reviewer.suggestionId,
        state,
        answerText: row.answerText ?? null,
        answerHtml: row.answerHtml ?? null,
        answerValue: row.answerValue ?? null,
      };
    });

    const question = { key, type, text, retired, cells };

    // Rating (picklist) aggregates per decision 3: computed only across
    // reviewers who answered this key.
    if (type === 'picklist') {
      const values = cells
        .filter((c) => c.state === 'answered' && Number.isFinite(c.answerValue))
        .map((c) => c.answerValue);
      const answeredCount = values.length;
      question.average = answeredCount > 0
        ? Math.round((values.reduce((sum, v) => sum + v, 0) / answeredCount) * 10) / 10
        : null;
      question.min = answeredCount > 0 ? Math.min(...values) : null;
      question.max = answeredCount > 0 ? Math.max(...values) : null;
      question.answeredCount = answeredCount;
      question.totalReviewers = reviewerList.length;
    }

    return question;
  });

  return {
    reviewers: reviewerList.map((r) => ({ suggestionId: r.suggestionId, name: r.name || null })),
    questions,
  };
}

/**
 * composeReviewReport — pure panel-prep report composition (workbench Reviews
 * tab Phase 3, docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * NO DOM, NO React, NO browser APIs, NO Dataverse/network imports — same
 * purity contract as `shared/utils/review-matrix.js`, which this module
 * consumes rather than re-deriving (governing decision 1). The return value
 * is a plain, JSON-serializable object so a server route or Dataverse-backed
 * roll-up column can wrap this later without touching this module (decision
 * 4 — no such route/column exists yet; do not build one until a Power
 * Automate flow needs it).
 *
 * Two responsibilities:
 *  1. `composeReviewReport(...)` — turn a `deriveReviewMatrix` result plus
 *     proposal identity into a report object: header, summary (counts +
 *     per-rating-question average/spread), ratings table (same rows/columns
 *     as the Compare grid), and per-richtext-question narrative sections
 *     (all reviewers' answers, in matrix order, "Prior cycle" flag carried
 *     through).
 *  2. `htmlToBlocks(html)` — a pure tokenizer for the sanitizer's ALLOWLISTED
 *     GRAMMAR ONLY (lib/external/sanitize-review-html.js `ALLOWED_TAGS`:
 *     p, br, strong, b, em, i, ul, ol, li, h2, h3, blockquote, a — no
 *     tables/images/spans/divs). Converts answerHtml into an array of typed
 *     blocks ({type, runs, items}) with inline runs
 *     ({text, bold, italic, href}). This intermediate form is what both the
 *     DOCX (review-report-docx.js) and PDF (review-report-pdf.js) renderers
 *     consume, so neither renderer re-parses HTML. Unknown/unexpected tags
 *     degrade to plain text: the tag is stripped, its text content kept,
 *     never thrown, never silently dropped. Malformed fragments (unclosed
 *     tags, stray closers) are tolerated the same way — this is a permissive
 *     tokenizer, not a validator; sanitize-html has already run server-side
 *     and is the actual security boundary.
 */

const BLOCK_TAGS = new Set(['p', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li']);
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'a', 'br']);
const VOID_TAGS = new Set(['br']);

// Very small HTML tokenizer: walks the string once, emitting open/close/text/void
// tokens. Deliberately does not build a DOM — the allowlisted grammar is a
// shallow, mostly-flat structure (blocks containing inline runs; ul/ol contain
// li; li contains inline runs), so a single linear pass with an explicit stack
// is sufficient and keeps this module dependency-free.
function tokenize(html) {
  const tokens = [];
  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?>/g;
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: html.slice(lastIndex, match.index) });
    }
    const [full, closing, rawName, selfClosing] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      tokens.push({ type: 'close', name });
    } else if (VOID_TAGS.has(name) || selfClosing) {
      tokens.push({ type: 'void', name });
    } else {
      // Capture href for <a> — the only attribute the sanitizer preserves.
      let href = null;
      if (name === 'a') {
        const hrefMatch = full.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
        if (hrefMatch) href = hrefMatch[1] ?? hrefMatch[2] ?? null;
      }
      tokens.push({ type: 'open', name, href });
    }
    lastIndex = tagRe.lastIndex;
  }
  if (lastIndex < html.length) {
    tokens.push({ type: 'text', value: html.slice(lastIndex) });
  }
  return tokens;
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : whole;
  });
}

function emptyInlineState() {
  return { bold: 0, italic: 0, link: null };
}

/**
 * Convert sanitized reviewer HTML (allowlisted grammar — see module header)
 * into an array of typed blocks. Never throws. `null`/empty/non-string input
 * returns `[]`.
 *
 * @param {string|null|undefined} html
 * @returns {Array<{type:('paragraph'|'heading2'|'heading3'|'blockquote'|'list-item'),
 *   ordered?:boolean, runs:Array<{text:string, bold:boolean, italic:boolean, href:(string|null)}>}>}
 */
export function htmlToBlocks(html) {
  if (typeof html !== 'string' || html.trim().length === 0) return [];

  const tokens = tokenize(html);
  const blocks = [];
  // Current open block (paragraph/heading/blockquote/list-item). Top-level
  // inline text with no enclosing block tag is coerced into an implicit
  // paragraph so content is never dropped.
  let currentBlock = null;
  let currentRuns = null;
  let inlineState = emptyInlineState();
  // ul/ol nesting: only tracks the "ordered" flag for the innermost list so
  // list-items know their marker style. The allowlist has no nested-list
  // support beyond flat li's in practice, but a stack tolerates nesting
  // without throwing.
  const listStack = [];

  function ensureBlock(type) {
    if (!currentBlock) {
      currentBlock = { type: type || 'paragraph', runs: [] };
      if (type === 'list-item') {
        currentBlock.ordered = listStack.length > 0 ? listStack[listStack.length - 1] : false;
      }
      currentRuns = currentBlock.runs;
    }
  }

  function closeBlock() {
    if (currentBlock) {
      // Drop fully-empty implicit/explicit blocks (e.g. stray "<p></p>") —
      // matches the sanitizer's own "effectively empty" notion, but content
      // with only whitespace runs is still dropped as noise, never throws.
      const hasContent = currentBlock.runs.some((r) => r.text.replace(/\n/g, '').length > 0);
      if (hasContent) blocks.push(currentBlock);
      currentBlock = null;
      currentRuns = null;
    }
  }

  function pushText(rawText) {
    if (!rawText) return;
    const text = decodeEntities(rawText);
    if (text.length === 0) return;
    ensureBlock('paragraph');
    currentRuns.push({
      text,
      bold: inlineState.bold > 0,
      italic: inlineState.italic > 0,
      href: inlineState.link,
    });
  }

  for (const tok of tokens) {
    if (tok.type === 'text') {
      pushText(tok.value);
      continue;
    }
    if (tok.type === 'void') {
      // <br>: a line break inside the current block. Represented as a
      // newline in the current run stream rather than a block split, so
      // "line1<br>line2" stays one paragraph with an embedded newline —
      // renderers decide how to realize that (docx: line break; pdf: wrap).
      ensureBlock('paragraph');
      currentRuns.push({ text: '\n', bold: inlineState.bold > 0, italic: inlineState.italic > 0, href: null });
      continue;
    }
    if (tok.type === 'open') {
      if (BLOCK_TAGS.has(tok.name)) {
        if (tok.name === 'ul' || tok.name === 'ol') {
          listStack.push(tok.name === 'ol');
          continue;
        }
        // A new block tag implicitly closes whatever block was open (covers
        // malformed/unclosed fragments without throwing).
        closeBlock();
        const type = tok.name === 'li' ? 'list-item'
          : tok.name === 'h2' ? 'heading2'
          : tok.name === 'h3' ? 'heading3'
          : tok.name === 'blockquote' ? 'blockquote'
          : 'paragraph';
        ensureBlock(type);
        continue;
      }
      if (INLINE_TAGS.has(tok.name)) {
        if (tok.name === 'strong' || tok.name === 'b') inlineState.bold += 1;
        else if (tok.name === 'em' || tok.name === 'i') inlineState.italic += 1;
        else if (tok.name === 'a') inlineState.link = tok.href || null;
        continue;
      }
      // Unknown/unexpected tag (should not occur post-sanitization, but this
      // tokenizer must never throw): ignore the tag itself, its text content
      // still flows through via subsequent text tokens (degrade, don't drop).
      continue;
    }
    if (tok.type === 'close') {
      if (tok.name === 'ul' || tok.name === 'ol') {
        if (listStack.length > 0) listStack.pop();
        continue;
      }
      if (BLOCK_TAGS.has(tok.name)) {
        closeBlock();
        continue;
      }
      if (INLINE_TAGS.has(tok.name)) {
        if (tok.name === 'strong' || tok.name === 'b') inlineState.bold = Math.max(0, inlineState.bold - 1);
        else if (tok.name === 'em' || tok.name === 'i') inlineState.italic = Math.max(0, inlineState.italic - 1);
        else if (tok.name === 'a') inlineState.link = null;
        continue;
      }
      // Stray/unknown closing tag — ignore, never throw.
      continue;
    }
  }
  closeBlock();

  return blocks;
}

function roundOrNull(n) {
  return Number.isFinite(n) ? n : null;
}

/**
 * Compose a plain, serializable panel-prep report object from an already-
 * derived review matrix (see `deriveReviewMatrix`, shared/utils/review-matrix.js)
 * and proposal identity fields already present on the reviewers DTO
 * (`proposals[0]` from GET /api/review-manager/reviewers).
 *
 * @param {Object} params
 * @param {string|null} [params.requestNumber]
 * @param {string|null} [params.requestTitle]
 * @param {string|null} [params.piName] - best-available PI/applicant identity
 *   field already on the DTO (`proposalAuthors`); the DTO has no dedicated
 *   `piName` field.
 * @param {string|null} [params.institution]
 * @param {{reviewers:Array, questions:Array}} params.matrix - output of
 *   `deriveReviewMatrix`
 * @param {string} params.generatedAtIso - ISO timestamp for the header;
 *   caller-supplied (not `Date.now()` internally) to keep this module pure
 *   and deterministic for tests.
 * @param {Object|null} [params.synthesis] - the stored/generated AI review
 *   synthesis (workbench Reviews tab Phase 4, `wmkf_reviewsynthesisjson`
 *   parsed shape: `{consensus, disagreements, keyConcerns, ratingSummaries,
 *   overall}`). Included in the composed report ONLY when passed — omitting
 *   it (or passing null/undefined) keeps the report byte-identical to a
 *   Phase-3-only export (no synthesis section rendered).
 * @returns {{
 *   header: {requestNumber:(string|null), requestTitle:(string|null),
 *     piName:(string|null), institution:(string|null), generatedAtIso:string,
 *     reviewerCount:number},
 *   summary: {reviewsSubmitted:number, ratingQuestions:Array<{key:string,
 *     text:string, retired:boolean, average:(number|null), min:(number|null),
 *     max:(number|null), answeredCount:number, totalReviewers:number}>},
 *   ratingsTable: {reviewers:Array<{suggestionId:string,name:(string|null)}>,
 *     rows:Array<{key:string, text:string, retired:boolean,
 *       cells:Array<{suggestionId:string, label:(string|null)}>,
 *       average:(number|null), min:(number|null), max:(number|null)}>},
 *   narrativeSections: Array<{key:string, text:string, retired:boolean,
 *     answers:Array<{suggestionId:string, reviewerName:(string|null),
 *       state:('answered'|'empty'|'not-asked'), blocks:Array}>},
 * }}
 */
export function composeReviewReport({
  requestNumber = null,
  requestTitle = null,
  piName = null,
  institution = null,
  matrix,
  generatedAtIso,
  synthesis = null,
}) {
  const safeMatrix = matrix && Array.isArray(matrix.questions) && Array.isArray(matrix.reviewers)
    ? matrix
    : { reviewers: [], questions: [] };

  const ratingQuestions = safeMatrix.questions.filter((q) => q.type === 'picklist');
  const categoricalQuestions = safeMatrix.questions.filter((q) => q.type === 'multiselect');
  const narrativeQuestions = safeMatrix.questions.filter((q) => q.type === 'richtext');

  const header = {
    requestNumber,
    requestTitle,
    piName,
    institution,
    generatedAtIso,
    reviewerCount: safeMatrix.reviewers.length,
  };

  const summary = {
    reviewsSubmitted: safeMatrix.reviewers.length,
    ratingQuestions: ratingQuestions.map((q) => ({
      key: q.key,
      text: q.text,
      retired: !!q.retired,
      average: roundOrNull(q.average),
      min: roundOrNull(q.min),
      max: roundOrNull(q.max),
      answeredCount: q.answeredCount ?? 0,
      totalReviewers: q.totalReviewers ?? safeMatrix.reviewers.length,
    })),
  };

  const ratingsTable = {
    reviewers: safeMatrix.reviewers,
    rows: ratingQuestions.map((q) => ({
      key: q.key,
      text: q.text,
      retired: !!q.retired,
      cells: q.cells.map((c) => ({
        suggestionId: c.suggestionId,
        label: c.state === 'answered'
          ? (c.answerText || (Number.isFinite(c.answerValue) ? String(c.answerValue) : null))
          : c.state === 'not-asked' ? 'Not asked' : null,
      })),
      average: roundOrNull(q.average),
      min: roundOrNull(q.min),
      max: roundOrNull(q.max),
    })),
  };

  const reviewerName = new Map(safeMatrix.reviewers.map((r) => [r.suggestionId, r.name || null]));

  const categoricalSections = categoricalQuestions.map((q) => ({
    key: q.key,
    text: q.text,
    retired: !!q.retired,
    tallies: Array.isArray(q.tallies) ? q.tallies : [],
    answers: q.cells.map((c) => ({
      suggestionId: c.suggestionId,
      reviewerName: reviewerName.get(c.suggestionId) ?? null,
      state: c.state,
      unreadable: c.answerValuesUnreadable === true,
      labels: Array.isArray(c.answerValues) ? c.answerValues.map((pair) => pair.label) : [],
    })),
  }));

  const narrativeSections = narrativeQuestions.map((q) => ({
    key: q.key,
    text: q.text,
    retired: !!q.retired,
    answers: q.cells.map((c) => ({
      suggestionId: c.suggestionId,
      reviewerName: reviewerName.get(c.suggestionId) ?? null,
      state: c.state,
      blocks: c.state === 'answered' ? htmlToBlocks(c.answerHtml) : [],
    })),
  }));

  // Phase 4: optional synthesis section. Only present when a synthesis object
  // was passed in (plain object with the LLM-authored arrays/strings — never
  // HTML, so renderers use plain text, no htmlToBlocks tokenization needed).
  const synthesisSection = synthesis && typeof synthesis === 'object'
    ? {
      consensus: Array.isArray(synthesis.consensus) ? synthesis.consensus : [],
      disagreements: Array.isArray(synthesis.disagreements) ? synthesis.disagreements : [],
      keyConcerns: Array.isArray(synthesis.keyConcerns) ? synthesis.keyConcerns : [],
      ratingSummaries: Array.isArray(synthesis.ratingSummaries) ? synthesis.ratingSummaries : [],
      overall: typeof synthesis.overall === 'string' ? synthesis.overall : '',
    }
    : null;

  return {
    header,
    summary,
    ratingsTable,
    categoricalSections,
    narrativeSections,
    synthesisSection,
  };
}

/**
 * composeSingleReviewCopy — pure composer for a SINGLE reviewer's own review,
 * used by the thank-you sweep (`lib/services/reviewer-thankyou-sweep.js`) to
 * build the courtesy DOCX copy attached to the thank-you email. Same purity
 * contract as `composeReviewReport` (no DOM/React/network); reuses the
 * `htmlToBlocks` tokenizer above for richtext answers so no HTML re-parsing
 * happens in the renderer.
 *
 * Input `answers` is the report-ready per-suggestion shape from
 * `fetchAnswersBySuggestion` (lib/services/review-answers.js): an ordered array
 * of `{questionKey, questionOrder, questionText, questionType, answerHtml,
 * answerText, answerValue}`. Each answer becomes one section:
 *   - richtext → `blocks` (htmlToBlocks(answerHtml)); `answerLabel` null.
 *   - picklist/other → `answerLabel` (answerText, else stringified answerValue,
 *     else null); `blocks` [].
 * `state` is 'answered' when the answer has content, else 'empty'.
 *
 * @param {Object} params
 * @param {string|null} [params.reviewerName]
 * @param {string|null} [params.requestNumber]
 * @param {string|null} [params.requestTitle]
 * @param {string} params.generatedAtIso - caller-supplied (keeps this pure).
 * @param {Array<{questionText:string, questionType:string, answerHtml:string,
 *   answerText:string, answerValue:(number|null)}>} params.answers
 * @returns {{
 *   header: {reviewerName:(string|null), requestNumber:(string|null),
 *     requestTitle:(string|null), generatedAtIso:string},
 *   sections: Array<{questionText:string, questionType:string,
 *     state:('answered'|'empty'), answerLabel:(string|null), blocks:Array}>,
 * }}
 */
export function composeSingleReviewCopy({
  reviewerName = null,
  requestNumber = null,
  requestTitle = null,
  generatedAtIso,
  answers = [],
}) {
  const safeAnswers = Array.isArray(answers) ? answers : [];

  const sections = safeAnswers.map((a) => {
    const isRichtext = a.questionType === 'richtext';
    if (isRichtext) {
      const blocks = htmlToBlocks(a.answerHtml);
      return {
        questionText: a.questionText || '',
        questionType: 'richtext',
        state: blocks.length > 0 ? 'answered' : 'empty',
        answerLabel: null,
        blocks,
      };
    }
    const label = (a.answerText && a.answerText.trim().length > 0)
      ? a.answerText
      : (Number.isFinite(a.answerValue) ? String(a.answerValue) : null);
    return {
      questionText: a.questionText || '',
      questionType: a.questionType || 'picklist',
      state: label != null ? 'answered' : 'empty',
      answerLabel: label,
      blocks: [],
    };
  });

  return {
    header: {
      reviewerName,
      requestNumber,
      requestTitle,
      generatedAtIso,
    },
    sections,
  };
}

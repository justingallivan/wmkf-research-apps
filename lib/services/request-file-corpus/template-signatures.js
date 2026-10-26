/**
 * Template signatures for the Research request file corpus
 * (docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md, section 2, tier 2).
 *
 * Pure: classifies one document from the start of its extracted text, for files
 * the filename rules leave `uncertain` (and as a cross-check on the rest). The
 * opening of a Foundation or GOapply template names it ("Phase I Summary and
 * Rationale", "REFEREE REVIEW", "Tracking Overview", a budget form's headings),
 * so only the first HEAD_CHARS of normalized text are matched. First matching
 * signature wins; no match returns null and the document goes to the model.
 *
 * Same asymmetry as filename-rules.js: Read signatures may be broad; Type-only
 * signatures name a specific template phrase, because a mistake keeps a
 * document out of the reading set. Signatures were found in the 2026-10-25
 * content pilot (plan section 2b) and carry no claim beyond those templates.
 */

import { priorityOf } from './filename-rules.js';

export const HEAD_CHARS = 600;

/** Lowercase, curly quotes and dashes straightened, whitespace collapsed; first HEAD_CHARS. */
export function normalizeHead(text) {
  return String(text || '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, HEAD_CHARS);
}

const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december)';

// Each signature: id, type, and a test over { head, length } (normalized head,
// total extracted characters).
const SIGNATURES = [
  // ── Staff documents (Read) ───────────────────────────────────────────────
  { id: 'phase-i-summary-rationale', type: 'staff-review', test: ({ head }) => /phase i summary and rationale/.test(head) },
  // "<Institution> <City, ST> Phase II Review Program: …" (2017–2020) and
  // "PHASE II REVIEW Organization: …" (2005): the staff's review, not a referee's.
  { id: 'staff-phase-review', type: 'staff-review',
    test: ({ head }) => /\bphase (i|ii) review\b.{0,40}\b(program|organization|from \w+ \d{4} grant cycle)\b/.test(head.slice(0, 200)) },
  { id: 'referee-review', type: 'external-review', test: ({ head }) => /referee review/.test(head.slice(0, 200)) },
  { id: 'tracking-overview', type: 'staff-writeup', test: ({ head }) => /keck foundation tracking overview/.test(head) },
  { id: 'grant-monitoring-report', type: 'staff-writeup', test: ({ head }) => /^grant monitoring report\b/.test(head) },
  { id: 'memorandum', type: 'staff-writeup', test: ({ head }) => /^.{0,90}\bmemorandum\b/.test(head) },

  // ── Proposal and application (Read) ──────────────────────────────────────
  { id: 'goapply-phase-i-form', type: 'application-form', test: ({ head }) => /^research program phase i - [jd]\d{2}\b/.test(head) },
  { id: 'compiled-phase-i-application', type: 'compiled-proposal',
    test: ({ head }) => /^(medical research|science and engineering) program phase i application meeting date/.test(head) },
  { id: 'phase-ii-proposal-abstract', type: 'project-summary', test: ({ head }) => /keck foundation - phase ii proposal - abstract/.test(head) },
  { id: 'project-description-heading', type: 'project-description', test: ({ head }) => /^project description\b/.test(head) },
  { id: 'project-summary-heading', type: 'project-summary', test: ({ head }) => /^(project summary|abstract)\b/.test(head) },

  // ── Post-award reports (Read) ────────────────────────────────────────────
  { id: 'final-progress-report-form', type: 'final-report', test: ({ head }) => /^final progress report\b|final ?- ?grant ?impact ?report|^final narrative report\b/.test(head) },
  { id: 'interim-progress-report-form', type: 'interim-report', test: ({ head }) => /^interim progress report\b/.test(head) },
  // The grantee narrative report form ("Grantee Organization/Institution Name:
  // … Project Description/Title: …"). Interim and final reports share it (every
  // copy carries a "Final Report Date:" field), so content alone types it as
  // interim; a filename rule that says final stands.
  { id: 'grantee-narrative-report-form', type: 'interim-report',
    test: ({ head }) => /^grantee (organization\/)?institution name: .{0,160}project description ?\/ ?title/.test(head) },

  // ── Administrative and institutional (Type-only: specific phrases) ───────
  { id: 'phase-ii-recognition-statement', type: 'recognition-statement', test: ({ head }) => /keck foundation - phase ii proposal - recognition statement/.test(head) },
  { id: 'application-cover-page', type: 'cover-page',
    test: ({ head }) => /^research program ?phase i application cover page|^meeting date \w+ \d{4} applicant institution\b/.test(head) },
  { id: 'budget-form', type: 'budget', test: ({ head }) => /^(\S+ )?(research program phase i application project budget )?organization name: project (title|time period)/.test(head) },
  { id: 'other-funding-table', type: 'other-funding', test: ({ head }) => /^(\S+ )?year ?corporations ?individuals/.test(head) },
  { id: 'institutional-priority-form', type: 'institutional-priority', test: ({ head }) => /institutional priority of request by signing/.test(head) },
  { id: 'financial-report-form', type: 'financial-report',
    test: ({ head }) => /^amount of award:|expenditures on wmkf funds|^financial summary for:|final financial report grantee|^financial report medical research/.test(head) },
  { id: 'budget-reallocation-form', type: 'budget-reallocation', test: ({ head }) => /^budget reallocation request\b|date of request: ?[\d/]+ ?(- expen|1\. financial)/.test(head) },
  { id: 'grantee-information-sheet', type: 'grantee-info-sheet', test: ({ head }) => /^grantee information sheet\b/.test(head) },
  { id: 'audited-financial-statements', type: 'institutional-info',
    test: ({ head }) => /(consolidated )?financial statements (june|december|august|september) \d{1,2}, \d{4}|independent auditor'?s report|^annual financial report\b/.test(head.slice(0, 200)) },
  // Not when the board is named as the applicant ("Applicant Institution: Board
  // of Trustees of …"), which opens proposal documents.
  { id: 'board-roster', type: 'governing-board',
    test: ({ head }) => /board of (trustees|regents|directors)\b|\bboard members\b|appointed regents/.test(head.slice(0, 100))
      && !/applicant institution|project (title|objectives|description|summary)/.test(head.slice(0, 300)) },
  // A dated letter: a date first and a salutation in the opening. Dated staff
  // notes (e.g. an office visit write-up) carry no salutation and stay undecided.
  { id: 'dated-letter', type: 'correspondence',
    test: ({ head }) => (new RegExp(`^(\\(.{0,120}\\) )?(\\w{1,3} )?(${MONTH} \\d{1,2}(st|nd|rd|th)?, \\d{4}|\\d{1,2} ${MONTH} \\d{4}) `).test(head)
      && /\bdear (dr|mr|ms|mrs|prof|professor|president|chancellor)\b/.test(head)) || /^dear (dr|mr|ms|mrs|prof)\.? /.test(head) },
  // An envelope or label: only an addressee block.
  { id: 'address-block', type: 'correspondence', test: ({ head, length }) => length < 300 && /^(dr|mr|ms|mrs|prof)\.? /.test(head) },
  { id: 'email-printout', type: 'correspondence', test: ({ head }) => /^(temp )?from: ?\S.{0,120}\bto: ?\S.{0,200}\bsubject: ?\S/.test(head) },
];

/**
 * @param {string} text extracted text of one document
 * @returns {{ type: string, priority: string, templateId: string } | null}
 */
export function classifyByContent(text) {
  const ctx = { head: normalizeHead(text), length: String(text || '').replace(/\s+/g, '').length };
  if (!ctx.head) return null;
  for (const sig of SIGNATURES) {
    if (sig.test(ctx)) return { type: sig.type, priority: priorityOf(sig.type), templateId: sig.id };
  }
  return null;
}

/**
 * Combine the filename result (tier 1) with the content result (tier 2). The
 * filename result stands, except that content decides an `uncertain` file and a
 * Read signature overrides a Type-only filename label, so neither tier can
 * silently keep a document out of the reading set.
 *
 * @param {{ type: string, priority: string, ruleId: string|null }} byName
 * @param {{ type: string, priority: string, templateId: string } | null} byContent
 * @returns {{ type: string, priority: string, source: string }}
 */
export function resolveClassification(byName, byContent) {
  const fromName = { type: byName.type, priority: byName.priority, source: byName.ruleId ? `rule:${byName.ruleId}` : 'none' };
  if (!byContent) return fromName;
  const fromContent = { type: byContent.type, priority: byContent.priority, source: `template:${byContent.templateId}` };
  if (byName.priority === 'uncertain') return fromContent;
  if (byName.priority === 'type-only' && byContent.priority === 'read') return fromContent;
  return fromName;
}

export const TEMPLATE_IDS = Object.freeze(SIGNATURES.map((s) => s.id));

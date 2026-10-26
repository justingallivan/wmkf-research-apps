/**
 * Filename and folder rules for the Research request file corpus
 * (docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md, section 2, tier 1).
 *
 * Pure: classifies one file from its request-relative subfolder and filename and
 * never reads bytes. First matching rule wins. Anything no rule decides is
 * `uncertain` and goes to template signatures and then the model.
 *
 * Asymmetry (plan section 2, "Rules may not silently exclude"): a rule that
 * sends a file to Read may be broad, because a mistake only costs extraction;
 * a rule that assigns a Type-only type must be narrow, because a mistake keeps a
 * document out of the reading set. Type-only rules therefore name specific
 * phrases, and no Type-only rule fires on a bare generic word.
 *
 * Separator note (same lesson as grant-reporting/classify-file.js): underscores
 * are word characters, so names are normalized to spaces before matching.
 */

export const PRIORITY = Object.freeze({
  READ: 'read',
  LEGIBLE: 'already-legible',
  TYPE_ONLY: 'type-only',
  UNCERTAIN: 'uncertain',
});

const READ_TYPES = [
  'application-form', 'compiled-proposal', 'project-summary', 'project-description',
  'graphical-abstract', 'bibliography', 'external-review', 'staff-review', 'agency-reviews',
  'site-visit-report', 'interim-report', 'final-report', 'staff-writeup',
];
const LEGIBLE_TYPES = [
  'site-visit-transcript', 'site-visit-summary', 'staff-discussion-transcript',
  'staff-discussion-summary', 'site-visit-slides',
];

export function priorityOf(type) {
  if (type === 'uncertain') return PRIORITY.UNCERTAIN;
  if (READ_TYPES.includes(type)) return PRIORITY.READ;
  if (LEGIBLE_TYPES.includes(type)) return PRIORITY.LEGIBLE;
  return PRIORITY.TYPE_ONLY;
}

/** Lowercase; `_`, `-`, `.` and `,` become spaces; extension removed. */
export function normalizeName(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.toLowerCase().replace(/[_\-.,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extensionOf(name) {
  const m = String(name || '').match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

const MEDIA_EXT = new Set(['mp4', 'm4a', 'mp3', 'wav', 'mov', 'png', 'jpg', 'jpeg', 'gif']);
const SHEET_EXT = new Set(['xlsx', 'xls', 'xlsm', 'csv']);

// Each rule: id, type, and a test over { name, folder, ext, raw }.
// `name` is the normalized filename, `folder` the lowercased subfolder path.
const RULES = [
  // ── Opaque names: nothing to go on ───────────────────────────────────────
  { id: 'opaque-number', type: 'uncertain', test: ({ name }) => /^\d+( \d+)?$/.test(name) },
  { id: 'opaque-guid', type: 'uncertain', test: ({ name }) => /^[0-9a-f]{32}$/.test(name.replace(/ /g, '')) },

  // ── App-generated Site Visit and staff artifacts (era 4) ──────────────────
  { id: 'sv-staff-discussion-summary', type: 'staff-discussion-summary',
    test: ({ name, folder }) => folder.startsWith('site visit - staff discussion summary') || /staff discussion summary/.test(name) },
  { id: 'sv-staff-discussion-transcript', type: 'staff-discussion-transcript',
    test: ({ name, folder }) => folder.startsWith('site visit - staff discussion transcript') || /staff discussion transcript/.test(name) },
  { id: 'sv-presentation-summary', type: 'site-visit-summary',
    test: ({ name, folder }) => folder.startsWith('site visit - transcript summary') || /presentation summary/.test(name) },
  { id: 'sv-transcript', type: 'site-visit-transcript',
    test: ({ name, folder }) => folder.startsWith('site visit - transcript') || folder.startsWith('site visit - presentation transcript') || /presentation transcript/.test(name) },
  { id: 'sv-participant-bios', type: 'biosketches',
    test: ({ name, folder }) => folder.startsWith('site visit - participant bios') || /(participant|presenter) bios/.test(name) },
  { id: 'sv-slides', type: 'site-visit-slides',
    test: ({ name, folder }) => folder.startsWith('site visit - slides') || /site visit presentation/.test(name) },
  { id: 'staff-artifact', type: 'staff-writeup',
    test: ({ name, folder }) => /^artifacts\/(initial assessment|pre site visit|pre-site visit|pre research presentation brief|pre-research presentation brief|final writeup|final write-up)/.test(folder)
      || /initial assessment|scientific briefing/.test(name) },
  { id: 'media', type: 'media', test: ({ ext }) => MEDIA_EXT.has(ext) },

  // ── Reviews and staff writeups (Read: broad) ─────────────────────────────
  { id: 'agency-reviews', type: 'agency-reviews',
    test: ({ name, folder }) => /(federal )?agency reviews?/.test(name) || /agency reviews?(\/|$)/.test(folder) || /^peer reviews(\/|$)/.test(folder) },
  { id: 'consultant-feedback', type: 'external-review', test: ({ name, folder }) => /consultant feedback/.test(name) || /^consultant feedback(\/|$)/.test(folder) },
  { id: 'federal-rejection', type: 'agency-reviews', test: ({ name }) => /federal rejection/.test(name) },
  { id: 'staff-writeup', type: 'staff-writeup', test: ({ name, folder }) => /write ?up/.test(name) || /write ?up/.test(folder) },
  { id: 'site-visit-report', type: 'site-visit-report',
    test: ({ name }) => /site visit (report|notes|summary|memo|wu|write ?up)|\bsv memo|visit memo|memo on .*visit/.test(name) },
  { id: 'phase-rationale', type: 'staff-review', test: ({ name }) => /phase (i|ii|1|2) rationale|\brationale\b/.test(name) },
  { id: 'office-visit-memo', type: 'staff-review', test: ({ name }) => /\bov memo|office visit (memo|notes|write ?up)/.test(name) },
  { id: 'review', type: 'external-review',
    test: ({ name, folder }) => (/\breview(s|er|ers)?\b/.test(name) && !/year in review|budget review/.test(name))
      || /(^|\/)(reviews|[a-z .]+ reviews)(\/|$)/.test(folder) },

  // ── Post-award reports ───────────────────────────────────────────────────
  { id: 'report-financial', type: 'financial-report',
    test: ({ name }) => /(interim|final|annual|progress) report( \d+)? financial|(interim|final) financial report|financial report( \d+)? (interim|final)|report financial/.test(name) },
  { id: 'report-cvs', type: 'biosketches', test: ({ name }) => /report( \d+)? (cvs?|resumes?)/.test(name) },
  { id: 'interim-report', type: 'interim-report',
    test: ({ name }) => /interim (narrative )?report|interim narrative|progress report|narrative ?(report|rpt)|year ?\d+ (narrative|report)|(keck|wmkf).*annual report|annual report.*(keck|wmkf)/.test(name) },
  { id: 'final-report', type: 'final-report', test: ({ name, folder }) => /final (narrative )?report|final narrative/.test(name) || /^final report(\/|$)/.test(folder) },
  { id: 'no-cost-extension', type: 'no-cost-extension', test: ({ name }) => /no cost extension|\bnce\b/.test(name) },
  { id: 'budget-reallocation', type: 'budget-reallocation', test: ({ name }) => /budget reallocation/.test(name) },
  { id: 'publication', type: 'publication', test: ({ folder }) => /publications?(\/|$)/.test(folder) },

  // ── Proposal documents (Read: broad) ─────────────────────────────────────
  { id: 'graphical-abstract', type: 'graphical-abstract', test: ({ name }) => /graphical abstract/.test(name) },
  { id: 'bibliography', type: 'bibliography', test: ({ name }) => /bibliograph|\breferences?\b|literature cited/.test(name) },
  { id: 'summary-and-description', type: 'project-description',
    test: ({ name, raw }) => /summ(ary)?(and|\+|&)?(project)?descr/.test(`${name} ${raw.toLowerCase()}`.replace(/[\s_\-]/g, '')) },
  { id: 'project-summary', type: 'project-summary',
    test: ({ name }) => /project ?summary|project overview|executive summary|proposal abstract|^abstract\b/.test(name) },
  { id: 'project-description', type: 'project-description',
    test: ({ name }) => /project ?(description|narrative)|proposal ?narrative|research plan|scientific narrative|^(keck )?narrative\b|\bnarrative( final)?$/.test(name) && !/financial/.test(name) },
  { id: 'goapply-phase-ii-proposal', type: 'compiled-proposal',
    test: ({ name, folder }) => (/research phase ii proposal|\bproposal\b|staff version/.test(name) && !/cover|budget|financial/.test(name))
      || /^reviewer materials(\/|$)/.test(folder) },
  { id: 'application-form', type: 'application-form',
    test: ({ name }) => /^application ?\d*$|research phase i application|phase (i|ii|1|2) application/.test(name) },

  // App-made AI inputs; after the Read rules so a copied proposal stays Read.
  { id: 'ai-material', type: 'ai-material',
    test: ({ folder }) => /^(ai materials|ai artifacts)(\/|$)/.test(folder) },

  // ── Administrative and institutional (Type-only: narrow phrases) ─────────
  { id: 'cover-page', type: 'cover-page', test: ({ name }) => /cover (page|sheet)|face page/.test(name) },
  { id: 'financial-narrative', type: 'financial-narrative', test: ({ name }) => /financial narrative/.test(name) },
  { id: 'budget-sheet', type: 'budget-spreadsheet', test: ({ name, ext }) => SHEET_EXT.has(ext) && /budget/.test(name) },
  { id: 'budget', type: 'budget', test: ({ name }) => /project ?budget|^budget\b|budget (justification|form|sheet)/.test(name) },
  { id: 'other-funding', type: 'other-funding', test: ({ name }) => /fundraising history|other ?funding|other support|current and pending/.test(name) },
  { id: 'status-letter', type: 'status-letter',
    test: ({ name }) => /\birs\b|determination letter|tax (exempt|status|determination)|exemption letter|exempt letter|501 ?c|\b\d?c ?3\b|franchise tax|declaration ?of ?status|status letter|affirmation letter|\bftb\b|exempt ?status|\d+ ?\(c\) ?\(?\d/.test(name) },
  { id: 'governing-board', type: 'governing-board',
    test: ({ name }) => /govern[a-z]* ?board|board ?(list|roster)|board of (trustees|directors|regents|governors)|regents list|officers of the corporation|\bbot\b/.test(name) },
  { id: 'institutional-priority', type: 'institutional-priority', test: ({ name }) => /institutional (priority|endorsement)|\bipr\b/.test(name) },
  { id: 'institutional-info', type: 'institutional-info',
    test: ({ name }) => /fact ?sheet|fact ?book|facts (and|&) figures|(quick|fast) facts|at a glance|campus profiles?|statistical ?summary|organizational summary|endowment holdings|audited financ|financial statements?|annual financial report|treasurer|\baudit\b/.test(name) },
  { id: 'collaborative-arrangements', type: 'collaborative-arrangements', test: ({ name }) => /collaborative arrangements?/.test(name) },
  { id: 'equipment-quotes', type: 'equipment-quotes', test: ({ name }) => /(equipment )?quotes?\b/.test(name) && /quote/.test(name) },
  { id: 'recognition-statement', type: 'recognition-statement', test: ({ name }) => /recognition statement/.test(name) },
  { id: 'biosketches', type: 'biosketches',
    test: ({ name }) => /bio ?sketch|biographical|curriculum vitae|\bcvs?\b|\bresumes?\b|\bbios\b/.test(name) },
  { id: 'award-letter', type: 'correspondence', test: ({ name }) => /grant award|award letter|\bpostcard\b/.test(name) },
  { id: 'correspondence', type: 'correspondence', test: ({ name, ext }) => ext === 'msg' || /declination ?letter|letters? of (support|commitment)|\bcorrespondence\b/.test(name) },
  { id: 'relevant-paper', type: 'relevant-paper', test: ({ folder }) => /relevant papers?(\/|$)|(^|\/)papers(\/|$)/.test(folder) },
];

/**
 * @param {{ name: string, subfolder?: string }} file
 * @returns {{ type: string, priority: string, ruleId: string|null }}
 */
export function classifyByFilename({ name, subfolder = '' }) {
  const ctx = {
    raw: String(name || ''),
    name: normalizeName(name),
    folder: String(subfolder || '').toLowerCase(),
    ext: extensionOf(name),
  };
  for (const rule of RULES) {
    if (rule.test(ctx)) return { type: rule.type, priority: priorityOf(rule.type), ruleId: rule.id };
  }
  return { type: 'uncertain', priority: PRIORITY.UNCERTAIN, ruleId: null };
}

/** Phase from folder and filename; `unknown` when neither says. */
export function phaseOf({ name, subfolder = '' }) {
  const s = `${String(subfolder || '').toLowerCase()} ${normalizeName(name)}`;
  if (/site visit/.test(s)) return 'site-visit';
  if (/interim|final report|final narrative|no cost extension|budget reallocation|progress report/.test(s)) return 'post-award';
  if (/phase (ii|2)\b|phaseii/.test(s)) return 'phase-ii';
  if (/phase (i|1)\b|phasei\b/.test(s)) return 'phase-i';
  if (/concept/.test(s)) return 'concept';
  return 'unknown';
}

export const RULE_IDS = Object.freeze(RULES.map((r) => r.id));

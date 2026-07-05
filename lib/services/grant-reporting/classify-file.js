/**
 * classifyFile — SharePoint filename → 'proposal' | 'report' | 'other'.
 *
 * Canonical home (Route→Service Consolidation Plan, Stage 5): previously
 * defined in pages/api/grant-reporting/lookup-grant.js and cross-imported by
 * reviewer-finder's load-proposal-service; the single definition now lives
 * here and both consumers import it.
 *
 * Heuristic notes:
 * - The Phase II application is often named with "project narrative" or "Project_Narrative".
 * - A "Phase I" file is the WRONG document for goals assessment — exclude with a separator
 *   class that treats `-`, `_`, and whitespace as boundaries (since `\b` fails on `_`).
 * - "final" alone is a poor report signal — many Phase II proposal files are versioned as
 *   "... Phase II - FINAL.docx". Only treat "final report" / "final narrative" as a report.
 * - Underscores are word characters, so `\binterim\b` fails on `_Interim_`. We use a custom
 *   separator class `[\s_\-]` instead.
 */

const SEP = '(?:^|[\\s_\\-])';
const SEP_END = '(?:[\\s_\\-]|$)';
const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');

export function classifyFile(name) {
  const n = (name || '').toLowerCase();

  // Phase I (not Phase II) is the wrong document for a Phase II goals assessment.
  const isPhaseI = wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n);
  if (isPhaseI) return 'other';

  // Front-matter / package boilerplate is NEVER the substantive proposal
  // narrative, even though such filenames often contain "Application" (e.g.
  // "Application Cover Page.docx") — which would otherwise trip the broad
  // `application` proposal signal below and get auto-picked over the real
  // narrative (reported bug: Reviewer Finder loaded the cover page). A project
  // narrative wins regardless (the most specific positive signal), so the
  // exclusion is gated on NOT being a narrative.
  // "project narrative" and "project description" are the two common names for
  // the substantive proposal body (the latter often written solid, e.g.
  // "ProjectDescription.pdf" — `[\s_\-]*` matches zero separators too).
  const hasNarrative = /project[\s_\-]*(narrative|description)/i.test(n);
  const isFrontMatter =
    /cover[\s_\-]*(page|sheet|letter)/i.test(n) ||
    /face[\s_\-]*page/i.test(n) ||
    /title[\s_\-]*page/i.test(n) ||
    /signature[\s_\-]*page/i.test(n) ||
    /application[\s_\-]*form/i.test(n);
  if (isFrontMatter && !hasNarrative) return 'other';

  // Strong proposal signals.
  const isProposal =
    hasNarrative ||
    wordRe('phase[\\s_]?ii').test(n) ||
    wordRe('proposal').test(n) ||
    wordRe('application').test(n);

  // Report signals. Note: "final" alone is excluded because proposals are often versioned
  // as "...Phase II - FINAL.docx"; require "final report" / "final narrative" instead.
  const isReport =
    wordRe('report').test(n) ||
    wordRe('annual').test(n) ||
    wordRe('interim').test(n) ||
    wordRe('progress').test(n) ||
    /final[\s_\-]+(report|narrative|summary)/i.test(n);

  // When both fire, proposal-specific signals win — "Project Narrative ... FINAL" is a
  // versioned proposal, not a report. Without this, the picker drops the actual narrative
  // and falls back to a cover page.
  if (isProposal) return 'proposal';
  if (isReport) return 'report';
  return 'other';
}

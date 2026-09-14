/**
 * review-writeup-paragraphs — deterministic Reviews-tab writeup sentences
 * (Reviews Tab Phase II Slice 1,
 * docs/plans/REVIEWS_TAB_WRITEUP_PARAGRAPHS_PLAN_2026-09-14.md §4.2, W1-W3, W5).
 *
 * NO DOM, NO React, NO Dataverse/network imports — same purity contract as
 * `shared/utils/review-report.js`. Consumed by the Reviews tab card (this
 * slice) and, later, the Word export (Slice 3) and the Pre-Site Visit
 * `[[STAFF:RefereeSection]]` fill (Slice 4).
 *
 * Input filter: every composer here takes only reviewers with
 * `reviewReceivedAt` set — the same filter `digestReviewers` applies in
 * `reviewers-service.js` (:~450). `reviewer.answers[]` is NOT required by
 * these composers (Slice 1 has no quotations yet); a caller may pass the
 * full submitted-reviewer projection from `getReviewers` unchanged.
 *
 * Ordering: descending `reviewerOverallAssessment` (nulls/unlabelled last);
 * ties keep the ORDER THE CALLER PASSED IN (the tab already name-sorts
 * `submitted` before calling in). This module never re-sorts by name.
 *
 * Unlabelled ratings (a legacy row with no in-domain overall rating — see
 * plan §3 "Ratings required at submit"): the reviewer still appears in the
 * reviewer/expertise sentences (identity is independent of rating), is
 * EXCLUDED from the score tally, and is reported by name in `warnings` so
 * the tab can show "N review(s) could not be scored" without silently
 * dropping the reviewer from the roster.
 *
 * Runs: `composeReviewerSentence` returns `[{text, underline}]` arrays so a
 * renderer (React, DOCX `TextRun`, or a Word-fill token) underlines the name
 * without ever having to parse or trust an HTML string. Reviewer names are
 * NEVER put in the plain "text" alongside markup — the underline flag is the
 * only formatting signal.
 */

import { labelForReviewRating } from '../../lib/external/review-form-schema';

const NUMBER_WORDS = [
  null, 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

function numberWord(n) {
  if (n >= 1 && n <= 12) return NUMBER_WORDS[n];
  return String(n);
}

function joinWithOxfordComma(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function isVowelLetter(ch) {
  return /^[aeiou]/i.test(ch || '');
}

function articleFor(word) {
  return isVowelLetter(word) ? 'an' : 'a';
}

/**
 * Lifted byte-identical from `shared/components/workbench/ReviewsTab.js`
 * (Reviews Tab Phase II Slice 1). Strips a legacy accepted-reviewer free-text
 * affiliation's trailing echoed email (occasionally as
 * "Electronic address: …"), leaving all other affiliation text untouched.
 *
 * @param {{reviewerAffiliation?: string, affiliation?: string, email?: string}} reviewer
 * @returns {string|null}
 */
export function reviewerAffiliationOf(reviewer) {
  const acceptedAffiliation = typeof reviewer?.reviewerAffiliation === 'string'
    ? reviewer.reviewerAffiliation.trim()
    : '';
  const personAffiliation = typeof reviewer?.affiliation === 'string'
    ? reviewer.affiliation.trim()
    : '';
  const affiliation = acceptedAffiliation || personAffiliation;
  const email = typeof reviewer?.email === 'string' ? reviewer.email.trim() : '';
  if (!affiliation || !email) return affiliation || null;

  const emailIndex = affiliation.toLowerCase().lastIndexOf(email.toLowerCase());
  if (emailIndex < 0) return affiliation;
  const suffix = affiliation.slice(emailIndex + email.length);
  if (suffix.replace(/[\s,.;:]/g, '') !== '') return affiliation;
  return affiliation
    .slice(0, emailIndex)
    .replace(/electronic\s+address\s*:?\s*$/i, '')
    .replace(/[\s,.;:]+$/g, '')
    .trim() || null;
}

function institutionOf(reviewer) {
  const main = typeof reviewer?.mainInstitution === 'string' ? reviewer.mainInstitution.trim() : '';
  if (main) return main;
  const accepted = reviewerAffiliationOf(reviewer);
  if (accepted) return accepted;
  return 'institution not recorded';
}

function lastNameOf(reviewer) {
  const explicit = typeof reviewer?.lastName === 'string' ? reviewer.lastName.trim() : '';
  if (explicit) return explicit;
  const name = typeof reviewer?.name === 'string' ? reviewer.name.trim() : '';
  if (!name) return '';
  const tokens = name.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1] : '';
}

/**
 * Stable sort by descending overall rating (labelled ratings only participate
 * in ordering weight — an unlabelled/null rating sorts after every labelled
 * one, preserving the input order among unlabelled reviewers and among ties).
 */
function orderByRatingDescending(reviewers, labelFor) {
  return reviewers
    .map((reviewer, index) => ({ reviewer, index, label: labelFor(reviewer) }))
    .sort((a, b) => {
      const aRated = a.label != null;
      const bRated = b.label != null;
      if (aRated && bRated) {
        const diff = (b.reviewer.reviewerOverallAssessment ?? 0) - (a.reviewer.reviewerOverallAssessment ?? 0);
        if (diff !== 0) return diff;
        return a.index - b.index;
      }
      if (aRated !== bRated) return aRated ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.reviewer);
}

function submittedReviewersOf(reviewers) {
  return (Array.isArray(reviewers) ? reviewers : []).filter((r) => !!r?.reviewReceivedAt);
}

/**
 * "We received three reviews with scores of two Excellent and one Fair."
 * Tally is computed on labelled ratings only, in descending rating order.
 * A reviewer whose `reviewerOverallAssessment` has no label (legacy row) is
 * excluded from the tally and its name is added to `warnings`.
 *
 * @param {Array<Object>} reviewers - full projection (Slice 1 shape)
 * @returns {{ sentence: string|null, warnings: string[] }}
 */
export function composeScoreSentence(reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  const warnings = [];
  if (submitted.length === 0) return { sentence: null, warnings };

  const tallies = new Map(); // label -> count
  const labelOrder = [];
  for (const reviewer of submitted) {
    const label = labelForReviewRating('overallAssessment', reviewer.reviewerOverallAssessment);
    if (!label) {
      warnings.push(`${reviewer.name || 'An unnamed reviewer'}'s overall rating has no label and was left out of the score tally.`);
      continue;
    }
    if (!tallies.has(label)) {
      tallies.set(label, 0);
      labelOrder.push({ label, rating: reviewer.reviewerOverallAssessment });
    }
    tallies.set(label, tallies.get(label) + 1);
  }

  labelOrder.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const reviewWord = submitted.length === 1 ? 'review' : 'reviews';
  const countWord = numberWord(submitted.length);

  if (labelOrder.length === 0) {
    return { sentence: `We received ${countWord} ${reviewWord}.`, warnings };
  }

  if (submitted.length === 1 && labelOrder.length === 1) {
    return {
      sentence: `We received one review with a score of ${labelOrder[0].label}.`,
      warnings,
    };
  }

  const tallyPhrases = labelOrder.map(({ label }) => `${numberWord(tallies.get(label))} ${label}`);
  return {
    sentence: `We received ${countWord} ${reviewWord} with scores of ${joinWithOxfordComma(tallyPhrases)}.`,
    warnings,
  };
}

/**
 * "The reviewers were <u>Name</u>, a professor at Institution; …"
 * One clause per submitted reviewer, in descending-rating order (ties keep
 * the caller's order). Returns runs so a renderer underlines the name
 * without HTML.
 *
 * @param {Array<Object>} reviewers
 * @returns {{ runs: Array<{text:string, underline?:boolean}> }|null}
 */
export function composeReviewerSentence(reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  if (submitted.length === 0) return null;

  const ordered = orderByRatingDescending(
    submitted,
    (r) => labelForReviewRating('overallAssessment', r.reviewerOverallAssessment),
  );

  const clauses = ordered.map((reviewer) => {
    const name = reviewer.name || 'Unnamed reviewer';
    const institution = institutionOf(reviewer);
    const rank = typeof reviewer.academicRank === 'string' ? reviewer.academicRank.trim() : '';
    const runs = [{ text: name, underline: true }];
    if (rank) {
      const lowerRank = rank.toLowerCase();
      runs.push({ text: `, ${articleFor(lowerRank)} ${lowerRank} at ${institution}` });
    } else {
      runs.push({ text: ` of ${institution}` });
    }
    return runs;
  });

  const lead = submitted.length === 1 ? 'The reviewer was ' : 'The reviewers were ';
  const runs = [{ text: lead }];
  clauses.forEach((clauseRuns, i) => {
    if (i > 0) {
      const isLast = i === clauses.length - 1;
      runs.push({ text: isLast ? '; and ' : '; ' });
    }
    runs.push(...clauseRuns);
  });
  runs.push({ text: '.' });
  return { runs };
}

/**
 * "Nadell has expertise in X, Y, and Z, while Breitbart has expertise in …"
 * Keyed by last name (fallback: last token of `name`). Areas come from
 * `keywords` split on ";", falling back to `areaOfExpertise`; first three
 * areas, first letter lowercased. Reviewers with no expertise data are
 * omitted; pairs are joined with "while"; a third (and later) reviewer
 * starts a new sentence.
 *
 * @param {Array<Object>} reviewers
 * @returns {string|null}
 */
export function composeExpertiseSentence(reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  if (submitted.length === 0) return null;

  const ordered = orderByRatingDescending(
    submitted,
    (r) => labelForReviewRating('overallAssessment', r.reviewerOverallAssessment),
  );

  const clauses = [];
  for (const reviewer of ordered) {
    const source = (typeof reviewer.keywords === 'string' && reviewer.keywords.trim())
      ? reviewer.keywords
      : reviewer.areaOfExpertise;
    if (typeof source !== 'string' || !source.trim()) continue;
    const areas = source
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((a) => (a.length > 0 ? a[0].toLowerCase() + a.slice(1) : a));
    if (areas.length === 0) continue;
    const lastName = lastNameOf(reviewer);
    if (!lastName) continue;
    clauses.push(`${lastName} has expertise in ${joinWithOxfordComma(areas)}`);
  }

  if (clauses.length === 0) return null;

  const sentences = [];
  for (let i = 0; i < clauses.length; i += 2) {
    const pair = clauses.slice(i, i + 2);
    sentences.push(`${pair.join(', while ')}.`);
  }
  return sentences.join(' ');
}

function runsToPlainText(runs) {
  return runs.map((r) => r.text).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function runsToHtml(runs) {
  return runs
    .map((r) => (r.underline ? `<u>${escapeHtml(r.text)}</u>` : escapeHtml(r.text)))
    .join('');
}

/**
 * Compose the full Slice 1 writeup block from stored data: score sentence,
 * reviewer sentence (as runs), and expertise sentence, plus plain-text and
 * HTML serialisations for Copy.
 *
 * `synthesis` is accepted but NOT rendered in Slice 1 — this is the named
 * hook Slice 2 fills in (model-authored `writeupThemes` /
 * `writeupQuotations`, verified at the read boundary per plan §4.3). Slice 1
 * deliberately does no provenance verification and appends nothing from it.
 *
 * @param {{reviewers: Array<Object>, synthesis?: Object|null}} input
 * @returns {{ paragraphs: Array<Array<{text:string, underline?:boolean}>>, warnings: string[], text: string, html: string }}
 */
export function composeWriteupParagraphs({ reviewers, synthesis } = {}) {
  const { sentence: scoreSentence, warnings } = composeScoreSentence(reviewers);
  const reviewerSentence = composeReviewerSentence(reviewers);
  const expertiseSentence = composeExpertiseSentence(reviewers);

  const paragraphs = [];
  if (scoreSentence) paragraphs.push([{ text: scoreSentence }]);
  if (reviewerSentence) paragraphs.push(reviewerSentence.runs);
  if (expertiseSentence) paragraphs.push([{ text: expertiseSentence }]);

  // Slice 2 hook: when `synthesis.writeupThemes` / `synthesis.writeupQuotations`
  // are present and read-boundary-verified, their sentences append here as
  // additional plain-text paragraphs. Not implemented in Slice 1.
  void synthesis;

  const text = paragraphs.map(runsToPlainText).join('\n\n');
  const html = paragraphs.map((runs) => `<p>${runsToHtml(runs)}</p>`).join('');

  return { paragraphs, warnings, text, html };
}

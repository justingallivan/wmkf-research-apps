import {
  buildReviewerAccountLabelIndex,
  classifyReviewerAccountTargets,
  nonBlankInstitution,
  normalizeReviewerInstitution,
} from '../../lib/utils/reviewer-institution-account-match.js';

export {
  buildReviewerAccountLabelIndex as buildAccountLabelIndex,
  classifyReviewerAccountTargets as classifyContactAccountTargets,
  normalizeReviewerInstitution as normalizeInstitution,
};

const AFFILIATION_SOURCE_PRIORITY = {
  accepted_suggestion: 0,
  reviewer_main_institution: 1,
  reviewer_primary_affiliation: 2,
  reviewer_organization: 3,
  contact_organization: 4,
};

export function nonBlank(value) {
  return nonBlankInstitution(value);
}

function evidenceSort(a, b) {
  const priority = (AFFILIATION_SOURCE_PRIORITY[a.source] ?? 99)
    - (AFFILIATION_SOURCE_PRIORITY[b.source] ?? 99);
  if (priority !== 0) return priority;
  return String(b.observedAt || '').localeCompare(String(a.observedAt || ''));
}

export function collectAffiliationEvidence({ reviewers = [], suggestions = [], contact = null } = {}) {
  const raw = [];
  for (const suggestion of suggestions) {
    raw.push({
      value: suggestion.wmkf_revieweraffiliation,
      source: 'accepted_suggestion',
      reviewerId: suggestion._wmkf_potentialreviewer_value || null,
      suggestionId: suggestion.wmkf_appreviewersuggestionid || null,
      observedAt: suggestion.wmkf_responsereceivedat || null,
    });
  }
  for (const reviewer of reviewers) {
    const reviewerId = reviewer.wmkf_potentialreviewersid || null;
    raw.push(
      { value: reviewer.wmkf_maininstitution, source: 'reviewer_main_institution', reviewerId },
      { value: reviewer.wmkf_primaryaffiliation, source: 'reviewer_primary_affiliation', reviewerId },
      { value: reviewer.wmkf_organizationname, source: 'reviewer_organization', reviewerId },
    );
  }
  raw.push({
    value: contact?.adx_organizationname,
    source: 'contact_organization',
    contactId: contact?.contactid || null,
  });

  const grouped = new Map();
  for (const item of raw.sort(evidenceSort)) {
    const value = nonBlank(item.value);
    const normalized = normalizeReviewerInstitution(value);
    if (!normalized) continue;
    if (!grouped.has(normalized)) {
      grouped.set(normalized, { value, normalized, sources: [] });
    }
    grouped.get(normalized).sources.push({ ...item, value: undefined });
  }
  return [...grouped.values()];
}

export function csvCell(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

const ACCOUNT_LABEL_FIELDS = [
  ['name', 'name'],
  ['akoya_aka', 'aka'],
  ['wmkf_legalname', 'legal_name'],
  ['wmkf_dc_aka', 'dc_aka'],
];

const AFFILIATION_SOURCE_PRIORITY = {
  accepted_suggestion: 0,
  reviewer_main_institution: 1,
  reviewer_primary_affiliation: 2,
  reviewer_organization: 3,
  contact_organization: 4,
};

export function nonBlank(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Conservative exact-name normalization. It deliberately does not expand
 * acronyms, remove corporate suffixes, or perform fuzzy matching.
 */
export function normalizeInstitution(value) {
  return nonBlank(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAccountLabelIndex(accounts) {
  const index = new Map();
  for (const account of accounts || []) {
    if (!account?.accountid || account.statecode === 1) continue;
    for (const [field, labelType] of ACCOUNT_LABEL_FIELDS) {
      const label = nonBlank(account[field]);
      const key = normalizeInstitution(label);
      if (!key) continue;
      if (!index.has(key)) index.set(key, new Map());
      const byAccount = index.get(key);
      const existing = byAccount.get(account.accountid) || {
        accountId: account.accountid,
        accountName: nonBlank(account.name) || label,
        matchedLabels: [],
      };
      existing.matchedLabels.push({ field: labelType, value: label });
      byAccount.set(account.accountid, existing);
    }
  }
  return index;
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
    const normalized = normalizeInstitution(value);
    if (!normalized) continue;
    if (!grouped.has(normalized)) {
      grouped.set(normalized, { value, normalized, sources: [] });
    }
    grouped.get(normalized).sources.push({ ...item, value: undefined });
  }
  return [...grouped.values()];
}

export function classifyContactAccountTargets(evidence, accountLabelIndex) {
  const targets = new Map();
  const matchedEvidence = [];
  const unmatchedEvidence = [];

  for (const item of evidence || []) {
    const matches = [...(accountLabelIndex.get(item.normalized)?.values() || [])];
    if (matches.length === 0) {
      unmatchedEvidence.push(item.value);
      continue;
    }
    matchedEvidence.push({ affiliation: item.value, targets: matches.map((m) => m.accountId) });
    for (const match of matches) {
      const existing = targets.get(match.accountId) || { ...match, affiliations: [] };
      existing.affiliations.push(item.value);
      targets.set(match.accountId, existing);
    }
  }

  const targetList = [...targets.values()].sort((a, b) =>
    a.accountName.localeCompare(b.accountName) || a.accountId.localeCompare(b.accountId));
  let status = 'no_affiliation';
  if ((evidence || []).length > 0 && targetList.length === 0) status = 'no_exact_target';
  if (targetList.length === 1) status = 'unique_exact_target';
  if (targetList.length > 1) status = 'ambiguous_exact_targets';

  return { status, targets: targetList, matchedEvidence, unmatchedEvidence };
}

export function csvCell(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

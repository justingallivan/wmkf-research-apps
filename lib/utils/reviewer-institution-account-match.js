/**
 * Conservative reviewer-affiliation → CRM Account matching primitives.
 *
 * Confidence means one and only one active Account exposes the normalized
 * affiliation through its canonical name or one of the established CRM name
 * variants. These helpers deliberately do not expand acronyms, strip legal
 * suffixes, or use fuzzy/provider scoring. Ambiguity is an abstention.
 */

export const ACCOUNT_INSTITUTION_LABEL_FIELDS = [
  ['name', 'name'],
  ['akoya_aka', 'aka'],
  ['wmkf_legalname', 'legal_name'],
  ['wmkf_dc_aka', 'dc_aka'],
];

export function nonBlankInstitution(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function normalizeReviewerInstitution(value) {
  return nonBlankInstitution(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildReviewerAccountLabelIndex(accounts) {
  const index = new Map();
  for (const account of accounts || []) {
    if (!account?.accountid || account.statecode === 1) continue;
    for (const [field, labelType] of ACCOUNT_INSTITUTION_LABEL_FIELDS) {
      const label = nonBlankInstitution(account[field]);
      const key = normalizeReviewerInstitution(label);
      if (!key) continue;
      if (!index.has(key)) index.set(key, new Map());
      const byAccount = index.get(key);
      const existing = byAccount.get(account.accountid) || {
        accountId: account.accountid,
        accountName: nonBlankInstitution(account.name) || label,
        matchedLabels: [],
      };
      existing.matchedLabels.push({ field: labelType, value: label });
      byAccount.set(account.accountid, existing);
    }
  }
  return index;
}

export function classifyReviewerAccountTargets(evidence, accountLabelIndex) {
  const targets = new Map();
  const matchedEvidence = [];
  const unmatchedEvidence = [];

  for (const item of evidence || []) {
    const matches = [...(accountLabelIndex.get(item.normalized)?.values() || [])];
    if (matches.length === 0) {
      unmatchedEvidence.push(item.value);
      continue;
    }
    matchedEvidence.push({ affiliation: item.value, targets: matches.map((match) => match.accountId) });
    for (const match of matches) {
      const existing = targets.get(match.accountId) || { ...match, affiliations: [] };
      existing.affiliations.push(item.value);
      targets.set(match.accountId, existing);
    }
  }

  const targetList = [...targets.values()].sort((left, right) =>
    left.accountName.localeCompare(right.accountName) || left.accountId.localeCompare(right.accountId));
  let status = 'no_affiliation';
  if ((evidence || []).length > 0 && targetList.length === 0) status = 'no_exact_target';
  if (targetList.length === 1) status = 'unique_exact_target';
  if (targetList.length > 1) status = 'ambiguous_exact_targets';

  return { status, targets: targetList, matchedEvidence, unmatchedEvidence };
}

export function classifyReviewerAffiliationAccount(affiliation, accounts) {
  const value = nonBlankInstitution(affiliation);
  const normalized = normalizeReviewerInstitution(value);
  const evidence = normalized ? [{ value, normalized }] : [];
  return classifyReviewerAccountTargets(evidence, buildReviewerAccountLabelIndex(accounts));
}

export function accountStillMatchesReviewerAffiliation(account, affiliation) {
  const normalized = normalizeReviewerInstitution(affiliation);
  if (!normalized || !account?.accountid || account.statecode === 1) return false;
  return ACCOUNT_INSTITUTION_LABEL_FIELDS.some(([field]) =>
    normalizeReviewerInstitution(account[field]) === normalized);
}

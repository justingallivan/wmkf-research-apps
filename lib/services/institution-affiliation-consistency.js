/**
 * Institution consistency for identity corroboration and mismatch alerts.
 *
 * This helper is intentionally separate from COI. Direct identity equality and
 * one-hop OpenAlex associated-institution links are acceptable evidence that
 * two affiliation labels can describe the same person's appointment. The same
 * associated links MUST NOT be consumed by the COI hard-drop matcher.
 */

const { DeduplicationService } = require('./deduplication-service');
const { createInstitutionIdentityResolver } = require('./institution-identity-resolver');

function associatedIdentityMatches(source, target) {
  return (Array.isArray(source?.associatedInstitutions)
    ? source.associatedInstitutions
    : [])
    .some((associated) => DeduplicationService.institutionDirectMatch(associated, target));
}

function institutionsConsistent(left, right) {
  if (!left || !right) return false;
  if (DeduplicationService.institutionDirectMatch(left, right)) return true;
  return associatedIdentityMatches(left, right) || associatedIdentityMatches(right, left);
}

function createInstitutionConsistencyChecker({
  resolver = createInstitutionIdentityResolver(),
} = {}) {
  async function resolve(institution, { signal } = {}) {
    if (!institution) return null;
    if (
      typeof institution === 'object'
      && institution.openAlexId
      && institution.displayName
      && Array.isArray(institution.associatedInstitutions)
    ) {
      return institution;
    }
    const name = DeduplicationService.institutionDisplayName(institution);
    if (!name) return null;
    return resolver.resolve(name, { signal });
  }

  async function areConsistent(left, right, { signal } = {}) {
    if (DeduplicationService.institutionDirectMatch(left, right)) return true;
    const [resolvedLeft, resolvedRight] = await Promise.all([
      resolve(left, { signal }),
      resolve(right, { signal }),
    ]);
    return institutionsConsistent(resolvedLeft || left, resolvedRight || right);
  }

  return Object.freeze({
    areConsistent,
    resolve,
  });
}

module.exports = {
  createInstitutionConsistencyChecker,
  institutionsConsistent,
};

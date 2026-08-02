const { normalizeReviewerName } = require('./reviewer-name-match');
const { isStaffIdentityConfirmationSatisfied } = require('./reviewer-identity-authority');

function text(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
}

function canonicalManualConfirmation(candidate = {}) {
  return {
    normalizedName: normalizeReviewerName(candidate.name),
    email: text(candidate.email).toLowerCase(),
    website: text(candidate.website),
    affiliation: text(candidate.affiliation),
  };
}

function manualConfirmationMatches(confirmation, candidate) {
  if (!confirmation || confirmation.source !== 'staff_confirmed'
    || !isStaffIdentityConfirmationSatisfied(confirmation)) return false;
  const expected = canonicalManualConfirmation(candidate);
  return confirmation.normalizedName === expected.normalizedName
    && confirmation.email === expected.email
    && confirmation.website === expected.website
    && confirmation.affiliation === expected.affiliation;
}

module.exports = { canonicalManualConfirmation, manualConfirmationMatches };

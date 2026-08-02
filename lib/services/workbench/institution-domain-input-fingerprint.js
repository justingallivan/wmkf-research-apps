/**
 * Dependency-free fingerprint for the bounded institution inputs consumed by
 * the domains producer.  Keeping this outside the producer avoids making the
 * shared source-version builder import a provider-capable module.
 */

const { createHash } = require('crypto');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function version(namespace, value) {
  return createHash('sha256').update(`${namespace}\n${stableStringify(value)}`, 'utf8').digest('hex');
}

function boundedText(value, maxLength = 240) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function authoritativeIdentityInputs(candidate = {}) {
  const identity = candidate?.identityEvidence;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return {};
  const orcid = boundedText(identity.orcid, 64);
  const openAlexAuthorId = boundedText(identity.openAlexAuthorId, 80);
  return {
    ...(orcid && /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(orcid) ? { orcid: orcid.toUpperCase() } : {}),
    ...(openAlexAuthorId && /^A\d{3,20}$/i.test(openAlexAuthorId) ? { openAlexAuthorId: openAlexAuthorId.toUpperCase() } : {}),
  };
}

// Kept as the exported shape name for the source-builder contract. Its inputs
// now come only from the sealed identity-stage projection, never the generic
// roster/contact tier blob that a browser payload can carry.
function currentOrcidRorInputs(candidate = {}) {
  return authoritativeIdentityInputs(candidate);
}

function institutionDomainInputFingerprint(candidate = {}) {
  return version('reviewer-stage-institution-domains:input:v1', {
    identity: authoritativeIdentityInputs(candidate),
  });
}

module.exports = {
  authoritativeIdentityInputs,
  currentOrcidRorInputs,
  institutionDomainInputFingerprint,
};

const LEGACY_HOST = 'wmkfresearch.vercel.app';
const CANONICAL_HOST = 'applications.wmkeck.org';

function shouldRedirectToCanonical(host) {
  if (!host) {
    return false;
  }

  const normalizedHost = String(host).trim().toLowerCase().split(':')[0];
  return normalizedHost === LEGACY_HOST;
}

module.exports = {
  LEGACY_HOST,
  CANONICAL_HOST,
  shouldRedirectToCanonical,
};

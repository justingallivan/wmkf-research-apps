/**
 * Happy-path stand-in for lib/services/reviewer-engagement/materials-release-store.js
 * in unit tests that drive the send service's materials path (the real store
 * needs Postgres). Use as:
 *   jest.mock('../../lib/services/reviewer-engagement/materials-release-store',
 *     () => require('../helpers/materials-release-store-mock').createMaterialsReleaseStoreMock());
 */
function createMaterialsReleaseStoreMock() {
  const row = (state) => ({ suggestion_id: 's', state, lease_token: 'lease-1' });
  return {
    materialsReleaseAlertKey: (suggestionId) => `reviewer-materials-release:${suggestionId}`,
    claimMaterialsRelease: jest.fn(async () => ({ claimed: true, release: row('claimed') })),
    markMaterialsLinkMinted: jest.fn(async () => row('link_minted')),
    markMaterialsSent: jest.fn(async () => row('sent')),
    recordMaterialsRelease: jest.fn(async () => row('recorded')),
    markMaterialsReleaseStopped: jest.fn(async (id, token, state) => row(state)),
  };
}

module.exports = { createMaterialsReleaseStoreMock };

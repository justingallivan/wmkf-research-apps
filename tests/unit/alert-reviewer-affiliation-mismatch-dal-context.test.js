/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md site 52).
 *
 * alertReviewerAffiliationMismatch's DEFAULT `withDynamicsBypass` parameter
 * aliases `bypassDynamicsRestrictions` directly (an aliased bypass scope
 * invisible to a call-site grep). Every existing test in
 * alert-reviewer-affiliation-mismatch.test.js injects `deps.withDynamicsBypass`,
 * so the default import path has never been exercised. This test drives the
 * REAL context machinery (no dynamics-context / core-context mocks) with no
 * injected override, and must stay green after the strip retargets the
 * default to `withDalContext` (same behavior, same label).
 */

jest.mock('../../lib/dataverse/adapters/contact.js', () => ({
  getInstitutionById: jest.fn(),
}));

const contactAdapter = require('../../lib/dataverse/adapters/contact.js');
const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');
const { alertReviewerAffiliationMismatch } = require('../../lib/services/alert-reviewer-affiliation-mismatch.js');

describe('alertReviewerAffiliationMismatch DEFAULT bypass path (S333 characterization)', () => {
  test('negative control: no trusted context exists before the call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('default withDynamicsBypass establishes a trusted Dataverse context for the institution read', async () => {
    const seen = { inside: null };
    contactAdapter.getInstitutionById.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
      return { adx_organizationname: 'Example University' };
    });

    const out = await alertReviewerAffiliationMismatch(
      {
        reviewer: { wmkf_potentialreviewersid: 'pr-1', wmkf_name: 'Jane Reviewer' },
        contactId: 'contact-1',
        reviewerAffiliation: 'Other University',
        suggestionId: 'suggestion-1',
      },
      { notify: jest.fn().mockResolvedValue({ id: 'alert-1' }) },
    );

    expect(seen.inside).toBe(true);
    expect(out).toEqual({ alerted: true });
    expect(hasTrustedDalContext()).toBe(false);
  });
});

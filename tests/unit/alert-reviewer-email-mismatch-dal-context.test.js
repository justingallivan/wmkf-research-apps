/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md site 51).
 *
 * alertReviewerEmailMismatch's DEFAULT `withDynamicsBypass` parameter aliases
 * `bypassDynamicsRestrictions` directly (an aliased bypass scope invisible to
 * a call-site grep). Every existing test in alert-reviewer-email-mismatch.test.js
 * injects `deps.withDynamicsBypass`, so the default import path has never been
 * exercised. This test drives the REAL context machinery (no dynamics-context /
 * core-context mocks) with no injected override, and must stay green after the
 * strip retargets the default to `withDalContext` (same behavior, same label).
 */

jest.mock('../../lib/dataverse/adapters/contact.js', () => ({
  getById: jest.fn(),
  normalizeEmail: jest.requireActual('../../lib/dataverse/adapters/contact.js').normalizeEmail,
}));

const contactAdapter = require('../../lib/dataverse/adapters/contact.js');
const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');
const { alertReviewerEmailMismatch } = require('../../lib/services/alert-reviewer-email-mismatch.js');

describe('alertReviewerEmailMismatch DEFAULT bypass path (S333 characterization)', () => {
  test('negative control: no trusted context exists before the call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('default withDynamicsBypass establishes a trusted Dataverse context for the contact read', async () => {
    const seen = { inside: null };
    contactAdapter.getById.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
      return { contactid: 'contact-1', emailaddress1: 'crm@example.edu' };
    });

    const out = await alertReviewerEmailMismatch(
      {
        reviewer: { wmkf_potentialreviewersid: 'pr-1', wmkf_name: 'Jane Reviewer' },
        contactId: 'contact-1',
        reviewerEmail: 'payee@example.edu',
        suggestionId: 'suggestion-1',
      },
      { notify: jest.fn().mockResolvedValue({ id: 'alert-1' }) },
    );

    expect(seen.inside).toBe(true);
    expect(out).toEqual({ alerted: true });
    expect(hasTrustedDalContext()).toBe(false);
  });
});

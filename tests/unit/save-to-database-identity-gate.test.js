/**
 * @jest-environment node
 *
 * Phase 2 post-impl fix (Codex MUST-FIX): the email-keyed ContactEnrichmentService
 * .saveToDatabase side path (used by /enrich-contacts with persist:true) must
 * honor the resolver verdict too — merely enriching must not persist an
 * unresolved/wrong ORCID/Scholar onto an existing person.
 */
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByEmail: jest.fn(),
  upsertByEmail: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(),
  writeIdentityDecision: jest.fn(),
  clearIdentityFields: jest.fn(),
}));

const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');

describe('saveToDatabase — identity gate on the email-keyed side path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    potentialReviewerAdapter.getByEmail.mockResolvedValue({ wmkf_potentialreviewersid: 'PID-1' });
    potentialReviewerAdapter.upsertByEmail.mockResolvedValue({ id: 'PID-1' });
    researcherAdapter.upsertByPotentialReviewer.mockResolvedValue({ id: 'PID-1' });
    researcherAdapter.writeIdentityDecision.mockResolvedValue(undefined);
    researcherAdapter.clearIdentityFields.mockResolvedValue(undefined);
  });

  const enrichment = (identity) => ({
    email: 'x@mit.edu', emailSource: 'orcid', orcidId: '0000-0001', orcidUrl: 'https://orcid.org/0000-0001',
    googleScholarUrl: 'https://scholar.google.com/citations?user=ABC',
    tierResults: {}, identity,
  });

  test('unresolved verdict → ORCID + Scholar URL NOT written; decision written; stale fields cleared', async () => {
    await ContactEnrichmentService.saveToDatabase({ name: 'Dr X', affiliation: 'MIT' }, enrichment({ status: 'unresolved' }));
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBeNull();
    expect(payload.orcidUrl).toBeNull();
    expect(payload.googleScholarUrl).toBeNull();
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith(
      'PID-1',
      expect.objectContaining({ status: 'unresolved' }),
      { identityOrigin: 'automated' },
    );
    expect(researcherAdapter.clearIdentityFields).toHaveBeenCalledWith(
      'PID-1',
      expect.any(Array),
      { identityOrigin: 'automated' },
    );
  });

  test('probable verdict → ORCID + Scholar URL written; no clear', async () => {
    await ContactEnrichmentService.saveToDatabase({ name: 'Dr X', affiliation: 'MIT' }, enrichment({ status: 'probable' }));
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(payload.googleScholarUrl).toContain('scholar.google.com');
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('no verdict (resolver absent) → fail-open, writes as before (no regression)', async () => {
    await ContactEnrichmentService.saveToDatabase({ name: 'Dr X', affiliation: 'MIT' }, enrichment(null));
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('emailPersistAllowed false → email-keyed side path does not look up or write by the denied email', async () => {
    await ContactEnrichmentService.saveToDatabase(
      { name: 'Dr X', affiliation: 'MIT' },
      { ...enrichment({ status: 'confirmed' }), emailPersistAllowed: false, websitePersistAllowed: true },
    );
    expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  });

  test('websitePersistAllowed false → confirmed identity still withholds website/faculty page on side-path save', async () => {
    await ContactEnrichmentService.saveToDatabase(
      { name: 'Dr X', affiliation: 'MIT' },
      {
        ...enrichment({ status: 'confirmed' }),
        website: 'https://wrong.example.edu',
        facultyPageUrl: 'https://wrong.example.edu/profile',
        emailPersistAllowed: true,
        websitePersistAllowed: false,
      },
    );
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.email).toBe('x@mit.edu');
    expect(payload.website).toBeNull();
    expect(payload.facultyPageUrl).toBeNull();
  });

  test('document facultyPageUrl is nulled before side-path persistence', async () => {
    await ContactEnrichmentService.saveToDatabase(
      { name: 'Dr X', affiliation: 'MIT' },
      {
        ...enrichment({ status: 'confirmed' }),
        facultyPageUrl: 'https://mit.edu/faculty/example-cv.pdf',
        emailPersistAllowed: true,
        websitePersistAllowed: true,
      },
    );
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.facultyPageUrl).toBeNull();
  });
});

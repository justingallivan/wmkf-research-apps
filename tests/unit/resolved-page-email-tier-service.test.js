/**
 * @jest-environment node
 *
 * Resolved-page email tier — service integration (_attachEmailFromResolvedPage):
 * flag gating, search-email replacement, trusted-email no-op, host gating, abort.
 * safeFetchInstitutionPage is stubbed; the grounding logic + ContactParser run real.
 */

jest.mock('../../lib/utils/safe-fetch.js', () => {
  const actual = jest.requireActual('../../lib/utils/safe-fetch.js');
  return { ...actual, safeFetchInstitutionPage: jest.fn() };
});

import { ContactEnrichmentService } from '../../lib/services/contact-enrichment-service';
import { safeFetchInstitutionPage } from '../../lib/utils/safe-fetch';

const FLAG = 'REVIEWER_PAGE_EMAIL_TIER_ENABLED';
const PAGE_HTML = '<p>Philip Bucksbaum <a href="mailto:phbuck@stanford.edu">e</a></p>';

function makeResult(ceOverrides = {}) {
  return {
    name: 'Philip Bucksbaum',
    contactEnrichment: {
      email: null,
      emailSource: null,
      verifiedInstitutionDomain: 'stanford.edu',
      facultyPageUrl: 'https://web.stanford.edu/~phbuck/',
      website: null,
      tierResults: {},
      ...ceOverrides,
    },
  };
}
const candidate = { name: 'Philip Bucksbaum' };

describe('_attachEmailFromResolvedPage', () => {
  const prev = process.env[FLAG];
  beforeEach(() => { safeFetchInstitutionPage.mockReset(); process.env[FLAG] = 'true'; });
  afterAll(() => { if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev; });

  it('no-ops when the feature flag is off', async () => {
    delete process.env[FLAG];
    const result = makeResult();
    await ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, {});
    expect(safeFetchInstitutionPage).not.toHaveBeenCalled();
    expect(result.contactEnrichment.email).toBeNull();
  });

  it('no-ops without a verified institution domain', async () => {
    const result = makeResult({ verifiedInstitutionDomain: null });
    await ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, {});
    expect(safeFetchInstitutionPage).not.toHaveBeenCalled();
  });

  it('stamps a grounded email as institution_page (HIGH-trust, persist allowed)', async () => {
    safeFetchInstitutionPage.mockResolvedValue({ ok: true, status: 200, text: PAGE_HTML, finalUrl: 'https://web.stanford.edu/~phbuck/' });
    const result = makeResult();
    await ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, {});
    const ce = result.contactEnrichment;
    expect(ce.email).toBe('phbuck@stanford.edu');
    expect(ce.emailSource).toBe('institution_page');
    expect(ce.emailPersistAllowed).toBe(true);
    expect(ce.tierResults.institution_page).toMatchObject({ email: 'phbuck@stanford.edu' });
  });

  it('replaces a low-trust search email with a grounded institution_page email', async () => {
    safeFetchInstitutionPage.mockResolvedValue({ ok: true, status: 200, text: PAGE_HTML, finalUrl: 'https://web.stanford.edu/~phbuck/' });
    const result = makeResult({ email: 'maybe@stanford.edu', emailSource: 'serp_search' });
    await ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, {});
    expect(result.contactEnrichment.email).toBe('phbuck@stanford.edu');
    expect(result.contactEnrichment.emailSource).toBe('institution_page');
  });

  it('leaves an already-trusted (orcid) email untouched and does not fetch', async () => {
    const result = makeResult({ email: 'phb@stanford.edu', emailSource: 'orcid' });
    await ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, {});
    expect(safeFetchInstitutionPage).not.toHaveBeenCalled();
    expect(result.contactEnrichment.email).toBe('phb@stanford.edu');
  });

  it('skips a captured URL whose host is not within the verified domain', async () => {
    const result = makeResult({ facultyPageUrl: 'https://phys.ksu.edu/rudenko', verifiedInstitutionDomain: 'k-state.edu', website: null });
    await ContactEnrichmentService._attachEmailFromResolvedPage({ name: 'Artem Rudenko' }, result, {});
    expect(safeFetchInstitutionPage).not.toHaveBeenCalled();
    expect(result.contactEnrichment.tierResults.institution_page).toMatchObject({ skipped: 'host_not_in_verified_domain' });
    expect(result.contactEnrichment.email).toBeNull();
  });

  it('records a skip (does not throw) when the page yields no grounded email', async () => {
    safeFetchInstitutionPage.mockResolvedValue({ ok: true, status: 200, text: '<p>Dept of Physics <a href="mailto:office@stanford.edu">x</a></p>', finalUrl: 'https://web.stanford.edu/~phbuck/' });
    const result = makeResult();
    await ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, {});
    expect(result.contactEnrichment.email).toBeNull();
    expect(result.contactEnrichment.tierResults.institution_page).toMatchObject({ skipped: 'no_grounded_email' });
  });

  it('propagates an aborted signal', async () => {
    const result = makeResult();
    const ac = new AbortController();
    ac.abort(new Error('reviewer_time_budget_exceeded'));
    await expect(ContactEnrichmentService._attachEmailFromResolvedPage(candidate, result, { signal: ac.signal }))
      .rejects.toThrow();
    expect(safeFetchInstitutionPage).not.toHaveBeenCalled();
  });
});

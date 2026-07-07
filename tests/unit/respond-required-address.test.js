/**
 * Server-side payment-contact guard for the Stage 2a accept path.
 *
 * `missingRequiredAddressFields` is the server's presence check that mirrors the
 * client's REQUIRED_ADDRESS_FIELDS (Stage2aView). A non-opted-out fresh accept
 * must carry a complete mailing address + phone so staff can pay the honorarium
 * manually this cycle (BILL onboarding deferred) — even on a direct POST that
 * bypasses the client form. State/province is required for US/Canada addresses.
 * Shape/length/country-code validity is owned by `validateAddress`; this owns
 * presence only.
 */
// The route pulls in the token verifier → jose (ESM, untransformed by jest) and
// other I/O libs at import time. We only exercise the pure presence helper, so
// stub the route's dependencies to keep module-load side-effect-free.
jest.mock('../../lib/external/verify-suggestion-token', () => ({ verifySuggestionToken: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({ applyStage2aResponse: jest.fn() }));
jest.mock('../../lib/external/policy-fetcher', () => ({ getActivePolicies: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: jest.fn() }));
jest.mock('../../lib/external/rate-limit', () => ({ checkRateLimit: jest.fn(), recordTokenOutcome: jest.fn() }));
jest.mock('../../lib/bill/honorarium-onboard-orchestrator', () => ({ ensureHonorariumOnboarding: jest.fn() }));
jest.mock('../../lib/services/capture-self-reported-orcid', () => ({ captureSelfReportedReviewerOrcid: jest.fn() }));
jest.mock('../../lib/utils/orcid-normalize', () => ({ normalizeOrcid: jest.fn() }));
jest.mock('../../lib/services/notification-service', () => ({ __esModule: true, default: {} }));

import { missingRequiredAddressFields } from '../../pages/api/external/review/[token]/respond';

const ALL = ['line1', 'city', 'postalCode', 'country', 'phone'];

describe('missingRequiredAddressFields (server payment-contact guard)', () => {
  // line2 is intentionally optional. State/province is conditional by country.
  const complete = {
    line1: '1 St', line2: '', city: 'T', state: 'CA',
    postalCode: '9', country: 'US', phone: '+1 555 0100',
  };

  it('returns [] for a complete US required set', () => {
    expect(missingRequiredAddressFields(complete)).toEqual([]);
  });

  it('flags every required field when the address is absent or empty', () => {
    expect(missingRequiredAddressFields(undefined)).toEqual(ALL);
    expect(missingRequiredAddressFields(null)).toEqual(ALL);
    expect(missingRequiredAddressFields({})).toEqual(ALL);
  });

  it('flags each empty/whitespace required field individually', () => {
    expect(missingRequiredAddressFields({ ...complete, line1: '' })).toContain('line1');
    expect(missingRequiredAddressFields({ ...complete, city: '  ' })).toContain('city');
    expect(missingRequiredAddressFields({ ...complete, postalCode: '' })).toContain('postalCode');
    expect(missingRequiredAddressFields({ ...complete, country: '' })).toContain('country');
    expect(missingRequiredAddressFields({ ...complete, phone: '' })).toContain('phone');
    expect(missingRequiredAddressFields({ ...complete, phone: '   ' })).toContain('phone');
  });

  it('requires state/province for US and Canada only', () => {
    expect(missingRequiredAddressFields({ ...complete, state: '' })).toEqual(['state']);
    expect(missingRequiredAddressFields({ ...complete, country: 'CA', state: '  ' })).toEqual(['state']);
    expect(missingRequiredAddressFields({ ...complete, country: 'GB', state: '' })).toEqual([]);
  });

  it('does not infer state/province is required before country is selected', () => {
    expect(missingRequiredAddressFields({ ...complete, country: '', state: '' })).toEqual(['country']);
  });

  it('does not flag optional line2/state when missing outside the US and Canada', () => {
    const out = missingRequiredAddressFields({
      line1: '1 St', city: 'T', postalCode: '9', country: 'GB', phone: '+1 555 0100',
    });
    expect(out).toEqual([]);
  });

  it('treats a non-object address as fully missing', () => {
    expect(missingRequiredAddressFields('nope')).toEqual(ALL);
    expect(missingRequiredAddressFields(['x'])).toEqual(ALL);
  });
});

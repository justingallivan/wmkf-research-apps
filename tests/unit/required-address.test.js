/**
 * Shared payment-contact presence check (lib/external/required-address.js).
 *
 * Single source enforced by BOTH the fresh-accept guard
 * (pages/api/external/review/[token]/respond.js → 422) and the capture-only
 * backfill (scripts/backfill-honorarium-capture-only.mjs → skip). A reviewer taking
 * the honorarium must supply a complete mailing address + phone so staff can pay it
 * manually this cycle (BILL onboarding deferred). Tested here at the shared source —
 * no route mocks needed since the module is dependency-free.
 */
import { missingRequiredAddressFields, REQUIRED_ADDRESS_FIELDS } from '../../lib/external/required-address';

const ALL = ['line1', 'city', 'postalCode', 'country', 'phone'];

describe('required-address shared presence check', () => {
  // line2 + state are intentionally optional (mirrors the client's Stage2aView).
  const complete = {
    line1: '1 St', line2: '', city: 'T', state: '',
    postalCode: '9', country: 'US', phone: '+1 555 0100',
  };

  it('exposes the canonical required-field list', () => {
    expect(REQUIRED_ADDRESS_FIELDS).toEqual(ALL);
  });

  it('returns [] for a complete required set (line2/state optional)', () => {
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
    expect(missingRequiredAddressFields({ ...complete, phone: '   ' })).toContain('phone');
  });

  // The exact gap the backfill now guards: a historical contact whose address was
  // PATCHed best-effort can be PARTIAL (not empty). Fresh accept would have rejected
  // it with a 422; the backfill must skip it rather than mint an unpayable honorarium.
  it('flags a partial (non-empty but incomplete) captured address', () => {
    const partial = { line1: '1 St', city: 'T', country: 'US' }; // no postalCode, no phone
    expect(missingRequiredAddressFields(partial)).toEqual(['postalCode', 'phone']);
  });

  it('does not flag optional line2/state when missing', () => {
    expect(missingRequiredAddressFields({
      line1: '1 St', city: 'T', postalCode: '9', country: 'US', phone: '+1 555 0100',
    })).toEqual([]);
  });

  it('treats a non-object address as fully missing', () => {
    expect(missingRequiredAddressFields('nope')).toEqual(ALL);
    expect(missingRequiredAddressFields(['x'])).toEqual(ALL);
  });
});

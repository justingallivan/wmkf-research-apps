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
import {
  addressRequiresState,
  missingRequiredAddressFields,
  REQUIRED_ADDRESS_FIELDS,
  requiredAddressFieldsFor,
  STATE_REQUIRED_COUNTRIES,
  validateAddress,
} from '../../lib/external/required-address';

const ALL = ['line1', 'city', 'postalCode', 'country', 'phone'];

describe('required-address shared presence check', () => {
  // line2 is intentionally optional. State/province is conditional by country.
  const complete = {
    line1: '1 St', line2: '', city: 'T', state: 'CA',
    postalCode: '9', country: 'US', phone: '+1 555 0100',
  };

  it('exposes the canonical required-field list', () => {
    expect(REQUIRED_ADDRESS_FIELDS).toEqual(ALL);
    expect(STATE_REQUIRED_COUNTRIES).toEqual(['US', 'CA']);
  });

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
    expect(missingRequiredAddressFields({ ...complete, phone: '   ' })).toContain('phone');
  });

  it('requires state/province for US and Canada only', () => {
    expect(addressRequiresState({ country: 'US' })).toBe(true);
    expect(addressRequiresState({ country: 'ca' })).toBe(true);
    expect(addressRequiresState({ country: 'GB' })).toBe(false);
    expect(requiredAddressFieldsFor({ country: 'US' })).toContain('state');
    expect(requiredAddressFieldsFor({ country: 'CA' })).toContain('state');
    expect(requiredAddressFieldsFor({ country: 'GB' })).not.toContain('state');
    expect(missingRequiredAddressFields({ ...complete, state: '' })).toEqual(['state']);
    expect(missingRequiredAddressFields({ ...complete, country: 'CA', state: '  ' })).toEqual(['state']);
  });

  it('does not infer state/province is required before country is selected', () => {
    expect(missingRequiredAddressFields({ ...complete, country: '', state: '' })).toEqual(['country']);
  });

  // The exact gap the backfill now guards: a historical contact whose address was
  // PATCHed best-effort can be PARTIAL (not empty). Fresh accept would have rejected
  // it with a 422; the backfill must skip it rather than mint an unpayable honorarium.
  it('flags a partial (non-empty but incomplete) captured address', () => {
    const partial = { line1: '1 St', city: 'T', state: 'CA', country: 'US' }; // no postalCode, no phone
    expect(missingRequiredAddressFields(partial)).toEqual(['postalCode', 'phone']);
  });

  it('does not flag optional line2/state when missing outside the US and Canada', () => {
    expect(missingRequiredAddressFields({
      line1: '1 St', city: 'T', postalCode: '9', country: 'GB', phone: '+1 555 0100',
    })).toEqual([]);
  });

  it('treats a non-object address as fully missing', () => {
    expect(missingRequiredAddressFields('nope')).toEqual(ALL);
    expect(missingRequiredAddressFields(['x'])).toEqual(ALL);
  });
});

describe('validateAddress shape/length/country validity check', () => {
  const complete = {
    line1: '1 St', city: 'T', postalCode: '9', country: 'US', phone: '+1 555 0100',
  };

  it('accepts a well-formed address (null = no error)', () => {
    expect(validateAddress(complete)).toBeNull();
    expect(validateAddress(undefined)).toBeNull();
    expect(validateAddress(null)).toBeNull();
  });

  // The exact gap the backfill now guards: a legacy contact whose country is the
  // full name, not an ISO2 code. Fresh accept 400s this; the backfill must skip it.
  // A full name (>2 chars) trips the length cap first — a shorter non-ISO2 value
  // (1 char) trips the dedicated country-code branch. Both are rejections.
  it('rejects a non-ISO2 country (full name trips the length cap)', () => {
    expect(validateAddress({ ...complete, country: 'United States' }))
      .toEqual({ reason: 'address_field_too_long', field: 'country' });
  });

  it('rejects a non-ISO2 country that is within the length cap', () => {
    expect(validateAddress({ ...complete, country: 'U' }))
      .toEqual({ reason: 'invalid_country', field: 'country' });
  });

  it('rejects an over-length field', () => {
    expect(validateAddress({ ...complete, postalCode: '9'.repeat(21) }))
      .toEqual({ reason: 'address_field_too_long', field: 'postalCode' });
  });

  it('rejects an unknown field and a non-string value', () => {
    expect(validateAddress({ ...complete, bogus: 'x' }))
      .toEqual({ reason: 'unknown_address_field', field: 'bogus' });
    expect(validateAddress({ ...complete, city: 5 }))
      .toEqual({ reason: 'invalid_address_field', field: 'city' });
  });

  it('stays lenient on emptiness (presence is a separate check)', () => {
    // Empty country passes validity; the presence check owns "required".
    expect(validateAddress({ ...complete, country: '' })).toBeNull();
  });
});

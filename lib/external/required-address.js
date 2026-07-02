// Payment-contact fields a reviewer MUST supply when taking the honorarium —
// mirrors REQUIRED_ADDRESS_FIELDS in Stage2aView (line2/state stay optional).
// This is the single source shared by:
//   • the fresh-accept guard — pages/api/external/review/[token]/respond.js (422)
//   • the capture-only backfill — scripts/backfill-honorarium-capture-only.mjs (skip)
// Both must enforce the SAME completeness, or the backfill could mint an honorarium
// from a historical contact whose address fresh accept would have rejected (the
// original contact-address PATCH was best-effort/non-fatal). `validateAddress` in
// respond.js still owns shape/length/country-code validity; this owns presence.
export const REQUIRED_ADDRESS_FIELDS = ['line1', 'city', 'postalCode', 'country', 'phone'];

export function missingRequiredAddressFields(address) {
  const a = address && typeof address === 'object' && !Array.isArray(address) ? address : {};
  return REQUIRED_ADDRESS_FIELDS.filter((k) => !String(a[k] ?? '').trim());
}

// Shape/length/country-code VALIDITY of a mailing address — the other half of the
// fresh-accept contract (respond.js runs this before the presence check above and
// 400s on any failure). `country` must be a 2-char ISO code; the backfill must skip
// a reconstructed historical address that fails this, or it would mint an honorarium
// from an address fresh accept would reject (e.g. a legacy contact whose
// address1_country is the full name "United States", not "US"). Stays lenient on
// emptiness — absent/empty fields pass here and are owned by the presence check.
export const ADDRESS_MAX = { line1: 200, line2: 200, city: 100, state: 100, postalCode: 20, country: 2, phone: 40 };

export function validateAddress(address) {
  if (address === undefined || address === null) return null;
  if (typeof address !== 'object' || Array.isArray(address)) return { reason: 'invalid_address' };
  for (const [k, v] of Object.entries(address)) {
    if (!(k in ADDRESS_MAX)) return { reason: 'unknown_address_field', field: k };
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'string') return { reason: 'invalid_address_field', field: k };
    if (v.length > ADDRESS_MAX[k]) return { reason: 'address_field_too_long', field: k };
  }
  const c = address.country;
  if (c !== undefined && c !== null && c !== '' && c.length !== 2) {
    return { reason: 'invalid_country', field: 'country' };
  }
  return null;
}

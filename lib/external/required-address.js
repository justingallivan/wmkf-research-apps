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

/**
 * Centralized ORCID normalization + checksum validation.
 *
 * The single shared helper for turning a raw ORCID value (canonical, URL-form,
 * or hyphen-stripped) into one of three honest states. Used by the reviewer
 * ORCID back-propagation flow (contact.setOrcidIfAbsent, the shared back-prop
 * helper, and the PR2 backfill) so the conflict policy can distinguish a
 * "different valid iD" from "shaped-but-checksum-invalid junk" — the latter must
 * never be mistaken for a real-but-different identifier (design §3/§4,
 * docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md).
 *
 *   normalizeOrcid(raw) → { state: 'empty' }                       // null/blank
 *                       | { state: 'valid', id: '0000-0002-1825-0097' }
 *                       | { state: 'malformed', raw: '<original>' } // wrong shape OR bad checksum
 *
 * The checksum is ISO 7064 MOD 11-2 over the first 15 digits, the 16th
 * character being the check digit (0-9 or X). Malformed values exist in the live
 * data (the S216 probe found `wmkf_orcid = "1234567"` on a real contact; 14 of
 * 423 contact ORCIDs are unparseable), so the malformed branch is live code.
 */

const SIXTEEN_RE = /^\d{15}[\dX]$/;

/**
 * ISO 7064 MOD 11-2 check-digit validation for a 16-char compacted ORCID
 * (15 digits + 1 check char, no hyphens, uppercase X).
 */
function hasValidChecksum(compact) {
  let total = 0;
  for (let i = 0; i < 15; i++) {
    total = (total + Number(compact[i])) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const expected = result === 10 ? 'X' : String(result);
  return compact[15] === expected;
}

/**
 * Normalize any raw ORCID representation to a canonical hyphenated iD, or
 * classify it as empty / malformed.
 *
 * @param {string|null|undefined} raw
 * @returns {{state:'empty'}|{state:'valid', id:string}|{state:'malformed', raw:string}}
 */
export function normalizeOrcid(raw) {
  if (raw === null || raw === undefined) return { state: 'empty' };
  const s = String(raw).trim();
  if (!s) return { state: 'empty' };

  // Strip an optional orcid.org URL prefix, then all hyphens/whitespace, and
  // upper-case so a trailing lowercase 'x' check digit still validates.
  const compact = s
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();

  if (!SIXTEEN_RE.test(compact)) return { state: 'malformed', raw: s };
  if (!hasValidChecksum(compact)) return { state: 'malformed', raw: s };

  const id = `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}`;
  return { state: 'valid', id };
}

/**
 * Name-display helpers for email rendering: grammatical list joining and
 * honorific stripping.
 */

// Leading honorific tokens to strip from a PI / co-PI display name. Mirrors the
// honorific set parseRecipientName (email-generator.js) detects for the RECIPIENT
// greeting — but here we remove them rather than turn them into a salutation.
const LEADING_HONORIFIC = /^\s*(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+|^\s*Professor\s+/i;

/**
 * Strip leading honorifics ("Dr.", "Prof.", "Professor", "Mr.", "Mrs.", "Ms.",
 * "Mx.") from a name so the plain full name remains:
 *   'Dr. Jane Smith'        → 'Jane Smith'
 *   'Professor Bob Brown'   → 'Bob Brown'
 *   'Prof. Dr. Hans Mueller'→ 'Hans Mueller'   (a run of honorifics is removed)
 *   'Jane Smith'            → 'Jane Smith'      (unchanged)
 * Suffixes ("Jr.", "III", "PhD") are part of the full name and are left intact.
 *
 * @param {string} name
 * @returns {string}
 */
export function stripHonorific(name) {
  let out = String(name ?? '').trim();
  let prev;
  do {
    prev = out;
    out = out.replace(LEADING_HONORIFIC, '').trim();
  } while (out !== prev);
  return out;
}

/**
 * Grammatical English list formatter (serial / "Oxford" comma).
 *
 * Joins a list of names into a single grammatically-correct phrase regardless of
 * how many there are, so email copy reads naturally for any number of co-PIs:
 *   []                  → ''
 *   ['A']               → 'A'
 *   ['A', 'B']          → 'A and B'
 *   ['A', 'B', 'C']     → 'A, B, and C'
 *   ['A', 'B', 'C', 'D']→ 'A, B, C, and D'
 *
 * Blank / whitespace-only entries are dropped first, so a sparse list never
 * produces a dangling comma or a stray "and". Input is an array of strings (the
 * co-PI junction returns names as an array); non-string entries are coerced.
 *
 * @param {Array<string>} names
 * @returns {string}
 */
export function formatNameList(names) {
  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  // 3+: serial comma before the final "and".
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

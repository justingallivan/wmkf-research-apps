/**
 * Build a Google search URL for a candidate reviewer's name + notional
 * institution, so staff adjudicating a suggestion don't have to
 * hand-compose the search they already run manually (owner request,
 * `outputs/fuzzy-matching-owner-answers-2026-08-06.md` Q2: "One option would
 * be to have a link to a google search for the person and the notional
 * institution.").
 *
 * Query shape: quoted name plus quoted institution, e.g.
 * `"Jane Shih" "Dana-Farber Cancer Institute"` — the institution is omitted
 * cleanly when absent. Encoding goes through `URLSearchParams` so names/
 * institutions containing quotes, ampersands, or diacritics come through
 * correctly.
 */
export function buildGoogleSearchUrl(name, institution) {
  const cleanName = (name || '').trim();
  if (!cleanName) return null;
  const cleanInstitution = (institution || '').trim();
  const query = cleanInstitution
    ? `"${cleanName}" "${cleanInstitution}"`
    : `"${cleanName}"`;
  const params = new URLSearchParams({ q: query });
  return `https://www.google.com/search?${params.toString()}`;
}

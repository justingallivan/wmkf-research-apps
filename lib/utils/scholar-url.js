/**
 * Build a Google Scholar author-search URL from a name (+ optional affiliation).
 *
 * Used as a fallback when we don't have a real persisted Scholar profile URL for
 * a reviewer: the link drops the user onto a Scholar author search pre-filled
 * with the cleaned name and best-guess institution, so staff can pull up the
 * person's papers live. Extracted from ReviewerSearchSection so the Workbench
 * Candidates tab and the in-panel search render identical Scholar links.
 */
export function buildScholarSearchUrl(name, affiliation) {
  if (!name) return 'https://scholar.google.com/citations?view_op=search_authors&mauthors=';
  const cleanName = name.replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '').trim();
  let cleanAffiliation = '';
  if (affiliation) {
    const affWithoutEmail = affiliation.replace(/\S+@\S+/g, '').trim();
    const parts = affWithoutEmail.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    let institutionPart = parts.find((p) =>
      /\buniversity\b|\binstitute\b|\bcollege\b/i.test(p) &&
      !/^(department|dept|division|school|faculty|center|centre)\s+of/i.test(p)
    );
    if (!institutionPart) institutionPart = parts.find((p) => /\bschool\b|\blaboratory\b|\blab\b/i.test(p));
    cleanAffiliation = (institutionPart || parts[0] || '')
      .replace(/^(department of|dept\.? of|division of|school of|faculty of|center for|centre for)\s+/i, '')
      .trim();
  }
  const query = cleanAffiliation ? `${cleanName} ${cleanAffiliation}` : cleanName;
  return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(query)}`;
}

/**
 * True only for a REAL Google Scholar author *profile* URL
 * (`scholar.google.com/citations?user=<id>`), not an author *search*
 * (`?view_op=search_authors&mauthors=...`). Enrichment populates
 * `googleScholarUrl` with a search URL by default (OpenAlex exposes no Scholar
 * `user=` id — see contact-enrichment-service.buildGoogleScholarUrl), so a
 * truthiness check mislabels every such reviewer as having a "profile". Use this
 * to decide the "Scholar profile" vs "Scholar search" label so the word matches
 * the link. Malformed/empty input → false.
 */
export function isRealScholarProfileUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/(^|\.)scholar\.google\./i.test(u.hostname)) return false;
  if (/view_op=search_authors/i.test(u.search)) return false;
  return !!u.searchParams.get('user');
}

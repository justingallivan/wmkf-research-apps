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

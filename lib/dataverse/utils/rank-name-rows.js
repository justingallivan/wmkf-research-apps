import { ContactParser } from '../../utils/contact-parser';

/**
 * Rank name-search rows for the cross-store dedup helpers: keep only rows whose
 * display name matches the typed name (`ContactParser.namesMatch`), sort
 * active-first then by original query order, cap to `top`. `displayFn(row)`
 * extracts the row's human name (adapter-specific field layout — `wmkf_name` for
 * reviewers, `fullname` for contacts). Shared by `potential-reviewer.searchByName`
 * and `contact.searchByName` so the ranking stays in sync.
 */
export function rankNameRows(rows, name, top, displayFn) {
  const target = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
  return (rows || [])
    .map((row, index) => ({
      row,
      index,
      matches: ContactParser.namesMatch(
        target,
        ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(displayFn(row) || '')),
      ),
      active: row.statecode === undefined || row.statecode === 0,
    }))
    .filter((x) => x.matches)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.index - b.index)
    .slice(0, top)
    .map((x) => x.row);
}

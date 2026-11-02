/**
 * Prompt catalog columns on `wmkf_ai_prompt` (wave36, owner decision 2026-11-02).
 *
 * Six optional, descriptive-only columns used to organize Admin → AI → Prompts.
 * No prompt execution reads them. They describe the prompt as it is now, so a
 * publish copies them from the prior current row to the new version.
 * See docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md.
 */

/** API field name → Dataverse column. */
export const PROMPT_CATALOG_COLUMNS = Object.freeze({
  title: 'wmkf_ai_displaytitle',
  description: 'wmkf_ai_description',
  group: 'wmkf_ai_groupkey',
  section: 'wmkf_ai_sectionkey',
  usedBy: 'wmkf_ai_usedby',
  usage: 'wmkf_ai_usagecategory',
});

/** Stored catalog values for the Admin DTO; absent values are null. */
export function mapPromptCatalog(row) {
  return Object.fromEntries(
    Object.entries(PROMPT_CATALOG_COLUMNS).map(([key, column]) => [key, row?.[column] ?? null]),
  );
}

/** The prior row's catalog columns, for the new version's create body. */
export function carryPromptCatalog(priorRow) {
  return Object.fromEntries(
    Object.values(PROMPT_CATALOG_COLUMNS).map((column) => [column, priorRow?.[column] ?? null]),
  );
}

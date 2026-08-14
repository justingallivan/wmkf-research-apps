/**
 * Shared persistence contract for grantee award abstracts.
 *
 * Dataverse currently allows 32,000 characters in both abstract Memo fields.
 * The application deliberately keeps the existing 20,000-character staff-save
 * ceiling and applies it to every writer so clients and servers cannot drift.
 */
export const MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH = 20000;

/**
 * Shared persistence ceiling for the grantee image caption. The staff
 * replacement route already enforced 2,000 characters; exporting the value
 * keeps the external form, both server writers, and both editors aligned.
 */
export const MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH = 2000;

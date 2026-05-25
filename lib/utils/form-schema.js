/**
 * Form-schema loader + walker for the applicant intake portal.
 *
 * Uses a STATIC import map (not a dynamic require with a template
 * string) so webpack can bundle the schema files deterministically.
 * Codex chunk-4 review: dynamic require(`...${formKey}...`) may not
 * resolve correctly in the Next.js production build.
 *
 * Add a new form_key here as new schemas are added.
 */

const phaseIIResearchSchema = require('../../shared/forms/phase-ii-research-2026-06/schema.js');

const SCHEMAS = {
  'phase-ii-research-2026-06': phaseIIResearchSchema,
};

/**
 * Resolve a form_key to its loaded schema module.
 * @param {string} formKey
 * @returns {object | null}  schema or null if formKey unknown
 */
function getFormSchema(formKey) {
  if (typeof formKey !== 'string' || !formKey) return null;
  return SCHEMAS[formKey] ?? null;
}

/**
 * Find a file field in the schema by its key. Walks top-level
 * `sections[].fields[]` AND one level of nested groups (the live
 * schema's `attachments` group nests file fields under
 * `fields[].fields[]`). Returns the field on hit, or a discriminated
 * `{_notUploadable, _found}` object if the key matched a non-file
 * field, or null if not found.
 *
 * @param {object} schema  schema object (from getFormSchema)
 * @param {string} fieldKey
 * @returns {object | null}
 */
function findFileField(schema, fieldKey) {
  if (!schema || typeof fieldKey !== 'string' || !fieldKey) return null;
  for (const section of schema.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.key === fieldKey) {
        return field.type === 'file' ? field : { _notUploadable: true, _found: field };
      }
      if (Array.isArray(field.fields)) {
        for (const nested of field.fields) {
          if (nested.key === fieldKey) {
            return nested.type === 'file' ? nested : { _notUploadable: true, _found: nested };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Count entries (clean + pending) for a given fieldKey on a draft row.
 * Used by /upload-token's cardinality gate per the chunk-4 design
 * (Codex Q1: enforce multiple/maxFiles in the endpoint, not just at
 * submit-strict, so applicants don't burn storage on uploads that
 * will be rejected at submit).
 *
 * @param {object} draft  draft row from IntakeDraftService.getById
 * @param {string} fieldKey
 * @returns {number}
 */
function countFieldEntries(draft, fieldKey) {
  const clean = Array.isArray(draft?.attachments) ? draft.attachments : [];
  const pending = Array.isArray(draft?.pending_attachments) ? draft.pending_attachments : [];
  let n = 0;
  for (const a of clean) if (a?.fieldKey === fieldKey) n += 1;
  for (const p of pending) if (p?.fieldKey === fieldKey) n += 1;
  return n;
}

module.exports = { getFormSchema, findFileField, countFieldEntries };

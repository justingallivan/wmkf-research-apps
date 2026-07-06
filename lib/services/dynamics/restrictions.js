/**
 * DynamicsService decomposition — Stage 2 leaf module (Checkpoint A).
 *
 * Moved verbatim from lib/services/dynamics-service.js: `resolveLogicalName`
 * and `checkRestriction` (both static methods; neither uses `this`), plus the
 * two module-private `$expand` parsers (`splitExpandSegments`,
 * `parseExpandSegment`) they depend on — used only by `checkRestriction`.
 * The facade keeps thin delegating wrappers for both public functions.
 *
 * `checkRestriction` fails closed: it reads the request-scoped restriction
 * context from `dynamics-context.js` (AsyncLocalStorage) and throws when no
 * context is set, so every caller must opt in explicitly via
 * `withDynamicsContext` / `bypassDynamicsRestrictions` /
 * `enterDynamicsBypassForScript`.
 *
 * Deps: constants (`ENTITY_SET_TO_LOGICAL`), dynamics-context
 * (`getDynamicsContext`).
 */

import { ENTITY_SET_TO_LOGICAL } from './constants.js';
import { getDynamicsContext } from '../dynamics-context.js';

/**
 * Resolve an entity set name back to its logical table name.
 */
export function resolveLogicalName(entitySet) {
  return ENTITY_SET_TO_LOGICAL[entitySet] || entitySet;
}

/**
 * Check if a table or field is restricted. Throws on violation.
 * Also validates $expand navigation properties against restrictions.
 * @param {string} tableName - Logical table name
 * @param {string} [selectFields] - Comma-separated $select fields
 * @param {string} [expandParam] - OData $expand value
 * @param {string} [requestId] - Current request ID (state-leak detection)
 */
export function checkRestriction(tableName, selectFields, expandParam, requestId) {
  // Restrictions are read from the request-scoped AsyncLocalStorage context
  // established by `withDynamicsContext` / `bypassDynamicsRestrictions` /
  // `enterDynamicsBypassForScript` in `dynamics-context.js`. Fail closed if
  // no context is set — every caller must opt in explicitly.
  const ctx = getDynamicsContext();
  if (!ctx) {
    throw new Error('Restrictions not initialized — cannot execute query');
  }
  const restrictions = ctx.restrictions;
  const activeRequestId = ctx.requestId;

  // State-leak detection: warn if requestId doesn't match
  if (requestId && activeRequestId && requestId !== activeRequestId) {
    console.warn(`[DynExp SECURITY] Restriction state mismatch: expected ${activeRequestId}, got ${requestId}. Possible request interleaving.`);
  }

  for (const r of restrictions) {
    if (r.table_name === tableName) {
      if (!r.field_name) {
        throw new Error(`Access denied: table "${tableName}" is restricted`);
      }
      if (selectFields) {
        const fields = selectFields.split(',').map(f => f.trim());
        if (fields.includes(r.field_name)) {
          throw new Error(`Access denied: field "${r.field_name}" on "${tableName}" is restricted`);
        }
      }
    }

    // Check $expand for restricted tables/fields via navigation properties
    if (expandParam) {
      const segments = splitExpandSegments(expandParam);
      for (const seg of segments) {
        const { navProperty, nestedSelect } = parseExpandSegment(seg);
        // Table-level block: navigation property name contains the restricted table name
        if (!r.field_name && navProperty.toLowerCase().includes(r.table_name.toLowerCase())) {
          throw new Error(`Access denied: $expand references restricted table "${r.table_name}" via "${navProperty}"`);
        }
        // Field-level block: nested $select contains the restricted field
        if (r.field_name && r.table_name === tableName && nestedSelect) {
          const nestedFields = nestedSelect.split(',').map(f => f.trim());
          if (nestedFields.includes(r.field_name)) {
            throw new Error(`Access denied: $expand nested $select references restricted field "${r.field_name}"`);
          }
        }
      }
    }
  }
}

/**
 * Split an OData $expand value into individual segments.
 * Handles commas inside parentheses (nested query options).
 * E.g. "a($select=x),b($select=y,z)" → ["a($select=x)", "b($select=y,z)"]
 */
function splitExpandSegments(expand) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (const ch of expand) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/**
 * Parse a single $expand segment into its navigation property name
 * and any nested $select value.
 * E.g. "contact_akoya_request($select=fullname,emailaddress1)"
 *   → { navProperty: "contact_akoya_request", nestedSelect: "fullname,emailaddress1" }
 */
function parseExpandSegment(segment) {
  const parenIdx = segment.indexOf('(');
  if (parenIdx === -1) {
    return { navProperty: segment.trim(), nestedSelect: null };
  }
  const navProperty = segment.substring(0, parenIdx).trim();
  const options = segment.substring(parenIdx + 1, segment.lastIndexOf(')'));
  // Extract $select= value from nested options
  const selectMatch = options.match(/\$select\s*=\s*([^;)]+)/);
  const nestedSelect = selectMatch ? selectMatch[1].trim() : null;
  return { navProperty, nestedSelect };
}

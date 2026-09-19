/**
 * OData call validation and fail-loud typed error classification for the
 * Dynamics Explorer chat loop: the pre-execution `$filter`/table validator
 * gate (validateEffectiveODataCall, validatorReject) and the post-execution
 * "unknown field/property" classifier (A5) that turns a truncated Dataverse
 * 400 into a deterministic correction path.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:777-794,
 * 951-1045 (pre-S2 line numbers); characterization tests are the safety
 * net.
 */

import { isOperationalLogTable } from './result-shaping';
import { validateODataCall, expandRestrictedFieldNames, isLookupAliasType, lookupAliasFor } from '../dynamics-odata-validator';
import { TABLE_ANNOTATIONS } from '../../../shared/config/prompts/dynamics-explorer';
import { DynamicsService } from '../dynamics-service';
import { ENTITY_TYPE_CONFIGS } from './tools/get-entity';
import { restrictedFieldsForTable } from './restriction-guard';

export async function validateEffectiveODataCall(name, input, restrictions) {
  if (isOperationalLogTable(input?.table_name)) {
    return {
      reject: 'DENIED: wmkf_ai_run is an operational AI audit log, not business data. '
        + 'Dynamics Explorer does not expose it through natural-language queries.',
    };
  }
  return await validateODataCall(name, input, {
    tableAnnotations: TABLE_ANNOTATIONS,
    getEntityAttributes: tableName => DynamicsService.getEntityAttributes(tableName),
    restrictions,
    entityConfigs: ENTITY_TYPE_CONFIGS,
  });
}

export function validatorReject(message) {
  return { error: message, _validatorReject: true };
}

// ─── A5: fail-loud typed errors ───
//
// Dataverse 400s for a bad field/entity name are returned as truncated plain
// strings today, so the model re-guesses across rounds (the dominant Explorer
// failure per the S200 soak). Classify the common "unknown field/property"
// shape and hand back a deterministic correction path: the offending name, the
// closest VALID field names (restriction-filtered, capped for token budget),
// and a describe_table pointer — instead of a bare error string.

const UNKNOWN_FIELD_RE = /Could not find a property named '([^']+)'/i;
const UNKNOWN_PROP_RE = /The property '([^']+)' does not exist/i;
const UNKNOWN_SEGMENT_RE = /Resource not found for the segment '([^']+)'/i;

/**
 * Rank valid field names by similarity to a bad name (prefix overlap +
 * substring containment). Lookup fields are filtered as `x` in metadata but
 * queried as `_x_value`, so compare against the de-affixed core too. Returns
 * up to `limit` names.
 */
export function closestFieldNames(invalid, validFields, limit = 8) {
  const lc = String(invalid).toLowerCase();
  const core = lc.replace(/^_/, '').replace(/_value$/, '');
  const scored = [];
  for (const v of validFields) {
    const vl = v.toLowerCase();
    let score = 0;
    if (vl === lc || vl === core) score += 100;
    else if (vl.includes(core) || core.includes(vl)) score += 50;
    let p = 0;
    while (p < vl.length && p < core.length && vl[p] === core[p]) p++;
    score += p;
    if (score > 2) scored.push({ v, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.v);
}

export async function classifyToolError(err, name, input, restrictions = []) {
  const raw = err?.message || 'Unknown error';
  const fallback = { error: raw.substring(0, 500) };

  // The /$count Edm.Int32 bug surfaces UNKNOWN_FIELD_RE with the CORRECT field
  // name on type 'Edm.Int32' — not a real unknown field. A3 fixed the count
  // path, but guard anyway so this never mislabels it as a bad field.
  if (/on type 'Edm\.Int32'/i.test(raw)) return fallback;

  const fieldMatch = raw.match(UNKNOWN_FIELD_RE) || raw.match(UNKNOWN_PROP_RE);
  if (fieldMatch && input?.table_name) {
    const invalidField = fieldMatch[1];
    try {
      // Normalize to the logical name so enrichment works when the model passed
      // an accepted entity-set alias (e.g. "akoya_requests"), and so restriction
      // filtering matches restrictions (keyed by logical name). Inside the try so
      // any failure falls back to the raw error — enrichment never masks it.
      const tableName = DynamicsService.resolveLogicalName(input.table_name);
      const attrs = await DynamicsService.getEntityAttributes(tableName);
      // Expanded across both lookup spellings so a restriction stored under one
      // can't be suggested back under the other.
      const restricted = expandRestrictedFieldNames(
        restrictedFieldsForTable(tableName, restrictions),
        attrs,
      );
      // Suggest the spelling the model must actually type in $select/$filter.
      // Offering the bare lookup name here contradicted this hint's own
      // "_<name>_value" instruction and cost a round every time.
      const validNames = attrs
        .map(a => (isLookupAliasType(a.type) ? lookupAliasFor(a.logicalName) : a.logicalName))
        .filter(f => !restricted.has(f));
      const suggestions = closestFieldNames(invalidField, validNames);
      return {
        error: raw.substring(0, 300),
        errorType: 'unknown_field',
        invalidField,
        table: tableName,
        suggestions,
        hint: `"${invalidField}" is not a readable field on ${tableName}. Do NOT retry with a guessed name. ${
          suggestions.length ? `Closest valid fields: ${suggestions.join(', ')}. ` : ''
        }Lookup fields are queried as _<name>_value in $filter/$select. For the full field list call describe_table with { table_name: "${tableName}", full: true }.`,
      };
    } catch {
      return fallback; // enrichment is best-effort; never mask the original error
    }
  }

  const segMatch = raw.match(UNKNOWN_SEGMENT_RE);
  if (segMatch) {
    return {
      error: raw.substring(0, 300),
      errorType: 'unknown_entity',
      invalidSegment: segMatch[1],
      hint: `"${segMatch[1]}" is not a valid table/navigation. Use discover_tables to find the correct table name, then describe_table before querying. Do NOT guess.`,
    };
  }

  return fallback;
}

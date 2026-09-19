/**
 * describe_table tool: annotated + live field metadata for a Dynamics table,
 * or a directory of all annotated tables when none is requested.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:920-925,
 * 1047-1157 (pre-S2 line numbers); characterization tests are the safety
 * net.
 */

import { TABLE_ANNOTATIONS, formatInlineFieldDescription, formatInlineRule } from '../../../../shared/config/prompts/dynamics-explorer';
import { restrictedFieldsForTable, redactRestrictedFieldNames } from '../restriction-guard';
import { isOperationalLogTable } from '../result-shaping';
import { DynamicsService } from '../../dynamics-service';
import { expandRestrictedFieldNames, isLookupAliasType, lookupAliasFor } from '../../dynamics-odata-validator';

// ─── describe_table ───

/**
 * Return annotated and live field metadata for a table, or list all annotated
 * tables if no table is requested.
 */

export async function describeTable({ table_name, full = false }, restrictions = []) {
  if (!table_name) {
    const tables = Object.entries(TABLE_ANNOTATIONS).map(([name, info]) => {
      const restricted = restrictedFieldsForTable(name, restrictions);
      return `${name} (${info.entitySet}) — ${redactRestrictedFieldNames(info.description, restricted)}`;
    });
    return {
      tables: tables.join('\n'),
      count: tables.length,
      note: 'All annotated tables listed above. Call with a specific table_name for field details, including live Dataverse fields.',
    };
  }
  if (isOperationalLogTable(table_name)) {
    return {
      error: 'DENIED: wmkf_ai_run is an operational AI audit log, not business data. '
        + 'Dynamics Explorer does not expose it through schema suggestions.',
    };
  }

  // Field-level restriction gate. getEntityAttributes only checks TABLE-level
  // restrictions (a wholly-restricted table is blocked upstream by
  // checkRestriction), so a field-level restriction would otherwise leak the
  // restricted attribute's name/metadata through this listing. Drop any field
  // restricted for this table from both the curated and live field sets, and
  // redact its name from all remaining free text (descriptions + rules).
  const table = TABLE_ANNOTATIONS[table_name];
  const liveAttributes = await DynamicsService.getEntityAttributes(table_name);
  // Live metadata is needed to expand a restriction across both lookup
  // spellings, so the attribute fetch has to precede the restriction set.
  const restrictedFieldNames = expandRestrictedFieldNames(
    restrictedFieldsForTable(table_name, restrictions),
    liveAttributes,
  );
  const curatedFields = Object.fromEntries(
    Object.entries(table?.fields || {}).filter(([field]) => !restrictedFieldNames.has(field))
  );
  const curatedNames = new Set(Object.keys(curatedFields));
  const additionalLiveFields = liveAttributes
    .filter(attr => !curatedNames.has(attr.logicalName) && !restrictedFieldNames.has(attr.logicalName))
    .map(attr => {
      const field = {
        logicalName: attr.logicalName,
        displayName: redactRestrictedFieldNames(attr.displayName, restrictedFieldNames),
        type: attr.type,
        description: redactRestrictedFieldNames(attr.description, restrictedFieldNames),
      };
      // AttributeMetadata reports the BARE lookup column, which is exactly the
      // spelling the model then wrote into $filter and Dataverse 400'd. Surface
      // the queryable computed alias alongside it so this path teaches the right
      // name instead of the wrong one.
      if (isLookupAliasType(attr.type)) field.queryAs = lookupAliasFor(attr.logicalName);
      return field;
    });
  const hasLookupAlias = additionalLiveFields.some(f => f.queryAs);

  // Apply the same inline-render sanitizers used by buildInlineSchemas so the
  // describe_table path can't leak stale hardcoded option-set codes (e.g.
  // wmkf_request_type's baked 100000001) that A2 replaced with the resolved
  // taxonomy block. Without this, describe_table('akoya_request') would still
  // surface the raw annotation codes and conflict with the live resolution.
  const fieldLines = Object.entries(curatedFields).map(([field, desc]) =>
    `  ${field}: ${formatInlineFieldDescription(table_name, field, desc)}`
  );
  const rulesBlock = table?.rules?.length > 0
    ? `\nRULES:\n${table.rules.map(r => `  - ${formatInlineRule(table_name, r)}`).join('\n')}`
    : '';

  const result = {
    table: table_name,
    entitySet: table?.entitySet || null,
    description: redactRestrictedFieldNames(
      table?.description || 'Live Dataverse table metadata. No curated annotation is available for this table.',
      restrictedFieldNames,
    ),
    fields: redactRestrictedFieldNames(fieldLines.join('\n'), restrictedFieldNames),
    rules: redactRestrictedFieldNames(rulesBlock, restrictedFieldNames),
    additionalLiveFieldCount: additionalLiveFields.length,
  };

  if (hasLookupAlias) {
    // The bare logicalName is NOT the navigation property. Navigation property
    // names come from relationship metadata (CSDL), are case-sensitive, and for
    // multi-table Customer/Owner/regarding lookups bear no fixed relation to the
    // column's logical name — this path has attribute metadata only, so it must
    // not teach a guess.
    result.lookupFieldNote = 'Lookup/Customer/Owner columns carry a "queryAs" name. '
      + 'Use queryAs (_<name>_value) in $select and $filter, compared to an UNQUOTED GUID or to null. '
      + 'The bare logicalName is not a queryable property, and it is not necessarily the $expand navigation '
      + 'property either: navigation property names come from relationship metadata, are case-sensitive, and '
      + 'for multi-table lookups do not follow the column name — do not guess them. '
      + 'Neither spelling is accepted in $orderby or as an aggregate field/group_by.';
  }

  if (full) {
    result.additionalLiveFields = additionalLiveFields;
  } else {
    result.additionalLiveFieldSample = additionalLiveFields.slice(0, 12);
    result.note = additionalLiveFields.length > result.additionalLiveFieldSample.length
      ? `There are ${additionalLiveFields.length} readable live fields beyond the curated annotations. Call describe_table with full:true for the complete additional list.`
      : 'All additional live fields are shown in the sample.';
  }

  if (!table) {
    result.fields = '';
    result.note = full
      ? 'Unknown to curated annotations; returned full live Dataverse readable fields.'
      : 'Unknown to curated annotations; returned a live Dataverse readable-field sample. Call describe_table with full:true for the complete list.';
  }

  return result;
}

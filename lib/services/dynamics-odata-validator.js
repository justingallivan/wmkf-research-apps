const REQUEST_NUMBER_PATTERN = /^\d{5,7}$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A canonical GUID appearing UNQUOTED in an OData expression. Bounded on both
// sides so it can't match a fragment of a longer identifier.
const GUID_LITERAL_PATTERN = /(?<![0-9A-Za-z_-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z_-])/gi;

// Hex-and-dash runs that look like someone meant a GUID. Evaluated only AFTER
// string literals, canonical GUIDs and date literals have been removed, so a
// valid GUID and an ISO datetime can never reach it.
const GUIDISH_PATTERN = /(?<![0-9A-Za-z_])[0-9a-f]+(?:-[0-9a-f]+){2,}(?![0-9A-Za-z_])/gi;

// ─── Lookup computed-alias catalog ───
//
// Dataverse AttributeMetadata reports a lookup column under its BARE logical
// name (`akoya_applicantid`). The Web API exposes the queryable value of that
// column as a computed Edm.Guid property named `_<logicalname>_value`, which is
// never itself an attribute row. $select/$filter need the alias, so the
// validator has to synthesize it rather than expect it in metadata.
//
// What attribute metadata does NOT give us is the $expand spelling. The
// single-valued navigation property for a lookup comes from RELATIONSHIP
// metadata (CSDL), is case-sensitive, and for multi-table lookups
// (Customer / Owner / regardingobject) is not derivable from the column's
// logical name at all. This module never fetches relationship metadata, so it
// never prescribes a navigation property name — it only rejects the spellings
// it can prove wrong.
//
// Explicit allowlist, not "anything id-shaped":
//   - Lookup / Customer / Owner  → one `_<name>_value` Edm.Guid each, including
//     the polymorphic ones (regardingobjectid, customerid, ownerid). Polymorphism
//     changes filter semantics, not the alias spelling.
//   - PartyList (activity `to`/`from`/`cc`) is an activity-party COLLECTION with
//     no `_value` computed property — synthesizing one fabricates a field — and
//     it is not a scalar query property in any expression either.
//   - Uniqueidentifier is a primary key, not a lookup — it is queried by its own
//     bare name, still as an Edm.Guid.
const LOOKUP_ALIAS_TYPES = new Set(['lookup', 'customer', 'owner']);

/** True for the AttributeType of an activity-party collection. */
function isPartyListType(type) {
  return String(type || '').trim().toLowerCase() === 'partylist';
}

function isUniqueidentifierType(type) {
  return String(type || '').trim().toLowerCase() === 'uniqueidentifier';
}

// One canonical id used in every hint, so the correction the model is taught is
// always the same shape.
const GUID_EXAMPLE = '3f2504e0-4f89-11d3-9a0c-0305e82c330c';

/** True for the AttributeType values that carry a `_<name>_value` computed property. */
export function isLookupAliasType(type) {
  return LOOKUP_ALIAS_TYPES.has(String(type || '').trim().toLowerCase());
}

/** The Web API computed property name for a lookup column's logical name. */
export function lookupAliasFor(logicalName) {
  return `_${logicalName}_value`;
}

/**
 * Derive the bare↔alias catalog from raw attribute metadata.
 * Returns two maps so both directions are exact lookups — no name heuristics.
 */
export function buildLookupAliasCatalog(attrs = []) {
  const bareToAlias = new Map();
  const aliasToBare = new Map();
  for (const attr of attrs) {
    const bare = attr?.logicalName;
    if (!bare || !isLookupAliasType(attr.type)) continue;
    // Defensive: never double-wrap a name that is already alias-shaped.
    if (bare.startsWith('_') && bare.endsWith('_value')) continue;
    const alias = lookupAliasFor(bare);
    bareToAlias.set(bare, alias);
    aliasToBare.set(alias, bare);
  }
  return { bareToAlias, aliasToBare };
}

/**
 * Expand a restricted-field set across BOTH lookup spellings.
 *
 * Restrictions are stored as a single literal `field_name`, so a restriction
 * recorded bare would otherwise leave the computed alias as an unguarded read
 * path to the same column (and vice versa). Shared by the validator and by
 * chat.js's describe_table / classifyToolError paths so the two cannot drift.
 */
export function expandRestrictedFieldNames(fieldNames, attrs = []) {
  const out = new Set(fieldNames);
  if (!out.size) return out;
  const { bareToAlias, aliasToBare } = buildLookupAliasCatalog(attrs);
  for (const name of fieldNames) {
    if (bareToAlias.has(name)) out.add(bareToAlias.get(name));
    if (aliasToBare.has(name)) out.add(aliasToBare.get(name));
  }
  return out;
}

const ODATA_KEYWORDS = new Set([
  'and', 'or', 'not', 'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'null', 'true', 'false',
  'asc', 'desc', 'add', 'sub', 'mul', 'div', 'mod', 'has', 'with', 'as', 'by',
  'filter', 'groupby', 'aggregate',
  'propertyname', 'propertyvalues',
]);

const ODATA_FUNCTIONS = new Set([
  'contains', 'startswith', 'endswith', 'substringof', 'tolower', 'toupper', 'trim',
  'length', 'indexof', 'substring', 'concat', 'year', 'month', 'day', 'date', 'time',
  'now', 'any', 'all',
]);

export function validateODataCall(name, input, ctx) {
  const validator = new ODataValidator(ctx);
  return validator.validate(name, input);
}

class ODataValidator {
  constructor({
    tableAnnotations,
    getEntityAttributes,
    restrictions = [],
    entityConfigs = {},
  }) {
    this.tableAnnotations = tableAnnotations || {};
    this.getEntityAttributes = getEntityAttributes;
    this.restrictions = restrictions;
    this.entityConfigs = entityConfigs;
  }

  async validate(name, input = {}) {
    if (name === 'get_entity') return this.validateGetEntity(input);
    if (name === 'get_related') return this.validateGetRelated(input);
    if (!['query_records', 'count_records', 'export_csv', 'aggregate'].includes(name)) {
      return { ok: true };
    }

    const inputTableName = input.table_name;
    const tableName = normalizeTableName(inputTableName, this.tableAnnotations);
    if (!tableName) {
      return { reject: unknownEntityHint(inputTableName, this.tableAnnotations) };
    }
    input = { ...input, table_name: tableName };

    const attrs = await this.getEntityAttributes(tableName);
    const { bareToAlias, aliasToBare } = buildLookupAliasCatalog(attrs);

    // Fold the synthesized aliases into the SAME sets every downstream guard
    // reads. Keeping the catalog beside attrNames would silently disable
    // findContainsOnLookup and findRequestNumberComparedToLookup.
    const attrNames = new Set(attrs.map(a => a.logicalName).filter(Boolean));
    const typeByName = new Map(attrs.map(a => [a.logicalName, a.type]));
    for (const [bare, alias] of bareToAlias) {
      attrNames.add(alias);
      typeByName.set(alias, typeByName.get(bare));
    }

    const restrictedFields = expandRestrictedFieldNames(
      restrictedFieldsForTable(tableName, this.restrictions),
      attrs,
    );
    const visibleAttrNames = [...attrNames].filter(n => !restrictedFields.has(n));

    const expressions = effectiveExpressionsForTool(name, input);

    // Restrictions first, across every model-supplied expression and both
    // spellings, so no later hint can disclose a restricted column's shape.
    // extractRestrictionFieldTokens — not the general tokenizer — because a
    // restriction on `akoya_applicantid` must also catch
    // `akoya_applicantid/name eq '…'`, which reads the restricted column
    // through its navigation path.
    for (const expr of expressions) {
      for (const token of extractRestrictionFieldTokens(expr.value, expr.kind)) {
        if (restrictedFields.has(token)) {
          return { reject: `DENIED: Field "${token}" is restricted and cannot be used in ${expr.kind}.` };
        }
      }
    }

    // Nested $expand options name fields on the EXPANDED table. Its identity
    // comes from relationship metadata, which this validator does not fetch, so
    // the target table's restrictions cannot be applied and the options cannot
    // be cleared. Fail closed whenever any field-level restriction exists
    // anywhere — an unresolvable target cannot be proven unrestricted. With no
    // field restriction configured, nested options are unchanged.
    if (this.restrictions.some(r => r?.field_name) && hasNestedExpandOptions(input.expand)) {
      return {
        reject: 'DENIED: $expand options ($select/$filter inside the parentheses) read fields on the '
          + 'expanded table, whose field restrictions cannot be checked from here. Re-run $expand without '
          + 'nested options, or query the related table directly so its own restrictions apply.',
      };
    }

    const unsupported = findUnsupportedConstruct(input, attrNames, typeByName, bareToAlias);
    if (unsupported) return { reject: unsupported };

    const requestNumberGuidHit = findRequestNumberComparedToLookup(input, attrNames, typeByName);
    if (requestNumberGuidHit) {
      return {
        reject: `Field "${requestNumberGuidHit.field}" needs a GUID, not request number "${requestNumberGuidHit.value}". Resolve the request to its GUID first, then filter by the GUID id.`,
      };
    }

    const malformedGuid = findMalformedGuidLiteral(expressions);
    if (malformedGuid) {
      return {
        reject: `"${malformedGuid}" is not a valid GUID. Dataverse ids are 8-4-4-4-12 hex digits (for example ${GUID_EXAMPLE}). Resolve the record to its full id first, then compare the lookup's _<name>_value column to the UNQUOTED GUID.`,
      };
    }

    // Type-aware literal check. The synthesized aliases and Uniqueidentifier
    // columns are Edm.Guid, and OData requires matching operand types: an
    // unquoted GUID or null. A quoted GUID is an Edm.String operand. Runs after
    // the request-number and malformed-GUID guards so their more specific
    // guidance still wins.
    const badLiteral = findInvalidGuidComparison(input.filter, aliasToBare, attrNames, typeByName);
    if (badLiteral) {
      return {
        reject: `Field "${badLiteral.field}" is an Edm.Guid column: compare it to an UNQUOTED GUID, or to null. `
          + `${badLiteral.literal} is not one — use the 8-4-4-4-12 form, for example `
          + `${badLiteral.field} ${badLiteral.operator} ${GUID_EXAMPLE}.`,
      };
    }

    for (const expr of expressions) {
      const tokens = extractODataFieldTokens(expr.value, expr.kind);
      for (const token of tokens) {
        // $expand takes a single-valued NAVIGATION PROPERTY, whose name lives in
        // relationship metadata rather than in AttributeMetadata. Only the
        // provably wrong spelling (the computed alias) is judged here;
        // everything else passes through to Dataverse unaltered.
        if (expr.kind === 'expand') {
          if (aliasToBare.has(token)) return { reject: expandAliasHint(token) };
          continue;
        }
        if (!attrNames.has(token)) {
          return { reject: unknownFieldHint(token, input.table_name, visibleAttrNames) };
        }

        const type = typeByName.get(token);
        if (isPartyListType(type)) return { reject: partyListHint(token, expr.kind) };

        const isLookupSpelling = aliasToBare.has(token) || bareToAlias.has(token);
        if (!isLookupSpelling) continue;

        if (expr.kind === 'select' || expr.kind === 'filter') {
          // Only the BARE spelling is wrong here — the alias is the answer.
          if (bareToAlias.has(token)) {
            return {
              reject: `Field "${token}" is a lookup column reported under its bare logical name. Use "${bareToAlias.get(token)}" in $${expr.kind} instead — it holds the related record's GUID (compare it to an UNQUOTED GUID). "${token}" is not a queryable property.`,
            };
          }
        } else if (expr.kind === 'orderby') {
          return { reject: lookupNotSortableHint(token) };
        } else if (expr.kind === 'field' || expr.kind === 'group_by') {
          return { reject: lookupNotAggregatableHint(token, expr.kind) };
        }
      }
    }

    return { ok: true };
  }

  validateGetEntity({ type, identifier }) {
    const cfg = this.entityConfigs[type];
    if (!cfg || !identifier) return { ok: true };
    if (!cfg.filterField && REQUEST_NUMBER_PATTERN.test(String(identifier)) && !GUID_PATTERN.test(String(identifier))) {
      return {
        reject: `${type} identifiers must be GUIDs on this path; "${identifier}" looks like a request number. Resolve the request to its GUID first.`,
      };
    }
    return { ok: true };
  }

  validateGetRelated({ source_id, date_from, date_to }) {
    if (source_id && REQUEST_NUMBER_PATTERN.test(String(source_id)) && !GUID_PATTERN.test(String(source_id))) {
      return { reject: `source_id needs a GUID, not request number "${source_id}". Resolve the request to its GUID first.` };
    }
    for (const [name, value] of Object.entries({ date_from, date_to })) {
      if (value && !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/.test(String(value))) {
        return { reject: `${name} must be an ISO date/date-time, not "${value}".` };
      }
    }
    return { ok: true };
  }
}

function effectiveExpressionsForTool(name, input) {
  const expressions = [];
  if (input.select) expressions.push({ kind: 'select', value: input.select });
  if (input.filter) expressions.push({ kind: 'filter', value: input.filter });
  if (input.orderby) expressions.push({ kind: 'orderby', value: input.orderby });
  if (input.expand) expressions.push({ kind: 'expand', value: input.expand });
  if (name === 'aggregate') {
    if (input.field) expressions.push({ kind: 'field', value: input.field });
    if (input.group_by) expressions.push({ kind: 'group_by', value: input.group_by });
  } else if (input.group_by) {
    expressions.push({ kind: 'group_by', value: input.group_by });
  }
  return expressions;
}

/** How an expression slot is named back to the model. */
function describeKind(kind) {
  if (kind === 'field') return 'the aggregate field';
  if (kind === 'group_by') return 'the aggregate group_by';
  return `$${kind}`;
}

// The navigation property is NOT derivable here: it comes from relationship
// metadata, is case-sensitive, and for multi-table lookups (Customer, Owner,
// regardingobject) it is unrelated to the column's logical name. Naming the bare
// logical name would be a guess, so this says what is wrong and stops.
function expandAliasHint(token) {
  return `Field "${token}" is the computed lookup column, not a navigation property — it belongs in $select/$filter. `
    + '$expand needs the relationship\'s navigation property name, which comes from relationship metadata and is '
    + 'not always the column\'s logical name: do not guess it. If you cannot confirm it, drop $expand and query '
    + 'the related record separately by the GUID held in the computed column.';
}

function partyListHint(token, kind) {
  return `Field "${token}" is a PartyList (activity-party collection), not a scalar query property, so it cannot be used in ${describeKind(kind)}. `
    + 'It has no _<name>_value column, and its navigation property name is not derivable from attribute metadata. '
    + 'Query the activityparty records for this activity instead.';
}

function lookupNotSortableHint(token) {
  return `Field "${token}" is a lookup column and cannot be used in $orderby — neither the bare logical name nor the `
    + '_<name>_value computed column is sortable. Order by a scalar column (a name, number or date field) instead, '
    + 'or sort after resolving the lookup.';
}

// Dataverse aggregation over a lookup is not verified for either spelling here,
// so both fail closed rather than being forwarded into a Dataverse 400.
function lookupNotAggregatableHint(token, kind) {
  return `Field "${token}" is a lookup column and cannot be used as ${describeKind(kind)} — neither the bare logical `
    + 'name nor the _<name>_value computed column is supported there. Aggregate or group by a scalar column '
    + '(a number, date, option-set or string field), or resolve the lookup to a scalar attribute first.';
}

function findUnsupportedConstruct(input, attrNames, typeByName, bareToAlias) {
  const filter = input.filter || '';
  const filterNoStrings = stripStringLiterals(filter);
  if (/\b(?:year|month|day)\s*\(/i.test(filterNoStrings)) {
    return 'OData year()/month()/day() date functions are not supported here. Use an explicit date range instead.';
  }
  const formatted = extractODataFieldTokens(filter, 'filter').find(t => t.endsWith('_formatted'));
  if (formatted) {
    return `Do not filter on formatted annotation field "${formatted}". Filter the raw lookup _value GUID or underlying field instead.`;
  }
  const containsLookup = findContainsOnLookup(filter, attrNames, typeByName);
  if (containsLookup) {
    // Teach the spelling AND the literal form: the column is Edm.Guid, so the
    // corrected filter compares it to an unquoted GUID, never a quoted one.
    const queryable = bareToAlias?.get(containsLookup) || containsLookup;
    return `contains() cannot be used on lookup field "${containsLookup}" because lookups hold GUIDs. `
      + `Resolve the record to its id first, then compare "${queryable}" to an UNQUOTED GUID `
      + `(for example ${queryable} eq ${GUID_EXAMPLE}).`;
  }
  if (/\bin\s*\(\s*select\b/i.test(filterNoStrings)) {
    return 'OData subqueries like in (select ...) are not supported. Do it in two steps: query the child records, then query with the resolved GUIDs.';
  }
  return null;
}

// Recognized by TYPE, not by name shape, so `contains()` on the BARE lookup is
// classified here in one round instead of being bounced to the alias hint and
// rejected on the retry.
function findContainsOnLookup(filter, attrNames, typeByName) {
  const noStrings = stripStringLiterals(filter);
  const re = /\bcontains\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/gi;
  let match;
  while ((match = re.exec(noStrings)) !== null) {
    const field = match[1];
    if (attrNames.has(field) && isLookupAliasType(typeByName.get(field))) return field;
  }
  return null;
}

function findRequestNumberComparedToLookup(input, attrNames, typeByName) {
  const expressions = [input.filter, input.source_id].filter(Boolean);
  for (const expr of expressions) {
    // Mask canonical GUIDs first: a valid unquoted id whose first block leads
    // with digits (12345678-aaaa-…) would otherwise have its leading 7 digits
    // read as a request number and the CORRECT filter rejected. The trailing
    // lookahead is the second line of defence — it also stops an 8+ digit
    // integer from being truncated into a 7-digit "request number".
    const noStrings = stripGuidLiterals(preserveQuotedRequestNumbers(expr));
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s+eq\s+'?(\d{5,7})(?![\d-])'?/gi;
    let match;
    while ((match = re.exec(noStrings)) !== null) {
      const field = match[1];
      const value = match[2];
      const type = typeByName.get(field);
      // Customer/Owner columns hold GUIDs exactly like Lookup does; the old
      // /lookup|uniqueidentifier/ test alone would let them through.
      if (attrNames.has(field) && (!type || isLookupAliasType(type) || /uniqueidentifier/i.test(type))) {
        return { field, value };
      }
    }
  }
  return null;
}

/**
 * A GUID the model got almost right. Detected only after string literals,
 * canonical GUIDs and date literals are gone, so a valid id and an ISO datetime
 * never reach it; the hex-digit floor keeps ordinary arithmetic out.
 */
function findMalformedGuidLiteral(expressions) {
  for (const expr of expressions) {
    if (expr.kind === 'expand') continue;
    const clean = stripDateLiterals(stripGuidLiterals(stripStringLiterals(expr.value)));
    GUIDISH_PATTERN.lastIndex = 0;
    let match;
    while ((match = GUIDISH_PATTERN.exec(clean)) !== null) {
      if (match[0].replace(/-/g, '').length >= 8) return match[0];
    }
  }
  return null;
}

/**
 * A direct `field eq|ne <literal>` comparison whose left side is an Edm.Guid
 * column (a synthesized lookup alias or a Uniqueidentifier attribute) and whose
 * right side is not an unquoted canonical GUID or null.
 *
 * Scanned over a copy whose string-literal INTERIORS are masked but whose
 * quotes and offsets survive, so a column name written inside a string
 * ("akoya_title eq '_x_value eq nonsense'") cannot be read as a comparison,
 * while quoted and unquoted operands stay distinguishable. Navigation-path
 * segments (`nav/field`) are skipped: they belong to the related table.
 */
function findInvalidGuidComparison(filter, aliasToBare, attrNames, typeByName) {
  if (!filter || typeof filter !== 'string') return null;
  const masked = maskStringLiteralInteriors(filter);
  const re = /(?<![A-Za-z0-9_/.])([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne)\s+('(?:[^']|'')*'|[^\s(),]+)/gi;
  let match;
  while ((match = re.exec(masked)) !== null) {
    const field = match[1];
    const isGuidColumn = aliasToBare.has(field)
      || (attrNames.has(field) && isUniqueidentifierType(typeByName.get(field)));
    if (!isGuidColumn) continue;
    const operand = match[3];
    if (/^null$/i.test(operand)) continue;
    if (GUID_PATTERN.test(operand)) continue;
    // Report the literal as the model actually wrote it, not the masked copy.
    const start = match.index + match[0].length - operand.length;
    return {
      field,
      operator: match[2].toLowerCase(),
      literal: `"${filter.slice(start, start + operand.length)}"`,
    };
  }
  return null;
}

/** Replace the CONTENTS of each string literal with `#`, keeping quotes and length. */
function maskStringLiteralInteriors(value) {
  return replaceStringLiterals(String(value), literal => `'${'#'.repeat(literal.length - 2)}'`);
}

/**
 * Field tokens for RESTRICTION checking.
 *
 * The general tokenizer deliberately drops navigation paths — they name fields
 * on another table and must not be existence-checked here. A restriction is a
 * different question: `akoya_applicantid/name` READS the restricted lookup on
 * THIS table, so the base segment of every path is kept and checked.
 */
function extractRestrictionFieldTokens(expression, kind = 'filter') {
  const tokens = new Set(extractODataFieldTokens(expression, kind));
  for (const base of extractNavigationPathSegments(expression)) tokens.add(base);
  return [...tokens];
}

function extractNavigationPathSegments(expression) {
  if (!expression || typeof expression !== 'string') return [];
  const clean = stripDateLiterals(stripGuidLiterals(stripStringLiterals(expression)));
  const segments = [];
  const re = /(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s*\//g;
  let match;
  while ((match = re.exec(clean)) !== null) segments.push(match[1]);
  return segments;
}

/** True when any $expand segment carries a nested `$select`/`$filter` option. */
function hasNestedExpandOptions(expand) {
  if (!expand || typeof expand !== 'string') return false;
  for (const part of splitTopLevel(expand, ',')) {
    const parenIdx = part.indexOf('(');
    if (parenIdx === -1) continue;
    if (/\$(?:select|filter)\s*=/i.test(part.slice(parenIdx))) return true;
  }
  return false;
}

export function extractODataFieldTokens(expression, kind = 'filter') {
  if (!expression || typeof expression !== 'string') return [];
  if (kind === 'select') return extractSelectTokens(expression);
  if (kind === 'expand') return extractExpandTokens(expression);

  const tokens = new Set();
  for (const field of extractContainValuesPropertyNames(expression)) {
    tokens.add(field);
  }

  // An unquoted GUID is not a string or date literal, so without this mask the
  // identifier regex below matches INSIDE it (`…-a1b2c3d4-…` → token
  // `a1b2c3d4`) and the correct lookup filter is rejected as a bogus field.
  // Masked, never deleted: the loop reads prev/next characters by index for its
  // `:` and `.` guards, so shifting offsets would break lambda/namespace
  // suppression.
  const clean = stripDateLiterals(stripGuidLiterals(stripStringLiterals(expression)));
  const re = /[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)?/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const token = match[0];
    const lower = token.toLowerCase();
    const next = clean.slice(re.lastIndex).trimStart()[0];
    const prev = clean[match.index - 1];
    if (ODATA_KEYWORDS.has(lower) || ODATA_FUNCTIONS.has(lower)) continue;
    if (next === '(') continue;
    if (next === ':' || prev === ':') continue;
    if (next === '.' || prev === '.') continue;
    if (token.includes('/')) continue;
    tokens.add(token);
  }
  return [...tokens];
}

function extractSelectTokens(select) {
  const tokens = new Set();
  for (const part of splitTopLevel(select, ',')) {
    const field = part.trim();
    if (!field) continue;
    if (field.includes('(')) continue;
    if (field.includes('/')) continue;
    tokens.add(field);
  }
  return [...tokens];
}

// $expand segments are `nav` or `nav($select=...;$filter=...)`. Only the
// navigation property belongs to THIS table; everything inside the parentheses
// names fields on the RELATED table and must never be existence-checked here.
function extractExpandTokens(expand) {
  const tokens = new Set();
  for (const part of splitTopLevel(expand, ',')) {
    const parenIdx = part.indexOf('(');
    const nav = (parenIdx === -1 ? part : part.slice(0, parenIdx)).trim();
    if (!nav || nav.includes('/')) continue;
    tokens.add(nav);
  }
  return [...tokens];
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'") {
      current += ch;
      if (inString && value[i + 1] === "'") {
        current += value[++i];
      } else {
        inString = !inString;
      }
      continue;
    }
    if (!inString) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === delimiter && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function stripStringLiterals(value) {
  return replaceStringLiterals(value, '');
}

function stripDateLiterals(value) {
  return value.replace(/\b\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z?)?\b/g, match => ' '.repeat(match.length));
}

function stripGuidLiterals(value) {
  return String(value).replace(GUID_LITERAL_PATTERN, match => ' '.repeat(match.length));
}

function preserveQuotedRequestNumbers(value) {
  return replaceStringLiterals(value, (literal) => {
    const unquoted = literal.slice(1, -1).replace(/''/g, "'");
    return REQUEST_NUMBER_PATTERN.test(unquoted) ? `'${unquoted}'` : '';
  });
}

function replaceStringLiterals(value, replacement) {
  let out = '';
  let inString = false;
  let literal = '';
  for (let i = 0; i < String(value).length; i++) {
    const ch = value[i];
    if (ch === "'") {
      literal += ch;
      if (inString && value[i + 1] === "'") {
        literal += value[++i];
        continue;
      }
      inString = !inString;
      if (!inString) {
        out += typeof replacement === 'function' ? replacement(literal) : replacement.padEnd(literal.length, ' ');
        literal = '';
      }
      continue;
    }
    if (inString) literal += ch;
    else out += ch;
  }
  return out + (inString ? ' '.repeat(literal.length) : '');
}

function extractContainValuesPropertyNames(expression) {
  const fields = [];
  const re = /\bPropertyName\s*=\s*'((?:[^']|'')+)'/gi;
  let match;
  while ((match = re.exec(expression)) !== null) {
    fields.push(match[1].replace(/''/g, "'"));
  }
  return fields;
}

function unknownEntityHint(tableName, tableAnnotations) {
  const known = Object.keys(tableAnnotations).sort();
  const suggestions = closestNames(tableName, known).join(', ');
  return `Unknown table_name "${tableName}". Known entities: ${known.join(', ')}${suggestions ? `. Closest: ${suggestions}` : ''}.`;
}

function normalizeTableName(tableName, tableAnnotations) {
  if (tableAnnotations[tableName]) return tableName;
  for (const [logicalName, info] of Object.entries(tableAnnotations)) {
    if (info?.entitySet === tableName) return logicalName;
  }
  return null;
}

function unknownFieldHint(field, tableName, visibleAttrNames) {
  const suggestions = closestNames(field, visibleAttrNames);
  return `Field "${field}" does not exist on ${tableName}.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`;
}

function closestNames(value, candidates) {
  if (!value) return candidates.slice(0, 5);
  return candidates
    .map(name => ({ name, dist: levenshtein(String(value), name) }))
    .sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map(x => x.name);
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + cost);
      last = old;
    }
  }
  return prev[b.length];
}

function restrictedFieldsForTable(tableName, restrictions = []) {
  return new Set(
    restrictions
      .filter(r => r.table_name === tableName && r.field_name)
      .map(r => r.field_name)
  );
}

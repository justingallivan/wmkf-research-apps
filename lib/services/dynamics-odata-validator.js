const REQUEST_NUMBER_PATTERN = /^\d{5,7}$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const restrictedFields = restrictedFieldsForTable(tableName, this.restrictions);
    const attrs = await this.getEntityAttributes(tableName);
    const attrNames = new Set(attrs.map(a => a.logicalName).filter(Boolean));
    const visibleAttrNames = [...attrNames].filter(n => !restrictedFields.has(n));
    const typeByName = new Map(attrs.map(a => [a.logicalName, a.type]));

    const unsupported = findUnsupportedConstruct(input, attrNames);
    if (unsupported) return { reject: unsupported };

    const restrictedHit = findRestrictedFieldUse(input, restrictedFields);
    if (restrictedHit) {
      return { reject: `DENIED: Field "${restrictedHit}" is restricted and cannot be used in this query.` };
    }

    const requestNumberGuidHit = findRequestNumberComparedToLookup(input, attrNames, typeByName);
    if (requestNumberGuidHit) {
      return {
        reject: `Field "${requestNumberGuidHit.field}" needs a GUID, not request number "${requestNumberGuidHit.value}". Resolve the request to its GUID first, then filter by the GUID id.`,
      };
    }

    const expressions = effectiveExpressionsForTool(name, input);
    for (const expr of expressions) {
      const tokens = extractODataFieldTokens(expr.value, expr.kind);
      for (const token of tokens) {
        if (restrictedFields.has(token)) {
          return { reject: `DENIED: Field "${token}" is restricted and cannot be used in ${expr.kind}.` };
        }
        if (!attrNames.has(token)) {
          const bareLookupHint = expr.kind === 'select' ? lookupValueHint(token, attrNames) : null;
          if (bareLookupHint) {
            return { reject: `Field "${token}" is a lookup navigation property. Use "${bareLookupHint}" in $select instead.` };
          }
          return { reject: unknownFieldHint(token, input.table_name, visibleAttrNames) };
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
  if (name === 'aggregate') {
    if (input.field) expressions.push({ kind: 'field', value: input.field });
    if (input.group_by) expressions.push({ kind: 'group_by', value: input.group_by });
  } else if (input.group_by) {
    expressions.push({ kind: 'group_by', value: input.group_by });
  }
  return expressions;
}

function findUnsupportedConstruct(input, attrNames) {
  const filter = input.filter || '';
  const filterNoStrings = stripStringLiterals(filter);
  if (/\b(?:year|month|day)\s*\(/i.test(filterNoStrings)) {
    return 'OData year()/month()/day() date functions are not supported here. Use an explicit date range instead.';
  }
  const formatted = extractODataFieldTokens(filter, 'filter').find(t => t.endsWith('_formatted'));
  if (formatted) {
    return `Do not filter on formatted annotation field "${formatted}". Filter the raw lookup _value GUID or underlying field instead.`;
  }
  const containsLookup = findContainsOnLookup(filter, attrNames);
  if (containsLookup) {
    return `contains() cannot be used on lookup field "${containsLookup}" because lookups hold GUIDs. Use eq '<guid>' after resolving the record.`;
  }
  if (/\bin\s*\(\s*select\b/i.test(filterNoStrings)) {
    return 'OData subqueries like in (select ...) are not supported. Do it in two steps: query the child records, then query with the resolved GUIDs.';
  }
  return null;
}

function findContainsOnLookup(filter, attrNames) {
  const noStrings = stripStringLiterals(filter);
  const re = /\bcontains\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/gi;
  let match;
  while ((match = re.exec(noStrings)) !== null) {
    const field = match[1];
    if (field.endsWith('_value') && attrNames.has(field)) return field;
  }
  return null;
}

function findRequestNumberComparedToLookup(input, attrNames, typeByName) {
  const expressions = [input.filter, input.source_id].filter(Boolean);
  for (const expr of expressions) {
    const noStrings = preserveQuotedRequestNumbers(expr);
    const re = /\b([A-Za-z_][A-Za-z0-9_]*_value)\s+eq\s+'?(\d{5,7})'?/gi;
    let match;
    while ((match = re.exec(noStrings)) !== null) {
      const field = match[1];
      const value = match[2];
      const type = typeByName.get(field);
      if (attrNames.has(field) && (!type || /lookup|uniqueidentifier/i.test(type))) {
        return { field, value };
      }
    }
  }
  return null;
}

function findRestrictedFieldUse(input, restrictedFields) {
  if (!restrictedFields.size) return null;
  for (const expr of effectiveExpressionsForTool('query_records', input)) {
    if (!['filter', 'orderby'].includes(expr.kind)) continue;
    for (const token of extractODataFieldTokens(expr.value, expr.kind)) {
      if (restrictedFields.has(token)) return token;
    }
  }
  return null;
}

export function extractODataFieldTokens(expression, kind = 'filter') {
  if (!expression || typeof expression !== 'string') return [];
  if (kind === 'select') return extractSelectTokens(expression);

  const tokens = new Set();
  for (const field of extractContainValuesPropertyNames(expression)) {
    tokens.add(field);
  }

  const clean = stripDateLiterals(stripStringLiterals(expression));
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

function lookupValueHint(field, attrNames) {
  const direct = `_${field}_value`;
  if (attrNames.has(direct)) return direct;
  const singular = field.endsWith('s') ? field.slice(0, -1) : field;
  const singularDirect = `_${singular}_value`;
  if (attrNames.has(singularDirect)) return singularDirect;
  return null;
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

import { fetchLiveTaxonomy, buildResolver } from './dataverse-export/live-taxonomy.js';
import { DynamicsService } from './dynamics-service.js';

const TAXONOMY_CACHE_TTL = 6 * 60 * 60 * 1000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABEL_CHARS = 80;
const MAX_BLOCK_CHARS = 6000;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

let taxonomyCache = null;

const TAXONOMY_SOURCES = {
  akoya_programs: {
    logicalName: 'akoya_program',
    entitySet: 'akoya_programs',
    resolverField: 'akoya_programid',
    odataField: '_akoya_programid_value',
    kind: 'guid',
  },
  wmkf_grantprograms: {
    logicalName: 'wmkf_grantprogram',
    entitySet: 'wmkf_grantprograms',
    resolverField: 'wmkf_grantprogram',
    odataField: '_wmkf_grantprogram_value',
    kind: 'guid',
  },
  wmkf_types: {
    logicalName: 'wmkf_type',
    entitySet: 'wmkf_types',
    resolverField: 'wmkf_type',
    odataField: '_wmkf_type_value',
    kind: 'guid',
  },
  'akoya_request.wmkf_request_type': {
    logicalName: 'akoya_request',
    entitySet: 'akoya_requests',
    fieldName: 'wmkf_request_type',
    resolverField: 'wmkf_request_type',
    odataField: 'wmkf_request_type',
    kind: 'int',
  },
  akoya_requeststatus: {
    logicalName: 'akoya_request',
    entitySet: 'akoya_requests',
    fieldName: 'akoya_requeststatus',
    odataField: 'akoya_requeststatus',
    kind: 'literal',
  },
};

async function getCachedLiveTaxonomy() {
  const now = Date.now();
  if (taxonomyCache && now - taxonomyCache.fetchedAt < TAXONOMY_CACHE_TTL) {
    return taxonomyCache.data;
  }

  const data = await fetchLiveTaxonomy();
  taxonomyCache = { data, fetchedAt: now };
  return data;
}

function clearDynamicsExplorerTaxonomyCache() {
  taxonomyCache = null;
}

function hasActiveTableRestriction(source, restrictions = []) {
  const aliases = new Set([
    source.logicalName,
    source.entitySet,
    DynamicsService.resolveLogicalName(source.entitySet),
  ].filter(Boolean));

  return restrictions.some(r => {
    if (r.field_name) return false;
    return aliases.has(r.table_name);
  });
}

function sanitizeLabel(raw, sourceName) {
  const original = String(raw ?? '');
  if (CONTROL_RE.test(original)) {
    console.warn(`[DynExp taxonomy] Dropping ${sourceName} label with control characters`);
    return null;
  }

  const label = original.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_CHARS);
  if (!label || /[|`{}]/.test(label)) {
    console.warn(`[DynExp taxonomy] Dropping malformed ${sourceName} label`);
    return null;
  }
  return label;
}

function normalizeGuid(value) {
  const str = String(value || '').trim().toLowerCase();
  return GUID_RE.test(str) ? str : null;
}

function normalizeInt(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function addRow(rows, sourceName, source, label, value) {
  const safeLabel = sanitizeLabel(label, sourceName);
  if (!safeLabel) return;

  let safeValue;
  if (source.kind === 'guid') safeValue = normalizeGuid(value);
  else if (source.kind === 'int') safeValue = normalizeInt(value);
  else if (source.kind === 'literal') safeValue = sanitizeLabel(value, sourceName);

  if (safeValue === null || safeValue === undefined) {
    console.warn(`[DynExp taxonomy] Dropping ${sourceName}.${safeLabel}: malformed value`);
    return;
  }

  rows.push(`${sourceName} | ${safeLabel} | ${source.odataField} | ${safeValue}`);
}

function appendRowsForSource(rows, sourceName, source, taxonomy, resolver) {
  if (sourceName === 'akoya_programs') {
    for (const item of taxonomy.programs || []) {
      addRow(rows, sourceName, source, item.name, resolver.resolve(source.resolverField, item.name));
    }
  } else if (sourceName === 'wmkf_grantprograms') {
    for (const item of taxonomy.fundingCategories || []) {
      addRow(rows, sourceName, source, item.name, resolver.resolve(source.resolverField, item.name));
    }
  } else if (sourceName === 'wmkf_types') {
    for (const item of taxonomy.types || []) {
      addRow(rows, sourceName, source, item.name, resolver.resolve(source.resolverField, item.name));
    }
  } else if (sourceName === 'akoya_request.wmkf_request_type') {
    for (const item of taxonomy.requestTypeOptions || []) {
      addRow(rows, sourceName, source, item.label, resolver.resolve(source.resolverField, item.label));
    }
  } else if (sourceName === 'akoya_requeststatus') {
    for (const status of taxonomy.statuses || []) {
      addRow(rows, sourceName, source, status, status);
    }
  }
}

async function buildResolvedTaxonomyPromptBlock({ restrictions = [] } = {}) {
  const taxonomy = await getCachedLiveTaxonomy();
  const resolver = buildResolver(taxonomy);
  const rows = [];
  const omitted = [];

  for (const [sourceName, source] of Object.entries(TAXONOMY_SOURCES)) {
    if (hasActiveTableRestriction(source, restrictions)) {
      omitted.push(sourceName);
      continue;
    }
    appendRowsForSource(rows, sourceName, source, taxonomy, resolver);
  }

  const omittedLine = omitted.length
    ? `\nOmitted by active table restriction: ${omitted.join(', ')}`
    : '';
  const block = [
    'SERVER-SIDE RESOLVED TAXONOMY',
    'Use these system-resolved mappings before querying lookup tables. Format: source | label | OData field | value.',
    'Values are validated server-side; lookup values are GUIDs and option-set values are integers.',
    ...rows,
  ].join('\n') + omittedLine;

  if (block.length > MAX_BLOCK_CHARS) {
    return `${block.slice(0, MAX_BLOCK_CHARS)}\n[resolved taxonomy truncated to ${MAX_BLOCK_CHARS} chars]`;
  }
  return block;
}

export {
  TAXONOMY_CACHE_TTL,
  TAXONOMY_SOURCES,
  buildResolvedTaxonomyPromptBlock,
  clearDynamicsExplorerTaxonomyCache,
};

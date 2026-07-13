import { normalizeOrcid } from '../utils/orcid-normalize.js';
import { IDENTITY_LINEAGE_FIELDS } from '../utils/reviewer-identity-fields.js';

export { IDENTITY_LINEAGE_FIELDS };

export const IDENTITY_BINDING_SOURCES = Object.freeze([
  'automated',
  'staff_confirmed',
  'self_reported',
]);

export const IDENTITY_FIELD_SOURCES = Object.freeze([
  'automated',
  'staff_manual',
  'staff_confirmed',
  'self_reported',
]);

export const IDENTITY_LINEAGE_SCHEMA_VERSION = 1;
export const IDENTITY_LINEAGE_MAX_BYTES = 2048;
export const IDENTITY_BINDING_VERSION_MAX = 2147483647;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPENALEX_AUTHOR_RE = /^A[1-9][0-9]*$/;
const SCHOLAR_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const SOURCE_SET = new Set(IDENTITY_BINDING_SOURCES);
const FIELD_SOURCE_SET = new Set(IDENTITY_FIELD_SOURCES);
const FIELD_SET = new Set(IDENTITY_LINEAGE_FIELDS);
const METRIC_RANGES = Object.freeze({
  wmkf_hindex: [0, 1000],
  wmkf_i10index: [0, 100000],
  wmkf_totalcitations: [0, 100000000],
});
const ISO_UTC_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * Accept the strict UTC forms Dataverse can return and normalize once to the
 * millisecond form used for durable comparisons and writes.
 */
export function normalizeIdentityTimestamp(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(ISO_UTC_TIMESTAMP_RE);
  if (!match) return null;
  const normalizedInput = `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`;
  const timestamp = Date.parse(normalizedInput);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString();
  return normalized === normalizedInput ? normalized : null;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalOpenAlexAuthorId(raw) {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'openalex.org' || parsed.search || parsed.hash) return null;
    const match = parsed.pathname.match(/^\/(A[1-9][0-9]*)\/?$/i);
    if (!match) return null;
    value = match[1];
  }
  value = value.toUpperCase();
  return OPENALEX_AUTHOR_RE.test(value) ? value : null;
}

export function normalizeBindingAnchor(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 255) {
    return { ok: false, error: 'binding anchor is missing or oversized' };
  }
  const value = raw.trim();
  const separator = value.indexOf(':');
  if (separator <= 0) return { ok: false, error: 'binding anchor namespace is missing' };
  const namespace = value.slice(0, separator).toLowerCase();
  const identifier = value.slice(separator + 1);

  if (namespace === 'orcid') {
    const normalized = normalizeOrcid(identifier);
    if (normalized.state !== 'valid') return { ok: false, error: 'binding ORCID is malformed' };
    return { ok: true, namespace, value: `orcid:${normalized.id}` };
  }
  if (namespace === 'openalex') {
    const normalized = canonicalOpenAlexAuthorId(identifier);
    if (!normalized) return { ok: false, error: 'binding OpenAlex author id is malformed' };
    return { ok: true, namespace, value: `openalex:${normalized}` };
  }
  if (namespace === 'staff-attestation') {
    if (!UUID_RE.test(identifier)) return { ok: false, error: 'staff attestation id is malformed' };
    return { ok: true, namespace, value: `staff-attestation:${identifier.toLowerCase()}` };
  }
  return { ok: false, error: `unsupported binding anchor namespace '${namespace}'` };
}

export function selectBindingAnchor({ orcid, openAlexAuthorId, staffAttestationId } = {}) {
  const normalizedOrcid = normalizeOrcid(orcid);
  if (normalizedOrcid.state === 'valid') return `orcid:${normalizedOrcid.id}`;
  if (orcid !== null && orcid !== undefined && String(orcid).trim()) {
    throw new Error('selectBindingAnchor: malformed ORCID');
  }
  const openAlex = canonicalOpenAlexAuthorId(openAlexAuthorId);
  if (openAlex) return `openalex:${openAlex}`;
  if (openAlexAuthorId !== null && openAlexAuthorId !== undefined && String(openAlexAuthorId).trim()) {
    throw new Error('selectBindingAnchor: malformed OpenAlex author id');
  }
  if (staffAttestationId) {
    const staff = normalizeBindingAnchor(`staff-attestation:${staffAttestationId}`);
    if (!staff.ok) throw new Error(`selectBindingAnchor: ${staff.error}`);
    return staff.value;
  }
  throw new Error('selectBindingAnchor: no canonical person anchor');
}

export function validateIdentityBindingTuple({
  bindingVersion,
  bindingSource,
  bindingAnchor,
  boundAt,
  derivedBindingVersion,
} = {}) {
  const errors = [];
  const noVersion = bindingVersion === null || bindingVersion === undefined;
  if (noVersion) {
    if (bindingSource !== null && bindingSource !== undefined && bindingSource !== 'legacy_unbound') {
      errors.push('unbound source must be null or legacy_unbound');
    }
    if (bindingAnchor !== null && bindingAnchor !== undefined) errors.push('unbound anchor must be null');
    if (boundAt !== null && boundAt !== undefined) errors.push('unbound timestamp must be null');
    if (derivedBindingVersion !== null && derivedBindingVersion !== undefined) errors.push('unbound derived version must be null');
    return { ok: errors.length === 0, state: errors.length === 0 ? 'unbound' : 'invalid', errors };
  }

  if (
    !Number.isSafeInteger(bindingVersion)
    || bindingVersion < 1
    || bindingVersion > IDENTITY_BINDING_VERSION_MAX
  ) {
    errors.push(`binding version must be an integer between 1 and ${IDENTITY_BINDING_VERSION_MAX}`);
  }
  if (!SOURCE_SET.has(bindingSource)) errors.push('binding source is unsupported');
  const anchor = normalizeBindingAnchor(bindingAnchor);
  if (!anchor.ok) errors.push(anchor.error);
  else {
    if (anchor.value !== bindingAnchor) errors.push('binding anchor must be canonical');
    const allowedNamespaces = {
      automated: new Set(['orcid', 'openalex']),
      staff_confirmed: new Set(['orcid', 'openalex', 'staff-attestation']),
      self_reported: new Set(['orcid']),
    };
    if (!allowedNamespaces[bindingSource]?.has(anchor.namespace)) {
      errors.push(`binding source '${bindingSource}' cannot use '${anchor.namespace}' anchor`);
    }
  }
  if (!normalizeIdentityTimestamp(boundAt)) {
    errors.push('boundAt must be a canonical ISO UTC timestamp');
  }
  if (
    derivedBindingVersion !== null
    && derivedBindingVersion !== undefined
    && (!Number.isSafeInteger(derivedBindingVersion)
      || derivedBindingVersion < 1
      || derivedBindingVersion > IDENTITY_BINDING_VERSION_MAX
      || derivedBindingVersion > bindingVersion)
  ) {
    errors.push('derived binding version must be null or between 1 and the current binding version');
  }
  return { ok: errors.length === 0, state: errors.length === 0 ? 'bound' : 'invalid', errors };
}

function isPresent(value) {
  return value !== null && value !== undefined;
}

function validateIdentityPairs(values, errors) {
  const orcidPresent = isPresent(values.wmkf_orcid);
  const orcidUrlPresent = isPresent(values.wmkf_orcidurl);
  if (orcidPresent !== orcidUrlPresent) {
    errors.push('ORCID id and URL must be present or absent together');
  } else if (orcidPresent) {
    const normalized = normalizeOrcid(values.wmkf_orcid);
    if (normalized.state !== 'valid') errors.push('ORCID id is malformed');
    else if (values.wmkf_orcid !== normalized.id || values.wmkf_orcidurl !== `https://orcid.org/${normalized.id}`) {
      errors.push('ORCID id and URL are not the canonical pair');
    }
  }

  const scholarPresent = isPresent(values.wmkf_googlescholarid);
  const scholarUrlPresent = isPresent(values.wmkf_googlescholarurl);
  if (scholarPresent !== scholarUrlPresent) {
    errors.push('Scholar id and URL must be present or absent together');
  } else if (scholarPresent) {
    const id = String(values.wmkf_googlescholarid);
    if (!SCHOLAR_ID_RE.test(id)) errors.push('Scholar id is malformed');
    else if (values.wmkf_googlescholarurl !== `https://scholar.google.com/citations?user=${id}`) {
      errors.push('Scholar id and URL are not the canonical pair');
    }
  }

  for (const [field, [min, max]] of Object.entries(METRIC_RANGES)) {
    if (!isPresent(values[field])) continue;
    if (!Number.isInteger(values[field]) || values[field] < min || values[field] > max) {
      errors.push(`${field} must be an integer between ${min} and ${max}`);
    }
  }
}

function validatePairLineage(fields, left, right, label, errors) {
  const leftEntry = fields[left];
  const rightEntry = fields[right];
  if (!leftEntry && !rightEntry) return;
  if (
    !leftEntry
    || !rightEntry
    || leftEntry.source !== rightEntry.source
    || leftEntry.bindingVersion !== rightEntry.bindingVersion
  ) {
    errors.push(`${label} pair must share one lineage source and binding version`);
  }
}

export function parseIdentityFieldLineage(raw, { values = {}, currentBindingVersion } = {}) {
  const errors = [];
  if (typeof raw !== 'string' || !raw) return { ok: false, errors: ['lineage is missing'] };
  if (Buffer.byteLength(raw, 'utf8') > IDENTITY_LINEAGE_MAX_BYTES) {
    return { ok: false, errors: [`lineage exceeds ${IDENTITY_LINEAGE_MAX_BYTES} bytes`] };
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['lineage is not valid JSON'] };
  }
  if (!exactKeys(document, ['schemaVersion', 'fields'])) errors.push('lineage top-level keys are invalid');
  if (document?.schemaVersion !== IDENTITY_LINEAGE_SCHEMA_VERSION) errors.push('lineage schemaVersion is unsupported');
  if (!document?.fields || typeof document.fields !== 'object' || Array.isArray(document.fields)) {
    errors.push('lineage fields must be an object');
  }

  const fields = document?.fields && typeof document.fields === 'object' && !Array.isArray(document.fields)
    ? document.fields
    : {};
  for (const [field, entry] of Object.entries(fields)) {
    if (!FIELD_SET.has(field)) {
      errors.push(`lineage field '${field}' is unsupported`);
      continue;
    }
    if (!exactKeys(entry, ['source', 'bindingVersion'])) {
      errors.push(`lineage entry '${field}' has invalid keys`);
      continue;
    }
    if (!FIELD_SOURCE_SET.has(entry.source)) errors.push(`lineage source for '${field}' is unsupported`);
    if (
      !Number.isSafeInteger(entry.bindingVersion)
      || entry.bindingVersion < 1
      || entry.bindingVersion > IDENTITY_BINDING_VERSION_MAX
      || !Number.isInteger(currentBindingVersion)
      || currentBindingVersion > IDENTITY_BINDING_VERSION_MAX
      || entry.bindingVersion > currentBindingVersion
    ) {
      errors.push(`lineage bindingVersion for '${field}' is invalid`);
    }
  }

  for (const field of IDENTITY_LINEAGE_FIELDS) {
    if (isPresent(values[field]) && !fields[field]) errors.push(`non-null '${field}' is missing lineage`);
    if (!isPresent(values[field]) && fields[field]) errors.push(`null '${field}' must not carry lineage`);
  }
  validateIdentityPairs(values, errors);
  validatePairLineage(fields, 'wmkf_orcid', 'wmkf_orcidurl', 'ORCID', errors);
  validatePairLineage(fields, 'wmkf_googlescholarid', 'wmkf_googlescholarurl', 'Scholar', errors);

  if (errors.length > 0) return { ok: false, errors };
  const orderedFields = {};
  for (const field of IDENTITY_LINEAGE_FIELDS) {
    if (fields[field]) orderedFields[field] = fields[field];
  }
  return {
    ok: true,
    value: { schemaVersion: IDENTITY_LINEAGE_SCHEMA_VERSION, fields: orderedFields },
    errors: [],
  };
}

export function serializeIdentityFieldLineage(fields, options = {}) {
  const raw = JSON.stringify({ schemaVersion: IDENTITY_LINEAGE_SCHEMA_VERSION, fields });
  const parsed = parseIdentityFieldLineage(raw, options);
  if (!parsed.ok) throw new Error(`Invalid identity field lineage: ${parsed.errors.join('; ')}`);
  const serialized = JSON.stringify(parsed.value);
  if (Buffer.byteLength(serialized, 'utf8') > IDENTITY_LINEAGE_MAX_BYTES) {
    throw new Error(`Invalid identity field lineage: exceeds ${IDENTITY_LINEAGE_MAX_BYTES} bytes`);
  }
  return serialized;
}

export function automatedLineageFields(lineageDocument) {
  if (!lineageDocument || lineageDocument.schemaVersion !== IDENTITY_LINEAGE_SCHEMA_VERSION) return [];
  return IDENTITY_LINEAGE_FIELDS.filter((field) => lineageDocument.fields?.[field]?.source === 'automated');
}

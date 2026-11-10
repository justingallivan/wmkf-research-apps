/** Offline import planner. No credentials, network, database clients, or mutations.
 * Export and target snapshot must be explicitly obtained under separate authorization.
 * Every plan is advisory; schema/key/audit and writer-freeze gates remain external.
 */
const { createHash } = require('node:crypto');
const spec = require('../../lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fields = ['role', 'affiliation', 'orcid', 'preferred_email', 'primary_fields', 'keywords', 'subfields_specialties', 'methods_techniques', 'distinctions', 'expertise', 'keck_affiliation', 'keck_affiliation_details'];
const category = Object.fromEntries(spec.attributes.find(a => a.schemaName === 'wmkf_Category').options.map(o => [o.label, o.value]));
const fieldName = name => `wmkf_${name.replaceAll('_', '')}`;
const maxLengths = Object.fromEntries(spec.attributes.filter(a => a.maxLength).map(a => [a.schemaName.toLowerCase(), a.maxLength]));
const audit = ['created_at', 'updated_at', 'created_by', 'updated_by'];
const allowedSource = new Set(['id', 'name', 'role_type', 'is_active', 'dataverse_contact_id', ...fields, ...audit]);
function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function guid(value, label) { assert(typeof value === 'string' && GUID.test(value), `${label}: expected canonical lowercase GUID`); return value; }
function optionalGuid(value, label) { return value == null ? null : guid(value, label); }
function exactKeys(value, allowed, label) { for (const k of Object.keys(value)) assert(allowed.includes(k), `${label}: unsupported field ${k}`); }
function planImport(source, target, mapping, registeredHosts) {
  assert(source?.version === 1 && Array.isArray(source.rows), 'source: version 1 and rows required');
  guid(source.datasetId, 'source.datasetId');
  assert(target?.version === 1 && target.complete === true && Array.isArray(target.profiles), 'target: complete version 1 snapshot required');
  assert(Array.isArray(registeredHosts) && registeredHosts.includes(target.targetHost), 'target: unregistered hostname');
  assert(mapping?.version === 1 && mapping.targetHost === target.targetHost && mapping.datasetId === source.datasetId, 'mapping: target/dataset mismatch');
  assert(Array.isArray(mapping.rows), 'mapping.rows required');
  const mapped = new Map();
  for (const m of mapping.rows) {
    exactKeys(m, ['legacyId', 'staffUserGuid', 'contactGuid', 'leadPdEligible', 'active', 'confirmed'], 'mapping row');
    assert(Number.isSafeInteger(m.legacyId) && m.legacyId > 0 && !mapped.has(m.legacyId), 'mapping: invalid/duplicate legacyId');
    assert(typeof m.confirmed === 'boolean', 'mapping: confirmed must be explicit');
    mapped.set(m.legacyId, m);
  }
  const targetKeys = new Map(), targetGuids = new Set(), targetLinks = new Map();
  const linkNames = ['wmkf_contactguid', 'wmkf_staffuser'];
  for (const p of target.profiles) {
    guid(p.profileGuid, 'target profile GUID');
    assert(!targetGuids.has(p.profileGuid), 'target: duplicate profile GUID'); targetGuids.add(p.profileGuid);
    assert(p.values && typeof p.values === 'object' && !Array.isArray(p.values), 'target: values required');
    assert(typeof p.values.wmkf_creationkey === 'string' && p.values.wmkf_creationkey.length > 0, 'target: creation key missing');
    assert(!targetKeys.has(p.values.wmkf_creationkey), 'target: duplicate creation key');
    targetKeys.set(p.values.wmkf_creationkey, p);
    assert(typeof p.values.wmkf_name === 'string' && p.values.wmkf_name.trim(), 'target: name required for duplicate review');
    for (const key of linkNames) assert(Object.hasOwn(p.values, key), `target: missing identity projection ${key}`);
    for (const key of linkNames) if (p.values[key] != null) {
      guid(p.values[key], `target ${key}`);
      const link = `${key}:${p.values[key]}`;
      assert(!targetLinks.has(link), 'target: duplicate person link'); targetLinks.set(link, p.values.wmkf_creationkey);
    }
  }
  const sourceIds = new Set(), sourceLinks = new Map(), results = [];
  for (const row of source.rows) {
    const errors = [], warnings = [];
    let values = null, creationKey = null, existing = null;
    try {
      assert(row && typeof row === 'object', 'source row must be an object');
      assert(Number.isSafeInteger(row.id) && row.id > 0 && row.id <= 2147483647, 'legacy ID must be a positive Postgres integer');
      assert(!sourceIds.has(row.id), 'duplicate source ID'); sourceIds.add(row.id);
      for (const k of Object.keys(row)) assert(allowedSource.has(k), `unmapped source field: ${k}`);
      assert(typeof row.name === 'string' && row.name.trim() && row.name.length <= 255, 'name missing or exceeds 255');
      assert(Object.hasOwn(category, row.role_type), 'unknown category');
      assert(typeof row.is_active === 'boolean', 'is_active must be boolean');
      const m = mapped.get(row.id);
      assert(m, 'explicit per-target mapping required (null links are permitted)');
      assert(m.confirmed, 'mapping/eligibility requires owner confirmation');
      assert(Object.hasOwn(m, 'staffUserGuid') && Object.hasOwn(m, 'contactGuid'), 'both link decisions must be explicit');
      const user = optionalGuid(m.staffUserGuid, 'staff user'), contact = optionalGuid(m.contactGuid, 'contact');
      assert(typeof m.leadPdEligible === 'boolean' && typeof m.active === 'boolean', 'active and lead eligibility must be explicit booleans');
      const staff = row.role_type === 'Research Program Staff';
      assert(staff ? contact === null : user === null, 'category/link mismatch');
      assert(!m.leadPdEligible || (staff && user && m.active), 'lead eligibility requires active staff and User link');
      creationKey = `legacy_${source.datasetId}_${row.id}`;
      values = { wmkf_name: row.name, wmkf_category: category[row.role_type], wmkf_leadpdeligible: m.leadPdEligible, wmkf_staffuser: user, wmkf_contactguid: contact, wmkf_creationkey: creationKey, statecode: m.active ? 0 : 1 };
      for (const key of fields) {
        assert(Object.hasOwn(row, key), `source export missing ${key}`);
        const value = row[key];
        assert(value === null || typeof value === 'string', `${key}: expected text or null`);
        assert(value === null || value.length <= maxLengths[fieldName(key)], `${key}: exceeds schema length`);
        values[fieldName(key)] = value;
      }
      if (row.dataverse_contact_id && row.dataverse_contact_id !== contact) warnings.push('source Contact link differs: retain approved per-target mapping; do not copy source GUID');
      if (row.is_active !== m.active) warnings.push('owner lifecycle override differs from raw import');
      warnings.push('User enabled state, Contact health and actual key/audit metadata not verified offline');
      for (const key of linkNames) if (values[key]) {
        const link = `${key}:${values[key]}`;
        const previous = sourceLinks.get(link);
        if (previous) { previous.errors.push(`person link also used by legacy ID ${row.id}`); previous.action = 'blocked'; fail(`person link also used by legacy ID ${previous.legacyId}`); }
        const targetOwner = targetLinks.get(link);
        assert(!targetOwner || targetOwner === creationKey, 'person link belongs to a different target profile');
      }
      existing = targetKeys.get(creationKey);
      if (existing) {
        for (const [k, v] of Object.entries(values)) assert(Object.hasOwn(existing.values, k) && existing.values[k] === v, `existing keyed profile differs at ${k}; reconcile, do not overwrite`);
      }
    } catch (e) { errors.push(e.message); }
    const result = { legacyId: row?.id ?? null, creationKey, action: errors.length ? 'blocked' : existing ? 'unchanged' : 'create', profileGuid: existing?.profileGuid ?? null, sourceHash: fingerprint(row), values, errors, warnings };
    results.push(result);
    if (!errors.length) for (const key of linkNames) if (values[key]) sourceLinks.set(`${key}:${values[key]}`, result);
  }
  // Names are a review signal only; never an identity join or automatic merge.
  const normalizedName = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  for (const result of results) {
    const name = normalizedName(result.values?.wmkf_name);
    if (!name) continue;
    const sourceMatches = results.filter(other => other !== result && normalizedName(other.values?.wmkf_name) === name).map(other => other.legacyId);
    const targetMatches = target.profiles.filter(p => p.values.wmkf_creationkey !== result.creationKey && normalizedName(p.values.wmkf_name) === name).map(p => p.profileGuid);
    if (sourceMatches.length || targetMatches.length) result.warnings.push(`Possible duplicate name; human review required, never auto-merge. Source IDs: ${sourceMatches.join(',') || 'none'}; target GUIDs: ${targetMatches.join(',') || 'none'}`);
  }
  for (const id of mapped.keys()) assert(sourceIds.has(id), `mapping legacy ID ${id} is absent from source export`);
  return { version: 1, mode: 'offline-dry-run', datasetId: source.datasetId, targetHost: target.targetHost, sourceHash: fingerprint(source), targetHash: fingerprint(target), mappingHash: fingerprint(mapping), executionAuthorized: false, blocked: results.some(r => r.errors.length > 0), summary: { total: results.length, create: results.filter(r => r.action === 'create').length, unchanged: results.filter(r => r.action === 'unchanged').length, blocked: results.filter(r => r.action === 'blocked').length }, rows: results };
}
module.exports = { planImport, fingerprint };

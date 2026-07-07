/**
 * DynamicsService decomposition — Stage 4 module (Checkpoint B, read path).
 *
 * Moved verbatim from lib/services/dynamics-service.js: the schema-discovery
 * cluster — `getEntityDefinitions`, `getEntityAttributes`,
 * `getEntityRelationships`, `resolveEntitySetName`, `getPrimaryIdAttribute`,
 * `getEntityKey`, the module-private `filterEntities`, and the `schemaCache`
 * state (was a module-level `const` in the facade). Every class-surface `this.`
 * access in a moved body is rewritten to `svc.` per C1 (the svc-dispatch rule),
 * so sibling calls (`svc.getAccessToken`, `svc.buildHeaders`,
 * `svc.checkRestriction`, `svc.resolveLogicalName`, `svc.getEntityDefinitions`)
 * still route through the facade and its test spies. Nothing else in the bodies
 * changed.
 *
 * The `schemaCache` object (including the in-flight `fieldPromises` dedupe map)
 * clusters here so the cache never crosses a module boundary (C4). The facade's
 * `clearCaches` now calls the new `resetSchemaCache` export (the Q3 seam).
 *
 * Deps: http (`fetchWithTimeout`), constants (`KNOWN_ENTITY_SETS`,
 * `KNOWN_ENTITY_SET_VALUES`, `TABLE_CACHE_TTL`, `FIELD_CACHE_TTL`,
 * `API_TIMEOUT`), service-error (`buildServiceError`, in `getEntityKey`).
 */

import {
  KNOWN_ENTITY_SETS,
  KNOWN_ENTITY_SET_VALUES,
  TABLE_CACHE_TTL,
  FIELD_CACHE_TTL,
  API_TIMEOUT,
} from './constants.js';
import { fetchWithTimeout } from './http.js';
import { buildServiceError } from '../../utils/service-error.js';

// Module-level cache (moved verbatim from the facade — Q3/C4 seam). The
// in-flight `fieldPromises` map lives here so the dedupe never crosses a
// module boundary.
const schemaCache = {
  tables: { data: null, fetchedAt: 0 },
  fields: new Map(),   // tableName → { data, fetchedAt }
  fieldPromises: new Map(),
  relationships: new Map(),
  entitySetMap: null,   // logicalName → EntitySetName
  primaryIdMap: null,   // logicalName → PrimaryIdAttribute (for countdistinct counts)
  entitySetFetchedAt: 0,
};

/**
 * Discover entity definitions (tables). Optionally filter by search term.
 */
export async function getEntityDefinitions(svc, searchTerm) {
  const now = Date.now();
  if (schemaCache.tables.data && now - schemaCache.tables.fetchedAt < TABLE_CACHE_TTL) {
    const cached = schemaCache.tables.data;
    return searchTerm ? filterEntities(cached, searchTerm) : cached;
  }

  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,Description,IsCustomEntity,IsActivity,PrimaryIdAttribute&$filter=IsPrivate eq false`;

  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    throw new Error(`Failed to fetch entity definitions (${resp.status})`);
  }

  const data = await resp.json();
  const entities = (data.value || []).map(e => ({
    logicalName: e.LogicalName,
    displayName: e.DisplayName?.UserLocalizedLabel?.Label || e.LogicalName,
    entitySetName: e.EntitySetName,
    description: e.Description?.UserLocalizedLabel?.Label || '',
    isCustom: e.IsCustomEntity,
    isActivity: e.IsActivity,
    primaryIdAttribute: e.PrimaryIdAttribute,
  }));

  schemaCache.tables = { data: entities, fetchedAt: now };

  // Also build entity set + primary-key maps
  schemaCache.entitySetMap = new Map();
  schemaCache.primaryIdMap = new Map();
  schemaCache.entitySetFetchedAt = now;
  for (const e of entities) {
    schemaCache.entitySetMap.set(e.logicalName, e.entitySetName);
    // Key the PK by BOTH logical name and entity-set name so getPrimaryIdAttribute
    // resolves regardless of which form a caller passes (e.g. countRecords
    // receives the entity-set name "systemusers" for tables not in the static
    // KNOWN_ENTITY_SETS reverse map).
    if (e.primaryIdAttribute) {
      schemaCache.primaryIdMap.set(e.logicalName, e.primaryIdAttribute);
      if (e.entitySetName) schemaCache.primaryIdMap.set(e.entitySetName, e.primaryIdAttribute);
    }
  }

  return searchTerm ? filterEntities(entities, searchTerm) : entities;
}

/**
 * Get attributes (fields) for a specific entity.
 */
export async function getEntityAttributes(svc, tableName) {
  svc.checkRestriction(tableName);

  const now = Date.now();
  const cached = schemaCache.fields.get(tableName);
  if (cached && now - cached.fetchedAt < FIELD_CACHE_TTL) {
    return cached.data;
  }
  const inFlight = schemaCache.fieldPromises.get(tableName);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const token = await svc.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableName)}')/Attributes?$select=LogicalName,DisplayName,AttributeType,Description,IsValidForRead,IsValidForCreate,IsValidForUpdate,RequiredLevel`;

    const resp = await fetchWithTimeout(url, {
      headers: svc.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      throw new Error(`Failed to fetch attributes for ${tableName} (${resp.status})`);
    }

    const data = await resp.json();
    const attrs = (data.value || [])
      .filter(a => a.IsValidForRead)
      .map(a => ({
        logicalName: a.LogicalName,
        displayName: a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName,
        type: a.AttributeType,
        description: a.Description?.UserLocalizedLabel?.Label || '',
        isRequired: a.RequiredLevel?.Value === 'ApplicationRequired' || a.RequiredLevel?.Value === 'SystemRequired',
      }));

    schemaCache.fields.set(tableName, { data: attrs, fetchedAt: Date.now() });
    return attrs;
  })();

  schemaCache.fieldPromises.set(tableName, promise);
  try {
    return await promise;
  } finally {
    schemaCache.fieldPromises.delete(tableName);
  }
}

/**
 * Get relationships (lookups/navigation) for a specific entity.
 */
export async function getEntityRelationships(svc, tableName) {
  svc.checkRestriction(tableName);

  const now = Date.now();
  const cached = schemaCache.relationships.get(tableName);
  if (cached && now - cached.fetchedAt < FIELD_CACHE_TTL) {
    return cached.data;
  }

  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;

  // Fetch both many-to-one and one-to-many relationships
  const [manyToOneResp, oneToManyResp] = await Promise.all([
    fetchWithTimeout(
      `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableName)}')/ManyToOneRelationships?$select=SchemaName,ReferencedEntity,ReferencingAttribute,ReferencedAttribute`,
      { headers: svc.buildHeaders(token) },
      API_TIMEOUT
    ),
    fetchWithTimeout(
      `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableName)}')/OneToManyRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedAttribute`,
      { headers: svc.buildHeaders(token) },
      API_TIMEOUT
    ),
  ]);

  const manyToOne = manyToOneResp.ok ? (await manyToOneResp.json()).value || [] : [];
  const oneToMany = oneToManyResp.ok ? (await oneToManyResp.json()).value || [] : [];

  const rels = {
    manyToOne: manyToOne.map(r => ({
      schemaName: r.SchemaName,
      referencedEntity: r.ReferencedEntity,
      referencingAttribute: r.ReferencingAttribute,
      referencedAttribute: r.ReferencedAttribute,
    })),
    oneToMany: oneToMany.map(r => ({
      schemaName: r.SchemaName,
      referencingEntity: r.ReferencingEntity,
      referencingAttribute: r.ReferencingAttribute,
      referencedAttribute: r.ReferencedAttribute,
    })),
  };

  schemaCache.relationships.set(tableName, { data: rels, fetchedAt: now });
  return rels;
}

/**
 * Resolve a logical entity name to its EntitySetName (plural collection name).
 * Accepts either logical name ("account") or entity set name ("accounts").
 */
export async function resolveEntitySetName(svc, logicalName) {
  // 1. Fast path: hardcoded known tables (avoids API call entirely)
  if (KNOWN_ENTITY_SETS[logicalName]) {
    return KNOWN_ENTITY_SETS[logicalName];
  }

  // 2. If the input IS already an entity set name, return it directly
  if (KNOWN_ENTITY_SET_VALUES.has(logicalName)) {
    return logicalName;
  }

  // 3. Check dynamic cache for unknown tables
  if (schemaCache.entitySetMap && Date.now() - schemaCache.entitySetFetchedAt < TABLE_CACHE_TTL) {
    const cached = schemaCache.entitySetMap.get(logicalName);
    if (cached) return cached;
  }

  // 4. Fetch entity definitions to populate cache
  await svc.getEntityDefinitions();
  const result = schemaCache.entitySetMap?.get(logicalName);
  if (!result) {
    throw new Error(`Unknown entity: "${logicalName}". Known tables: ${Object.keys(KNOWN_ENTITY_SETS).join(', ')}. Use discover_tables to search for others.`);
  }
  return result;
}

/**
 * Resolve a table's primary-key attribute (e.g. akoya_request → akoya_requestid,
 * email → activityid) from live EntityDefinitions metadata. The PK is NOT
 * derivable by convention (activity entities use activityid, not <name>id),
 * so it must come from PrimaryIdAttribute. Cached for TABLE_CACHE_TTL via the
 * shared entity-definitions cache. Returns null if it can't be resolved.
 */
export async function getPrimaryIdAttribute(svc, entitySet) {
  // The argument may be a logical name OR an entity-set name. primaryIdMap is
  // keyed by both, so try the statically-resolved logical name first, then the
  // raw argument (covers entity sets absent from the static KNOWN_ENTITY_SETS).
  const lookup = () => {
    if (!schemaCache.primaryIdMap) return null;
    return schemaCache.primaryIdMap.get(svc.resolveLogicalName(entitySet))
      || schemaCache.primaryIdMap.get(entitySet)
      || null;
  };
  if (schemaCache.primaryIdMap && Date.now() - schemaCache.entitySetFetchedAt < TABLE_CACHE_TTL) {
    const cached = lookup();
    if (cached) return cached;
  }
  await svc.getEntityDefinitions();
  return lookup();
}

/**
 * Fetch the metadata for one entity alternate key (Keys collection on
 * EntityDefinitions). Returns the first matching record or null. Used
 * by callers that need to gate behavior on EntityKeyIndexStatus (e.g.,
 * the contact bridge must verify wmkf_portaloid is Active before its
 * duplicate-PK recovery path is safe — see contact-bridge-service.js).
 *
 * @param {string} entityLogicalName — e.g. 'contact'
 * @param {string} keyLogicalName — e.g. 'wmkf_portaloid'
 * @returns {Promise<null | { LogicalName: string, EntityKeyIndexStatus: string, KeyAttributes: string[] }>}
 */
export async function getEntityKey(svc, entityLogicalName, keyLogicalName) {
  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entityLogicalName}')/Keys`
    + `?$filter=LogicalName eq '${keyLogicalName}'`
    + `&$select=LogicalName,EntityKeyIndexStatus,KeyAttributes`;

  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw buildServiceError('dataverse', resp, errorBody);
  }
  const data = await resp.json();
  return (data.value && data.value[0]) || null;
}

/**
 * Reset the module-level schema cache. Called by the facade's `clearCaches`
 * (Q3 seam) and available for tests/admin reset. Clears every schemaCache
 * slot including the in-flight `fieldPromises` dedupe map.
 */
export function resetSchemaCache() {
  schemaCache.tables = { data: null, fetchedAt: 0 };
  schemaCache.fields.clear();
  schemaCache.fieldPromises.clear();
  schemaCache.relationships.clear();
  schemaCache.entitySetMap = null;
  schemaCache.primaryIdMap = null;
  schemaCache.entitySetFetchedAt = 0;
}

function filterEntities(entities, searchTerm) {
  const term = searchTerm.toLowerCase();
  return entities.filter(e =>
    e.logicalName.toLowerCase().includes(term) ||
    e.displayName.toLowerCase().includes(term) ||
    e.description.toLowerCase().includes(term)
  );
}

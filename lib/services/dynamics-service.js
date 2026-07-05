/**
 * Dynamics 365 Service
 *
 * Handles authentication, schema discovery, and data operations
 * against the Dataverse Web API v9.2 (OData).
 *
 * Auth: Client credentials flow (server-to-server).
 * Env vars: DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET
 */

import { randomUUID } from 'crypto';
import { getDynamicsContext, assertTrustedDalContext } from './dynamics-context.js';
import { applyRawOutputRetention } from '../utils/ai-run-retention.js';
import { buildServiceError, buildNoResponseError } from '../utils/service-error.js';

// Hardcoded entity set mapping for known tables — avoids the expensive
// EntityDefinitions API call for every first query in a session.
const KNOWN_ENTITY_SETS = {
  akoya_request: 'akoya_requests',
  akoya_concept: 'akoya_concepts',
  akoya_requestpayment: 'akoya_requestpayments',
  contact: 'contacts',
  account: 'accounts',
  email: 'emails',
  annotation: 'annotations',
  akoya_program: 'akoya_programs',
  akoya_phase: 'akoya_phases',
  akoya_goapplystatustracking: 'akoya_goapplystatustrackings',
  activitypointer: 'activitypointers',
  wmkf_potentialreviewers: 'wmkf_potentialreviewerses',
  wmkf_donors: 'wmkf_donorses',
  wmkf_bbstatus: 'wmkf_bbstatuses',
  wmkf_grantprogram: 'wmkf_grantprograms',
  wmkf_type: 'wmkf_types',
  wmkf_supporttype: 'wmkf_supporttypes',
  wmkf_programlevel2: 'wmkf_programlevel2s',
  wmkf_granteedeliverable: 'wmkf_granteedeliverables',
  systemuser: 'systemusers',
  sharepointdocumentlocation: 'sharepointdocumentlocations',
};

// Reverse map: entity set name → logical name
const ENTITY_SET_TO_LOGICAL = {};
for (const [logical, entitySet] of Object.entries(KNOWN_ENTITY_SETS)) {
  ENTITY_SET_TO_LOGICAL[entitySet] = logical;
}

// Reverse map: entity set name → itself (so passing "accounts" also works)
const KNOWN_ENTITY_SET_VALUES = new Set(Object.values(KNOWN_ENTITY_SETS));

// Module-level caches
let tokenCache = { token: null, expiresAt: 0 };
const schemaCache = {
  tables: { data: null, fetchedAt: 0 },
  fields: new Map(),   // tableName → { data, fetchedAt }
  fieldPromises: new Map(),
  relationships: new Map(),
  entitySetMap: null,   // logicalName → EntitySetName
  primaryIdMap: null,   // logicalName → PrimaryIdAttribute (for countdistinct counts)
  entitySetFetchedAt: 0,
};

const TABLE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const FIELD_CACHE_TTL = 6 * 60 * 60 * 1000;  // 6 hours
const API_TIMEOUT = 30_000; // 30 seconds
const MAX_EXPORT_RECORDS = 5000;
const EXPORT_PAGE_SIZE = 500;

export class DynamicsService {
  // ───────── Auth ─────────

  /**
   * Get an access token via client credentials grant.
   * Returns a cached token if still valid.
   *
   * SECURITY: The returned token grants service-principal-level access to
   * Dynamics 365. It must NEVER be logged to console, included in error
   * messages, returned in API responses, sent via SSE, stored in the
   * database, or passed to third-party APIs (including Claude).
   * See .semgrep/token-audit.yaml for automated enforcement.
   */
  static async getAccessToken() {
    const now = Date.now();
    if (tokenCache.token && tokenCache.expiresAt > now + 60_000) {
      return tokenCache.token;
    }

    const {
      DYNAMICS_URL,
      DYNAMICS_TENANT_ID,
      DYNAMICS_CLIENT_ID,
      DYNAMICS_CLIENT_SECRET,
    } = process.env;

    if (!DYNAMICS_URL || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
      // Forced non-transient: this is a config bug, not a real 500 — retrying
      // can't recover from missing env vars. Round-11 §5 found that without the
      // override, the drain would burn max_attempts retrying a bug it can't fix.
      throw buildServiceError(
        'dataverse',
        { status: 500 },
        'Missing Dynamics 365 environment variables (DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET)',
        { isTransient: false },
      );
    }

    const tokenUrl = `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: DYNAMICS_CLIENT_ID,
      client_secret: DYNAMICS_CLIENT_SECRET,
      scope: `${DYNAMICS_URL}/.default`,
    });

    const resp = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const text = await resp.text();
      throw buildServiceError('dataverse', resp, text);
    }

    const data = await resp.json();
    tokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  // ───────── Headers ─────────

  static buildHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      'OData-Version': '4.0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'odata.include-annotations="*",odata.maxpagesize=100',
    };
  }

  // Write paths only. Adding MSCRMCallerID to reads would impersonate the user
  // for security-role evaluation, breaking callers whose linked Dynamics user
  // has narrower privileges than the service principal. Writes are the goal —
  // attribution on createdby/modifiedby/audit history.
  //
  // Important: Dataverse impersonation runs under the *intersection* of the app
  // user's privileges and the impersonated user's privileges. A staff role
  // missing a single table-level write privilege (e.g. Update on
  // wmkf_ai_run) will 403 even though the app registration has it. To ship
  // safely we:
  //   1. Gate the feature behind DYNAMICS_IMPERSONATION_ENABLED so admins
  //      can flip it per-environment after a privilege audit.
  //   2. Catch 403s from impersonated writes in _writeFetch and retry once
  //      without the header (logs a warning so the missing privilege is
  //      visible). The user's request still succeeds; attribution falls
  //      back to the service principal for that one call.
  static _withCallerId(headers, actingUserSystemId) {
    if (actingUserSystemId && process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true') {
      headers.MSCRMCallerID = actingUserSystemId;
    }
    return headers;
  }

  /**
   * Write-path fetch with automatic privilege-intersection fallback.
   *
   * If the request has an MSCRMCallerID header and Dataverse responds 403,
   * retry once without the header so the write still lands as the service
   * principal. Emits a structured warning so the missing privilege is
   * actionable (telemetry, not silence). Other failure modes (4xx/5xx,
   * timeouts) bubble unchanged.
   *
   * @param {string} url
   * @param {object} init - fetch init; init.headers must already include or
   *   exclude MSCRMCallerID per _withCallerId.
   * @param {string|null} actingUserSystemId - the systemuserid attempted, used
   *   for the warning. Pass null when no impersonation was attempted.
   */
  static async _writeFetch(url, init, actingUserSystemId, { noFallback = false } = {}) {
    let resp = await fetchWithTimeout(url, init, API_TIMEOUT);
    const triedImpersonation = !!(actingUserSystemId && init.headers?.MSCRMCallerID);
    if (resp.status === 403 && triedImpersonation) {
      if (noFallback) return resp;
      const errBody = await resp.text().catch(() => '');
      console.warn(
        `[DynamicsService] Impersonated write rejected (acting=${actingUserSystemId}, ` +
        `url=${url}). Retrying as service principal. Body: ${errBody.slice(0, 300)}`
      );
      const fallbackHeaders = { ...init.headers };
      delete fallbackHeaders.MSCRMCallerID;
      resp = await fetchWithTimeout(url, { ...init, headers: fallbackHeaders }, API_TIMEOUT);
    }
    return resp;
  }

  // ───────── Restrictions ─────────
  //
  /**
   * Resolve an entity set name back to its logical table name.
   */
  static resolveLogicalName(entitySet) {
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
  static checkRestriction(tableName, selectFields, expandParam, requestId) {
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

  // ───────── Schema Discovery ─────────

  /**
   * Discover entity definitions (tables). Optionally filter by search term.
   */
  static async getEntityDefinitions(searchTerm) {
    const now = Date.now();
    if (schemaCache.tables.data && now - schemaCache.tables.fetchedAt < TABLE_CACHE_TTL) {
      const cached = schemaCache.tables.data;
      return searchTerm ? filterEntities(cached, searchTerm) : cached;
    }

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,Description,IsCustomEntity,IsActivity,PrimaryIdAttribute&$filter=IsPrivate eq false`;

    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
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
  static async getEntityAttributes(tableName) {
    this.checkRestriction(tableName);

    const now = Date.now();
    const cached = schemaCache.fields.get(tableName);
    if (cached && now - cached.fetchedAt < FIELD_CACHE_TTL) {
      return cached.data;
    }
    const inFlight = schemaCache.fieldPromises.get(tableName);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const token = await this.getAccessToken();
      const baseUrl = process.env.DYNAMICS_URL;
      const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableName)}')/Attributes?$select=LogicalName,DisplayName,AttributeType,Description,IsValidForRead,IsValidForCreate,IsValidForUpdate,RequiredLevel`;

      const resp = await fetchWithTimeout(url, {
        headers: this.buildHeaders(token),
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
  static async getEntityRelationships(tableName) {
    this.checkRestriction(tableName);

    const now = Date.now();
    const cached = schemaCache.relationships.get(tableName);
    if (cached && now - cached.fetchedAt < FIELD_CACHE_TTL) {
      return cached.data;
    }

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    // Fetch both many-to-one and one-to-many relationships
    const [manyToOneResp, oneToManyResp] = await Promise.all([
      fetchWithTimeout(
        `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableName)}')/ManyToOneRelationships?$select=SchemaName,ReferencedEntity,ReferencingAttribute,ReferencedAttribute`,
        { headers: this.buildHeaders(token) },
        API_TIMEOUT
      ),
      fetchWithTimeout(
        `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(tableName)}')/OneToManyRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedAttribute`,
        { headers: this.buildHeaders(token) },
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

  // ───────── Read Operations ─────────

  /**
   * Query records from an entity set with OData parameters.
   *
   * Safety: enforces $top max of 100 and requires either $filter or $top <= 25.
   */
  static async queryRecords(entitySet, { select, filter, orderby, top, expand } = {}) {
    const logicalName = this.resolveLogicalName(entitySet);
    this.checkRestriction(logicalName, select, expand);

    const effectiveTop = Math.min(top || 25, 100);

    // Safety: require filter or small top
    if (!filter && effectiveTop > 25) {
      throw new Error('Queries without $filter are limited to 25 records. Add a filter or reduce $top.');
    }

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const params = new URLSearchParams();

    if (select) params.set('$select', select);
    if (filter) params.set('$filter', filter);
    if (orderby) params.set('$orderby', orderby);
    params.set('$top', String(effectiveTop));
    if (expand) params.set('$expand', expand);
    params.set('$count', 'true');

    const url = `${baseUrl}/api/data/v9.2/${entitySet}?${params.toString()}`;

    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw buildServiceError('dataverse', resp, errorBody);
    }

    const data = await resp.json();
    const records = (data.value || []).map(r => this.processAnnotations(r));
    const totalCount = data['@odata.count'];

    return {
      records,
      count: records.length,
      totalCount: totalCount !== undefined ? totalCount : records.length,
      hasMore: !!data['@odata.nextLink'],
    };
  }

  /**
   * Get a single record by ID.
   */
  static async getRecord(entitySet, recordId, { select, expand } = {}) {
    const logicalName = this.resolveLogicalName(entitySet);
    this.checkRestriction(logicalName, select, expand);

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const params = new URLSearchParams();

    if (select) params.set('$select', select);
    if (expand) params.set('$expand', expand);

    const paramStr = params.toString();
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})${paramStr ? '?' + paramStr : ''}`;

    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw buildServiceError('dataverse', resp, errorBody);
    }

    const record = await resp.json();
    return this.processAnnotations(record);
  }

  /**
   * Count records in an entity set, optionally with a filter.
   *
   * Dataverse's `/{entitySet}/$count` endpoint is doubly unreliable on this
   * instance (probe scripts/probe-akoya-folio-casing.js, 2026-05-30):
   *   - Unfiltered it CAPS at 5000 (returned 5000 for the ~22.6k-row
   *     akoya_requestpayments table — the documented Dataverse /$count limit).
   *   - With `$filter` it throws "Could not find a property named '<field>' on
   *     type 'Edm.Int32'" even for a trivial `field eq 'x'` filter.
   * The robust path is `$apply=filter(...)/aggregate(<pk> with countdistinct as
   * value)`: the primary key is unique, so distinct-count == row-count, and it
   * returns the TRUE total (probe: 9120 for the PAID filter, 22580 unfiltered —
   * both above the 5000 cap). Subject to the 50,000-row `$apply` aggregate
   * ceiling — past that Dataverse errors and we fail loud (the caller surfaces
   * the error) rather than returning a silent under-count. The unbounded
   * (>50k) count remains the deferred OData→FetchXML / record-paging tail.
   */
  static async countRecords(entitySet, filter) {
    const logicalName = this.resolveLogicalName(entitySet);
    this.checkRestriction(logicalName);

    const pk = await this.getPrimaryIdAttribute(logicalName);
    if (!pk) {
      throw new Error(`Count failed: could not resolve a primary-key attribute for "${entitySet}" from metadata.`);
    }

    const aggregate = `aggregate(${pk} with countdistinct as value)`;
    const apply = filter ? `filter(${filter})/${aggregate}` : aggregate;

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}?$apply=${encodeURIComponent(apply)}`;

    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Count failed (${resp.status}): ${errorBody}`);
    }

    const data = await resp.json();
    // Zero matches → Dataverse returns value:[{value:0}]; defensively treat an
    // empty value array as 0 too.
    const value = data.value?.[0]?.value;
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Server-side aggregation via OData $apply.
   * Returns exact sums/averages/min/max/countdistinct computed by the CRM.
   *
   * @param {string} entitySet - Entity set name (e.g. "akoya_requests")
   * @param {object} options
   * @param {string} options.field - Field to aggregate
   * @param {string} options.operation - sum, average, min, max, or countdistinct
   * @param {string} [options.filter] - OData $filter to scope the aggregation
   * @param {string} [options.groupBy] - Field to group by (returns one result per group)
   * @returns {{ results, operation, field, groupBy?, filter? }}
   */
  static async aggregateRecords(entitySet, { field, operation, filter, groupBy } = {}) {
    const ALLOWED_OPS = ['sum', 'average', 'min', 'max', 'countdistinct'];
    if (!ALLOWED_OPS.includes(operation)) {
      throw new Error(`Invalid aggregation operation "${operation}". Allowed: ${ALLOWED_OPS.join(', ')}`);
    }

    const logicalName = this.resolveLogicalName(entitySet);
    this.checkRestriction(logicalName, field);
    if (groupBy) this.checkRestriction(logicalName, groupBy);

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    // Build $apply value
    let apply;
    const aggregateExpr = `${field} with ${operation} as value`;
    if (groupBy && filter) {
      apply = `filter(${filter})/groupby((${groupBy}),aggregate(${aggregateExpr}))`;
    } else if (groupBy) {
      apply = `groupby((${groupBy}),aggregate(${aggregateExpr}))`;
    } else if (filter) {
      apply = `filter(${filter})/aggregate(${aggregateExpr})`;
    } else {
      apply = `aggregate(${aggregateExpr})`;
    }

    const params = new URLSearchParams();
    params.set('$apply', apply);

    const url = `${baseUrl}/api/data/v9.2/${entitySet}?${params.toString()}`;

    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Aggregation failed (${resp.status}): ${errorBody}`);
    }

    const data = await resp.json();
    const results = (data.value || []).map(r => this.processAnnotations(r));

    const response = { results, operation, field };
    if (groupBy) response.groupBy = groupBy;
    if (filter) response.filter = filter;
    return response;
  }

  /**
   * Query all matching records with pagination via @odata.nextLink.
   * Used for Excel exports. Requires a $filter (no unfiltered dumps).
   * Caps at MAX_EXPORT_RECORDS (5000).
   *
   * @returns {{ records, totalCount, capped }}
   */
  static async queryAllRecords(entitySet, { select, filter, orderby } = {}) {
    if (!filter) {
      throw new Error('Export requires a $filter — unfiltered full-table dumps are not allowed.');
    }

    const logicalName = this.resolveLogicalName(entitySet);
    this.checkRestriction(logicalName, select);

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const params = new URLSearchParams();

    if (select) params.set('$select', select);
    params.set('$filter', filter);
    if (orderby) params.set('$orderby', orderby);
    params.set('$count', 'true');

    const headers = {
      Authorization: `Bearer ${token}`,
      'OData-Version': '4.0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: `odata.include-annotations="*",odata.maxpagesize=${EXPORT_PAGE_SIZE}`,
    };

    let url = `${baseUrl}/api/data/v9.2/${entitySet}?${params.toString()}`;
    const allRecords = [];
    let totalCount = 0;
    let capped = false;

    while (url) {
      const resp = await fetchWithTimeout(url, { headers }, API_TIMEOUT);
      if (!resp.ok) {
        const errorBody = await resp.text();
        throw new Error(`Export query failed (${resp.status}): ${errorBody}`);
      }

      const data = await resp.json();
      if (data['@odata.count'] !== undefined) {
        totalCount = data['@odata.count'];
      }

      const records = (data.value || []).map(r => this.processAnnotations(r));
      allRecords.push(...records);

      if (allRecords.length >= MAX_EXPORT_RECORDS) {
        capped = true;
        allRecords.length = MAX_EXPORT_RECORDS;
        break;
      }

      url = data['@odata.nextLink'] || null;
    }

    if (!totalCount) totalCount = allRecords.length;

    return { records: allRecords, totalCount, capped };
  }

  // ───────── Full-Text Search (Dataverse Search API) ─────────

  /**
   * Full-text search across indexed tables using Dataverse Search.
   * Searches all text fields simultaneously with relevance ranking.
   *
   * @param {string} search - Search term(s)
   * @param {object} options
   * @param {string[]} [options.entities] - Limit to specific table names (e.g. ['akoya_request','contact'])
   * @param {number} [options.top] - Max results (1-100, default 20)
   * @param {string} [options.filter] - OData $filter to narrow results
   * @returns {{ results, totalCount, queryContext }}
   */
  static async searchRecords(search, { entities, top = 20, filter } = {}) {
    // Check restrictions for each entity in the filter
    if (entities && entities.length > 0) {
      for (const entity of entities) {
        this.checkRestriction(entity);
      }
    }

    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/search/v1.0/query`;

    const body = {
      search,
      top: Math.min(top || 20, 100),
      returntotalrecordcount: true,
    };

    if (entities && entities.length > 0) {
      body.entities = entities; // Simple string array: ["account", "contact"]
    }
    if (filter) {
      body.filter = filter;
    }

    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Dataverse Search failed (${resp.status}): ${errorBody}`);
    }

    const data = await resp.json();

    // Normalize the @search.* prefixed response into clean objects
    const results = (data.value || []).map(r => {
      const entity = r['@search.entityname'];
      const objectId = r['@search.objectid'];
      const score = r['@search.score'];
      const highlights = r['@search.highlights'] || {};

      // Collect non-metadata fields as attributes
      const attributes = {};
      for (const [key, value] of Object.entries(r)) {
        if (key.startsWith('@search.') || key === 'ownerid' || key === 'owneridname') continue;
        if (value === null || value === undefined || value === '') continue;
        attributes[key] = value;
      }

      return { entity, objectId, score, highlights, attributes };
    });

    return {
      results,
      totalCount: data.totalrecordcount ?? results.length,
      queryContext: data.querycontext || null,
    };
  }

  // ───────── Write Operations ─────────
  //
  // Write access on the service principal was granted 2026-04-14 (see
  // docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md). Scope at time of writing:
  //   - prvUpdate on akoya_request
  //   - prvCreate + prvUpdate on wmkf_ai_run
  //   - Activity privileges (email create/write/read + prvSendAsUser)
  // Writes to other tables (e.g., annotation/note) will 403.

  /**
   * Create a record. Uses Prefer: return=representation so the created row
   * comes back in the response — callers often need the new ID.
   *
   * @param {string} entitySet - e.g. 'wmkf_ai_runs', 'akoya_requests'
   * @param {object} data - Field payload. Lookups use `<nav>@odata.bind`.
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - When set, sends
   *   `MSCRMCallerID` so Dataverse records the acting staff member on
   *   `createdby` / audit history. Plumbed from the session by user-initiated
   *   API routes; null for unattended writes (cron, external-token flows).
   * @returns {Promise<object>} The created record.
   */
  static async createRecord(entitySet, data, { actingUserSystemId, noFallback = false } = {}) {
    assertTrustedDalContext('DynamicsService.createRecord');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}`;

    const resp = await this._writeFetch(url, {
      method: 'POST',
      headers: this._withCallerId({
        ...this.buildHeaders(token),
        Prefer: 'return=representation',
      }, actingUserSystemId),
      body: JSON.stringify(data),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw buildServiceError('dataverse', resp, errorBody);
    }

    return this.processAnnotations(await resp.json());
  }

  /**
   * Update a record by ID (PATCH). Returns void on success (204).
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID
   * @param {object} data
   * @param {object} [options]
   * @param {string} [options.ifMatch] - ETag from a prior getRecord (`record._etag`).
   *   When supplied, Dataverse rejects the PATCH with 412 if the row has been
   *   modified since the read. A thrown Error's `.status` is set to 412 in that
   *   case so callers can distinguish concurrent-edit from other failures.
   * @param {string} [options.actingUserSystemId] - When set, sends
   *   `MSCRMCallerID` so `modifiedby` reflects the acting staff member.
   * @returns {Promise<void>}
   */
  static async updateRecord(entitySet, recordId, data, { ifMatch, actingUserSystemId, noFallback = false } = {}) {
    assertTrustedDalContext('DynamicsService.updateRecord');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})`;

    const headers = this._withCallerId(this.buildHeaders(token), actingUserSystemId);
    if (ifMatch) headers['If-Match'] = ifMatch;

    const resp = await this._writeFetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      // 412-aware behavior preserved: buildServiceError sets .status; callers
      // that branch on err.status === 412 (concurrent-edit detection) continue
      // to work. buildServiceError also adds .isTransient and Dataverse code/
      // message — purely additive vs. the pre-P1 throw.
      throw buildServiceError('dataverse', resp, errorBody);
    }
  }

  /**
   * Write a value to a single field only when the field is currently empty —
   * unless `overwrite: true` is set. Uses the M1 ETag plumbing so the write
   * is safe against concurrent edits: if the row changes between the
   * preflight read and the PATCH, the PATCH fails with 412 and we surface
   * that as `{ ok: false, reason: 'conflict' }` instead of clobbering.
   *
   * Returns a discriminated object so callers can translate to HTTP
   * responses themselves (some want 409, some want 200 + a flag):
   *
   *   { ok: true, written: true }                         — field was empty, write succeeded
   *   { ok: true, written: false, reason: 'overwrote' }   — field was non-empty, overwrite=true, write succeeded
   *   { ok: false, reason: 'already-populated', existing, modifiedOn }
   *   { ok: false, reason: 'conflict' }                   — 412 from Dataverse (race)
   *   { ok: false, reason: 'writeback_failed', error }    — any other failure
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID
   * @param {string} fieldName - Dataverse field to write (e.g. 'wmkf_ai_summary')
   * @param {string|number|boolean} value - value to write
   * @param {object} [options]
   * @param {boolean} [options.overwrite=false]
   * @param {string[]} [options.extraSelect=['modifiedon']] - extra fields to return in `existing`
   * @param {string} [options.actingUserSystemId] - Pass-through to `updateRecord`.
   */
  static async updateIfEmpty(entitySet, recordId, fieldName, value, { overwrite = false, extraSelect = ['modifiedon'], actingUserSystemId } = {}) {
    const selectFields = Array.from(new Set([fieldName, ...extraSelect])).join(',');

    let existing;
    try {
      existing = await this.getRecord(entitySet, recordId, { select: selectFields });
    } catch (err) {
      return { ok: false, reason: 'writeback_failed', error: err };
    }

    const current = (existing?.[fieldName] ?? '');
    const isEmpty = current === '' || current === null || current === undefined ||
      (typeof current === 'string' && current.trim() === '');

    if (!isEmpty && !overwrite) {
      return {
        ok: false,
        reason: 'already-populated',
        existing: current,
        modifiedOn: existing?.modifiedon || null,
      };
    }

    try {
      await this.updateRecord(
        entitySet,
        recordId,
        { [fieldName]: value },
        {
          ...(existing?._etag ? { ifMatch: existing._etag } : {}),
          ...(actingUserSystemId ? { actingUserSystemId } : {}),
        },
      );
      return isEmpty
        ? { ok: true, written: true }
        : { ok: true, written: false, reason: 'overwrote' };
    } catch (err) {
      if (err.status === 412) return { ok: false, reason: 'conflict' };
      return { ok: false, reason: 'writeback_failed', error: err };
    }
  }

  /**
   * Delete a record by ID. Returns void on success (204).
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - When set, sends `MSCRMCallerID`.
   * @param {string} [options.ifMatch] - ETag from a prior read (`record._etag`).
   *   When supplied, Dataverse rejects the DELETE with 412 if the row changed
   *   since the read — used to fail-closed against a concurrent write that would
   *   engage a row we're about to delete (the merge collision-delete). The thrown
   *   Error's `.status` is the HTTP status so callers can branch on 412.
   * @returns {Promise<void>}
   */
  static async deleteRecord(entitySet, recordId, { actingUserSystemId, ifMatch } = {}) {
    assertTrustedDalContext('DynamicsService.deleteRecord');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})`;

    const headers = this._withCallerId(this.buildHeaders(token), actingUserSystemId);
    if (ifMatch) headers['If-Match'] = ifMatch;

    const resp = await this._writeFetch(url, {
      method: 'DELETE',
      headers,
    }, actingUserSystemId);

    if (!resp.ok) {
      const errorBody = await resp.text();
      // Plain-Error shape preserved for existing callers that match on the
      // message; `.status` added (purely additive) so the conditional-delete
      // caller can distinguish a 412 precondition failure from other errors.
      const err = new Error(`Delete ${entitySet}(${recordId}) failed (${resp.status}): ${errorBody}`);
      err.status = resp.status;
      throw err;
    }
  }

  /**
   * Clear a single-valued navigation property (NULL a lookup) by deleting its
   * $ref. This is the supported way to disassociate a lookup — a PATCH with
   * `<NavProp>@odata.bind: null` is NOT accepted by Dataverse. Mirrors the proven
   * slot-clear in scripts/reset-request-reviewers.mjs (`<entity>(id)/<NavProp>/$ref`
   * DELETE). A 404 is treated as success: the reference was already absent, so the
   * post-condition (lookup empty) already holds — idempotent clear.
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID of the referencing row
   * @param {string} navProperty - single-valued nav prop (e.g. 'wmkf_PotentialReviewer1')
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - MSCRMCallerID attribution.
   */
  static async disassociate(entitySet, recordId, navProperty, { actingUserSystemId } = {}) {
    assertTrustedDalContext('DynamicsService.disassociate');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})/${navProperty}/$ref`;

    const headers = this._withCallerId(this.buildHeaders(token), actingUserSystemId);

    const resp = await this._writeFetch(url, {
      method: 'DELETE',
      headers,
    }, actingUserSystemId);

    if (!resp.ok && resp.status !== 404) {
      const errorBody = await resp.text();
      const err = new Error(`Disassociate ${entitySet}(${recordId})/${navProperty} failed (${resp.status}): ${errorBody}`);
      err.status = resp.status;
      throw err;
    }
  }

  // ───────── Atomic Multi-Row Writes ($batch changeset) ─────────
  //
  // Dataverse $batch wrapping a SINGLE changeset commits every operation or none
  // of them — verified in prod, S301 (scripts/probe-dataverse-batch-changeset.mjs:
  // multi-op commit + atomic rollback + per-op If-Match all confirmed). The
  // reviewer submit flow uses this to write the answer-snapshot child rows and
  // the parent PATCH in one transaction. This REFUTES the older "Dataverse has no
  // $batch transaction" belief carried in pages/api/admin/prompts/[name].js — that
  // flow's non-atomic mirror predates this verification.

  /**
   * Execute several create/update/delete operations in ONE atomic Dataverse
   * changeset. Either every operation commits or none do (all-or-nothing).
   *
   * @param {Array<{method:'POST'|'PATCH'|'DELETE', url:string, body?:object, ifMatch?:string}>} operations
   *   Ordered list (Content-ID = 1-based index). `url` is a resource path
   *   relative to the v9.2 data root with NO leading slash — e.g.
   *   `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<g>,wmkf_questionkey='q2')`
   *   (alternate-key upsert) or `akoya_requests(<guid>)`. POST/PATCH must carry a
   *   `body`; `ifMatch` adds a per-op `If-Match` precondition (412 if the row
   *   changed since it was read). Build URLs server-side — this helper does not
   *   GUID-validate them.
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - MSCRMCallerID attribution for
   *   every op in the batch (same privilege-intersection fallback as single
   *   writes). Null/omitted for external-token flows (e.g. reviewer submit).
   * @returns {Promise<{ ok: true, operations: Array<{contentId:number|null, status:number, body:object|null}> }>}
   *   `body` is the parsed JSON op body when present (Dataverse create/PATCH ops
   *   in a changeset typically return 204 No Content, so `body` is usually null).
   *   This helper does NOT surface embedded response headers, so created-row IDs
   *   (`OData-EntityId`) are intentionally NOT returned — callers must address
   *   rows by GUID or alternate key they already hold, not by created-id
   *   read-back (the reviewer submit upserts answer rows by alternate key).
   * @throws {Error} structured service-error (buildServiceError shape) when the
   *   changeset is rejected OR when the parser cannot confirm a 2xx result for
   *   every op (fail-closed) — because the changeset is atomic, a throw means
   *   NOTHING was committed. `.status` is the failing op's HTTP status, so callers
   *   branch on 412 (If-Match conflict) exactly as they do for updateRecord/deleteRecord.
   */
  static async executeChangeset(operations, { actingUserSystemId } = {}) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('executeChangeset: operations must be a non-empty array');
    }
    const ALLOWED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
    operations.forEach((op, i) => {
      if (!op || !ALLOWED_METHODS.has(op.method)) {
        throw new Error(`executeChangeset: operations[${i}].method must be one of POST/PATCH/DELETE`);
      }
      if (!op.url || typeof op.url !== 'string') {
        throw new Error(`executeChangeset: operations[${i}].url is required`);
      }
      if ((op.method === 'POST' || op.method === 'PATCH') && (op.body === undefined || op.body === null)) {
        throw new Error(`executeChangeset: operations[${i}] (${op.method}) requires a body`);
      }
    });
    // Enforcement runs AFTER input validation (above) so malformed-input
    // rejections keep their existing, more specific messages regardless of
    // context — only a well-formed changeset needs a trusted context to run.
    assertTrustedDalContext('DynamicsService.executeChangeset');

    const token = await this.getAccessToken();
    const baseUrl = `${process.env.DYNAMICS_URL}/api/data/v9.2`;
    const batchId = randomUUID();
    const batchBoundary = `batch_${batchId}`;
    const changesetBoundary = `changeset_${batchId}`;
    const body = buildChangesetBatchBody(operations, batchBoundary, changesetBoundary, baseUrl);

    const headers = this._withCallerId({
      Authorization: `Bearer ${token}`,
      'OData-Version': '4.0',
      'OData-MaxVersion': '4.0',
      Accept: 'application/json',
      'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
    }, actingUserSystemId);

    const resp = await this._writeFetch(`${baseUrl}/$batch`, {
      method: 'POST',
      headers,
      body,
    }, actingUserSystemId);

    const rawText = await resp.text();
    const contentType = resp.headers?.get ? resp.headers.get('content-type') : null;
    const parsed = parseBatchResponse(rawText, contentType);

    // The changeset is atomic, so a single failed embedded op == the whole batch
    // rolled back. Prefer the embedded status/body for precise 412/400/409
    // classification; fall back to the outer HTTP status when Dataverse returns a
    // bare (non-multipart) error envelope.
    const failed = parsed.find((p) => p.status >= 400);
    if (failed || !resp.ok) {
      const status = failed ? failed.status : resp.status;
      const errBody = failed ? failed.rawBody : rawText;
      throw buildServiceError('dataverse', { status }, errBody);
    }

    // Fail closed: a multipart success response MUST yield exactly one parsed 2xx
    // result per requested op. If the parser under-counts (skipped an unsplittable
    // part), or yields a non-2xx / unparseable status (status 0) that the `failed`
    // scan above didn't catch, we cannot prove the changeset committed — throw
    // rather than return ok and let the caller do post-commit work (e.g. delete
    // the reviewer draft) on an unconfirmed write. This guards the parser itself,
    // not just Dataverse's response.
    const allConfirmed =
      parsed.length === operations.length &&
      parsed.every((p) => p.status >= 200 && p.status < 300);
    if (!allConfirmed) {
      const statuses = parsed.map((p) => p.status).join(', ') || 'none';
      throw buildServiceError(
        'dataverse',
        { status: resp.status },
        `executeChangeset could not confirm an atomic commit: parsed ${parsed.length} of ` +
          `${operations.length} op result(s) [statuses: ${statuses}]. Raw response (truncated): ` +
          rawText.slice(0, 500),
      );
    }

    return {
      ok: true,
      operations: parsed.map((p) => ({ contentId: p.contentId, status: p.status, body: p.body })),
    };
  }

  // ───────── AI Run Logging ─────────

  /**
   * Choice → numeric mapping for wmkf_ai_run Picklist fields.
   * See docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md. Numeric values are the
   * contract — Dynamics API does not accept labels.
   */
  static AI_RUN_TASK_TYPES = Object.freeze({
    summary: 682090000,
    report: 682090001,
    'check-in': 682090002,
    pd_assignment: 682090003,
  });

  static AI_RUN_STATUSES = Object.freeze({
    completed: 682090000,
    failed: 682090001,
    needs_review: 682090002,
  });

  /**
   * Write a row to the wmkf_ai_run audit/replay table. Non-critical — callers
   * should treat failures as logged warnings, not user-visible errors. The AI
   * produced its output before this runs; the run log is supplementary.
   *
   * @param {object} opts
   * @param {string} opts.requestGuid - akoya_request GUID this run was for
   * @param {string} opts.taskType - One of AI_RUN_TASK_TYPES keys
   * @param {string} opts.model - Claude model ID (e.g. 'claude-sonnet-4')
   * @param {number} [opts.promptVersion] - Integer; bumped on prompt text changes
   * @param {string} opts.status - One of AI_RUN_STATUSES keys
   * @param {object|string} [opts.rawOutput] - Full structured payload; stringified if object unless rawOutputRetention narrows it
   * @param {string|object} [opts.rawOutputRetention='full'] - full | hash | none
   * @param {string} [opts.notes] - Failure messages / retry context
   * @param {string} [opts.actingUserSystemId] - When set, the run row is
   *   attributed to the staff member rather than the service principal.
   * @returns {Promise<{ runId: string, runNum: string }>} IDs of the created row
   */
  static async logAiRun({ requestGuid, taskType, model, promptVersion, status, rawOutput, rawOutputRetention = 'full', notes, actingUserSystemId }) {
    if (!requestGuid) throw new Error('logAiRun: requestGuid is required');

    const taskTypeValue = this.AI_RUN_TASK_TYPES[taskType];
    if (taskTypeValue === undefined) {
      throw new Error(`logAiRun: unknown taskType "${taskType}" (expected one of: ${Object.keys(this.AI_RUN_TASK_TYPES).join(', ')})`);
    }

    const statusValue = this.AI_RUN_STATUSES[status];
    if (statusValue === undefined) {
      throw new Error(`logAiRun: unknown status "${status}" (expected one of: ${Object.keys(this.AI_RUN_STATUSES).join(', ')})`);
    }

    // Navigation property name is wmkf_ai_Request (capitalized R) — discovered
    // via EntityDefinitions expand on ManyToOneRelationships. Case matters.
    const payload = {
      'wmkf_ai_Request@odata.bind': `/akoya_requests(${requestGuid})`,
      wmkf_ai_tasktype: taskTypeValue,
      wmkf_ai_status: statusValue,
    };
    if (model) payload.wmkf_ai_model = String(model).slice(0, 64);
    if (promptVersion !== undefined && promptVersion !== null) payload.wmkf_ai_promptversion = Number(promptVersion);
    if (rawOutput !== undefined && rawOutput !== null) {
      // wmkf_ai_rawoutput cap raised to 1,000,000 chars (2026-04-14, Connor).
      // Truncation here is a safety valve only — real payloads are 5-15k.
      const retainedRawOutput = applyRawOutputRetention(rawOutput, rawOutputRetention);
      const serialized = typeof retainedRawOutput === 'string' ? retainedRawOutput : JSON.stringify(retainedRawOutput);
      payload.wmkf_ai_rawoutput = this._truncateForMemo(serialized, 1_000_000);
    }
    if (notes) payload.wmkf_ai_notes = this._truncateForMemo(String(notes), 2000);

    const created = await this.createRecord('wmkf_ai_runs', payload, { actingUserSystemId });
    return {
      runId: created.wmkf_ai_runid,
      runNum: created.wmkf_ai_runnum,
    };
  }

  /**
   * Truncate a string to fit in a Dataverse Memo field. Appends a visible
   * marker so readers can tell the content was cut off.
   */
  static _truncateForMemo(s, maxChars) {
    if (!s || s.length <= maxChars) return s;
    const marker = `\n…[truncated ${s.length - maxChars + 0} chars]`;
    return s.slice(0, maxChars - marker.length) + marker;
  }

  // ───────── Email Operations ─────────

  /**
   * Create an email activity record in Dynamics CRM.
   *
   * @param {Object} options
   * @param {string} options.subject - Email subject
   * @param {string} options.body - Email body (HTML supported)
   * @param {string} options.from - Sender email address
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {string|string[]} [options.cc] - CC email(s)
   * @param {string} [options.regardingId] - GUID of the regarding entity (e.g., request)
   * @param {string} [options.regardingType] - Logical name of regarding entity (e.g., 'akoya_request')
   * @returns {string} The created email activity ID
   */
  /**
   * Resolve an email address to a Dynamics system user ID.
   * Required for sender party — Dynamics needs a partyid reference.
   */
  static async resolveSystemUser(email) {
    const { records } = await this.queryRecords('systemusers', {
      select: 'systemuserid',
      filter: `internalemailaddress eq '${email}'`,
      top: 1,
    });
    if (records.length === 0) {
      throw new Error(`No Dynamics system user found for email: ${email}`);
    }
    return records[0].systemuserid;
  }

  static async createEmailActivity({ subject, body, from, to, cc, regardingId, regardingType, actingUserSystemId, noFallback = false }) {
    assertTrustedDalContext('DynamicsService.createEmailActivity');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    // Resolve sender to a system user (required for SendEmail)
    const senderUserId = await this.resolveSystemUser(from);

    // Build activity parties
    const parties = [];

    // Sender (participationtypemask = 1) — must bind to a system user
    parties.push({
      participationtypemask: 1,
      addressused: from,
      'partyid_systemuser@odata.bind': `/systemusers(${senderUserId})`,
    });

    // To recipients (participationtypemask = 2)
    const toList = Array.isArray(to) ? to : [to];
    for (const addr of toList) {
      parties.push({ participationtypemask: 2, addressused: addr });
    }

    // CC recipients (participationtypemask = 3)
    if (cc) {
      const ccList = Array.isArray(cc) ? cc : [cc];
      for (const addr of ccList) {
        parties.push({ participationtypemask: 3, addressused: addr });
      }
    }

    const emailData = {
      subject,
      description: body,
      directioncode: true, // Outgoing
      email_activity_parties: parties,
    };

    // Link to a regarding record (e.g., a request)
    if (regardingId && regardingType) {
      const entitySet = await this.resolveEntitySetName(regardingType);
      emailData[`regardingobjectid_${regardingType}@odata.bind`] = `/${entitySet}(${regardingId})`;
    }

    const resp = await this._writeFetch(`${baseUrl}/api/data/v9.2/emails`, {
      method: 'POST',
      headers: this._withCallerId({
        ...this.buildHeaders(token),
        Prefer: 'return=representation',
      }, actingUserSystemId),
      body: JSON.stringify(emailData),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Failed to create email activity (${resp.status}): ${errorBody}`);
    }

    const result = await resp.json();
    return result.activityid;
  }

  /**
   * Add an attachment to an email activity.
   *
   * @param {string} emailId - Email activity ID
   * @param {Object} attachment
   * @param {string} attachment.filename - Filename
   * @param {string} attachment.contentType - MIME type
   * @param {Buffer|string} attachment.content - File content (Buffer or base64 string)
   */
  static async addEmailAttachment(emailId, { filename, contentType, content, actingUserSystemId, noFallback = false }) {
    assertTrustedDalContext('DynamicsService.addEmailAttachment');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    const base64Body = Buffer.isBuffer(content)
      ? content.toString('base64')
      : content;

    const attachmentData = {
      'objectid_email@odata.bind': `/emails(${emailId})`,
      objecttypecode: 'email',
      subject: filename,
      filename,
      mimetype: contentType || 'application/octet-stream',
      body: base64Body,
    };

    const resp = await this._writeFetch(`${baseUrl}/api/data/v9.2/activitymimeattachments`, {
      method: 'POST',
      headers: this._withCallerId(this.buildHeaders(token), actingUserSystemId),
      body: JSON.stringify(attachmentData),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Failed to add email attachment "${filename}" (${resp.status}): ${errorBody}`);
    }
  }

  /**
   * Send an email activity via the Dynamics SendEmail action.
   * The email must already be created via createEmailActivity().
   *
   * @param {string} emailId - Email activity ID to send
   */
  static async sendEmail(emailId, { actingUserSystemId, noFallback = false } = {}) {
    assertTrustedDalContext('DynamicsService.sendEmail');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    const resp = await this._writeFetch(`${baseUrl}/api/data/v9.2/emails(${emailId})/Microsoft.Dynamics.CRM.SendEmail`, {
      method: 'POST',
      headers: this._withCallerId(this.buildHeaders(token), actingUserSystemId),
      body: JSON.stringify({
        IssueSend: true,
      }),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Failed to send email (${resp.status}): ${errorBody}`);
    }
  }

  /**
   * Create, optionally attach files, and send an email in one call.
   *
   * @param {Object} options - Same as createEmailActivity plus:
   * @param {Array} [options.attachments] - Array of { filename, contentType, content }
   * @returns {{ emailId: string }} The sent email activity ID
   */
  static async createAndSendEmail({ subject, body, from, to, cc, regardingId, regardingType, attachments = [], actingUserSystemId, noFallback = false }) {
    if (noFallback && actingUserSystemId && process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
      throw new Error('Dynamics impersonation is disabled; noFallback requested');
    }

    // Step 1: Create the email activity
    const emailId = await this.createEmailActivity({ subject, body, from, to, cc, regardingId, regardingType, actingUserSystemId, noFallback });

    // Step 2: Add attachments (sequentially to avoid race conditions)
    for (const attachment of attachments) {
      await this.addEmailAttachment(emailId, { ...attachment, actingUserSystemId, noFallback });
    }

    // Step 3: Send
    await this.sendEmail(emailId, { actingUserSystemId, noFallback });

    return { emailId };
  }

  // ───────── Helpers ─────────

  /**
   * Resolve a logical entity name to its EntitySetName (plural collection name).
   * Accepts either logical name ("account") or entity set name ("accounts").
   */
  static async resolveEntitySetName(logicalName) {
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
    await this.getEntityDefinitions();
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
  static async getPrimaryIdAttribute(entitySet) {
    // The argument may be a logical name OR an entity-set name. primaryIdMap is
    // keyed by both, so try the statically-resolved logical name first, then the
    // raw argument (covers entity sets absent from the static KNOWN_ENTITY_SETS).
    const lookup = () => {
      if (!schemaCache.primaryIdMap) return null;
      return schemaCache.primaryIdMap.get(this.resolveLogicalName(entitySet))
        || schemaCache.primaryIdMap.get(entitySet)
        || null;
    };
    if (schemaCache.primaryIdMap && Date.now() - schemaCache.entitySetFetchedAt < TABLE_CACHE_TTL) {
      const cached = lookup();
      if (cached) return cached;
    }
    await this.getEntityDefinitions();
    return lookup();
  }

  /**
   * Process OData annotation values in a record.
   * Annotations like `_fieldid_value@OData.Community.Display.V1.FormattedValue`
   * become `_fieldid_value_formatted`.
   */
  static processAnnotations(record) {
    if (!record || typeof record !== 'object') return record;

    const processed = {};
    const annotationSuffix = '@OData.Community.Display.V1.FormattedValue';
    const msAnnotationSuffix = '@Microsoft.Dynamics.CRM.lookuplogicalname';

    for (const [key, value] of Object.entries(record)) {
      // Preserve @odata.etag as _etag for optimistic-concurrency callers
      // (If-Match on PATCH). All other @odata / @Microsoft annotations are stripped.
      if (key === '@odata.etag') {
        processed._etag = value;
        continue;
      }
      if (key.startsWith('@odata') || key.startsWith('@Microsoft')) continue;

      if (key.endsWith(annotationSuffix)) {
        const baseKey = key.replace(annotationSuffix, '');
        processed[`${baseKey}_formatted`] = value;
      } else if (key.endsWith(msAnnotationSuffix)) {
        const baseKey = key.replace(msAnnotationSuffix, '');
        processed[`${baseKey}_entity`] = value;
      } else {
        processed[key] = value;
      }
    }

    return processed;
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
  static async getEntityKey(entityLogicalName, keyLogicalName) {
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entityLogicalName}')/Keys`
      + `?$filter=LogicalName eq '${keyLogicalName}'`
      + `&$select=LogicalName,EntityKeyIndexStatus,KeyAttributes`;

    const resp = await fetchWithTimeout(url, {
      headers: this.buildHeaders(token),
    }, API_TIMEOUT);

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw buildServiceError('dataverse', resp, errorBody);
    }
    const data = await resp.json();
    return (data.value && data.value[0]) || null;
  }

  /**
   * Clear all caches (useful for testing / admin reset).
   */
  static clearCaches() {
    tokenCache = { token: null, expiresAt: 0 };
    schemaCache.tables = { data: null, fetchedAt: 0 };
    schemaCache.fields.clear();
    schemaCache.fieldPromises.clear();
    schemaCache.relationships.clear();
    schemaCache.entitySetMap = null;
    schemaCache.primaryIdMap = null;
    schemaCache.entitySetFetchedAt = 0;
  }
}

// ───────── Private Helpers ─────────

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

// ───────── $batch changeset builders + response parser ─────────
//
// Adapted from the proven body builder in scripts/probe-dataverse-batch-changeset.mjs
// (the S301 feasibility spike). The request half is byte-for-byte the spike's
// shape; the response parser is net-new (the spike only regex-scanned status
// lines — executeChangeset needs per-op Content-ID + body for structured errors).

const BATCH_CRLF = '\r\n';

/** Build one embedded operation (an application/http MIME part) inside a changeset. */
function buildChangesetOp(op, changesetBoundary, baseUrl, contentId) {
  const lines = [];
  lines.push(`--${changesetBoundary}`);
  lines.push('Content-Type: application/http');
  lines.push('Content-Transfer-Encoding: binary');
  lines.push(`Content-ID: ${contentId}`);
  lines.push(''); // blank line before the embedded request
  const url = op.url.startsWith('http') ? op.url : `${baseUrl}/${op.url}`;
  lines.push(`${op.method} ${url} HTTP/1.1`);
  lines.push('OData-Version: 4.0');
  lines.push('Accept: application/json');
  if (op.ifMatch) lines.push(`If-Match: ${op.ifMatch}`);
  if (op.body !== undefined && op.body !== null) {
    lines.push('Content-Type: application/json');
    lines.push('');
    lines.push(JSON.stringify(op.body));
  } else {
    lines.push('');
  }
  return lines.join(BATCH_CRLF);
}

/** Build the full multipart/mixed $batch body wrapping a single changeset of ops. */
function buildChangesetBatchBody(operations, batchBoundary, changesetBoundary, baseUrl) {
  const parts = [];
  parts.push(`--${batchBoundary}`);
  parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`);
  parts.push(''); // blank line before the changeset
  operations.forEach((op, i) => parts.push(buildChangesetOp(op, changesetBoundary, baseUrl, i + 1)));
  parts.push(`--${changesetBoundary}--`);
  parts.push(`--${batchBoundary}--`);
  parts.push('');
  return parts.join(BATCH_CRLF);
}

/** Pull the multipart boundary token out of a Content-Type header value. */
function extractBoundary(contentType) {
  if (!contentType) return null;
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1].trim() : null;
}

/**
 * Split a string at its first blank line (the MIME header/body separator),
 * tolerant of CRLF or LF endings. Returns { headers, body } or null if there is
 * no blank-line separator.
 */
function splitHeadersAndBody(text) {
  const m = text.match(/\r?\n\r?\n/);
  if (!m) return null;
  return { headers: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

/**
 * Split a multipart body into its constituent part strings (each part's MIME
 * headers + content), dropping the preamble, the closing `--boundary--`, and any
 * epilogue. Tolerant of CRLF or LF line endings from the wire.
 */
function splitMultipart(body, boundary) {
  const segments = body.split(`--${boundary}`);
  const parts = [];
  for (const seg of segments) {
    const stripped = seg.replace(/^\r?\n/, '');
    if (stripped.startsWith('--')) continue; // closing boundary marker
    if (!stripped.trim()) continue;          // preamble / blank
    parts.push(stripped);
  }
  return parts;
}

/**
 * Parse one embedded `application/http` response body into { status, body,
 * rawBody }. Shape: "HTTP/1.1 <status> <reason>\r\n<headers>\r\n\r\n<body>".
 * Embedded response headers (e.g. OData-EntityId on a create) are intentionally
 * NOT surfaced — see executeChangeset's JSDoc: callers identify rows by
 * alternate key, not by created-id read-back.
 */
function parseEmbeddedHttp(text) {
  const statusMatch = text.match(/^HTTP\/1\.1\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const split = splitHeadersAndBody(text);
  const rawBody = split ? split.body.trim() : '';
  let body = null;
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { /* non-JSON op body */ }
  }
  return { status, rawBody, body };
}

/** Recursively walk the nested multipart structure, collecting every embedded HTTP op result. */
function collectHttpParts(body, boundary, results) {
  for (const part of splitMultipart(body, boundary)) {
    const split = splitHeadersAndBody(part);
    if (!split) continue;
    const { headers: partHeaders, body: partBody } = split;
    const ctMatch = partHeaders.match(/Content-Type:\s*([^\r\n]+)/i);
    const ct = ctMatch ? ctMatch[1].trim() : '';
    const ctType = ct.toLowerCase(); // compare the MIME type case-insensitively…
    if (ctType.startsWith('multipart/mixed')) {
      const inner = extractBoundary(ct); // …but extract the boundary from the original (boundaries are case-sensitive)
      if (inner) collectHttpParts(partBody, inner, results);
    } else if (ctType.startsWith('application/http')) {
      const cidMatch = partHeaders.match(/Content-ID:\s*(\d+)/i);
      const contentId = cidMatch ? Number(cidMatch[1]) : null;
      results.push({ contentId, ...parseEmbeddedHttp(partBody) });
    }
  }
}

/**
 * Parse a Dataverse $batch response (batchresponse → changesetresponse →
 * application/http) into a flat per-op list. Returns [] when the response is not
 * multipart (Dataverse sometimes returns a bare JSON error for a rejected
 * changeset) — executeChangeset then falls back to the outer HTTP status.
 *
 * @returns {Array<{ contentId:number|null, status:number, body:object|null, rawBody:string }>}
 */
function parseBatchResponse(rawText, contentType) {
  const boundary = extractBoundary(contentType);
  if (!boundary || !rawText) return [];
  const results = [];
  collectHttpParts(rawText, boundary, results);
  return results;
}

function filterEntities(entities, searchTerm) {
  const term = searchTerm.toLowerCase();
  return entities.filter(e =>
    e.logicalName.toLowerCase().includes(term) ||
    e.displayName.toLowerCase().includes(term) ||
    e.description.toLowerCase().includes(term)
  );
}

async function fetchWithTimeout(url, options, timeout) {
  // CONTRACT: this helper installs its own AbortSignal for the timeout.
  // Any caller-provided `options.signal` is silently overwritten — composition
  // with caller signals is not currently supported (round-11 §2). No call site
  // in dynamics-service.js or graph-service.js passes one today; if a future
  // caller needs caller-driven cancellation, compose signals here (AbortSignal.any)
  // rather than picking one over the other.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    // Every no-response throw is wrapped so the drain's retry classifier sees
    // a structured error with err.noResponse / err.isTransient / err.causeKind
    // instead of having to string-parse err.message. See lib/utils/service-error.js.
    throw buildNoResponseError('dataverse', err);
  } finally {
    clearTimeout(timer);
  }
}

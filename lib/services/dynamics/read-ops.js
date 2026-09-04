// @ts-check
/**
 * DynamicsService decomposition — Stage 5 module (Checkpoint B, read path).
 *
 * Moved verbatim from lib/services/dynamics-service.js: the read cluster —
 * `queryRecords`, `getRecord`, `countRecords`, `aggregateRecords`,
 * `queryAllRecords`, `searchRecords`. Every class-surface `this.` access in a
 * moved body is rewritten to `svc.` per C1 (the svc-dispatch rule), so sibling
 * calls (`svc.resolveLogicalName`, `svc.checkRestriction`, `svc.getAccessToken`,
 * `svc.buildHeaders`, `svc.processAnnotations`, `svc.getPrimaryIdAttribute`)
 * still route through the facade and its test spies. Nothing else in the bodies
 * changed.
 *
 * These are read-only; they carry no `assertTrustedDalContext` (that guard lives
 * in the write cluster). Restriction enforcement (`svc.checkRestriction`) is
 * preserved verbatim, fail-closed via the facade → restrictions.js chain.
 *
 * Deps: http (`fetchWithTimeout`), constants (`API_TIMEOUT`,
 * `MAX_EXPORT_RECORDS`, `EXPORT_PAGE_SIZE`), service-error (`buildServiceError`).
 */

import {
  API_TIMEOUT,
  MAX_EXPORT_RECORDS,
  EXPORT_PAGE_SIZE,
} from './constants.js';
import { fetchWithTimeout } from './http.js';
import { buildServiceError } from '../../utils/service-error.js';

/**
 * Branded Dataverse record id (see lib/utils/guid.js). A raw request-input
 * string does not type-check as `Guid` until narrowed through `isGuid` at the
 * route edge; server-derived ids are cast at the read site.
 * @typedef {import('../../utils/guid.js').Guid} Guid
 */

/**
 * The DynamicsService facade receiver (C1 svc-dispatch). Typed `any` here on
 * purpose: this module brands the record-id selector surface, not the facade —
 * the facade's own typed coverage is deferred to the decomposition's
 * facade-finalize checkpoint. See docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md.
 * @typedef {any} Svc
 */

/**
 * Query records from an entity set with OData parameters.
 *
 * Safety: enforces $top max of 100 and requires either $filter or $top <= 25.
 *
 * SECURITY: `filter` is interpolated into the OData query — client-supplied
 * values inside it must be validated/escaped at the route edge (GUIDs via
 * `isGuid`, strings via the odata-escape helpers) before they reach here.
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {{select?:string, filter?:string, orderby?:string, top?:number, expand?:string}} [options]
 */
export async function queryRecords(svc, entitySet, { select, filter, orderby, top, expand } = {}) {
  const logicalName = svc.resolveLogicalName(entitySet);
  svc.checkRestriction(logicalName, select, expand);

  const effectiveTop = Math.min(top || 25, 100);

  // Safety: require filter or small top
  if (!filter && effectiveTop > 25) {
    throw new Error('Queries without $filter are limited to 25 records. Add a filter or reduce $top.');
  }

  const token = await svc.getAccessToken();
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
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw buildServiceError('dataverse', resp, errorBody);
  }

  const data = await resp.json();
  const records = (data.value || []).map((/** @type {any} */ r) => svc.processAnnotations(r));
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
 *
 * `recordId` is interpolated raw into the key predicate `${entitySet}(${recordId})`,
 * so it requires the branded {@link Guid} — narrow client input through `isGuid`
 * at the route edge first. Server-derived ids are cast at the read site.
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {Guid} recordId
 * @param {{select?:string, expand?:string}} [options]
 */
export async function getRecord(svc, entitySet, recordId, { select, expand } = {}) {
  const logicalName = svc.resolveLogicalName(entitySet);
  svc.checkRestriction(logicalName, select, expand);

  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const params = new URLSearchParams();

  if (select) params.set('$select', select);
  if (expand) params.set('$expand', expand);

  const paramStr = params.toString();
  const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})${paramStr ? '?' + paramStr : ''}`;

  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw buildServiceError('dataverse', resp, errorBody);
  }

  const record = await resp.json();
  return svc.processAnnotations(record);
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
 *
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {string} [filter]
 */
export async function countRecords(svc, entitySet, filter) {
  const logicalName = svc.resolveLogicalName(entitySet);
  svc.checkRestriction(logicalName);

  const pk = await svc.getPrimaryIdAttribute(logicalName);
  if (!pk) {
    throw new Error(`Count failed: could not resolve a primary-key attribute for "${entitySet}" from metadata.`);
  }

  const aggregate = `aggregate(${pk} with countdistinct as value)`;
  const apply = filter ? `filter(${filter})/${aggregate}` : aggregate;

  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/data/v9.2/${entitySet}?$apply=${encodeURIComponent(apply)}`;

  const resp = await fetchWithTimeout(url, {
    headers: svc.buildHeaders(token),
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
 * @param {Svc} svc
 * @param {string} entitySet - Entity set name (e.g. "akoya_requests")
 * @param {{field?:string, operation?:string, filter?:string, groupBy?:string}} [options]
 *   field: Field to aggregate; operation: sum/average/min/max/countdistinct;
 *   filter: OData $filter to scope; groupBy: field to group by.
 * @returns {Promise<{ results: any[], operation?: string, field?: string, groupBy?: string, filter?: string }>}
 */
export async function aggregateRecords(svc, entitySet, { field, operation, filter, groupBy } = {}) {
  const ALLOWED_OPS = ['sum', 'average', 'min', 'max', 'countdistinct'];
  if (!operation || !ALLOWED_OPS.includes(operation)) {
    throw new Error(`Invalid aggregation operation "${operation}". Allowed: ${ALLOWED_OPS.join(', ')}`);
  }

  const logicalName = svc.resolveLogicalName(entitySet);
  svc.checkRestriction(logicalName, field);
  if (groupBy) svc.checkRestriction(logicalName, groupBy);

  const token = await svc.getAccessToken();
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
    headers: svc.buildHeaders(token),
  }, API_TIMEOUT);

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Aggregation failed (${resp.status}): ${errorBody}`);
  }

  const data = await resp.json();
  const results = (data.value || []).map((/** @type {any} */ r) => svc.processAnnotations(r));

  /** @type {{ results: any[], operation?: string, field?: string, groupBy?: string, filter?: string }} */
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
 * @param {Svc} svc
 * @param {string} entitySet
 * @param {{select?:string, filter?:string, orderby?:string}} [options]
 * @returns {Promise<{ records: any[], totalCount: number, capped: boolean }>}
 */
export async function queryAllRecords(svc, entitySet, { select, filter, orderby } = {}) {
  if (!filter) {
    throw new Error('Export requires a $filter — unfiltered full-table dumps are not allowed.');
  }

  const logicalName = svc.resolveLogicalName(entitySet);
  svc.checkRestriction(logicalName, select);

  const token = await svc.getAccessToken();
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

    const records = (data.value || []).map((/** @type {any} */ r) => svc.processAnnotations(r));
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

/**
 * Full-text search across indexed tables using Dataverse Search.
 * Searches all text fields simultaneously with relevance ranking.
 *
 * @param {Svc} svc
 * @param {string} search - Search term(s)
 * @param {object} [options]
 * @param {string[]} [options.entities] - Limit to specific table names (e.g. ['akoya_request','contact'])
 * @param {number} [options.top] - Max results (1-100, default 20)
 * @param {number} [options.skip] - Number of ranked results to skip (default 0)
 * @param {string[]} [options.orderby] - Stable Dataverse Search sort expressions
 * @param {string} [options.filter] - OData $filter to narrow results
 * @returns {Promise<{ results: any[], totalCount: number, queryContext: any }>}
 */
export async function searchRecords(
  svc,
  search,
  { entities, top = 20, skip = 0, orderby, filter } = {},
) {
  // Check restrictions for each entity in the filter
  if (entities && entities.length > 0) {
    for (const entity of entities) {
      svc.checkRestriction(entity);
    }
  }

  const token = await svc.getAccessToken();
  const baseUrl = process.env.DYNAMICS_URL;
  const url = `${baseUrl}/api/search/v1.0/query`;

  /** @type {{ search: string, top: number, returntotalrecordcount: boolean, entities?: string[], skip?: number, orderby?: string[], filter?: string }} */
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
  if (Number.isSafeInteger(skip) && skip > 0) {
    body.skip = skip;
  }
  if (Array.isArray(orderby) && orderby.length > 0) {
    body.orderby = orderby;
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
  const results = (data.value || []).map((/** @type {Record<string, any>} */ r) => {
    const entity = r['@search.entityname'];
    const objectId = r['@search.objectid'];
    const score = r['@search.score'];
    const highlights = r['@search.highlights'] || {};

    // Collect non-metadata fields as attributes
    /** @type {Record<string, any>} */
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

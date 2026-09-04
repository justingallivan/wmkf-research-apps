/**
 * Workbench — bounded active/historical request discovery.
 *
 * Provides the read-only service contract for
 * GET /api/workbench/search-requests. Text searches use Dataverse Search for
 * relevance ranking and then hydrate the canonical request projection through
 * the grant-request adapter. Filter-only searches use a bounded OData query.
 * Search options are read live with distinct FetchXML queries so cycle/status
 * values do not become a hardcoded taxonomy.
 *
 * Contract:
 *   - plain arguments and response objects; never req/res;
 *   - no writes or durable application state;
 *   - at most 100 candidates per submitted search, returned 25 at a time;
 *   - ASSUMES the route established a trusted DAL context.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as odata from '../../dataverse/core/odata.js';
import { fetchXmlAll } from '../dataverse-export/fetch-client.js';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../utils/cycle-code.js';
import { ServiceHttpError } from '../service-http-error.js';

export const REQUEST_SEARCH_PAGE_SIZE = 25;
export const REQUEST_SEARCH_MAX_RESULTS = 100;

const SEARCH_ORDER = [
  '@search.score desc',
  'modifiedon desc',
  'createdon desc',
  'akoya_requestnum asc',
];
const SEARCH_EXPRESSION_MAX_LENGTH = 100;
const DATAVERSE_SEARCH_RESERVED = new Set([
  '+', '-', '&', '|', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':', '\\', '/',
]);

const SEARCH_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'akoya_fiscalyear',
  'wmkf_meetingdate',
  'akoya_requeststatus',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_researchleader_value',
  '_akoya_programid_value',
  '_wmkf_grantprogram_value',
].join(',');

const DISTINCT_CYCLES_FETCH = '<fetch distinct="true"><entity name="akoya_request">'
  + '<attribute name="akoya_fiscalyear" /></entity></fetch>';
const DISTINCT_STATUSES_FETCH = '<fetch distinct="true"><entity name="akoya_request">'
  + '<attribute name="akoya_requeststatus" /></entity></fetch>';

function nonBlank(value) {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function cycleSortValue(label) {
  const match = /^(June|December)\s+(\d{4})$/i.exec(label || '');
  if (!match) return Number.NEGATIVE_INFINITY;
  return Number(match[2]) * 10 + (match[1].toLowerCase() === 'december' ? 2 : 1);
}

function projectRequest(row) {
  const cycleCode = row.wmkf_meetingdate
    ? meetingDateToCycleCode(row.wmkf_meetingdate)
    : null;
  return {
    requestId: row.akoya_requestid,
    requestNumber: row.akoya_requestnum || null,
    title: row.akoya_title || 'Untitled request',
    institution: row.wmkf_organizationname
      || row._akoya_applicantid_value_formatted
      || null,
    projectLeader: row._wmkf_projectleader_value_formatted
      || row._wmkf_researchleader_value_formatted
      || null,
    cycleCode,
    cycleLabel: row.akoya_fiscalyear
      || (cycleCode ? cycleCodeToLabel(cycleCode) : null),
    requestStatus: row.akoya_requeststatus || null,
    program: row._akoya_programid_value_formatted
      || row._wmkf_grantprogram_value_formatted
      || null,
  };
}

function buildFilter({ cycle, status }) {
  const clauses = [];
  if (cycle) clauses.push(odata.eq('akoya_fiscalyear', cycle));
  if (status) clauses.push(odata.eq('akoya_requeststatus', status));
  return clauses.join(' and ');
}

// Dataverse legacy Search uses Lucene simple-query syntax. These characters
// are operators unless escaped, so user-entered institution/title punctuation
// must be made literal before it reaches the Search endpoint.
function escapeSearchExpression(value) {
  return [...value]
    .map((character) => (DATAVERSE_SEARCH_RESERVED.has(character) ? `\\${character}` : character))
    .join('');
}

/**
 * Return live cycle and status options. Distinct FetchXML keeps this bounded
 * even though akoya_request itself contains tens of thousands of rows.
 */
export async function loadRequestSearchOptions() {
  const [cycleResult, statusResult] = await Promise.all([
    fetchXmlAll('akoya_requests', DISTINCT_CYCLES_FETCH, { hardCapRows: 500 }),
    fetchXmlAll('akoya_requests', DISTINCT_STATUSES_FETCH, { hardCapRows: 500 }),
  ]);

  if (cycleResult.capped || cycleResult.truncatedByBudget
    || statusResult.capped || statusResult.truncatedByBudget) {
    throw new ServiceHttpError('Request search options were incomplete. Please try again.', {
      httpStatus: 503,
    });
  }

  const cycles = [...new Set(
    cycleResult.rows.map((row) => nonBlank(row.akoya_fiscalyear)).filter(Boolean),
  )].sort((a, b) => cycleSortValue(b) - cycleSortValue(a) || b.localeCompare(a));
  const statuses = [...new Set(
    statusResult.rows.map((row) => nonBlank(row.akoya_requeststatus)).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

  return {
    success: true,
    cycles: cycles.map((value) => ({ value, label: value })),
    statuses,
  };
}

/**
 * Search requests. The route validates lengths/ranges; this service still
 * rejects the unsafe complement (no text and no filters) so a future caller
 * cannot accidentally turn it into an unfiltered table scan.
 */
export async function searchWorkbenchRequests({ query, cycle, status, offset = 0 }) {
  const q = nonBlank(query);
  const selectedCycle = nonBlank(cycle);
  const selectedStatus = nonBlank(status);
  if (!q && !selectedCycle && !selectedStatus) {
    throw new ServiceHttpError('Enter a search term or select a cycle or status.', {
      httpStatus: 400,
    });
  }

  const filter = buildFilter({ cycle: selectedCycle, status: selectedStatus });
  let rows = [];
  let totalCount = 0;
  let unavailableCount = 0;
  let hasMore = false;
  let nextOffset = null;

  if (q) {
    const searchExpression = escapeSearchExpression(q);
    if (searchExpression.length > SEARCH_EXPRESSION_MAX_LENGTH) {
      throw new ServiceHttpError('Search term has too much punctuation. Shorten it and try again.', {
        httpStatus: 400,
      });
    }
    const searched = await grantRequestAdapter.searchRequests(searchExpression, {
      top: REQUEST_SEARCH_PAGE_SIZE,
      skip: offset,
      orderby: SEARCH_ORDER,
      ...(filter ? { filter: `akoya_request:(${filter})` } : {}),
    });
    const searchHits = Array.isArray(searched.results) ? searched.results : [];
    const ids = [...new Set(
      searchHits.map((result) => result.objectId).filter(Boolean),
    )].slice(0, REQUEST_SEARCH_PAGE_SIZE);
    totalCount = Number.isFinite(searched.totalCount) ? searched.totalCount : ids.length;

    if (ids.length) {
      const hydrated = await grantRequestAdapter.findByIds(ids, {
        select: SEARCH_SELECT,
        top: ids.length,
      });
      const byId = new Map((hydrated.records || []).map((row) => [
        String(row.akoya_requestid).toLowerCase(),
        row,
      ]));
      rows = ids.map((id) => byId.get(String(id).toLowerCase())).filter(Boolean);
      unavailableCount = ids.length - rows.length;
    }
    const returnedThrough = offset + searchHits.length;
    hasMore = searchHits.length > 0
      && returnedThrough < Math.min(totalCount, REQUEST_SEARCH_MAX_RESULTS);
    nextOffset = hasMore ? offset + REQUEST_SEARCH_PAGE_SIZE : null;
  } else {
    const found = await grantRequestAdapter.queryRequests({
      select: SEARCH_SELECT,
      filter,
      orderby: 'akoya_requestnum desc',
      top: REQUEST_SEARCH_MAX_RESULTS,
    });
    rows = found.records || [];
    totalCount = Number.isFinite(found.totalCount) ? found.totalCount : rows.length;
    const availableCount = Math.min(rows.length, REQUEST_SEARCH_MAX_RESULTS);
    rows = rows.slice(offset, offset + REQUEST_SEARCH_PAGE_SIZE);
    hasMore = offset + rows.length < availableCount;
    nextOffset = hasMore ? offset + REQUEST_SEARCH_PAGE_SIZE : null;
  }

  return {
    success: true,
    results: rows.map(projectRequest),
    offset,
    limit: REQUEST_SEARCH_PAGE_SIZE,
    totalCount,
    returnedCount: rows.length,
    hasMore,
    nextOffset,
    capped: totalCount > REQUEST_SEARCH_MAX_RESULTS,
    unavailableCount,
  };
}

export const REQUEST_SEARCH_SELECT = SEARCH_SELECT;
export const REQUEST_SEARCH_OPTIONS_FETCH = {
  cycles: DISTINCT_CYCLES_FETCH,
  statuses: DISTINCT_STATUSES_FETCH,
};
export const REQUEST_SEARCH_ORDER = SEARCH_ORDER;

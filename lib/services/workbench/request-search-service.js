/**
 * Workbench — bounded active/historical request discovery.
 *
 * Provides the read-only service contract for
 * GET /api/workbench/search-requests. Text searches union Dataverse Search
 * relevance hits with requests joined through matching Project Leader contacts,
 * then hydrate the canonical request projection through the grant-request
 * adapter. Filter-only searches use a bounded OData query.
 * Search options are read live with server-side group-by aggregates so
 * cycle/status values do not become a hardcoded taxonomy.
 *
 * Contract:
 *   - plain arguments and response objects; never req/res;
 *   - no writes or durable application state;
 *   - at most 100 candidates per submitted search, returned 25 at a time;
 *   - ASSUMES the route established a trusted DAL context.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as contactAdapter from '../../dataverse/adapters/contact.js';
import * as odata from '../../dataverse/core/odata.js';
import { chunk } from '../../utils/chunk.js';
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
const SEARCH_HYDRATION_CHUNK_SIZE = 50;
const PROJECT_LEADER_CONTACT_LIMIT = 25;
const PROJECT_LEADER_ORDER = 'modifiedon desc,createdon desc,akoya_requestnum asc';
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

const CYCLES_AGGREGATE = Object.freeze({
  field: 'akoya_requestid',
  operation: 'countdistinct',
  groupBy: 'akoya_fiscalyear',
});
const STATUSES_AGGREGATE = Object.freeze({
  field: 'akoya_requestid',
  operation: 'countdistinct',
  groupBy: 'akoya_requeststatus',
});

function nonBlank(value) {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function normalizeTotalCount(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
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

async function hydrateSearchHits(ids) {
  const records = [];
  for (const idChunk of chunk(ids, SEARCH_HYDRATION_CHUNK_SIZE)) {
    const hydrated = await grantRequestAdapter.findByIds(idChunk, {
      select: SEARCH_SELECT,
      top: idChunk.length,
    });
    records.push(...(hydrated.records || []));
  }
  const byId = new Map(records.map((row) => [
    String(row.akoya_requestid).toLowerCase(),
    row,
  ]));
  const orderedRows = ids.map((id) => byId.get(String(id).toLowerCase())).filter(Boolean);
  return {
    rows: orderedRows,
    unavailableCount: ids.length - orderedRows.length,
  };
}

async function findProjectLeaderRequests(query, filter) {
  // Dataverse Search does not index the formatted value of the
  // wmkf_projectleader lookup. Resolve bounded contact-name candidates first,
  // then join them back to requests through the authoritative lookup field.
  const contacts = await contactAdapter.searchDirectoryByName(query, {
    top: PROJECT_LEADER_CONTACT_LIMIT + 1,
  });
  const contactCandidatesTruncated = (contacts || []).length > PROJECT_LEADER_CONTACT_LIMIT;
  const contactIds = [...new Set(
    (contacts || [])
      .slice(0, PROJECT_LEADER_CONTACT_LIMIT)
      .map((row) => row.contactid)
      .filter(Boolean),
  )];
  if (!contactIds.length) {
    return {
      records: [],
      totalCount: 0,
      hasMore: false,
      contactCandidatesTruncated,
    };
  }

  const leaderClause = odata.or(
    contactIds.map((contactId) => odata.eqGuid('_wmkf_projectleader_value', contactId)),
  );
  const result = await grantRequestAdapter.queryRequests({
    select: SEARCH_SELECT,
    filter: odata.and([
      `(${leaderClause})`,
      ...(filter ? [filter] : []),
    ]),
    orderby: PROJECT_LEADER_ORDER,
    top: REQUEST_SEARCH_MAX_RESULTS,
  });
  return { ...result, contactCandidatesTruncated };
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
 * Return live cycle and status options. Server-side grouping keeps the response
 * bounded even though akoya_request itself contains tens of thousands of rows.
 */
export async function loadRequestSearchOptions() {
  const [cycleResult, statusResult] = await Promise.all([
    grantRequestAdapter.aggregateRequests(CYCLES_AGGREGATE),
    grantRequestAdapter.aggregateRequests(STATUSES_AGGREGATE),
  ]);

  const cycles = [...new Set(
    cycleResult.results.map((row) => nonBlank(row.akoya_fiscalyear)).filter(Boolean),
  )].sort((a, b) => cycleSortValue(b) - cycleSortValue(a) || b.localeCompare(a));
  const statuses = [...new Set(
    statusResult.results.map((row) => nonBlank(row.akoya_requeststatus)).filter(Boolean),
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
  let capped = false;

  if (q) {
    const searchExpression = escapeSearchExpression(q);
    if (searchExpression.length > SEARCH_EXPRESSION_MAX_LENGTH) {
      throw new ServiceHttpError('Search term has too much punctuation. Shorten it and try again.', {
        httpStatus: 400,
      });
    }
    const [searched, projectLeaderResult] = await Promise.all([
      grantRequestAdapter.searchRequests(searchExpression, {
        top: REQUEST_SEARCH_MAX_RESULTS,
        orderby: SEARCH_ORDER,
        ...(filter ? { filter: `akoya_request:(${filter})` } : {}),
      }),
      findProjectLeaderRequests(q, filter),
    ]);
    const searchHits = Array.isArray(searched.results) ? searched.results : [];
    const ids = [...new Set(
      searchHits.map((result) => result.objectId).filter(Boolean),
    )].slice(0, REQUEST_SEARCH_MAX_RESULTS);
    const hydrated = ids.length
      ? await hydrateSearchHits(ids)
      : { rows: [], unavailableCount: 0 };
    const projectLeaderRows = projectLeaderResult.records || [];
    const projectLeaderTotalCount = normalizeTotalCount(
      projectLeaderResult.totalCount,
      projectLeaderRows.length,
    );
    const unslicedMergedRows = [...new Map(
      [...projectLeaderRows, ...hydrated.rows].map((row) => [
        String(row.akoya_requestid).toLowerCase(),
        row,
      ]),
    ).values()];
    const mergedRows = unslicedMergedRows.slice(0, REQUEST_SEARCH_MAX_RESULTS);
    const indexedTotalCount = normalizeTotalCount(searched.totalCount, ids.length);
    totalCount = Math.max(
      indexedTotalCount,
      projectLeaderTotalCount,
      unslicedMergedRows.length,
    );
    capped = Boolean(
      projectLeaderResult.contactCandidatesTruncated
      || projectLeaderResult.hasMore
      || projectLeaderTotalCount > REQUEST_SEARCH_MAX_RESULTS
      || indexedTotalCount > REQUEST_SEARCH_MAX_RESULTS
      || unslicedMergedRows.length > REQUEST_SEARCH_MAX_RESULTS,
    );
    rows = mergedRows.slice(offset, offset + REQUEST_SEARCH_PAGE_SIZE);
    unavailableCount = offset === 0 ? hydrated.unavailableCount : 0;
    hasMore = offset + rows.length < mergedRows.length;
    nextOffset = hasMore ? offset + REQUEST_SEARCH_PAGE_SIZE : null;
  } else {
    const found = await grantRequestAdapter.queryRequests({
      select: SEARCH_SELECT,
      filter,
      orderby: 'akoya_requestnum desc',
      top: REQUEST_SEARCH_MAX_RESULTS,
    });
    rows = found.records || [];
    totalCount = normalizeTotalCount(found.totalCount, rows.length);
    const availableCount = Math.min(rows.length, REQUEST_SEARCH_MAX_RESULTS);
    rows = rows.slice(offset, offset + REQUEST_SEARCH_PAGE_SIZE);
    hasMore = offset + rows.length < availableCount;
    nextOffset = hasMore ? offset + REQUEST_SEARCH_PAGE_SIZE : null;
    capped = totalCount > REQUEST_SEARCH_MAX_RESULTS;
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
    capped,
    unavailableCount,
  };
}

export const REQUEST_SEARCH_SELECT = SEARCH_SELECT;
export const REQUEST_SEARCH_OPTIONS_AGGREGATES = {
  cycles: CYCLES_AGGREGATE,
  statuses: STATUSES_AGGREGATE,
};
export const REQUEST_SEARCH_ORDER = SEARCH_ORDER;
export const REQUEST_SEARCH_PROJECT_LEADER_ORDER = PROJECT_LEADER_ORDER;

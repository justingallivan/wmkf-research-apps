/**
 * Composite Dynamics Explorer tools kept as single-query shortcuts:
 * find_reports_due and search (full-text search across indexed tables).
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:2728-2866
 * (pre-S2 line numbers); characterization tests are the safety net.
 */

import { DynamicsService } from '../../dynamics-service';
import { applyActiveOnlyFilter, isOperationalLogTable } from '../result-shaping';
import { serializeDynamicsExplorerFieldValueForModel } from '../../../utils/dynamics-explorer-serializer';
import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import {
  ordinaryTestRequestODataFilterForNavigation,
  testRequestIsolationEnabled,
  testRequestVisibilityDto,
  withTestRequestIsolationSelect,
} from '../../test-requests/isolation.js';

// ─── Existing composite tools (kept) ───

/**
 * Find all reporting requirements due in a date range.
 * Single Dynamics query with _formatted annotations for org/request names.
 */
export async function findReportsDue({ date_from, date_to, include_inactive }) {
  const base = `akoya_type eq true and akoya_requirementdue ge ${date_from} and akoya_requirementdue lt ${date_to}`;
  const activeFilter = applyActiveOnlyFilter(base, include_inactive);
  const filter = testRequestIsolationEnabled()
    ? `(${activeFilter}) and ${ordinaryTestRequestODataFilterForNavigation('akoya_requestlookup')}`
    : activeFilter;

  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_requirementdue,akoya_requirementtype,wmkf_reporttype,_akoya_requestlookup_value,_akoya_requestapplicant_value,statecode',
    filter,
    orderby: 'akoya_requirementdue asc',
    top: 100,
  });

  if (!result.records.length) {
    return { reportCount: 0, totalCount: result.totalCount, message: 'No reports due in this date range.' };
  }

  // Group by due date for summary
  const byDate = {};
  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const due = r.akoya_requirementdue_formatted || r.akoya_requirementdue || '?';
    const type = r.akoya_requirementtype_formatted || '?';
    const detail = r.wmkf_reporttype_formatted || '';
    const reqNum = r._akoya_requestlookup_value_formatted || r._akoya_requestlookup_value || '?';
    const org = r._akoya_requestapplicant_value_formatted || '?';
    const status = r.statecode_formatted || '';

    // Track date grouping
    byDate[due] = (byDate[due] || 0) + 1;

    return `${num} | ${due} | ${type}${detail ? ' - ' + detail : ''} | Req ${reqNum} | ${org} | ${status}`;
  });

  const summary = Object.entries(byDate)
    .map(([date, count]) => `${date}: ${count}`)
    .join(', ');

  return {
    totalCount: result.totalCount,
    reportCount: result.records.length,
    hasMore: result.totalCount > result.records.length,
    byDate: summary,
    header: 'Report# | Due | Type | Request# | Organization | Status',
    reports: lines.join('\n'),
  };
}

/**
 * Full-text search across all indexed Dynamics tables.
 */
export async function searchRecords({ search, entities, top }) {
  const requestedEntities = Array.isArray(entities)
    ? entities.filter(entity => !isOperationalLogTable(entity))
    : entities;
  if (Array.isArray(entities) && requestedEntities.length === 0) {
    return {
      totalCount: 0,
      query: search,
      message: 'No results found. Operational AI audit logs are not exposed in Dynamics Explorer.',
    };
  }

  const result = await DynamicsService.searchRecords(search, {
    entities: requestedEntities,
    top: top || 20,
  });
  const visibleResults = result.results.filter(r => !isOperationalLogTable(r.entity));
  const hiddenResultCount = result.results.length - visibleResults.length;

  const testRequestIds = new Set();
  if (testRequestIsolationEnabled()) {
    const requestIds = [...new Set(visibleResults
      .filter((row) => row.entity === 'akoya_request')
      .map((row) => row.objectId)
      .filter(Boolean)
      .map((id) => String(id).toLowerCase()))];
    // The TEST badge is informational: a hit that cannot be classified (stale
    // index entry, failed read) renders without it rather than failing search.
    for (let index = 0; index < requestIds.length; index += 50) {
      const batch = requestIds.slice(index, index + 50);
      let hydrated;
      try {
        hydrated = await grantRequestAdapter.findByIds(batch, {
          select: withTestRequestIsolationSelect('akoya_requestid'),
          top: batch.length,
        });
      } catch (error) {
        console.warn('[dynamics-explorer] TEST badge lookup failed; rendering hits without it:', error?.message);
        continue;
      }
      for (const row of hydrated.records || []) {
        if (testRequestVisibilityDto(row).isTestRequest === true) {
          testRequestIds.add(String(row.akoya_requestid).toLowerCase());
        }
      }
    }
  }

  if (!visibleResults.length) {
    return {
      totalCount: 0,
      query: result.queryContext?.alteredquery || search,
      message: 'No results found.',
    };
  }

  // Group results by entity for readable output
  const byEntity = {};
  for (const r of visibleResults) {
    if (!byEntity[r.entity]) byEntity[r.entity] = [];
    byEntity[r.entity].push(r);
  }

  const sections = [];
  for (const [entity, results] of Object.entries(byEntity)) {
    const lines = results.map(r => {
      const a = r.attributes;

      // Build a one-line identifier based on entity type
      let label;
      if (entity === 'akoya_request') {
        const testBadge = testRequestIds.has(String(r.objectId).toLowerCase()) ? ' | TEST' : '';
        label = `Req ${a.akoya_requestnum || '?'}${testBadge} | ${a.akoya_applicantidname || '?'} | ${(a.akoya_title || '').substring(0, 80)}`;
      } else if (entity === 'contact') {
        label = `${a.fullname || '?'} | ${a.jobtitle || ''} | ${a.emailaddress1 || ''}`;
      } else if (entity === 'account') {
        label = `${a.name || '?'} | ${a.address1_city || ''}, ${a.address1_stateorprovince || ''}`;
      } else if (entity === 'annotation') {
        const noteField = a.subject ? 'subject' : 'notetext';
        const notePreview = serializeDynamicsExplorerFieldValueForModel(noteField, a.subject || a.notetext || '', { maxStringChars: 80 });
        label = `Note: ${String(notePreview).substring(0, 80)}`;
      } else if (entity === 'email') {
        const subjectPreview = serializeDynamicsExplorerFieldValueForModel('subject', a.subject || '', { maxStringChars: 80 });
        label = `Email: ${String(subjectPreview).substring(0, 80)} | ${a.createdon || ''}`;
      } else {
        label = `${a.wmkf_name || a.akoya_title || r.objectId}`;
      }

      // Format highlights — strip {crmhit} tags and show matched text
      const hlParts = [];
      for (const [field, values] of Object.entries(r.highlights)) {
        const cleanValues = (Array.isArray(values) ? values : [values])
          .map(v => {
            const clean = v.replace(/\{crmhit\}/g, '**').replace(/\{\/crmhit\}/g, '**');
            return serializeDynamicsExplorerFieldValueForModel(field, clean, { maxStringChars: 200 });
          });
        hlParts.push(`${field}: ${String(cleanValues[0]).substring(0, 200)}`);
      }

      return `${label}\n  ID: ${r.objectId}\n  ${hlParts.join('\n  ')}`;
    });

    sections.push(`[${entity}] (${results.length} results)\n${lines.join('\n')}`);
  }

  return {
    totalCount: hiddenResultCount > 0 ? visibleResults.length : result.totalCount,
    query: result.queryContext?.alteredquery || search,
    nextStepHint: (!requestedEntities?.length || requestedEntities.includes('akoya_request'))
      ? 'If the user asked for files/documents and a listed request looks plausible, call list_documents with that request number now instead of running more broad searches.'
      : undefined,
    results: sections.join('\n\n'),
  };
}

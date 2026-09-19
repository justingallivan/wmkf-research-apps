/**
 * get_related tool: server-side relationship traversal from a resolved
 * source entity (account/request/contact/reviewer) to its related records
 * (requests, emails, payments, reports, annotations, reviewers).
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:1364-1920
 * (pre-S2 line numbers); characterization tests are the safety net.
 */

import { DynamicsService } from '../../dynamics-service';
import { getEntity, ENTITY_TYPE_CONFIGS } from './get-entity';

// ─── get_related ───

/**
 * Resolve a source entity by name/number to get its GUID.
 * Used by get_related when source_name is provided instead of source_id.
 */
async function resolveEntity(sourceType, sourceName) {
  const result = await getEntity({ type: sourceType, identifier: sourceName });
  // Carry the not-found marker through so get_related logs a zero-result rather
  // than an error when the source simply doesn't exist.
  if (result.error) return { error: result.error, _notFound: result._notFound };

  // Extract the GUID from the result
  const cfg = ENTITY_TYPE_CONFIGS[sourceType];
  const id = result[cfg.idField];
  if (!id) {
    return { error: `Could not resolve ${sourceType} "${sourceName}" to a GUID` };
  }

  return { id, record: result };
}

/**
 * Get request IDs for an account. Shared helper for account→emails/payments/reports.
 * Returns { requestIds, requestLookup, account } or { error }.
 */
async function getAccountRequestIds(accountId) {
  const requestResult = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requestid,akoya_requeststatus',
    filter: `_akoya_applicantid_value eq ${accountId}`,
    orderby: 'createdon desc',
    top: 100,
  });

  if (!requestResult.records.length) {
    return { requestIds: [], requestLookup: {} };
  }

  const requestIds = requestResult.records.map(r => r.akoya_requestid);
  const requestLookup = {};
  for (const r of requestResult.records) {
    requestLookup[r.akoya_requestid] = r.akoya_requestnum;
  }

  return { requestIds, requestLookup, totalRequests: requestResult.totalCount };
}

/**
 * Valid relationship paths and their target types.
 */
const VALID_RELATIONSHIPS = {
  account: ['requests', 'emails', 'payments', 'reports'],
  request: ['payments', 'reports', 'emails', 'annotations', 'reviewers'],
  contact: ['requests'],
  reviewer: ['requests'],
};

/**
 * Follow relationships from a source entity. Handles multi-step lookups server-side.
 */
export async function getRelated({ source_type, source_id, source_name, target_type, date_from, date_to }) {
  // Validate relationship
  const validTargets = VALID_RELATIONSHIPS[source_type];
  if (!validTargets) {
    return { error: `Unknown source type: "${source_type}". Valid: ${Object.keys(VALID_RELATIONSHIPS).join(', ')}` };
  }
  if (!validTargets.includes(target_type)) {
    return { error: `Unknown relationship: ${source_type}→${target_type}. Valid targets for ${source_type}: ${validTargets.join(', ')}` };
  }

  // Must have source_id or source_name
  if (!source_id && !source_name) {
    return { error: 'Either source_id (GUID) or source_name (name/number) is required.' };
  }

  // Resolve source_name to GUID if needed
  let resolvedId = source_id;
  let sourceRecord = null;
  if (!resolvedId) {
    const resolved = await resolveEntity(source_type, source_name);
    if (resolved.error) return { error: resolved.error, _notFound: resolved._notFound };
    resolvedId = resolved.id;
    sourceRecord = resolved.record;
  }

  // Build date filter fragment
  const buildDateFilter = (field) => {
    let df = '';
    if (date_from) df += ` and ${field} ge ${date_from}`;
    if (date_to) df += ` and ${field} lt ${date_to}`;
    return df;
  };

  // Dispatch to relationship handler
  const key = `${source_type}→${target_type}`;
  switch (key) {
    // ─── account relationships ───

    case 'account→requests':
      return await handleAccountRequests(resolvedId, sourceRecord, buildDateFilter);

    case 'account→emails':
      return await handleAccountEmails(resolvedId, sourceRecord, buildDateFilter);

    case 'account→payments':
      return await handleAccountPayments(resolvedId, sourceRecord, buildDateFilter);

    case 'account→reports':
      return await handleAccountReports(resolvedId, sourceRecord, buildDateFilter);

    // ─── request relationships ───

    case 'request→payments':
      return await handleRequestPayments(resolvedId, buildDateFilter);

    case 'request→reports':
      return await handleRequestReports(resolvedId, buildDateFilter);

    case 'request→emails':
      return await handleRequestEmails(resolvedId);

    case 'request→annotations':
      return await handleRequestAnnotations(resolvedId, buildDateFilter);

    case 'request→reviewers':
      return await handleRequestReviewers(resolvedId);

    // ─── contact relationships ───

    case 'contact→requests':
      return await handleContactRequests(resolvedId, buildDateFilter);

    // ─── reviewer relationships ───

    case 'reviewer→requests':
      return await handleReviewerRequests(resolvedId, buildDateFilter);

    default:
      return { error: `Unimplemented relationship: ${key}` };
  }
}

// ─── Relationship handlers ───

async function handleAccountRequests(accountId, sourceRecord, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_submitdate');
  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,akoya_paid,wmkf_request_type,_akoya_primarycontactid_value,_wmkf_grantprogram_value',
    filter: `_akoya_applicantid_value eq ${accountId}${dateFilter}`,
    orderby: 'akoya_submitdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_requestnum || '?';
    const status = r.akoya_requeststatus_formatted || r.akoya_requeststatus || '';
    const date = r.akoya_submitdate_formatted || r.akoya_submitdate || '';
    const fy = r.akoya_fiscalyear || '';
    const paid = r.akoya_paid_formatted || r.akoya_paid || '';
    const type = r.wmkf_request_type || '';
    const program = r._wmkf_grantprogram_value_formatted || '';
    return `Req ${num} | ${status} | ${date} | FY: ${fy} | ${type} | ${program} | Paid: ${paid}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    requestCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Request# | Status | Submitted | FY | Type | Program | Paid',
    requests: lines.join('\n') || 'No requests found.',
  };
}

async function handleAccountEmails(accountId, sourceRecord, buildDateFilter) {
  const { requestIds, requestLookup, totalRequests } = await getAccountRequestIds(accountId);

  if (!requestIds.length) {
    return {
      account: sourceRecord?.name || accountId,
      requestCount: 0,
      emailCount: 0,
      emails: 'No requests found for this account, so no linked emails.',
    };
  }

  const orClauses = requestIds.map(id => `_regardingobjectid_value eq ${id}`).join(' or ');
  const dateFilter = buildDateFilter('createdon');

  const emailResult = await DynamicsService.queryRecords('emails', {
    select: 'subject,sender,torecipients,createdon,directioncode,_regardingobjectid_value',
    filter: `(${orClauses})${dateFilter}`,
    orderby: 'createdon desc',
    top: 100,
  });

  const lines = emailResult.records.map(e => {
    const dir = e.directioncode ? 'Out' : 'In';
    const date = e.createdon_formatted || e.createdon || '';
    const reqNum = requestLookup[e._regardingobjectid_value] || '?';
    const subj = (e.subject || '').substring(0, 80);
    const sender = (e.sender || '').substring(0, 30);
    const to = (e.torecipients || '').substring(0, 40);
    return `[${dir}] ${date} | Req ${reqNum} | ${sender} → ${to} | ${subj}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    requestCount: totalRequests,
    emailCount: emailResult.records.length,
    totalEmailCount: emailResult.totalCount,
    hasMore: emailResult.hasMore,
    emails: lines.join('\n') || 'No emails found.',
  };
}

async function handleAccountPayments(accountId, sourceRecord, buildDateFilter) {
  const { requestIds, requestLookup } = await getAccountRequestIds(accountId);

  if (!requestIds.length) {
    return {
      account: sourceRecord?.name || accountId,
      paymentCount: 0,
      payments: 'No requests found for this account.',
    };
  }

  const orClauses = requestIds.map(id => `_akoya_requestlookup_value eq ${id}`).join(' or ');
  const dateFilter = buildDateFilter('akoya_paymentdate');

  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_amount,akoya_netamount,akoya_paymentdate,akoya_folio,_akoya_requestlookup_value',
    filter: `akoya_type eq false and (${orClauses})${dateFilter}`,
    orderby: 'akoya_paymentdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const amt = r.akoya_amount_formatted || r.akoya_amount || '';
    const net = r.akoya_netamount_formatted || r.akoya_netamount || '';
    const date = r.akoya_paymentdate_formatted || r.akoya_paymentdate || '';
    const status = r.akoya_folio || '';
    const reqNum = requestLookup[r._akoya_requestlookup_value] || '?';
    return `${num} | ${date} | ${amt} | Net: ${net} | ${status} | Req ${reqNum}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    paymentCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Payment# | Date | Amount | Net | Status | Request#',
    payments: lines.join('\n') || 'No payments found.',
  };
}

async function handleAccountReports(accountId, sourceRecord, buildDateFilter) {
  const { requestIds, requestLookup } = await getAccountRequestIds(accountId);

  if (!requestIds.length) {
    return {
      account: sourceRecord?.name || accountId,
      reportCount: 0,
      reports: 'No requests found for this account.',
    };
  }

  const orClauses = requestIds.map(id => `_akoya_requestlookup_value eq ${id}`).join(' or ');
  const dateFilter = buildDateFilter('akoya_requirementdue');

  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_requirementdue,akoya_requirementtype,wmkf_reporttype,_akoya_requestlookup_value,statecode',
    filter: `akoya_type eq true and (${orClauses})${dateFilter}`,
    orderby: 'akoya_requirementdue asc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const due = r.akoya_requirementdue_formatted || r.akoya_requirementdue || '';
    const type = r.akoya_requirementtype_formatted || '?';
    const detail = r.wmkf_reporttype_formatted || '';
    const reqNum = requestLookup[r._akoya_requestlookup_value] || '?';
    const status = r.statecode_formatted || '';
    return `${num} | ${due} | ${type}${detail ? ' - ' + detail : ''} | Req ${reqNum} | ${status}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    reportCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Report# | Due | Type | Request# | Status',
    reports: lines.join('\n') || 'No reports found.',
  };
}

async function handleRequestPayments(requestId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_paymentdate');
  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_amount,akoya_netamount,akoya_paymentdate,akoya_postingdate,akoya_folio,_akoya_requestapplicant_value,statecode',
    filter: `_akoya_requestlookup_value eq ${requestId} and akoya_type eq false${dateFilter}`,
    orderby: 'akoya_paymentdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const amt = r.akoya_amount_formatted || r.akoya_amount || '';
    const net = r.akoya_netamount_formatted || r.akoya_netamount || '';
    const date = r.akoya_paymentdate_formatted || r.akoya_paymentdate || '';
    const status = r.akoya_folio || '';
    return `${num} | ${date} | ${amt} | Net: ${net} | ${status}`;
  });

  return {
    requestId,
    paymentCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Payment# | Date | Amount | Net | Status',
    payments: lines.join('\n') || 'No payments found for this request.',
  };
}

async function handleRequestReports(requestId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_requirementdue');
  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_requirementdue,akoya_requirementtype,wmkf_reporttype,_akoya_requestapplicant_value,statecode',
    filter: `_akoya_requestlookup_value eq ${requestId} and akoya_type eq true${dateFilter}`,
    orderby: 'akoya_requirementdue asc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const due = r.akoya_requirementdue_formatted || r.akoya_requirementdue || '';
    const type = r.akoya_requirementtype_formatted || '?';
    const detail = r.wmkf_reporttype_formatted || '';
    const status = r.statecode_formatted || '';
    return `${num} | ${due} | ${type}${detail ? ' - ' + detail : ''} | ${status}`;
  });

  return {
    requestId,
    reportCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Report# | Due | Type | Status',
    reports: lines.join('\n') || 'No reports found for this request.',
  };
}

async function handleRequestEmails(requestId) {
  const emailResult = await DynamicsService.queryRecords('emails', {
    select: 'subject,sender,torecipients,createdon,directioncode,description,activityid',
    filter: `_regardingobjectid_value eq ${requestId}`,
    orderby: 'createdon desc',
    top: 50,
  });

  const lines = emailResult.records.map(e => {
    const dir = e.directioncode ? 'Out' : 'In';
    const date = e.createdon_formatted || e.createdon || '';
    const subj = (e.subject || '').substring(0, 80);
    const sender = (e.sender || '').substring(0, 30);
    const to = (e.torecipients || '').substring(0, 40);
    const rawBody = (e.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const body = rawBody.length > 800 ? rawBody.substring(0, 800) + '...[truncated]' : rawBody;
    const id = e.activityid || '';
    return `[${dir}] ${date} | ${sender} → ${to} | ${subj}\nID: ${id}\n${body || '(no body text)'}`;
  });

  return {
    requestId,
    emailCount: emailResult.records.length,
    totalCount: emailResult.totalCount,
    hasMore: emailResult.hasMore,
    emails: lines.join('\n---\n') || 'No emails found for this request.',
  };
}

async function handleRequestAnnotations(requestId, buildDateFilter) {
  const dateFilter = buildDateFilter('createdon');
  const result = await DynamicsService.queryRecords('annotations', {
    select: 'subject,notetext,filename,mimetype,filesize,isdocument,createdon,annotationid',
    filter: `_objectid_value eq ${requestId}${dateFilter}`,
    orderby: 'createdon desc',
    top: 50,
  });

  const lines = result.records.map(r => {
    const subj = (r.subject || '').substring(0, 80);
    const date = r.createdon_formatted || r.createdon || '';
    const text = (r.notetext || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
    const file = r.filename ? ` | File: ${r.filename} (${r.mimetype}, ${r.filesize} bytes)` : '';
    return `${date} | ${subj}${file}\n  ${text || '(no text)'}`;
  });

  return {
    requestId,
    annotationCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    annotations: lines.join('\n') || 'No notes/attachments found for this request.',
  };
}

async function handleRequestReviewers(requestId) {
  // Get the request record with reviewer lookup fields
  const req = await DynamicsService.getRecord('akoya_requests', requestId, {
    select: '_wmkf_potentialreviewer1_value,_wmkf_potentialreviewer2_value,_wmkf_potentialreviewer3_value,_wmkf_potentialreviewer4_value,_wmkf_potentialreviewer5_value,wmkf_excludedreviewers',
  });

  const processed = DynamicsService.processAnnotations(req);

  // Collect reviewer GUIDs and their _formatted names
  const reviewers = [];
  for (let i = 1; i <= 5; i++) {
    const guid = processed[`_wmkf_potentialreviewer${i}_value`];
    const name = processed[`_wmkf_potentialreviewer${i}_value_formatted`];
    if (guid && !/^0{8}-/.test(guid)) {
      reviewers.push({ slot: i, id: guid, name: name || 'Unknown' });
    }
  }

  // If we have GUIDs, batch lookup full reviewer details
  if (reviewers.length > 0) {
    const orClauses = reviewers.map(r => `wmkf_potentialreviewersid eq ${r.id}`).join(' or ');
    const detailResult = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
      select: 'wmkf_name,wmkf_title,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_areaofexpertise,wmkf_potentialreviewersid',
      filter: orClauses,
      top: 5,
    });

    // Merge details back
    const detailMap = {};
    for (const r of detailResult.records) {
      detailMap[r.wmkf_potentialreviewersid] = r;
    }

    for (const rev of reviewers) {
      const detail = detailMap[rev.id];
      if (detail) {
        rev.title = detail.wmkf_title || '';
        rev.email = detail.wmkf_emailaddress || '';
        rev.organization = detail.wmkf_primaryaffiliation || detail.wmkf_organizationname || '';
        rev.expertise = detail.wmkf_areaofexpertise || '';
      }
    }
  }

  const lines = reviewers.map(r => {
    const parts = [`Slot ${r.slot}: ${r.name}`];
    if (r.title) parts.push(r.title);
    if (r.organization) parts.push(r.organization);
    if (r.email) parts.push(r.email);
    if (r.expertise) parts.push(`Expertise: ${r.expertise.substring(0, 100)}`);
    return parts.join(' | ');
  });

  const excluded = processed.wmkf_excludedreviewers || '';

  return {
    requestId,
    reviewerCount: reviewers.length,
    reviewers: lines.join('\n') || 'No reviewers assigned to this request.',
    excludedReviewers: excluded || null,
  };
}

async function handleContactRequests(contactId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_submitdate');
  const contactRoleFields = [
    '_akoya_primarycontactid_value',
    '_wmkf_projectleader_value',
    '_wmkf_researchleader_value',
    '_wmkf_ceo_value',
    '_wmkf_authorizedofficial_value',
    '_wmkf_paymentcontact_value',
    '_wmkf_copi1_value',
    '_wmkf_copi2_value',
    '_wmkf_copi3_value',
    '_wmkf_copi4_value',
    '_wmkf_copi5_value',
  ];
  const roleFilter = contactRoleFields.map(field => `${field} eq ${contactId}`).join(' or ');
  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: `akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,akoya_paid,wmkf_request_type,_akoya_applicantid_value,_wmkf_grantprogram_value,${contactRoleFields.join(',')}`,
    filter: `(${roleFilter})${dateFilter}`,
    orderby: 'akoya_submitdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_requestnum || '?';
    const status = r.akoya_requeststatus_formatted || r.akoya_requeststatus || '';
    const date = r.akoya_submitdate_formatted || r.akoya_submitdate || '';
    const org = r._akoya_applicantid_value_formatted || '';
    const program = r._wmkf_grantprogram_value_formatted || '';
    const paid = r.akoya_paid_formatted || r.akoya_paid || '';
    const roles = [];
    if (r._akoya_primarycontactid_value === contactId) roles.push('Primary Contact');
    if (r._wmkf_projectleader_value === contactId) roles.push('PI');
    if (r._wmkf_researchleader_value === contactId) roles.push('VPR');
    if (r._wmkf_ceo_value === contactId) roles.push('CEO');
    if (r._wmkf_authorizedofficial_value === contactId) roles.push('Authorized Official');
    if (r._wmkf_paymentcontact_value === contactId) roles.push('Payment Contact');
    for (let i = 1; i <= 5; i++) {
      if (r[`_wmkf_copi${i}_value`] === contactId) roles.push(`Co-PI ${i}`);
    }
    return `Req ${num} | ${status} | ${date} | ${org} | ${program} | ${roles.join(', ') || 'Contact'} | Paid: ${paid}`;
  });

  return {
    contactId,
    requestCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Request# | Status | Submitted | Organization | Program | Contact Role | Paid',
    requests: lines.join('\n') || 'No requests found for this contact.',
  };
}

async function handleReviewerRequests(reviewerId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_submitdate');
  // OR across all 5 reviewer slots
  const orClauses = [1, 2, 3, 4, 5]
    .map(i => `_wmkf_potentialreviewer${i}_value eq ${reviewerId}`)
    .join(' or ');

  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,_akoya_applicantid_value,_wmkf_grantprogram_value',
    filter: `(${orClauses})${dateFilter}`,
    orderby: 'akoya_submitdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_requestnum || '?';
    const status = r.akoya_requeststatus_formatted || r.akoya_requeststatus || '';
    const date = r.akoya_submitdate_formatted || r.akoya_submitdate || '';
    const org = r._akoya_applicantid_value_formatted || '';
    const program = r._wmkf_grantprogram_value_formatted || '';
    return `Req ${num} | ${status} | ${date} | ${org} | ${program}`;
  });

  return {
    reviewerId,
    requestCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Request# | Status | Submitted | Organization | Program',
    requests: lines.join('\n') || 'No requests found for this reviewer.',
  };
}

/**
 * Pure source fencing helpers for the sandbox-only Request clone rehearsal.
 * Source text stays in the private local manifest/body and is never logged.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sameGuid(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

export function validCalendarDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function projectCloneSource(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Source Request is missing or invalid.');
  if (typeof row.akoya_requestid !== 'string' || !GUID.test(row.akoya_requestid)) throw new Error('Source Request identity is invalid.');
  if (!Number.isInteger(row.akoya_requesttype)) throw new Error('Source Request type is invalid.');
  if (row.akoya_purpose != null && (typeof row.akoya_purpose !== 'string' || row.akoya_purpose.length > 100000)) {
    throw new Error('Source Request purpose is invalid or too long.');
  }
  if (row.akoya_request != null && (typeof row.akoya_request !== 'number' || !Number.isFinite(row.akoya_request) || row.akoya_request < 0)) {
    throw new Error('Source Request amount is invalid.');
  }
  const meetingDate = row.wmkf_meetingdate == null || row.wmkf_meetingdate === ''
    ? null : String(row.wmkf_meetingdate).slice(0, 10);
  if (meetingDate !== null && !validCalendarDate(meetingDate)) throw new Error('Source Request meeting date is invalid.');
  const fiscalYear = row.akoya_fiscalyear == null || row.akoya_fiscalyear === '' ? null : row.akoya_fiscalyear;
  if (fiscalYear !== null && (typeof fiscalYear !== 'string' || fiscalYear.length > 80)) {
    throw new Error('Source Request fiscal year is invalid or too long.');
  }
  const revision = row['@odata.etag'] || (row.versionnumber != null ? String(row.versionnumber) : null);
  if (!revision || typeof revision !== 'string' || revision.length > 160) throw new Error('Source Request revision is unavailable.');
  return {
    akoya_requestid: row.akoya_requestid.toLowerCase(),
    akoya_requestnum: row.akoya_requestnum == null ? null : String(row.akoya_requestnum),
    akoya_requesttype: row.akoya_requesttype,
    akoya_purpose: row.akoya_purpose == null || row.akoya_purpose === '' ? null : row.akoya_purpose,
    akoya_request: row.akoya_request ?? null,
    akoya_fiscalyear: fiscalYear,
    wmkf_meetingdate: meetingDate,
    revision,
  };
}

export function requireUniqueSourceRequest(rows, hasContinuation = false) {
  if (!Array.isArray(rows) || hasContinuation || rows.length !== 1) {
    const count = Array.isArray(rows) ? rows.length : 0;
    throw new Error(`Expected exactly one source Request; found ${count}${hasContinuation ? '+' : ''}.`);
  }
  return projectCloneSource(rows[0]);
}

export function resolveCloneCycle(source, overrides = {}) {
  const fiscalYear = overrides.fiscalYear ?? source.akoya_fiscalyear;
  const meetingDate = overrides.meetingDate ?? source.wmkf_meetingdate;
  if (typeof fiscalYear !== 'string' || !fiscalYear.trim() || fiscalYear.length > 80) {
    throw new Error('Source Request has no usable fiscal year; provide --fiscal-year.');
  }
  if (!validCalendarDate(meetingDate)) {
    throw new Error('Source Request has no usable meeting date; provide --meeting-date.');
  }
  return { fiscalYear, meetingDate };
}

export function expectedRequestFolder(requestNumber, requestId) {
  if (!/^\d{1,10}$/.test(String(requestNumber)) || typeof requestId !== 'string' || !GUID.test(requestId)) {
    throw new Error('Request folder identity is invalid.');
  }
  return `${requestNumber}_${requestId.replace(/-/g, '').toUpperCase()}`;
}

export function assertSourceUnchanged(manifestSource, currentSource, grantType) {
  const current = projectCloneSource(currentSource);
  if (!GUID.test(manifestSource?.requestId || '') || current.akoya_requestid !== manifestSource.requestId.toLowerCase()) {
    throw new Error('Source Request identity changed or no longer resolves.');
  }
  if (current.akoya_requesttype !== grantType || current.akoya_requesttype !== manifestSource.requestType) {
    throw new Error('Source Request is no longer the same Grant request.');
  }
  if (current.revision !== manifestSource.revision) throw new Error('Source Request changed since prepare.');
  return current;
}

export function assertCopiedSourceValues(source, body) {
  if ((source.akoya_purpose ?? undefined) !== body.akoya_purpose || (source.akoya_request ?? undefined) !== body.akoya_request) {
    throw new Error('Source Request copied values changed since prepare.');
  }
}

export function verifyCloneRequestReadback(manifest, request) {
  const failures = [];
  if (!sameGuid(request.akoya_requestid, manifest.values.requestId)) failures.push('request GUID mismatch');
  if (request.akoya_title !== manifest.createBody.akoya_title) failures.push('title mismatch');
  if (request.akoya_fiscalyear !== manifest.createBody.akoya_fiscalyear) failures.push('fiscal year mismatch');
  if ((request.akoya_purpose ?? null) !== (manifest.createBody.akoya_purpose ?? null)) failures.push('purpose mismatch');
  if ((request.akoya_request ?? null) !== (manifest.createBody.akoya_request ?? null)) failures.push('requested amount mismatch');
  if (request.akoya_requesttype !== manifest.createBody.akoya_requesttype) failures.push('request type mismatch');
  if (String(request.wmkf_meetingdate || '').slice(0, 10) !== manifest.values.meetingDate) failures.push('meeting date mismatch');
  if (!sameGuid(request._akoya_applicantid_value, manifest.expectedOrganization.accountid)) failures.push('applicant mismatch');
  if (!sameGuid(request._createdby_value, manifest.expectedAppUserId)) failures.push('creator mismatch');
  if (!sameGuid(request._ownerid_value, manifest.expectedAppUserId)) failures.push('owner mismatch');
  if (request.wmkf_istestrequest !== true) failures.push('test marker not true');
  if (!sameGuid(request.wmkf_testcreationrunid, manifest.values.runId)) failures.push('run ID mismatch');
  if (request.wmkf_respondreminderenabled !== false) failures.push('respond reminder not false');
  if (request.wmkf_reviewduereminderenabled !== false) failures.push('review-due reminder not false');
  return failures;
}

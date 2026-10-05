/**
 * Applicant materials collection (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
 * §16, owner decisions M1–M5). The PC starts one collection from a request's
 * scheduled site visit; the PI and liaison receive one shared contributor
 * link; received files are read back from the request-document registry by
 * artifact type and canonical filename, so this service owns process state
 * (checklist, contacts, link, window, receipts), never bytes.
 *
 * Liaison: the Liaison of record (lib/services/contacts/request-liaison.js via
 * site-visit/applicant-contacts.js; the institution Primary Contact for
 * Research). Recipients and {{liaisonFullName}} use the same resolution. The
 * saved `contacts` snapshot records `liaisonStatus`: 'none' sends to the PI
 * only; 'found' without an email refuses (409). A legacy snapshot without a
 * status still requires both recipients until a current resolution refreshes it.
 */
import crypto from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import * as contactAdapter from '../../dataverse/adapters/contact.js';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { ServiceHttpError } from '../service-http-error.js';
import { assertRequestEmailAllowed } from '../test-requests/request-test-state.js';
import { isGuid } from '../../utils/guid.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { mintScopedToken } from '../external-token.js';
import { renderMaterialsEmailHtml } from '../../external/site-visit-materials-email.js';
import { getDueBusinessDays } from './due-date-setting.js';
import { subtractBusinessDays } from '../../utils/business-days.js';
import { isSiteVisitMaterialsSchemaReady } from '../../utils/site-visit-materials-readiness.js';
import { selectActiveSiteVisit } from '../deliberation-briefing/site-visit-selection.js';
import { resolveSiteVisitApplicantContacts } from '../site-visit/applicant-contacts.js';
import { resolveRequestLiaison } from '../contacts/request-liaison.js';
import { readRequiredEmailDefaults } from '../email-defaults.js';
import { resolveSystemUserToProfile } from '../dataverse-identity-map.js';
import { DatabaseService } from '../database-service.js';
import { resolveSignatureForProfile } from '../email-signature.js';
import { PREFERENCE_KEYS, readEmailSignaturePreference } from '../../../shared/config/reviewerFinderPreferences.js';
import { isVisibleRequestRow } from '../../../shared/config/workbenchVisibility.js';
import { classifyEmailDispatchError } from '../../../shared/utils/email-send-outcome.js';
import {
  MATERIALS_EMAIL_KINDS,
  loadPersonalMaterialsTemplate,
  mergeMaterialsEmailTemplate,
  validateMaterialsEmailTemplate,
  materialsPreviewDigest,
  mintMaterialsPreviewProof,
} from './email-personalization.js';
import {
  SITE_VISIT_MATERIALS_AUDIENCE,
  SITE_VISIT_MATERIALS_CHECKLIST,
  SITE_VISIT_MATERIALS_CLOSE_AFTER_DAYS,
  SITE_VISIT_MATERIALS_STATUS,
} from '../../../shared/config/siteVisitMaterials.js';
import * as store from './collection-store.js';
import { listMaterialsUploadJobsForRequest } from './background-job-store.js';
import { isMaterialsBackgroundSchemaReady } from '../../utils/site-visit-materials-background-readiness.js';
import { sanitizeSiteVisitMaterialsScanRejection } from '../../../shared/utils/site-visit-materials-scan-rejection.js';
import { canonicalFilename, matchReceivedFiles } from './materials-matching.js';
export { canonicalFilename, matchReceivedFiles } from './materials-matching.js';

const PUBLIC_UPLOAD_JOB_ERROR_CODES = new Set([
  'infected', 'invalid_file', 'size_limit', 'processing_deadline', 'storage_unavailable', 'coordinator_action_required',
]);
const ACTIVE_UPLOAD_JOB_STATUSES = new Set(['queued', 'processing', 'needs_attention']);

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'wmkf_meetingdate',
  'akoya_requeststatus', 'wmkf_triagestatus', '_akoya_applicantid_value', '_akoya_programid_value',
  '_wmkf_projectleader_value', '_akoya_primarycontactid_value', '_wmkf_programcoordinator_value',
];
const CONTRIBUTOR_OPS = Object.freeze(['upload_materials']);
const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_SUBJECT_KEY = 'email.site_visit_materials_invite.subject';
const INVITE_BODY_KEY = 'email.site_visit_materials_invite.body';
const REMINDER_SUBJECT_KEY = 'email.site_visit_materials_reminder.subject';
const REMINDER_BODY_KEY = 'email.site_visit_materials_reminder.body';

async function resolveMaterialsTemplate(kind, profileId, provided, dependencies) {
  const keys = kind === MATERIALS_EMAIL_KINDS.invitation
    ? [INVITE_SUBJECT_KEY, INVITE_BODY_KEY]
    : [REMINDER_SUBJECT_KEY, REMINDER_BODY_KEY];
  const defaults = await requiredDefaults(keys, `site-visit-materials:${kind}`, dependencies);
  const shared = kind === MATERIALS_EMAIL_KINDS.invitation
    ? { subject: defaults[INVITE_SUBJECT_KEY], body: defaults[INVITE_BODY_KEY] }
    : { subject: defaults[REMINDER_SUBJECT_KEY], body: defaults[REMINDER_BODY_KEY] };
  const personal = profileId ? await loadPersonalMaterialsTemplate(profileId, kind) : null;
  const template = provided || mergeMaterialsEmailTemplate(shared, personal);
  const checked = validateMaterialsEmailTemplate(kind, template);
  if (!checked.valid) throw materialsError('The email template is invalid.', 'site_visit_materials_email_template_invalid', 400, { issues: checked.errors });
  return checked.value;
}

export const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isSiteVisitMaterialsSchemaReady,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findActiveSiteVisit: async (requestId) => {
    const { records } = await siteVisitAdapter.findActiveByRequest(requestId);
    return selectActiveSiteVisit(records);
  },
  resolveRecipients: (requestId, request) => resolveSiteVisitApplicantContacts({ requestId, request }),
  findDocumentsByRequest: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  getOpenCollection: store.getOpenCollectionForRequest,
  getLatestCollection: store.getLatestCollectionForRequest,
  backgroundJobsSchemaReady: isMaterialsBackgroundSchemaReady,
  listUploadJobsForRequest: listMaterialsUploadJobsForRequest,
  insertCollection: store.insertCollection,
  recordInvitation: store.recordInvitation,
  updateContacts: store.updateContacts,
  claimManualReminder: store.claimManualReminder,
  attachReminderEmailId: store.attachReminderEmailId,
  updateChecklist: store.updateChecklist,
  markReady: store.markReady,
  reopenFromReady: store.reopenFromReady,
  mint: mintScopedToken,
  seal: encrypt,
  unseal: decrypt,
  randomUUID: () => crypto.randomUUID(),
  now: () => new Date(),
  readEmailDefaults: readRequiredEmailDefaults,
  getDueBusinessDays,
  resolvePcSignature: async (actorId) => {
    const user = await systemUserAdapter.getByIdWithSelect(actorId, 'systemuserid,fullname,internalemailaddress,isdisabled');
    if (!user?.internalemailaddress || user.isdisabled === true) {
      throw materialsError('The sending PC signature is unavailable.', 'site_visit_materials_signature_unavailable', 503);
    }
    const profileId = await resolveSystemUserToProfile(actorId).catch(() => null);
    const preferences = profileId ? await DatabaseService.getUserPreferences(profileId, false).catch(() => ({})) : {};
    const saved = readEmailSignaturePreference(preferences);
    return resolveSignatureForProfile({
      [PREFERENCE_KEYS.EMAIL_SIGNATURE]: {
        ...saved,
        name: saved.name || user.fullname || user.internalemailaddress,
        email: saved.email || user.internalemailaddress,
      },
    }).signature;
  },
  resolveMaterialNames: async ({ request }) => {
    let liaisonOfRecord;
    try {
      liaisonOfRecord = await resolveRequestLiaison(request);
    } catch (error) {
      console.error('[site-visit-materials] Liaison read failed:', error?.message || error);
      throw materialsError('The Liaison could not be verified. Refresh the preview or try again.', 'site_visit_primary_contact_unavailable', 503);
    }
    const [pi, liaison, coordinator] = await Promise.all([
      request._wmkf_projectleader_value ? contactAdapter.getByIdWithSelect(request._wmkf_projectleader_value, ['contactid', 'lastname', 'emailaddress1']) : null,
      liaisonOfRecord.status === 'found' ? contactAdapter.getByIdWithSelect(liaisonOfRecord.contactId, ['contactid', 'fullname', 'emailaddress1']) : null,
      request._wmkf_programcoordinator_value ? systemUserAdapter.getByIdWithSelect(request._wmkf_programcoordinator_value, 'systemuserid,fullname,isdisabled') : null,
    ]);
    return {
      piLastName: pi?.lastname || '',
      piEmail: pi?.emailaddress1 || '',
      liaisonFullName: liaison?.fullname || '',
      liaisonEmail: liaison?.emailaddress1 || '',
      programCoordinatorName: coordinator?.fullname || '',
    };
  },
  sendEmail: async ({ subject, bodyText, from, to, cc, correlationKey, actingUserSystemId, url, buttonLabel, regardingId }) => {
    if (!isGuid(regardingId || '')) throw nonDispatchedMaterialsError('A valid Request is required for this materials email.', 'site_visit_materials_request_invalid', 400);
    const emailId = await emailActivityAdapter.create({
      subject, body: renderMaterialsEmailHtml({ bodyText, url, buttonLabel }), from, to, cc,
      regardingId, regardingType: 'akoya_request', correlationKey, actingUserSystemId, noFallback: true,
    });
    try {
      await emailActivityAdapter.send(emailId, { actingUserSystemId });
    } catch (error) {
      if (error && typeof error === 'object') {
        try {
          error.emailId ||= emailId;
        } catch {
          // Preserve the original transport error even if it is non-extensible.
        }
      }
      throw error;
    }
    return emailId;
  },
  buildContributorUrl: (jwt) => `${externalBaseUrl()}/external/materials/${encodeURIComponent(jwt)}`,
});

function externalBaseUrl() {
  const raw = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  return String(raw).replace(/\/+$/, '');
}

function materialsError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, { httpStatus, code, body: { error: message, code, ...extras } });
}

function nonDispatchedMaterialsError(message, code, httpStatus = 409) {
  return Object.assign(materialsError(message, code, httpStatus), { dispatched: false });
}

function assertReady(dependencies) {
  if (!dependencies.schemaReady()) {
    throw materialsError('Applicant materials collection is not enabled for this environment.', 'site_visit_materials_schema_not_ready', 503);
  }
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function assertMatchingRequestIds(expectedId, actualId) {
  if (!isGuid(expectedId || '') || !isGuid(actualId || '')) {
    throw nonDispatchedMaterialsError('A valid Request is required for this materials email.', 'site_visit_materials_request_invalid', 400);
  }
  if (String(expectedId).trim().toLowerCase() !== String(actualId).trim().toLowerCase()) {
    throw nonDispatchedMaterialsError('The materials collection is bound to a different Request. Reload the Request and try again.', 'site_visit_materials_request_mismatch', 409);
  }
}

function normalizedRecipients(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))].sort();
}

function splitMaterialRecipients(contacts) {
  const people = Array.isArray(contacts) ? contacts : contactList(contacts);
  const pi = people.find((person) => person.role === 'pi' && person.email);
  const liaison = people.find((person) => person.role === 'liaison' && person.email);
  const to = pi?.email ? [pi.email] : (people[0]?.email ? [people[0].email] : []);
  const cc = liaison?.email && !to.some((email) => String(email).toLowerCase() === String(liaison.email).toLowerCase()) ? [liaison.email] : [];
  return { to, cc };
}

function hashToken(jwt) {
  return crypto.createHash('sha256').update(String(jwt)).digest('hex');
}

function projectChecklist(checklist, received) {
  return (checklist || []).map((item) => ({
    key: item.key,
    label: item.label,
    required: item.required === true,
    waived: item.waived === true,
    received: received[item.key] || null,
  }));
}

function contactList(contacts) {
  return ['pi', 'liaison']
    .filter((role) => contacts?.[role]?.email)
    .map((role) => ({ role, name: contacts[role].name || contacts[role].email, email: contacts[role].email }));
}

// Only an explicit liaisonStatus 'none' (a successful read found no Liaison)
// allows a PI-only send. 'found' without an email, and a legacy snapshot with
// no status, still require the Liaison's email.
function requireMaterialRecipients(contacts) {
  const roles = contacts?.liaisonStatus === 'none' ? ['pi'] : ['pi', 'liaison'];
  const missing = roles.filter((role) => !String(contacts?.[role]?.email || '').trim());
  if (missing.length) {
    throw materialsError(
      `Add an email address for the ${missing.map((role) => role === 'pi' ? 'project leader' : 'Liaison (the institution\'s Primary Contact)').join(' and ')} in AkoyaGo, then refresh the preview.`,
      'site_visit_materials_recipients_required', 409, { missingRoles: missing },
    );
  }
  return contactList(contacts);
}

function snapshotContacts(resolved) {
  const liaisonStatus = resolved?.liaisonStatus === 'none' ? 'none' : 'found';
  const person = (role) => (resolved?.[role]
    ? { role, name: resolved[role].name || null, email: resolved[role].email || null }
    : null);
  return { pi: person('pi'), liaison: liaisonStatus === 'none' ? null : person('liaison'), liaisonStatus };
}

async function currentContacts(requestId, request, dependencies) {
  const contacts = snapshotContacts(await dependencies.resolveRecipients(requestId, request));
  requireMaterialRecipients(contacts);
  return contacts;
}

/**
 * The current contact snapshot for a collection's request, resolved and
 * checked exactly as the manual invite and remind do (the automatic sweep's
 * refresh). Throws the 409 `site_visit_materials_recipients_required` when a
 * required email is missing, and the resolver's error when a read fails.
 */
export async function resolveCurrentMaterialsContacts({ requestId, request }, dependencies = DEFAULT_DEPENDENCIES) {
  return currentContacts(requestId, request, dependencies);
}

function projectUploadJobs(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((job) => ({
    jobId: job.job_id || job.jobId,
    slot: job.slot,
    status: job.status,
    filename: job.filename || null,
    createdAt: job.created_at || job.createdAt || null,
    updatedAt: job.updated_at || job.updatedAt || null,
    attemptCount: Number(job.attempt_count ?? job.attemptCount ?? 0),
    errorCode: (job.error_code || job.errorCode) === 'scan_infected'
      ? 'infected'
      : PUBLIC_UPLOAD_JOB_ERROR_CODES.has(job.error_code || job.errorCode)
        ? (job.error_code || job.errorCode)
        : null,
    ...(['failed', 'needs_attention'].includes(job.status) && ['scan_infected', 'infected'].includes(job.error_code || job.errorCode)
      ? { scanRejection: sanitizeSiteVisitMaterialsScanRejection(job.scan_rejection || job.scanRejection) }
      : {}),
  })).filter((job) => typeof job.jobId === 'string' && typeof job.slot === 'string' && typeof job.status === 'string');
}

async function readUploadJobs(requestId, collectionId, dependencies) {
  if (!dependencies.backgroundJobsSchemaReady?.()) return [];
  const rows = await dependencies.listUploadJobsForRequest(requestId, { collectionIds: collectionId ? [collectionId] : [] });
  if (!Array.isArray(rows)) throw materialsError('Upload status is temporarily unavailable. Refresh and try again.', 'site_visit_materials_upload_status_unavailable', 503);
  return projectUploadJobs(rows);
}

export function projectCollection(row, { received = {}, other = [], uploadJobs = [], uploadStatusUnavailable = false, now = new Date(), contributorUrl = null } = {}) {
  if (!row) return null;
  const jobs = projectUploadJobs(uploadJobs);
  const processingCount = jobs.filter((job) => job.status === 'queued' || job.status === 'processing').length;
  const attentionCount = jobs.filter((job) => job.status === 'needs_attention').length;
  const checklist = projectChecklist(row.checklist, received);
  const requiredOpen = checklist.filter((item) => item.required && !item.waived);
  const missing = requiredOpen.filter((item) => !item.received).map((item) => item.key);
  const closed = row.status === SITE_VISIT_MATERIALS_STATUS.CLOSED || new Date(row.closes_at).getTime() <= now.getTime();
  const state = closed ? 'closed'
    : attentionCount ? 'needs_attention'
      : processingCount ? 'processing'
    : row.status === SITE_VISIT_MATERIALS_STATUS.READY ? 'ready'
      : missing.length ? 'missing' : 'received';
  return {
    id: row.id,
    requestId: row.request_id,
    siteVisitActivityId: row.site_visit_activity_id,
    status: row.status,
    state,
    dueAt: new Date(row.due_at).toISOString(),
    closesAt: new Date(row.closes_at).toISOString(),
    overdue: state === 'missing' && new Date(row.due_at).getTime() < now.getTime(),
    checklist,
    missing,
    other,
    uploadJobs: jobs,
    uploadStatusUnavailable: Boolean(uploadStatusUnavailable),
    processingCount,
    attentionCount,
    contacts: row.contacts || {},
    invitedAt: row.invited_at ? new Date(row.invited_at).toISOString() : null,
    lastReminderAt: row.last_reminder_at ? new Date(row.last_reminder_at).toISOString() : null,
    reminderCount: Number(row.reminder_count || 0),
    readyConfirmedAt: row.ready_confirmed_at ? new Date(row.ready_confirmed_at).toISOString() : null,
    contributorUrl,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Staff-visible summary of a projected collection: state, counts, and the
 * window only. No contributor link and no contacts, so it is safe to attach
 * to payloads outside the tracker grant (Staff Deliberations tab, cycle view).
 */
export function summarizeCollection(collection) {
  if (!collection) return null;
  const required = collection.checklist.filter((item) => item.required && !item.waived);
  return {
    state: collection.state,
    processingCount: Number(collection.processingCount || 0),
    attentionCount: Number(collection.attentionCount || 0),
    receivedCount: required.filter((item) => item.received).length,
    requiredCount: required.length,
    otherCount: collection.other.length,
    dueAt: collection.dueAt,
    closesAt: collection.closesAt,
    overdue: collection.overdue,
    invited: Boolean(collection.invitedAt),
  };
}

function formatWhen(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(new Date(date));
  } catch {
    return new Date(date).toDateString();
  }
}

function fillEmailTemplate(template, values) {
  return String(template).replace(/\{\{([A-Za-z]+)\}\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : token
  ));
}

async function requiredDefaults(keys, source, dependencies) {
  const result = await dependencies.readEmailDefaults(keys, { source });
  if (!result?.ok || keys.some((key) => typeof result.values?.[key] !== 'string' || !result.values[key].trim())) {
    throw materialsError('Required email defaults are unavailable. Ask an admin to check Email defaults.', 'site_visit_materials_email_defaults_unavailable', 503);
  }
  return result.values;
}

async function signatureForTemplate(template, actorId, dependencies) {
  return String(template).includes('{{signature}}') ? dependencies.resolvePcSignature(actorId) : '';
}

async function namesForTemplate(template, request, dependencies, recipients = []) {
  const usesNames = ['piLastName', 'liaisonFullName', 'programCoordinatorName'].some((token) => String(template || '').includes(`{{${token}}}`));
  if (!usesNames) return {};
  if (typeof dependencies.resolveMaterialNames !== 'function') throw materialsError('This email uses personal name placeholders, but the recipient names could not be resolved. Remove the placeholders or try again.', 'site_visit_materials_email_name_unavailable', 409);
  const names = await dependencies.resolveMaterialNames({ request, recipients });
  const pi = recipients.find((person) => person.role === 'pi');
  if (String(template || '').includes('{{piLastName}}')) {
    if (!pi?.email || !names.piEmail) {
      throw materialsError('The project leader email could not be verified. Refresh the preview or remove {{piLastName}}.', 'site_visit_materials_email_name_unavailable', 409, { token: 'piLastName' });
    }
    if (String(pi.email).trim().toLowerCase() !== String(names.piEmail).trim().toLowerCase()) {
      throw materialsError('The project leader changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    }
  }
  const liaison = recipients.find((person) => person.role === 'liaison');
  if (String(template || '').includes('{{liaisonFullName}}')) {
    if (!liaison?.email) {
      throw materialsError('The institution has no Primary Contact (Liaison), so {{liaisonFullName}} cannot be filled. Remove the placeholder or set the institution\'s Primary Contact in AkoyaGo.', 'site_visit_materials_email_name_unavailable', 409, { token: 'liaisonFullName' });
    }
    if (liaison?.name && String(liaison.name).trim() && String(liaison.name).trim().toLowerCase() !== String(liaison.email).trim().toLowerCase()) {
      names.liaisonFullName = liaison.name;
    } else if (!names.liaisonEmail || String(liaison.email).trim().toLowerCase() !== String(names.liaisonEmail).trim().toLowerCase()) {
      throw materialsError('The primary contact name is unavailable. Add a name in AkoyaGo or remove {{liaisonFullName}} before sending.', 'site_visit_materials_email_name_unavailable', 409, { token: 'liaisonFullName' });
    }
  }
  for (const token of ['piLastName', 'liaisonFullName', 'programCoordinatorName']) {
    if (String(template || '').includes(`{{${token}}}`) && !String(names[token] || '').trim()) {
      throw materialsError(`The email uses {{${token}}}, but that name is unavailable. Update the request contact or remove the placeholder before sending.`, 'site_visit_materials_email_name_unavailable', 409, { token });
    }
  }
  return names;
}

function assertPreparedNames(preparedEmail, names) {
  if (!preparedEmail?.names) return;
  for (const token of ['piLastName', 'liaisonFullName', 'programCoordinatorName']) {
    if (preparedEmail.names[token] !== names[token]) throw materialsError('A recipient or coordinator name changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  }
}

export function invitationBodyText({ bodyTemplate, institution, title, visitStartIso, timeZone, dueAt, checklist, uploadLink = '', signature = '', names = {} }) {
  const items = checklist.filter((item) => !item.waived).map((item) => `  - ${item.label}${item.required ? '' : ' (optional)'}`).join('\n');
  return fillEmailTemplate(bodyTemplate, {
    proposalTitle: title,
    institution,
    visitDate: formatWhen(visitStartIso, timeZone),
    dueDate: formatWhen(dueAt, timeZone),
    checklist: items,
    uploadLink,
    signature,
    ...names,
  });
}

export function reminderBodyText({ bodyTemplate, institution, title, visitStartIso, timeZone, dueAt, missing, uploadLink = '', signature = '', names = {} }) {
  const items = missing.map((item) => `  - ${item.label}`).join('\n');
  return fillEmailTemplate(bodyTemplate, {
    proposalTitle: title,
    institution,
    visitDate: formatWhen(visitStartIso, timeZone),
    dueDate: formatWhen(dueAt, timeZone),
    missingItemsGrammar: missing.length === 1 ? 'item is' : 'items are',
    missingItems: items,
    uploadLink,
    signature,
    ...names,
  });
}

async function loadContext(requestId, dependencies) {
  if (!isGuid(requestId)) throw materialsError('A valid requestId is required.', 'site_visit_materials_request_invalid', 400);
  const request = await dependencies.getRequest(requestId);
  if (!request?.akoya_requestid) throw materialsError('Request not found.', 'site_visit_materials_request_not_found', 404);
  return request;
}

function institutionOf(request) {
  return request._akoya_applicantid_value_formatted || request['_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue'] || 'the applicant institution';
}

function unsealUrl(row, dependencies) {
  try {
    return dependencies.buildContributorUrl(dependencies.unseal(row.token_ciphertext));
  } catch {
    return null;
  }
}

/** Add stored file links only to staff receipts, never the shared matcher. */
function matchStaffReceivedFiles(rows, requestId, requestNumber) {
  const matched = matchReceivedFiles(rows, requestId, requestNumber);
  const withLink = (receipt) => {
    if (!receipt) return null;
    const row = (rows || []).find((candidate) => sameId(candidate.wmkf_requestdocumentid, receipt.artifactId)
      && sameId(candidate._wmkf_request_value, requestId));
    let webUrl = null;
    try {
      const url = new URL(row?.wmkf_sharepointweburl);
      if (url.protocol === 'https:' && !url.username && !url.password) webUrl = url.toString();
    } catch { /* Legacy receipts may have no usable URL. */ }
    return { ...receipt, webUrl };
  };
  return {
    received: Object.fromEntries(Object.entries(matched.received).map(([key, receipt]) => [key, withLink(receipt)])),
    other: matched.other.map(withLink),
  };
}

/** Staff read: the current (or latest) collection with the registry joined in. */
export async function getMaterialsCollection({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  const request = await loadContext(requestId, dependencies);
  const row = (await dependencies.getOpenCollection(requestId)) || (await dependencies.getLatestCollection(requestId));
  if (!row) return { collection: null };
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const { received, other } = matchStaffReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  const uploadJobs = await readUploadJobs(requestId, row.id, dependencies);
  return { collection: projectCollection(row, { received, other, uploadJobs, now: dependencies.now(), contributorUrl: unsealUrl(row, dependencies) }) };
}

/**
 * Start a collection from the request's active site visit and send the
 * invitation to the PI and liaison. The row exists before the email so a
 * transport failure leaves a collection the PC can invite again.
 */
export async function createMaterialsCollection({ requestId, actorId, profileId, fromEmail, emailTemplate, preparedEmail }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(actorId || '')) throw materialsError('Your staff account is not linked to a Dynamics identity.', 'site_visit_materials_actor_required', 403);
  const request = await loadContext(requestId, dependencies);
  assertMatchingRequestIds(requestId, request.akoya_requestid);
  if (!request.wmkf_meetingdate || !isVisibleRequestRow(request, false)) {
    throw materialsError('Materials can be collected only for an advancing request in a cycle.', 'site_visit_materials_request_not_schedulable');
  }
  const visit = await dependencies.findActiveSiteVisit(requestId);
  if (!visit?.activityid || !visit.scheduledstart) {
    throw materialsError('Schedule the site visit first; the due date comes from it.', 'site_visit_materials_visit_required');
  }
  if (preparedEmail?.visitSnapshot && (preparedEmail.visitSnapshot.id !== visit.activityid || preparedEmail.visitSnapshot.start !== visit.scheduledstart || preparedEmail.visitSnapshot.end !== (visit.scheduledend || null) || preparedEmail.visitSnapshot.timeZone !== (visit.wmkf_ianatimezone || 'America/Los_Angeles'))) throw materialsError('The site visit changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  if (await dependencies.getOpenCollection(requestId)) {
    throw materialsError('A materials collection is already open for this request.', 'site_visit_materials_exists');
  }
  const contacts = await currentContacts(requestId, request, dependencies);
  const recipients = contactList(contacts);
  await assertRequestEmailAllowed(requestId, { recipients: recipients.map((person) => person.email) });
  if (preparedEmail) {
    const expected = normalizedRecipients(preparedEmail.recipients);
    const actual = normalizedRecipients(recipients.map((person) => person.email));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw materialsError('The reviewed recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    const envelope = splitMaterialRecipients(recipients);
    if (preparedEmail.toRecipients && JSON.stringify(normalizedRecipients(preparedEmail.toRecipients)) !== JSON.stringify(normalizedRecipients(envelope.to))) throw materialsError('The reviewed To recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    if (preparedEmail.ccRecipients && JSON.stringify(normalizedRecipients(preparedEmail.ccRecipients)) !== JSON.stringify(normalizedRecipients(envelope.cc))) throw materialsError('The reviewed Cc recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  }
  const inviteDefaults = emailTemplate || preparedEmail?.template;
  if (preparedEmail?.names && inviteDefaults) assertPreparedNames(preparedEmail, await namesForTemplate(inviteDefaults.body, request, dependencies, recipients));
  const timeZone = visit.wmkf_ianatimezone || 'America/Los_Angeles';
  const visitStart = new Date(visit.scheduledstart);
  const visitEnd = new Date(visit.scheduledend || visit.scheduledstart);
  const dueAt = subtractBusinessDays(visitStart, (await dependencies.getDueBusinessDays()).dueBusinessDays, timeZone);
  if (preparedEmail?.dueAt && String(preparedEmail.dueAt) !== String(dueAt)) throw materialsError('The collection window changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const closesAt = new Date(visitEnd.getTime() + SITE_VISIT_MATERIALS_CLOSE_AFTER_DAYS * DAY_MS);
  if (!dueAt || closesAt.getTime() <= dueAt.getTime()) {
    throw materialsError('The site visit dates do not allow a collection window.', 'site_visit_materials_window_invalid');
  }
  const checklist = SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false }));
  const { jwt, jti, hash } = await dependencies.mint({
    subject: requestId, audience: SITE_VISIT_MATERIALS_AUDIENCE, ops: [...CONTRIBUTOR_OPS], expiresAt: closesAt,
  });
  let row;
  try {
    row = await dependencies.insertCollection({
    id: dependencies.randomUUID(),
    requestId,
    siteVisitActivityId: visit.activityid,
    dueAt,
    closesAt,
    checklist,
    contacts,
    jti,
    tokenDigest: hash || hashToken(jwt),
    tokenCiphertext: dependencies.seal(jwt),
    createdBy: actorId,
    });
  } catch (error) {
    if (error?.code === '23505' || error?.code === 'site_visit_materials_exists') throw materialsError('A materials collection was created while this preview was open. Reload the request.', 'site_visit_materials_exists', 409);
    throw error;
  }
  if (!row) throw materialsError('The collection could not be recorded.', 'site_visit_materials_persist_failed', 502);
  const url = dependencies.buildContributorUrl(jwt);
  const invitation = await sendInvitation({ row, request, visit, timeZone, url, recipients, fromEmail, actorId, profileId, emailTemplate, preparedEmail }, dependencies);
  const invited = invitation.row;
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const { received, other } = matchStaffReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  let uploadJobs = [];
  let uploadStatusUnavailable = false;
  try {
    uploadJobs = await readUploadJobs(requestId, row.id, dependencies);
  } catch (error) {
    // Creation and invitation are already durable; a status read must not
    // turn that completed action into an apparent create failure.
    uploadStatusUnavailable = true;
    console.error('[site-visit-materials] post-create upload status unavailable:', error?.message || error);
  }
  return {
    collection: projectCollection(invited || row, { received, other, uploadJobs, uploadStatusUnavailable, now: dependencies.now(), contributorUrl: url }),
    invitationSent: Boolean(invited?.invited_at),
    invitationOutcome: invitation.outcome,
  };
}

async function sendInvitation({ row, request, visit, timeZone, url, recipients, fromEmail, actorId, profileId, emailTemplate, preparedEmail }, dependencies, { propagateConfigError = false } = {}) {
  let emailId = null;
  try {
    assertMatchingRequestIds(request.akoya_requestid, row?.request_id);
    const expectedRecipients = normalizedRecipients(preparedEmail?.recipients);
    const actualRecipients = normalizedRecipients(recipients.map((person) => person.email));
    const envelope = splitMaterialRecipients(recipients);
    if (preparedEmail && JSON.stringify(expectedRecipients) !== JSON.stringify(actualRecipients)) {
      throw materialsError('The reviewed recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    }
    if (preparedEmail?.toRecipients && JSON.stringify(normalizedRecipients(preparedEmail.toRecipients)) !== JSON.stringify(normalizedRecipients(envelope.to))) throw materialsError('The reviewed To recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    if (preparedEmail?.ccRecipients && JSON.stringify(normalizedRecipients(preparedEmail.ccRecipients)) !== JSON.stringify(normalizedRecipients(envelope.cc))) throw materialsError('The reviewed Cc recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    const defaults = preparedEmail ? null : await resolveMaterialsTemplate(MATERIALS_EMAIL_KINDS.invitation, profileId, emailTemplate, dependencies);
    const names = defaults ? await namesForTemplate(defaults.body, request, dependencies, recipients) : {};
    const bodyText = preparedEmail?.bodyText
      ? String(preparedEmail.bodyText).replaceAll('[secure link generated when you send]', url)
      : invitationBodyText({
      bodyTemplate: defaults.body,
      institution: institutionOf(request), title: request.akoya_title || 'your proposal',
      visitStartIso: visit.scheduledstart, timeZone, dueAt: row.due_at,
      checklist: row.checklist, uploadLink: url,
      signature: await signatureForTemplate(defaults.body, actorId, dependencies),
      names,
      });
    emailId = await dependencies.sendEmail({
      subject: preparedEmail?.subject || fillEmailTemplate(defaults.subject, { proposalTitle: request.akoya_title || request.akoya_requestnum }),
      bodyText,
      url,
      buttonLabel: 'Upload site visit materials',
      from: fromEmail,
      to: envelope.to,
      cc: envelope.cc,
      regardingId: request.akoya_requestid,
      correlationKey: `wmkf-site-visit-materials-invite:${row.id}`,
      actingUserSystemId: actorId,
    });
    return { row: await dependencies.recordInvitation(row.id, emailId), outcome: 'sent' };
  } catch (error) {
    if (error?.code === 'site_visit_materials_preview_stale') throw error;
    if (propagateConfigError && error?.code === 'site_visit_materials_email_defaults_unavailable') throw error;
    const classification = classifyEmailDispatchError(error);
    console.error('[site-visit-materials] invitation send failed:', error?.message || error);
    return {
      row: null,
      outcome: classification.outcome,
      retryable: classification.retryable,
      emailId: classification.emailId || emailId,
    };
  }
}

/** Send (or re-send) the invitation for an existing open collection. */
export async function inviteMaterialsContributors({ requestId, actorId, profileId, fromEmail, emailTemplate, preparedEmail }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(actorId || '')) throw materialsError('Your staff account is not linked to a Dynamics identity.', 'site_visit_materials_actor_required', 403);
  const request = await loadContext(requestId, dependencies);
  assertMatchingRequestIds(requestId, request.akoya_requestid);
  const row = await dependencies.getOpenCollection(requestId);
  if (!row) throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  assertMatchingRequestIds(requestId, row.request_id);
  if (preparedEmail?.collectionId && String(preparedEmail.collectionId) !== String(row.id)) throw materialsError('The reviewed collection changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const visit = await dependencies.findActiveSiteVisit(requestId);
  if (!visit?.scheduledstart) throw materialsError('The site visit is no longer scheduled.', 'site_visit_materials_visit_required');
  if (preparedEmail?.visitSnapshot && (preparedEmail.visitSnapshot.id !== visit.activityid || preparedEmail.visitSnapshot.start !== visit.scheduledstart || preparedEmail.visitSnapshot.end !== (visit.scheduledend || null) || preparedEmail.visitSnapshot.timeZone !== (visit.wmkf_ianatimezone || 'America/Los_Angeles'))) throw materialsError('The site visit changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const contacts = await currentContacts(requestId, request, dependencies);
  const recipients = contactList(contacts);
  await assertRequestEmailAllowed(requestId, { recipients: recipients.map((person) => person.email) });
  if (preparedEmail) {
    const envelope = splitMaterialRecipients(recipients);
    if (JSON.stringify(normalizedRecipients(preparedEmail.toRecipients)) !== JSON.stringify(normalizedRecipients(envelope.to))
      || JSON.stringify(normalizedRecipients(preparedEmail.ccRecipients)) !== JSON.stringify(normalizedRecipients(envelope.cc))) {
      throw materialsError('The reviewed recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
    }
  }
  const preparedTemplate = emailTemplate || preparedEmail?.template;
  if (preparedEmail?.names && preparedTemplate) assertPreparedNames(preparedEmail, await namesForTemplate(preparedTemplate.body, request, dependencies, recipients));
  const url = unsealUrl(row, dependencies);
  if (!url) throw materialsError('The contributor link can no longer be read. Start a new collection.', 'site_visit_materials_link_unreadable');
  if (!preparedEmail) await resolveMaterialsTemplate(MATERIALS_EMAIL_KINDS.invitation, profileId, emailTemplate, dependencies);
  const updated = await dependencies.updateContacts(row.id, row.contacts, contacts);
  if (!updated) throw materialsError('The collection recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const invitation = await sendInvitation({ row: updated, request, visit, timeZone: visit.wmkf_ianatimezone || 'America/Los_Angeles', url, recipients, fromEmail, actorId, profileId, emailTemplate, preparedEmail }, dependencies, { propagateConfigError: true });
  if (!invitation.row) {
    const uncertain = invitation.outcome === 'uncertain';
    throw materialsError(
      uncertain ? 'Dynamics may have accepted the invitation, but the result could not be confirmed.' : 'The invitation could not be sent. Try again.',
      uncertain ? 'site_visit_materials_send_unconfirmed' : 'site_visit_materials_send_failed',
      uncertain ? 202 : 502,
      { outcome: invitation.outcome, retryable: invitation.retryable, ...(invitation.emailId ? { emailId: invitation.emailId } : {}) },
    );
  }
  return getMaterialsCollection({ requestId }, dependencies);
}

/**
 * Reminder naming exactly the missing required items; refuses when nothing is
 * missing. Claim-before-send (S507), same sequencing as the automatic sweep
 * (`reminder-sweep.js`): resolve everything the send needs, then claim, then
 * send, then attach the email id — so a PC click during the daily cron run
 * can never produce two reminder emails. A send failure after the claim is
 * at-most-once: it propagates and the claim is not undone. Manual reminders
 * may send for test Requests when every current recipient is allowlisted; the
 * automatic sweep continues to skip all test Requests before preparation.
 */
export async function remindMaterialsContributors({ requestId, actorId, profileId, fromEmail, emailTemplate, preparedEmail }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(actorId || '')) throw materialsError('Your staff account is not linked to a Dynamics identity.', 'site_visit_materials_actor_required', 403);
  const request = await loadContext(requestId, dependencies);
  assertMatchingRequestIds(requestId, request.akoya_requestid);
  const row = await dependencies.getOpenCollection(requestId);
  if (!row) throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  assertMatchingRequestIds(requestId, row.request_id);
  if (preparedEmail?.collectionId && String(preparedEmail.collectionId) !== String(row.id)) throw materialsError('The reviewed collection changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const { received } = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  const jobs = await readUploadJobs(requestId, row.id, dependencies);
  const activeJobSlots = new Set(jobs.filter((job) => ACTIVE_UPLOAD_JOB_STATUSES.has(job.status)).map((job) => job.slot));
  const missing = missingRequiredItems(row, received, { mode: 'reminder_actionable', activeJobSlots });
  if (preparedEmail?.missingKeys && JSON.stringify([...preparedEmail.missingKeys].sort()) !== JSON.stringify(missing.map((item) => item.key).sort())) {
    throw materialsError('The missing-item list changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  }
  if (missing.length === 0) throw materialsError('Every required item has been received; nothing to remind about.', 'site_visit_materials_nothing_missing');
  const visit = await dependencies.findActiveSiteVisit(requestId);
  if (!visit?.scheduledstart) throw materialsError('The site visit is no longer scheduled.', 'site_visit_materials_visit_required');
  if (preparedEmail?.visitSnapshot && (preparedEmail.visitSnapshot.id !== visit.activityid || preparedEmail.visitSnapshot.start !== visit.scheduledstart || preparedEmail.visitSnapshot.end !== (visit.scheduledend || null) || preparedEmail.visitSnapshot.timeZone !== (visit.wmkf_ianatimezone || 'America/Los_Angeles'))) throw materialsError('The site visit changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);

  const contacts = await currentContacts(requestId, request, dependencies);
  const recipients = contactList(contacts);
  await assertRequestEmailAllowed(requestId, { recipients: recipients.map((person) => person.email) });
  const currentRow = { ...row, contacts };
  const prepared = preparedEmail
    ? { ...preparedEmail, url: unsealUrl(row, dependencies) }
    : await prepareMaterialsReminderEmail({ row: currentRow, request, visit, missing, actorId, profileId, emailTemplate }, dependencies);
  if (!prepared.url) throw materialsError('The contributor link can no longer be read. Start a new collection.', 'site_visit_materials_link_unreadable');
  const preparedTemplate = emailTemplate || prepared.template;
  if (prepared.names && preparedTemplate) assertPreparedNames(prepared, await namesForTemplate(preparedTemplate.body, request, dependencies, recipients));
  const currentEnvelope = splitMaterialRecipients(contacts);
  const preparedRecipients = normalizedRecipients(prepared.recipients);
  const currentRecipients = normalizedRecipients([...currentEnvelope.to, ...currentEnvelope.cc]);
  if (prepared.recipients && JSON.stringify(preparedRecipients) !== JSON.stringify(currentRecipients)) throw materialsError('The reviewed recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  if (prepared.toRecipients && JSON.stringify(normalizedRecipients(prepared.toRecipients)) !== JSON.stringify(normalizedRecipients(currentEnvelope.to))) throw materialsError('The reviewed To recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  if (prepared.ccRecipients && JSON.stringify(normalizedRecipients(prepared.ccRecipients)) !== JSON.stringify(normalizedRecipients(currentEnvelope.cc))) throw materialsError('The reviewed Cc recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const claimed = await dependencies.claimManualReminder(row.id, dependencies.now(), row.contacts, contacts);
  if (!claimed) throw materialsError('The collection changed or a reminder was sent moments ago. Reload and refresh the preview.', 'site_visit_materials_reminder_just_sent');

  let emailId;
  try {
    emailId = await sendReminderEmail({ row: claimed, prepared, fromEmail, actorId, sequence: Number(claimed.reminder_count || 0) }, dependencies);
  } catch (error) {
    const classification = classifyEmailDispatchError(error);
    const uncertain = classification.outcome === 'uncertain';
    throw materialsError(
      uncertain ? 'Dynamics may have accepted the reminder, but the result could not be confirmed.' : 'The reminder could not be sent. Try again.',
      uncertain ? 'site_visit_materials_send_unconfirmed' : 'site_visit_materials_send_failed',
      uncertain ? 202 : 502,
      { outcome: classification.outcome, retryable: classification.retryable, ...(classification.emailId ? { emailId: classification.emailId } : {}) },
    );
  }
  await dependencies.attachReminderEmailId(row.id, emailId);
  return getMaterialsCollection({ requestId }, dependencies);
}

/**
 * Resolve every email input before either caller claims a reminder. A missing
 * default or unreadable link must leave the collection row unclaimed.
 */
export async function prepareMaterialsReminderEmail({ row, request, visit, missing, actorId, profileId, emailTemplate }, dependencies = DEFAULT_DEPENDENCIES) {
  requireMaterialRecipients(row.contacts);
  const url = unsealUrl(row, dependencies);
  if (!url) throw materialsError('The contributor link can no longer be read. Start a new collection.', 'site_visit_materials_link_unreadable');
  const defaults = await resolveMaterialsTemplate(MATERIALS_EMAIL_KINDS.reminder, profileId, emailTemplate, dependencies);
  const names = await namesForTemplate(defaults.body, request, dependencies, contactList(row.contacts));
  return {
    subject: fillEmailTemplate(defaults.subject, { proposalTitle: request.akoya_title || request.akoya_requestnum }),
    bodyText: reminderBodyText({
      bodyTemplate: defaults.body,
      institution: institutionOf(request), title: request.akoya_title || 'your proposal',
      visitStartIso: visit?.scheduledstart || row.due_at, timeZone: visit?.wmkf_ianatimezone || 'America/Los_Angeles',
      dueAt: row.due_at, missing, uploadLink: url,
      signature: await signatureForTemplate(defaults.body, actorId, dependencies),
      names,
    }),
    url,
  };
}

/**
 * Send an already prepared reminder; `sequence` keys the Dynamics correlation.
 * Runs after the at-most-once claim. The shared Dynamics create and dispatch
 * guards recheck the Request state after the claim; a refusal is a definite
 * non-send and does not restore the existing at-most-once claim.
 */
export async function sendReminderEmail({ row, prepared, fromEmail, actorId, sequence }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!prepared) throw materialsError('Reminder email was not prepared.', 'site_visit_materials_email_unprepared', 503);
  if (!isGuid(row?.request_id || '')) throw nonDispatchedMaterialsError('A valid Request is required for this materials email.', 'site_visit_materials_request_invalid', 400);
  requireMaterialRecipients(row.contacts);
  const actualRecipients = normalizedRecipients(contactList(row.contacts).map((person) => person.email));
  const expectedRecipients = normalizedRecipients(prepared.recipients);
  if (prepared.recipients && JSON.stringify(actualRecipients) !== JSON.stringify(expectedRecipients)) {
    throw materialsError('The reviewed recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  }
  const envelope = splitMaterialRecipients(row.contacts);
  return dependencies.sendEmail({
    ...prepared,
    buttonLabel: 'Upload the missing items',
    from: fromEmail,
    to: envelope.to,
    cc: envelope.cc,
    regardingId: row.request_id,
    correlationKey: `wmkf-site-visit-materials-reminder:${row.id}:${sequence}`,
    actingUserSystemId: actorId,
  });
}

/** Read-only preview. It never mints an upload token, creates a collection,
 * claims a reminder, or creates an email activity. */
export async function previewMaterialsEmail({ requestId, action, actorId, profileId, fromEmail, emailTemplate }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(actorId || '')) throw materialsError('Your staff account is not linked to a Dynamics identity.', 'site_visit_materials_actor_required', 403);
  if (!['create', 'invite', 'remind'].includes(action)) throw materialsError('A send action is required.', 'site_visit_materials_preview_action_invalid', 400);
  const request = await loadContext(requestId, dependencies);
  const row = await dependencies.getOpenCollection(requestId);
  if (action === 'create' && (row || !request.wmkf_meetingdate || !isVisibleRequestRow(request, false))) {
    throw materialsError('Materials can be collected only for an advancing request in a cycle.', 'site_visit_materials_request_not_schedulable');
  }
  if ((action === 'invite' || action === 'remind') && !row) {
    throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  }
  const visit = await dependencies.findActiveSiteVisit(requestId);
  if (!visit?.scheduledstart) throw materialsError('The site visit is no longer scheduled.', 'site_visit_materials_visit_required');
  if (!fromEmail) throw materialsError('Your account has no sending email address.', 'site_visit_materials_sender_required', 400);
  const timeZone = visit.wmkf_ianatimezone || 'America/Los_Angeles';
  const dueAt = row?.due_at || subtractBusinessDays(new Date(visit.scheduledstart), (await dependencies.getDueBusinessDays()).dueBusinessDays, timeZone);
  const checklist = row?.checklist || SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false }));
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const matched = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  const projected = row ? projectChecklist(row.checklist, matched.received) : checklist;
  let missing;
  if (action === 'remind' && row) {
    const jobs = await readUploadJobs(requestId, row.id, dependencies);
    const activeJobSlots = new Set(jobs.filter((job) => ACTIVE_UPLOAD_JOB_STATUSES.has(job.status)).map((job) => job.slot));
    missing = missingRequiredItems(row, matched.received, { mode: 'reminder_actionable', activeJobSlots });
  } else {
    missing = projected.filter((item) => item.required && !item.waived && !item.received);
  }
  if (action === 'remind' && missing.length === 0) throw materialsError('Every required item has been received; nothing to remind about.', 'site_visit_materials_nothing_missing');
  const contacts = await currentContacts(requestId, request, dependencies);
  const recipients = contactList(contacts);
  const kind = action === 'remind' ? MATERIALS_EMAIL_KINDS.reminder : MATERIALS_EMAIL_KINDS.invitation;
  const template = await resolveMaterialsTemplate(kind, profileId, emailTemplate, dependencies);
  const placeholderUrl = row ? unsealUrl(row, dependencies) : '[secure link generated when you send]';
  if (row && !placeholderUrl) throw materialsError('The contributor link can no longer be read. Start a new collection.', 'site_visit_materials_link_unreadable');
  const signature = await signatureForTemplate(template.body, actorId, dependencies);
  const names = await namesForTemplate(template.body, request, dependencies, recipients);
  const bodyText = kind === MATERIALS_EMAIL_KINDS.invitation
    ? invitationBodyText({ bodyTemplate: template.body, institution: institutionOf(request), title: request.akoya_title || 'your proposal', visitStartIso: visit.scheduledstart, timeZone, dueAt, checklist, uploadLink: placeholderUrl, signature, names })
    : reminderBodyText({ bodyTemplate: template.body, institution: institutionOf(request), title: request.akoya_title || 'your proposal', visitStartIso: visit.scheduledstart, timeZone, dueAt, missing, uploadLink: placeholderUrl, signature, names });
  const subject = fillEmailTemplate(template.subject, { proposalTitle: request.akoya_title || request.akoya_requestnum });
  const envelope = splitMaterialRecipients(recipients);
  const allRecipients = [...envelope.to, ...envelope.cc].sort();
  const context = { action, requestId, profileId, actorId, fromEmail: String(fromEmail || '').trim().toLowerCase(), recipients: allRecipients, toRecipients: [...envelope.to], ccRecipients: [...envelope.cc], collectionId: row?.id || null, visit: { id: visit.activityid, start: visit.scheduledstart, end: visit.scheduledend || null, timeZone }, dueAt: String(dueAt), checklist: projected, missing, template, subject, bodyText, names };
  const digest = materialsPreviewDigest(context);
  const proof = await mintMaterialsPreviewProof({ digest, action, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return { kind, action, subject, bodyText, names, fromEmail, recipients: envelope.to.map((email) => ({ email })), ccRecipients: envelope.cc.map((email) => ({ email })), allRecipients, missingKeys: missing.map((item) => item.key), collectionId: row?.id || null, dueAt: String(dueAt), visitSnapshot: { id: visit.activityid, start: visit.scheduledstart, end: visit.scheduledend || null, timeZone }, secureLinkPlaceholder: !row, proof, digest };
}

/** Required, unwaived, unreceived checklist items for a stored row. */
export function missingRequiredItems(row, received, { mode = 'ready_required', activeJobSlots = [] } = {}) {
  const activeSlots = activeJobSlots instanceof Set ? activeJobSlots : new Set(activeJobSlots || []);
  return projectChecklist(row.checklist, received).filter((item) => item.required && !item.waived && !item.received
    && !(mode === 'reminder_actionable' && activeSlots.has(item.key)));
}

/** Waive or restore one checklist item (plan §2: staff may waive request-specific items). */
export async function waiveMaterialsItem({ requestId, key, waived }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  await loadContext(requestId, dependencies);
  const row = await dependencies.getOpenCollection(requestId);
  if (!row) throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  if (!(row.checklist || []).some((item) => item.key === key)) throw materialsError('Unknown checklist item.', 'site_visit_materials_item_unknown', 400);
  const checklist = row.checklist.map((item) => (item.key === key ? { ...item, waived: waived === true } : item));
  await dependencies.updateChecklist(row.id, checklist);
  return getMaterialsCollection({ requestId }, dependencies);
}

/** PC confirms the received files open (plan §6.3 Ready); refuses while a required item is missing. */
export async function confirmMaterialsReady({ requestId, actorId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  const { collection } = await getMaterialsCollection({ requestId }, dependencies);
  if (!collection || collection.state === 'closed') throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  if (collection.processingCount > 0 || collection.attentionCount > 0) throw materialsError('An upload is still being saved or needs coordinator attention.', 'site_visit_materials_uploads_incomplete');
  if (collection.missing.length) throw materialsError('A required item is still missing.', 'site_visit_materials_incomplete');
  const updated = await dependencies.markReady(collection.id, actorId);
  if (!updated) throw materialsError('The collection is not open.', 'site_visit_materials_not_open');
  return getMaterialsCollection({ requestId }, dependencies);
}

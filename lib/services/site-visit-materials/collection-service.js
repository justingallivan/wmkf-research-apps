/**
 * Applicant materials collection (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
 * §16, owner decisions M1–M5). The PC starts one collection from a request's
 * scheduled site visit; the PI and liaison receive one shared contributor
 * link; received files are read back from the request-document registry by
 * artifact type and canonical filename, so this service owns process state
 * (checklist, contacts, link, window, receipts), never bytes.
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
import { subtractBusinessDays } from '../../utils/business-days.js';
import { isSiteVisitMaterialsSchemaReady } from '../../utils/site-visit-materials-readiness.js';
import { selectActiveSiteVisit } from '../deliberation-briefing/site-visit-selection.js';
import { resolveGranteeInviteRecipients } from '../workbench/grantee-deliverables/recipients-service.js';
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
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  SITE_VISIT_MATERIALS_AUDIENCE,
  SITE_VISIT_MATERIALS_CHECKLIST,
  SITE_VISIT_MATERIALS_CLOSE_AFTER_DAYS,
  SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS,
  SITE_VISIT_MATERIALS_STATUS,
} from '../../../shared/config/siteVisitMaterials.js';
import * as store from './collection-store.js';

const REQUEST_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title', 'wmkf_meetingdate',
  'akoya_requeststatus', 'wmkf_triagestatus', '_akoya_applicantid_value',
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
  resolveRecipients: (requestId) => resolveGranteeInviteRecipients({ requestId }),
  findDocumentsByRequest: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  getOpenCollection: store.getOpenCollectionForRequest,
  getLatestCollection: store.getLatestCollectionForRequest,
  insertCollection: store.insertCollection,
  recordInvitation: store.recordInvitation,
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
    const [pi, liaison, coordinator] = await Promise.all([
      request._wmkf_projectleader_value ? contactAdapter.getByIdWithSelect(request._wmkf_projectleader_value, ['contactid', 'lastname', 'emailaddress1']) : null,
      request._akoya_primarycontactid_value ? contactAdapter.getByIdWithSelect(request._akoya_primarycontactid_value, ['contactid', 'fullname', 'emailaddress1']) : null,
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
  sendEmail: async ({ subject, bodyText, from, to, cc, correlationKey, actingUserSystemId, url, buttonLabel }) => {
    const emailId = await emailActivityAdapter.create({
      subject, body: renderMaterialsEmailHtml({ bodyText, url, buttonLabel }), from, to, cc, correlationKey, actingUserSystemId, noFallback: true,
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

function assertReady(dependencies) {
  if (!dependencies.schemaReady()) {
    throw materialsError('Applicant materials collection is not enabled for this environment.', 'site_visit_materials_schema_not_ready', 503);
  }
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
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

/** Canonical staff filenames per plan §7.3; the extension follows the format. */
export function canonicalFilename(requestNumber, key, extension) {
  const base = key === 'participant_bios' ? `${requestNumber} Site Visit Participant Bios` : `${requestNumber} Site Visit Presentation`;
  return `${base}.${String(extension || '').replace(/^\./, '').toLowerCase()}`;
}

const SLOT_RULES = Object.freeze({
  presentation_pdf: { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, extensions: ['pdf'] },
  presentation_source: { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, extensions: ['pptx', 'ppt', 'key'] },
  participant_bios: { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS, extensions: ['pdf', 'docx', 'doc'] },
});

function eligibleRegistryRow(row, requestId) {
  return sameId(row?._wmkf_request_value, requestId)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && Boolean(row.wmkf_sharepointitemid);
}

/**
 * Received files per checklist slot, read from the registry: the newest Ready
 * row of the slot's artifact type whose filename is the slot's canonical name.
 */
export function matchReceivedFiles(rows, requestId, requestNumber) {
  const eligible = (rows || []).filter((row) => eligibleRegistryRow(row, requestId));
  const received = {};
  for (const [key, rule] of Object.entries(SLOT_RULES)) {
    const names = new Set(rule.extensions.map((ext) => canonicalFilename(requestNumber, key, ext).toLowerCase()));
    const matches = eligible
      .filter((row) => row.wmkf_artifacttype === rule.artifactType && names.has(String(row.wmkf_filename || '').toLowerCase()))
      .sort((a, b) => String(b.modifiedon || b.createdon || '').localeCompare(String(a.modifiedon || a.createdon || '')));
    const row = matches[0];
    received[key] = row ? {
      artifactId: row.wmkf_requestdocumentid,
      filename: row.wmkf_filename,
      versionId: row.wmkf_sharepointversionid || null,
      receivedAt: row.modifiedon || row.createdon || null,
      size: row.wmkf_filesize ?? null,
    } : null;
  }
  const other = eligible
    .filter((row) => row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS
      && !Object.values(received).some((hit) => hit && sameId(hit.artifactId, row.wmkf_requestdocumentid)))
    .map((row) => ({ artifactId: row.wmkf_requestdocumentid, filename: row.wmkf_filename, receivedAt: row.modifiedon || row.createdon || null }));
  return { received, other };
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
    .map((role) => contacts?.[role])
    .filter((person) => person?.email)
    .map((person, index) => ({ role: ['pi', 'liaison'][index], name: person.name || person.email, email: person.email }));
}

export function projectCollection(row, { received = {}, other = [], now = new Date(), contributorUrl = null } = {}) {
  if (!row) return null;
  const checklist = projectChecklist(row.checklist, received);
  const requiredOpen = checklist.filter((item) => item.required && !item.waived);
  const missing = requiredOpen.filter((item) => !item.received).map((item) => item.key);
  const closed = row.status === SITE_VISIT_MATERIALS_STATUS.CLOSED || new Date(row.closes_at).getTime() <= now.getTime();
  const state = closed ? 'closed'
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
      throw materialsError('The primary contact email could not be verified. Refresh the preview or remove {{liaisonFullName}}.', 'site_visit_materials_email_name_unavailable', 409, { token: 'liaisonFullName' });
    }
    if (liaison?.name && String(liaison.name).trim() && String(liaison.name).trim().toLowerCase() !== String(liaison.email).trim().toLowerCase()) {
      names.liaisonFullName = liaison.name;
    } else if (!names.liaisonEmail || String(liaison.email).trim().toLowerCase() !== String(names.liaisonEmail).trim().toLowerCase()) {
      throw materialsError('The primary contact changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
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

/** Staff read: the current (or latest) collection with the registry joined in. */
export async function getMaterialsCollection({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  const request = await loadContext(requestId, dependencies);
  const row = (await dependencies.getOpenCollection(requestId)) || (await dependencies.getLatestCollection(requestId));
  if (!row) return { collection: null };
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const { received, other } = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  return { collection: projectCollection(row, { received, other, now: dependencies.now(), contributorUrl: unsealUrl(row, dependencies) }) };
}

/**
 * Start a collection from the request's active site visit and send the
 * invitation to the PI and liaison. The row exists before the email so a
 * transport failure leaves a collection the PC can invite again.
 */
export async function createMaterialsCollection({ requestId, actorId, profileId, fromEmail, emailTemplate, preparedEmail }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(actorId || '')) throw materialsError('Your staff account is not linked to a Dynamics identity.', 'site_visit_materials_actor_required', 403);
  // Materials email is disabled for test requests (Test Request Factory Stage 1b).
  await assertRequestEmailAllowed(requestId);
  const request = await loadContext(requestId, dependencies);
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
  const contactsResolved = await dependencies.resolveRecipients(requestId);
  const contacts = {
    pi: contactsResolved?.pi ? { role: 'pi', name: contactsResolved.pi.name || null, email: contactsResolved.pi.email || null } : null,
    liaison: contactsResolved?.liaison ? { role: 'liaison', name: contactsResolved.liaison.name || null, email: contactsResolved.liaison.email || null } : null,
  };
  const recipients = contactList(contacts);
  if (recipients.length === 0) {
    throw materialsError('Neither the project leader nor the primary contact has an email address on the request.', 'site_visit_materials_no_recipients');
  }
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
  const dueAt = subtractBusinessDays(visitStart, SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS, timeZone);
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
  const { received, other } = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  return {
    collection: projectCollection(invited || row, { received, other, now: dependencies.now(), contributorUrl: url }),
    invitationSent: Boolean(invited?.invited_at),
    invitationOutcome: invitation.outcome,
  };
}

async function sendInvitation({ row, request, visit, timeZone, url, recipients, fromEmail, actorId, profileId, emailTemplate, preparedEmail }, dependencies, { propagateConfigError = false } = {}) {
  let emailId = null;
  try {
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
  // Materials email is disabled for test requests (Test Request Factory Stage 1b).
  await assertRequestEmailAllowed(requestId);
  const request = await loadContext(requestId, dependencies);
  const row = await dependencies.getOpenCollection(requestId);
  if (!row) throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  if (preparedEmail?.collectionId && String(preparedEmail.collectionId) !== String(row.id)) throw materialsError('The reviewed collection changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const visit = await dependencies.findActiveSiteVisit(requestId);
  if (!visit?.scheduledstart) throw materialsError('The site visit is no longer scheduled.', 'site_visit_materials_visit_required');
  if (preparedEmail?.visitSnapshot && (preparedEmail.visitSnapshot.id !== visit.activityid || preparedEmail.visitSnapshot.start !== visit.scheduledstart || preparedEmail.visitSnapshot.end !== (visit.scheduledend || null) || preparedEmail.visitSnapshot.timeZone !== (visit.wmkf_ianatimezone || 'America/Los_Angeles'))) throw materialsError('The site visit changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const recipients = contactList(row.contacts);
  const preparedTemplate = emailTemplate || preparedEmail?.template;
  if (preparedEmail?.names && preparedTemplate) assertPreparedNames(preparedEmail, await namesForTemplate(preparedTemplate.body, request, dependencies, recipients));
  const url = unsealUrl(row, dependencies);
  if (!url) throw materialsError('The contributor link can no longer be read. Start a new collection.', 'site_visit_materials_link_unreadable');
  const invitation = await sendInvitation({ row, request, visit, timeZone: visit.wmkf_ianatimezone || 'America/Los_Angeles', url, recipients, fromEmail, actorId, profileId, emailTemplate, preparedEmail }, dependencies, { propagateConfigError: true });
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
 * at-most-once: it propagates and the claim is not undone.
 */
export async function remindMaterialsContributors({ requestId, actorId, profileId, fromEmail, emailTemplate, preparedEmail }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(actorId || '')) throw materialsError('Your staff account is not linked to a Dynamics identity.', 'site_visit_materials_actor_required', 403);
  // Materials email is disabled for test requests (Test Request Factory Stage 1b).
  await assertRequestEmailAllowed(requestId);
  const request = await loadContext(requestId, dependencies);
  const row = await dependencies.getOpenCollection(requestId);
  if (!row) throw materialsError('No open materials collection exists for this request.', 'site_visit_materials_missing', 404);
  if (preparedEmail?.collectionId && String(preparedEmail.collectionId) !== String(row.id)) throw materialsError('The reviewed collection changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const { received } = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  const missing = missingRequiredItems(row, received);
  if (preparedEmail?.missingKeys && JSON.stringify([...preparedEmail.missingKeys].sort()) !== JSON.stringify(missing.map((item) => item.key).sort())) {
    throw materialsError('The missing-item list changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  }
  if (missing.length === 0) throw materialsError('Every required item has been received; nothing to remind about.', 'site_visit_materials_nothing_missing');
  const visit = await dependencies.findActiveSiteVisit(requestId);
  if (!visit?.scheduledstart) throw materialsError('The site visit is no longer scheduled.', 'site_visit_materials_visit_required');
  if (preparedEmail?.visitSnapshot && (preparedEmail.visitSnapshot.id !== visit.activityid || preparedEmail.visitSnapshot.start !== visit.scheduledstart || preparedEmail.visitSnapshot.end !== (visit.scheduledend || null) || preparedEmail.visitSnapshot.timeZone !== (visit.wmkf_ianatimezone || 'America/Los_Angeles'))) throw materialsError('The site visit changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);

  const prepared = preparedEmail
    ? { ...preparedEmail, url: unsealUrl(row, dependencies) }
    : await prepareMaterialsReminderEmail({ row, request, visit, missing, actorId, profileId, emailTemplate }, dependencies);
  if (!prepared.url) throw materialsError('The contributor link can no longer be read. Start a new collection.', 'site_visit_materials_link_unreadable');
  const preparedTemplate = emailTemplate || prepared.template;
  if (prepared.names && preparedTemplate) assertPreparedNames(prepared, await namesForTemplate(preparedTemplate.body, request, dependencies, contactList(row.contacts)));
  const currentEnvelope = splitMaterialRecipients(contactList(row.contacts));
  const preparedRecipients = normalizedRecipients(prepared.recipients);
  const currentRecipients = normalizedRecipients([...currentEnvelope.to, ...currentEnvelope.cc]);
  if (prepared.recipients && JSON.stringify(preparedRecipients) !== JSON.stringify(currentRecipients)) throw materialsError('The reviewed recipients changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  if (prepared.toRecipients && JSON.stringify(normalizedRecipients(prepared.toRecipients)) !== JSON.stringify(normalizedRecipients(currentEnvelope.to))) throw materialsError('The reviewed To recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  if (prepared.ccRecipients && JSON.stringify(normalizedRecipients(prepared.ccRecipients)) !== JSON.stringify(normalizedRecipients(currentEnvelope.cc))) throw materialsError('The reviewed Cc recipient changed. Refresh the preview before sending.', 'site_visit_materials_preview_stale', 409);
  const claimed = await dependencies.claimManualReminder(row.id, dependencies.now());
  if (!claimed) throw materialsError('A reminder was sent moments ago. Reload to see it.', 'site_visit_materials_reminder_just_sent');

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
 * Runs after the at-most-once claim, so it does no fallible test-request read:
 * both callers (manual remind, automatic sweep) refuse test requests before
 * claiming (Stage 1b).
 */
export async function sendReminderEmail({ row, prepared, fromEmail, actorId, sequence }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!prepared) throw materialsError('Reminder email was not prepared.', 'site_visit_materials_email_unprepared', 503);
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
  const contacts = row?.contacts || await dependencies.resolveRecipients(requestId);
  const recipients = contactList(contacts);
  if (recipients.length === 0) throw materialsError('Neither the project leader nor the primary contact has an email address on the request.', 'site_visit_materials_no_recipients');
  if (!fromEmail) throw materialsError('Your account has no sending email address.', 'site_visit_materials_sender_required', 400);
  const timeZone = visit.wmkf_ianatimezone || 'America/Los_Angeles';
  const dueAt = row?.due_at || subtractBusinessDays(new Date(visit.scheduledstart), SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS, timeZone);
  const checklist = row?.checklist || SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false }));
  const documents = await dependencies.findDocumentsByRequest(requestId);
  const matched = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
  const projected = row ? projectChecklist(row.checklist, matched.received) : checklist;
  const missing = projected.filter((item) => item.required && !item.waived && !item.received);
  if (action === 'remind' && missing.length === 0) throw materialsError('Every required item has been received; nothing to remind about.', 'site_visit_materials_nothing_missing');
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
export function missingRequiredItems(row, received) {
  return projectChecklist(row.checklist, received).filter((item) => item.required && !item.waived && !item.received);
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
  if (collection.missing.length) throw materialsError('A required item is still missing.', 'site_visit_materials_incomplete');
  const updated = await dependencies.markReady(collection.id, actorId);
  if (!updated) throw materialsError('The collection is not open.', 'site_visit_materials_not_open');
  return getMaterialsCollection({ requestId }, dependencies);
}

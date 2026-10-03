/**
 * Resolve Site Visit Project Leader and liaison for materials and calendar
 * suggestions. This helper is read-only.
 *
 * Research (RESEARCH_PROGRAM_IDS): the Liaison of record is the applicant
 * institution's Primary Contact only (lib/services/contacts/request-liaison.js,
 * via the invite recipients); the Request copy is never used.
 * Other programs: a set Request Primary Contact wins; only a blank lookup uses
 * the applicant organization's Primary Contact.
 *
 * The result carries `liaisonStatus`: 'found' (a Liaison contact, whose email
 * may still be blank) or 'none' (a successful read confirmed no Liaison).
 * Read failures throw; they are never 'none'.
 */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as contactAdapter from '../../dataverse/adapters/contact.js';
import { ServiceHttpError } from '../service-http-error.js';
import { resolveGranteeInviteRecipients } from '../workbench/grantee-deliverables/recipients-service.js';
import { isResearchProgram } from '../contacts/request-liaison.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: ['akoya_requestid', '_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value'],
  }),
  resolveRequestRecipients: (requestId) => resolveGranteeInviteRecipients({ requestId }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: '_primarycontactid_value' }),
  getContact: (contactId) => contactAdapter.getInviteRecipientById(contactId),
});

function withLiaisonStatus(contacts) {
  return { ...contacts, liaisonStatus: contacts.liaison?.contactId ? 'found' : 'none' };
}

export async function resolveSiteVisitApplicantContacts({ requestId, request = null }, dependencies = DEFAULT_DEPENDENCIES) {
  const currentRequest = request || await dependencies.getRequest(requestId);
  if (!currentRequest || !Object.hasOwn(currentRequest, '_akoya_programid_value')) {
    throw new Error('applicant-contacts: the Request projection must select _akoya_programid_value');
  }
  const recipients = await dependencies.resolveRequestRecipients(requestId);
  // Research: the recipients already carry the institution Liaison (or none).
  if (isResearchProgram(currentRequest._akoya_programid_value)) return withLiaisonStatus(recipients);
  // Other programs: the request-specific contact wins when set. Only a blank
  // request lookup falls back to the applicant organization's primary contact.
  if (currentRequest._akoya_primarycontactid_value || recipients.liaison?.contactId || !currentRequest._akoya_applicantid_value) {
    return withLiaisonStatus(recipients);
  }
  try {
    const account = await dependencies.getAccount(currentRequest._akoya_applicantid_value);
    const contactId = account?._primarycontactid_value;
    if (!contactId) return withLiaisonStatus(recipients);
    const contact = await dependencies.getContact(contactId);
    return withLiaisonStatus({
      ...recipients,
      liaison: {
        contactId,
        name: contact?.fullname || `${contact?.firstname || ''} ${contact?.lastname || ''}`.trim() || null,
        email: contact?.emailaddress1 || null,
      },
    });
  } catch {
    // An unavailable lookup is different from a confirmed missing address.
    // Materials returns this actionable error; the visit GET remains usable.
    throw new ServiceHttpError('The organization primary contact could not be verified. Refresh the preview or ask an administrator to check AkoyaGo.', {
      httpStatus: 503,
      code: 'site_visit_primary_contact_unavailable',
      body: {
        error: 'The organization primary contact could not be verified. Refresh the preview or ask an administrator to check AkoyaGo.',
        code: 'site_visit_primary_contact_unavailable',
      },
    });
  }
}

export function applicantAttendeeSuggestions(contacts) {
  const seen = new Set();
  return ['pi', 'liaison'].flatMap((role) => {
    const person = contacts?.[role];
    const email = String(person?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) return [];
    seen.add(email);
    return [{ kind: 'manual', name: person.name || email, email }];
  });
}

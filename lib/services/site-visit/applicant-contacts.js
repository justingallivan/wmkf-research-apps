/**
 * Resolve Site Visit Project Leader and liaison for materials and calendar
 * suggestions. A set Request Primary Contact wins; only a blank lookup uses
 * the applicant organization's Primary Contact. This helper is read-only.
 */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as contactAdapter from '../../dataverse/adapters/contact.js';
import { ServiceHttpError } from '../service-http-error.js';
import { resolveGranteeInviteRecipients } from '../workbench/grantee-deliverables/recipients-service.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: ['akoya_requestid', '_akoya_applicantid_value', '_akoya_primarycontactid_value'],
  }),
  resolveRequestRecipients: (requestId) => resolveGranteeInviteRecipients({ requestId }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: '_primarycontactid_value' }),
  getContact: (contactId) => contactAdapter.getInviteRecipientById(contactId),
});

export async function resolveSiteVisitApplicantContacts({ requestId, request = null }, dependencies = DEFAULT_DEPENDENCIES) {
  const currentRequest = request || await dependencies.getRequest(requestId);
  const recipients = await dependencies.resolveRequestRecipients(requestId);
  // The request-specific contact wins when set. Only a blank request lookup
  // falls back to the applicant organization's primary contact.
  if (currentRequest?._akoya_primarycontactid_value || recipients.liaison?.contactId || !currentRequest?._akoya_applicantid_value) return recipients;
  try {
    const account = await dependencies.getAccount(currentRequest._akoya_applicantid_value);
    const contactId = account?._primarycontactid_value;
    if (!contactId) return recipients;
    const contact = await dependencies.getContact(contactId);
    return {
      ...recipients,
      liaison: {
        contactId,
        name: contact?.fullname || `${contact?.firstname || ''} ${contact?.lastname || ''}`.trim() || null,
        email: contact?.emailaddress1 || null,
      },
    };
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

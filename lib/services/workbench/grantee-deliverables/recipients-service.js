/**
 * Workbench grantee-deliverables — invite-recipient resolution service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for GET /api/workbench/grantee-deliverables/
 * recipients (chunk 3b); the route is a thin shell. Resolves the TWO invite
 * recipients for a research grant (owner-confirmed S268):
 *   - PI      = akoya_request.wmkf_projectleader → contact
 *   - Liaison = the Liaison of record (lib/services/contacts/request-liaison.js):
 *     for Research, the applicant institution's Primary Contact, never the
 *     Request's akoya_primarycontactid copy; other programs keep the copy.
 *     No Liaison → liaison fields null (the invite goes to the PI with no Cc).
 * Contact GUIDs come from server-read rows, never client input. Read-only.
 *
 * Contract (plan Decision 3): plain args; returns { pi, liaison }; throws
 * ServiceHttpError 404 (default `{ error }`) and 503 when the Liaison or a
 * contact cannot be read (never degraded to "no Liaison" or "no email").
 * ASSUMES a trusted DAL context.
 *
 * `resolveCurrentInviteLiaison` is shared with the send service, which
 * re-resolves the Liaison at send and compares it with what staff saw.
 */

import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import * as contactAdapter from '../../../dataverse/adapters/contact.js';
import { ServiceHttpError } from '../../service-http-error';
import { resolveRequestLiaison, REQUEST_LIAISON_FIELDS } from '../../contacts/request-liaison.js';

const UNAVAILABLE = 'Recipients are temporarily unavailable. Please try again.';

function unavailable(what, error) {
  console.error(`[grantee-deliverables/recipients] ${what}:`, error?.message || error);
  return new ServiceHttpError(UNAVAILABLE, { httpStatus: 503, code: 'recipients_unavailable' });
}

async function resolveContact(id) {
  if (!id) return { contactId: null, name: null, email: null, hasEmail: false };
  let c;
  try {
    c = await contactAdapter.getInviteRecipientById(id);
  } catch (error) {
    // A contact we cannot read is a failure, never a recipient without email.
    throw unavailable(`could not read contact ${id}`, error);
  }
  const name = c.fullname || `${c.firstname || ''} ${c.lastname || ''}`.trim() || null;
  const email = c.emailaddress1 || null;
  return { contactId: c.contactid || id, name, email, hasEmail: Boolean(email) };
}

/**
 * The current invite Liaison for a Request row carrying REQUEST_LIAISON_FIELDS:
 * the helper's contact id, then a contact read for name and email.
 *
 * @param {Object} row - server-read akoya_request row
 * @returns {Promise<{ contactId: string|null, name: string|null, email: string|null, hasEmail: boolean }>}
 * @throws {ServiceHttpError} 503 when the Liaison or its contact cannot be read
 */
export async function resolveCurrentInviteLiaison(row) {
  let liaison;
  try {
    liaison = await resolveRequestLiaison(row);
  } catch (error) {
    throw unavailable('could not resolve the Liaison', error);
  }
  return resolveContact(liaison.status === 'found' ? liaison.contactId : null);
}

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @returns {Promise<{ pi: Object, liaison: Object }>}
 * @throws {ServiceHttpError} 404 when the request does not resolve; 503 when a recipient cannot be read
 */
export async function resolveGranteeInviteRecipients({ requestId }) {
  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, {
      select: ['akoya_requestid', '_wmkf_projectleader_value', ...REQUEST_LIAISON_FIELDS],
    });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Contact GUIDs come from server-read rows, not client input.
  const [pi, liaison] = await Promise.all([
    resolveContact(row._wmkf_projectleader_value),
    resolveCurrentInviteLiaison(row),
  ]);

  return { pi, liaison };
}

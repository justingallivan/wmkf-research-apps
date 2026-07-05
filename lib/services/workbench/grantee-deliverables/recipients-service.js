/**
 * Workbench grantee-deliverables — invite-recipient resolution service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for GET /api/workbench/grantee-deliverables/
 * recipients (chunk 3b); the route is a thin shell. Resolves the TWO invite
 * recipients for a research grant (owner-confirmed S268):
 *   - PI      = akoya_request.wmkf_projectleader   → contact
 *   - Liaison = akoya_request.akoya_primarycontactid → contact
 * Contact GUIDs come from the request row (server-sourced), never client
 * input. Read-only.
 *
 * Contract (plan Decision 3): plain args; returns { pi, liaison }; throws
 * ServiceHttpError 404 (default `{ error }`). ASSUMES a trusted DAL context.
 */

import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import * as contactAdapter from '../../../dataverse/adapters/contact.js';
import { ServiceHttpError } from '../../service-http-error';

async function resolveContact(id) {
  if (!id) return { contactId: null, name: null, email: null, hasEmail: false };
  let c;
  try {
    c = await contactAdapter.getInviteRecipientById(id);
  } catch {
    // Lookup points at a contact we can't read — surface the id but no PII.
    return { contactId: id, name: null, email: null, hasEmail: false };
  }
  const name = c.fullname || `${c.firstname || ''} ${c.lastname || ''}`.trim() || null;
  const email = c.emailaddress1 || null;
  return { contactId: c.contactid || id, name, email, hasEmail: Boolean(email) };
}

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @returns {Promise<{ pi: Object, liaison: Object }>}
 * @throws {ServiceHttpError} 404 when the request does not resolve
 */
export async function resolveGranteeInviteRecipients({ requestId }) {
  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, {
      select: ['akoya_requestid', '_wmkf_projectleader_value', '_akoya_primarycontactid_value'],
    });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Contact GUIDs come from the request row (server-sourced), not client input.
  const [pi, liaison] = await Promise.all([
    resolveContact(row._wmkf_projectleader_value),
    resolveContact(row._akoya_primarycontactid_value),
  ]);

  return { pi, liaison };
}

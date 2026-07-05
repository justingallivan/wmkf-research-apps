/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/recipients-service —
 * logic-level tests (adapters mocked), Stage 4 series C extraction.
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
}));

const getInviteRecipientById = jest.fn();
jest.mock('../../lib/dataverse/adapters/contact.js', () => ({
  getInviteRecipientById: (...a) => getInviteRecipientById(...a),
}));

import { resolveGranteeInviteRecipients } from '../../lib/services/workbench/grantee-deliverables/recipients-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const GUID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({ akoya_requestid: GUID, _wmkf_projectleader_value: 'pi-1', _akoya_primarycontactid_value: 'li-1' });
  getInviteRecipientById.mockImplementation(async (id) => (
    id === 'pi-1'
      ? { contactid: 'pi-1', fullname: 'Monika Raj', emailaddress1: 'monika.raj@emory.edu' }
      : { contactid: 'li-1', firstname: 'Lorena', lastname: 'McLaren', emailaddress1: null }
  ));
});

test('404 typed error when the request does not resolve', async () => {
  getById.mockRejectedValue(new Error('gone'));
  const err = await resolveGranteeInviteRecipients({ requestId: GUID }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
});

test('resolves both contacts; fullname preferred, first/last fallback, hasEmail per address', async () => {
  const body = await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(body).toEqual({
    pi: { contactId: 'pi-1', name: 'Monika Raj', email: 'monika.raj@emory.edu', hasEmail: true },
    liaison: { contactId: 'li-1', name: 'Lorena McLaren', email: null, hasEmail: false },
  });
});

test('missing lookup id → null stub; unreadable contact → id surfaced, no PII', async () => {
  getById.mockResolvedValue({ akoya_requestid: GUID, _wmkf_projectleader_value: 'pi-1', _akoya_primarycontactid_value: null });
  getInviteRecipientById.mockRejectedValue(Object.assign(new Error('403'), { status: 403 }));
  const body = await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(body.pi).toEqual({ contactId: 'pi-1', name: null, email: null, hasEmail: false });
  expect(body.liaison).toEqual({ contactId: null, name: null, email: null, hasEmail: false });
});

/**
 * @jest-environment node
 *
 * Characterization tests for the contact.js adapter methods added to absorb
 * long-tail callers (Wave 6 / tail-2B, data-access-layer migration):
 *  - lib/bill/honorarium-onboard-orchestrator.js (updateFields)
 *  - lib/bill/onboard-reviewer-service.js (getBillingFieldsById)
 *  - lib/services/proposal-pi-identity.js (getPIIdentityById)
 *  - pages/api/workbench/grantee-deliverables/recipients.js (getInviteRecipientById)
 * Each method must byte-mirror the caller's former inline call shape.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  updateFields,
  getBillingFieldsById,
  getPIIdentityById,
  getInviteRecipientById,
} from '../../lib/dataverse/adapters/contact.js';

afterEach(() => jest.restoreAllMocks());

const GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('contact.updateFields', () => {
  test('golden: forwards contactId/payload verbatim, no options', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const payload = { address1_line1: '123 Main St', address1_city: 'Anytown' };
    await updateFields(GUID, payload);
    expect(u).toHaveBeenCalledWith('contacts', GUID, payload);
    expect(u.mock.calls[0]).toHaveLength(3);
  });

  test('forwards options when passed', async () => {
    const u = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await updateFields(GUID, { wmkf_billcomid: 'v1', akoya_isvendor: true }, {});
    expect(u).toHaveBeenCalledWith('contacts', GUID, { wmkf_billcomid: 'v1', akoya_isvendor: true }, {});
  });

  test('failure path: propagates an updateRecord rejection', async () => {
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValue(new Error('boom'));
    await expect(updateFields(GUID, {})).rejects.toThrow('boom');
  });
});

describe('contact.getBillingFieldsById', () => {
  test('golden: byte-mirrors the BILL pre-read select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_billcomid: 'v1', akoya_isvendor: true });
    const out = await getBillingFieldsById(GUID);
    expect(out).toEqual({ wmkf_billcomid: 'v1', akoya_isvendor: true });
    expect(g).toHaveBeenCalledWith('contacts', GUID, { select: 'wmkf_billcomid,akoya_isvendor' });
  });

  test('failure path: propagates a getRecord rejection', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('404'));
    await expect(getBillingFieldsById(GUID)).rejects.toThrow('404');
  });
});

describe('contact.getPIIdentityById', () => {
  test('golden: byte-mirrors proposal-pi-identity select', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ fullname: 'Jane Doe' });
    const out = await getPIIdentityById(GUID);
    expect(out).toEqual({ fullname: 'Jane Doe' });
    expect(g).toHaveBeenCalledWith('contacts', GUID, { select: 'fullname,firstname,lastname,wmkf_orcid,emailaddress1' });
  });
});

describe('contact.getInviteRecipientById', () => {
  test('golden: byte-mirrors the grantee-deliverables recipients CONTACT_SELECT', async () => {
    const g = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: GUID, fullname: 'Jane Doe' });
    const out = await getInviteRecipientById(GUID);
    expect(out).toEqual({ contactid: GUID, fullname: 'Jane Doe' });
    expect(g).toHaveBeenCalledWith('contacts', GUID, { select: 'contactid,fullname,firstname,lastname,emailaddress1' });
  });

  test('failure path: propagates a getRecord rejection', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('boom'));
    await expect(getInviteRecipientById(GUID)).rejects.toThrow('boom');
  });
});

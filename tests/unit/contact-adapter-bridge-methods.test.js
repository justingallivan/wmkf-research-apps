/**
 * @jest-environment node
 *
 * Characterization tests for the contact.js adapter methods added to absorb
 * lib/services/alert-reviewer-affiliation-mismatch.js's defaultContactsAdapter
 * and lib/services/contact-bridge-service.js's raw DynamicsService calls
 * (Wave 4, data-access-layer migration). Each method must byte-mirror the
 * caller's former inline call shape.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  getInstitutionById,
  setParentAccountIfEmpty,
  findManyByPortalOid,
  findManyByEmailLowercased,
  setPortalOid,
  createPortalContact,
  getEntityKeyStatus,
  getByIdWithSelect,
} from '../../lib/dataverse/adapters/contact.js';

afterEach(() => jest.restoreAllMocks());

describe('contact.getInstitutionById', () => {
  test('null contactId short-circuits without a GET', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: 'x' });
    const out = await getInstitutionById(null);
    expect(out).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  test('issues getRecord with the institution-comparison select', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      contactid: 'contact-1',
      adx_organizationname: 'Acme Org',
    });
    const out = await getInstitutionById('contact-1');
    expect(out).toEqual({ contactid: 'contact-1', adx_organizationname: 'Acme Org' });
    expect(get).toHaveBeenCalledWith('contacts', 'contact-1', {
      select: 'contactid,adx_organizationname,_parentcustomerid_value',
    });
  });
});

describe('contact.setParentAccountIfEmpty', () => {
  test('fills an empty parent with an ETag-conditional Account bind', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      contactid: 'contact-1',
      _parentcustomerid_value: null,
      _etag: 'W/"5"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await setParentAccountIfEmpty('contact-1', 'account-1', {
      actingUserSystemId: 'user-1',
    });

    expect(out).toEqual({ action: 'write', accountId: 'account-1' });
    expect(update).toHaveBeenCalledWith('contacts', 'contact-1', {
      'parentcustomerid_account@odata.bind': '/accounts(account-1)',
    }, {
      actingUserSystemId: 'user-1',
      ifMatch: 'W/"5"',
    });
  });

  test('never overwrites a different existing parent', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      contactid: 'contact-1',
      _parentcustomerid_value: 'account-other',
      _etag: 'W/"5"',
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await setParentAccountIfEmpty('contact-1', 'account-1');

    expect(out).toEqual({
      action: 'conflict',
      reason: 'parent_already_populated',
      existingParentId: 'account-other',
      accountId: 'account-1',
    });
    expect(update).not.toHaveBeenCalled();
  });

  test('re-evaluates a 412 race and noops when the same Account won', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ contactid: 'contact-1', _parentcustomerid_value: null, _etag: 'W/"1"' })
      .mockResolvedValueOnce({ contactid: 'contact-1', _parentcustomerid_value: 'ACCOUNT-1', _etag: 'W/"2"' });
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(
      Object.assign(new Error('Precondition Failed'), { status: 412 }),
    );

    await expect(setParentAccountIfEmpty('contact-1', 'account-1')).resolves.toEqual({
      action: 'noop',
      reason: 'already_linked',
      accountId: 'account-1',
    });
  });

  test('re-evaluates a 412 race and preserves a different parent that won', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ contactid: 'contact-1', _parentcustomerid_value: null, _etag: 'W/"1"' })
      .mockResolvedValueOnce({ contactid: 'contact-1', _parentcustomerid_value: 'account-other', _etag: 'W/"2"' });
    jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(
      Object.assign(new Error('Precondition Failed'), { status: 412 }),
    );

    await expect(setParentAccountIfEmpty('contact-1', 'account-1')).resolves.toEqual({
      action: 'conflict',
      reason: 'parent_already_populated',
      existingParentId: 'account-other',
      accountId: 'account-1',
    });
  });

  test('refuses a bare write when the Contact GET has no ETag', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      contactid: 'contact-1',
      _parentcustomerid_value: null,
    });
    const update = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await expect(setParentAccountIfEmpty('contact-1', 'account-1')).rejects.toMatchObject({
      code: 'reviewer_contact_parent_etag_missing',
      retryable: true,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('contact.findManyByPortalOid', () => {
  test('queries with escaped filter, top:2, bridge select', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ contactid: 'c1' }],
    });
    const out = await findManyByPortalOid("o'id");
    expect(out).toEqual([{ contactid: 'c1' }]);
    expect(query).toHaveBeenCalledWith('contacts', {
      select: 'contactid,wmkf_portaloid,emailaddress1,firstname,lastname',
      filter: "wmkf_portaloid eq 'o''id'",
      top: 2,
    });
  });
});

describe('contact.findManyByEmailLowercased', () => {
  test('lowercases email before filtering', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await findManyByEmailLowercased('JANE@EXAMPLE.ORG');
    expect(query).toHaveBeenCalledWith('contacts', {
      select: 'contactid,wmkf_portaloid,emailaddress1,firstname,lastname',
      filter: "emailaddress1 eq 'jane@example.org'",
      top: 5,
    });
  });
});

describe('contact.setPortalOid', () => {
  test('PATCHes only wmkf_portaloid', async () => {
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await setPortalOid('contact-1', 'oid-1');
    expect(patch).toHaveBeenCalledWith('contacts', 'contact-1', { wmkf_portaloid: 'oid-1' });
  });
});

describe('contact.createPortalContact', () => {
  test('POSTs the caller-provided body unchanged', async () => {
    const create = jest.spyOn(DynamicsService, 'createRecord').mockResolvedValue({ contactid: 'new-1' });
    const body = { wmkf_portaloid: 'oid-1', emailaddress1: 'a@b.com', lastname: 'Doe' };
    const out = await createPortalContact(body);
    expect(out).toEqual({ contactid: 'new-1' });
    expect(create).toHaveBeenCalledWith('contacts', body);
  });
});

describe('contact.getEntityKeyStatus', () => {
  test('passes both args through to DynamicsService.getEntityKey unchanged', async () => {
    const getKey = jest.spyOn(DynamicsService, 'getEntityKey').mockResolvedValue({
      EntityKeyIndexStatus: 'Active',
    });
    const out = await getEntityKeyStatus('contact', 'wmkf_portaloid');
    expect(out).toEqual({ EntityKeyIndexStatus: 'Active' });
    expect(getKey).toHaveBeenCalledWith('contact', 'wmkf_portaloid');
  });
});

describe('contact.getByIdWithSelect', () => {
  test('byte-mirrors the external review context route select', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: 'c1' });
    const select = [
      'firstname', 'lastname', 'nickname', 'jobtitle', 'emailaddress1',
      'wmkf_orcid', 'adx_organizationname', '_parentcustomerid_value',
      'address1_line1', 'address1_line2', 'address1_city',
      'address1_stateorprovince', 'address1_postalcode', 'address1_country',
    ];
    const out = await getByIdWithSelect('c1', select);
    expect(out).toEqual({ contactid: 'c1' });
    expect(get).toHaveBeenCalledWith('contacts', 'c1', { select: select.join(',') });
  });
});

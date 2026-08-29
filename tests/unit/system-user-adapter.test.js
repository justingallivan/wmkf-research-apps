/**
 * @jest-environment node
 *
 * Characterization tests for the new lib/dataverse/adapters/system-user.js
 * adapter (Wave 4, data-access-layer migration). Each method must byte-mirror
 * its former inline caller (dynamics-identity-service.js / reviewer-acceptance-email.js).
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  findByEmail, getById, getByIdWithSelect, queryAllUsers, queryUsers,
} from '../../lib/dataverse/adapters/system-user.js';

afterEach(() => jest.restoreAllMocks());

describe('system-user.findByEmail', () => {
  test('queries systemusers with escaped filter, top:1, reconciliation select', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ systemuserid: 'su-1', fullname: 'Jane PD', isdisabled: false }],
    });
    const out = await findByEmail("o'brien@example.org");
    expect(out).toEqual({ records: [{ systemuserid: 'su-1', fullname: 'Jane PD', isdisabled: false }] });
    expect(query).toHaveBeenCalledWith('systemusers', {
      select: 'systemuserid,fullname,isdisabled,internalemailaddress',
      filter: "internalemailaddress eq 'o''brien@example.org'",
      top: 1,
    });
  });
});

describe('system-user.getById', () => {
  test('gets systemuser with the acceptance-email sender select', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      systemuserid: 'su-2',
      internalemailaddress: 'pd@example.org',
      isdisabled: false,
    });
    const out = await getById('su-2');
    expect(out).toEqual({ systemuserid: 'su-2', internalemailaddress: 'pd@example.org', isdisabled: false });
    expect(get).toHaveBeenCalledWith('systemusers', 'su-2', {
      select: 'systemuserid,internalemailaddress,isdisabled',
    });
  });
});

describe('system-user.getByIdWithSelect', () => {
  test('byte-mirrors email-signature.resolveSignatureForRequest select', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ fullname: 'Jane PD' });
    const out = await getByIdWithSelect('su-3', 'systemuserid,fullname,internalemailaddress,isdisabled');
    expect(out).toEqual({ fullname: 'Jane PD' });
    expect(get).toHaveBeenCalledWith('systemusers', 'su-3', {
      select: 'systemuserid,fullname,internalemailaddress,isdisabled',
    });
  });

  test('byte-mirrors program-director-resolver.resolveProgramDirectorEmailForRequest narrower select', async () => {
    const get = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ isdisabled: false });
    await getByIdWithSelect('su-4', 'internalemailaddress,isdisabled');
    expect(get).toHaveBeenCalledWith('systemusers', 'su-4', {
      select: 'internalemailaddress,isdisabled',
    });
  });
});

describe('system-user.queryUsers', () => {
  test('forwards options verbatim to DynamicsService.queryRecords', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const options = {
      select: 'systemuserid,fullname,internalemailaddress,isdisabled',
      filter: "internalemailaddress eq 'pd@example.org' and isdisabled eq false",
      top: 1,
    };
    const out = await queryUsers(options);
    expect(out).toEqual({ records: [] });
    expect(query).toHaveBeenCalledWith('systemusers', options);
  });
});

describe('system-user.queryAllUsers', () => {
  test('forwards options to the paginated DynamicsService query', async () => {
    const query = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{ systemuserid: 'su-1' }],
      totalCount: 1,
      capped: false,
    });
    const options = {
      select: 'systemuserid,fullname,internalemailaddress,isdisabled',
      filter: 'isdisabled eq false',
      orderby: 'systemuserid asc',
    };
    await expect(queryAllUsers(options)).resolves.toEqual({
      records: [{ systemuserid: 'su-1' }],
      totalCount: 1,
      capped: false,
    });
    expect(query).toHaveBeenCalledWith('systemusers', options);
  });
});

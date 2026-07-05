/**
 * @jest-environment node
 *
 * Characterization test for the new lib/dataverse/adapters/app-request-person.js
 * adapter (Wave 4, data-access-layer migration). Byte-mirrors
 * proposal-participants.fetchCoPIs's former inline queryRecords call.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { queryCoPIs, queryPersons, queryAllPersons } from '../../lib/dataverse/adapters/app-request-person.js';

afterEach(() => jest.restoreAllMocks());

describe('app-request-person.queryCoPIs', () => {
  test('queries wmkf_apprequestpersons with the Co-PI filter/select/expand/order/top', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ _wmkf_contact_value: 'c1', wmkf_authorposition: 1 }],
    });

    const out = await queryCoPIs('request-guid-1');

    expect(out).toEqual({ records: [{ _wmkf_contact_value: 'c1', wmkf_authorposition: 1 }] });
    expect(query).toHaveBeenCalledWith('wmkf_apprequestpersons', {
      select: '_wmkf_contact_value,wmkf_authorposition',
      expand: 'wmkf_Contact($select=fullname,firstname,lastname)',
      filter: '_wmkf_request_value eq request-guid-1 and wmkf_role eq 100000001',
      orderby: 'wmkf_authorposition asc,createdon asc',
      top: 50,
    });
  });
});

describe('app-request-person.queryPersons', () => {
  test('forwards options verbatim to DynamicsService.queryRecords (generate-emails Co-PI-names shape)', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const options = {
      select: '_wmkf_contact_value,wmkf_authorposition',
      filter: '_wmkf_request_value eq request-1 and wmkf_role eq 100000001',
      orderby: 'wmkf_authorposition asc,createdon asc',
      top: 50,
    };
    const out = await queryPersons(options);
    expect(out).toEqual({ records: [] });
    expect(query).toHaveBeenCalledWith('wmkf_apprequestpersons', options);
  });
});

describe('app-request-person.queryAllPersons', () => {
  test('forwards options verbatim to DynamicsService.queryAllRecords (contact-history junction scan shape)', async () => {
    const query = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    const options = {
      select: '_wmkf_request_value,wmkf_role,wmkf_authorposition',
      filter: '_wmkf_contact_value eq contact-1 and (wmkf_role eq 100000000 or wmkf_role eq 100000001)',
    };
    const out = await queryAllPersons(options);
    expect(out).toEqual({ records: [], capped: false });
    expect(query).toHaveBeenCalledWith('wmkf_apprequestpersons', options);
  });
});

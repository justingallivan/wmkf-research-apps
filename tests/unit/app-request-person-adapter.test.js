/**
 * @jest-environment node
 *
 * Characterization test for the new lib/dataverse/adapters/app-request-person.js
 * adapter (Wave 4, data-access-layer migration). Byte-mirrors
 * proposal-participants.fetchCoPIs's former inline queryRecords call.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { queryCoPIs } from '../../lib/dataverse/adapters/app-request-person.js';

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

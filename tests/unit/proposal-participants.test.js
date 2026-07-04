/**
 * @jest-environment node
 *
 * Contract tests for fetchCoPIs (lib/services/proposal-participants.js) written
 * BEFORE Wave-4 conversion to the wmkf_apprequestpersons adapter. DynamicsService
 * is mocked at the transport boundary, so these stay valid whether the caller
 * issues the query directly or via lib/dataverse/adapters/app-request-person.js.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { fetchCoPIs } from '../../lib/services/proposal-participants.js';

afterEach(() => jest.restoreAllMocks());

describe('fetchCoPIs — golden path', () => {
  test('builds ordered, deduped display names from the junction rows', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { _wmkf_contact_value: 'c1', wmkf_Contact: { fullname: 'Ann Lee' } },
        { _wmkf_contact_value: 'c2', wmkf_Contact: { firstname: 'Bob', lastname: 'Roe' } },
        { _wmkf_contact_value: 'c1', wmkf_Contact: { fullname: 'Ann Lee Duplicate' } }, // dedupe: first wins
      ],
    });

    const out = await fetchCoPIs('request-guid-1');

    expect(out).toEqual(['Ann Lee', 'Bob Roe']);
    expect(query).toHaveBeenCalledWith('wmkf_apprequestpersons', {
      select: '_wmkf_contact_value,wmkf_authorposition',
      expand: 'wmkf_Contact($select=fullname,firstname,lastname)',
      filter: '_wmkf_request_value eq request-guid-1 and wmkf_role eq 100000001',
      orderby: 'wmkf_authorposition asc,createdon asc',
      top: 50,
    });
  });

  test('rows with no resolvable name are skipped', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { _wmkf_contact_value: 'c1', wmkf_Contact: {} },
        { _wmkf_contact_value: 'c2', wmkf_Contact: { fullname: 'Cy Poe' } },
      ],
    });

    const out = await fetchCoPIs('request-guid-2');
    expect(out).toEqual(['Cy Poe']);
  });
});

describe('fetchCoPIs — failure/edge path', () => {
  test('no requestId short-circuits without querying Dynamics', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords');
    const out = await fetchCoPIs(undefined);
    expect(out).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('no matching rows returns an empty array', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const out = await fetchCoPIs('request-guid-3');
    expect(out).toEqual([]);
  });
});

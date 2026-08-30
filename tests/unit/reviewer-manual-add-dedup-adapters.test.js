/**
 * @jest-environment node
 *
 * Manual-add cross-store dedup adapter helpers.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as potentialReviewer from '../../lib/dataverse/adapters/potential-reviewer.js';
import * as contact from '../../lib/dataverse/adapters/contact.js';

const ORCID = '0000-0002-1825-0097';

afterEach(() => jest.restoreAllMocks());

describe('potential-reviewer candidate helpers', () => {
  test('findByEmailCandidates detects an ambiguous normalized email with top:2', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { wmkf_potentialreviewersid: 'r1', wmkf_emailaddress: 'Ada@Example.edu' },
        { wmkf_potentialreviewersid: 'r2', wmkf_emailaddress: 'ada@example.edu' },
      ],
    });
    const out = await potentialReviewer.findByEmailCandidates(' ada@example.edu ');
    expect(out).toMatchObject({ ambiguous: true, count: 2 });
    expect(query.mock.calls[0][1]).toMatchObject({ top: 2 });
  });

  test('findByEmailCandidates prefers one active exact owner over an inactive historical owner', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { wmkf_potentialreviewersid: 'inactive', wmkf_emailaddress: 'ada@example.edu', statecode: 1 },
        { wmkf_potentialreviewersid: 'active', wmkf_emailaddress: 'ADA@example.edu', statecode: 0 },
      ],
    });

    await expect(potentialReviewer.findByEmailCandidates('ada@example.edu')).resolves.toMatchObject({
      one: true,
      id: 'active',
      inactiveRows: [expect.objectContaining({ wmkf_potentialreviewersid: 'inactive' })],
    });
  });

  test('findByOrcidCandidates returns one by canonical normalized ORCID', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_potentialreviewersid: 'r1', wmkf_orcid: `https://orcid.org/${ORCID}` }],
    });
    await expect(potentialReviewer.findByOrcidCandidates(ORCID)).resolves.toMatchObject({ one: true, id: 'r1' });
  });

  test('findByContactId uses the reverse lookup field', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_potentialreviewersid: 'r1', _wmkf_contact_value: 'c1' }],
    });
    const out = await potentialReviewer.findByContactId('c1');
    expect(out.wmkf_potentialreviewersid).toBe('r1');
    expect(query.mock.calls[0][1].filter).toBe('_wmkf_contact_value eq c1');
  });

  test('searchByName uses structured lastname/firstname before fallback', async () => {
    // searchByName issues the lastname-eq variant then the startswith variant
    // (a two-part name), so the mock must answer every call, not just the first.
    const query = jest.spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValue({ records: [{ wmkf_potentialreviewersid: 'r1', wmkf_firstname: 'Ada', wmkf_lastname: 'Lovelace', wmkf_name: 'Ada Lovelace' }] });
    const out = await potentialReviewer.searchByName('Ada Lovelace', { top: 5 });
    expect(out).toHaveLength(1);
    expect(query.mock.calls[0][1].filter).toContain('wmkf_lastname eq');
  });

  test('setContactLink noops same link and conflicts on different link', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValueOnce({ wmkf_potentialreviewersid: 'r1', _wmkf_contact_value: 'c1' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await expect(potentialReviewer.setContactLink('r1', 'c1')).resolves.toEqual({ action: 'noop', contactId: 'c1' });
    expect(patch).not.toHaveBeenCalled();

    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValueOnce({ wmkf_potentialreviewersid: 'r1', _wmkf_contact_value: 'c2' });
    await expect(potentialReviewer.setContactLink('r1', 'c1')).rejects.toMatchObject({ code: 'reviewer_linked_elsewhere', status: 409 });
  });

  test('setContactLink conflicts when contact is linked to another reviewer', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'r1',
      _wmkf_contact_value: null,
      _etag: 'W/"1"',
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ wmkf_potentialreviewersid: 'r2', _wmkf_contact_value: 'c1' }] });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    await expect(potentialReviewer.setContactLink('r1', 'c1')).rejects.toMatchObject({ code: 'contact_linked_elsewhere', status: 409 });
    expect(patch).not.toHaveBeenCalled();
  });

  test('setContactLink uses the reviewer ETag for an atomic compare-and-set', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_potentialreviewersid: 'r1',
      _wmkf_contact_value: null,
      _etag: 'W/"9"',
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await expect(potentialReviewer.setContactLink('r1', 'c1', {
      actingUserSystemId: 'user-1',
    })).resolves.toEqual({ action: 'link', contactId: 'c1' });
    expect(patch).toHaveBeenCalledWith(
      'wmkf_potentialreviewerses',
      'r1',
      { 'wmkf_Contact@odata.bind': '/contacts(c1)' },
      { actingUserSystemId: 'user-1', ifMatch: 'W/"9"' },
    );
  });
});

describe('contact candidate helpers', () => {
  test('findByEmailCandidates returns none for empty and one for normalized match', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ contactid: 'c1', emailaddress1: 'Ada@Example.edu' }] });
    await expect(contact.findByEmailCandidates('')).resolves.toEqual({ none: true });
    await expect(contact.findByEmailCandidates('ada@example.edu')).resolves.toMatchObject({ one: true, id: 'c1' });
    expect(query.mock.calls[0][1]).toMatchObject({ top: 2 });
  });

  test('findByOrcidCandidates detects ambiguity', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ contactid: 'c1', wmkf_orcid: ORCID }, { contactid: 'c2', wmkf_orcid: ORCID }],
    });
    await expect(contact.findByOrcidCandidates(ORCID)).resolves.toMatchObject({ ambiguous: true, count: 2 });
  });

  test('exact inactive-only contact matches are never auto-link candidates', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{
        contactid: 'inactive',
        emailaddress1: 'ada@example.edu',
        statecode: 1,
      }],
    });

    await expect(contact.findByEmailCandidates('ada@example.edu')).resolves.toMatchObject({
      ambiguous: true,
      inactiveOnly: true,
      count: 1,
      rows: [expect.objectContaining({ contactid: 'inactive' })],
    });
  });

  test('searchByName ranks active contacts first', async () => {
    // Persistent mock: searchByName runs several structured filter variants;
    // every call returns the same two rows so dedup + active-first ranking apply.
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { contactid: 'inactive', firstname: 'Ada', lastname: 'Lovelace', fullname: 'Ada Lovelace', statecode: 1 },
        { contactid: 'active', firstname: 'Ada', lastname: 'Lovelace', fullname: 'Ada Lovelace', statecode: 0 },
      ],
    });
    const out = await contact.searchByName('Ada Lovelace', { top: 5 });
    expect(out.map((r) => r.contactid)).toEqual(['active', 'inactive']);
  });

  test('searchDirectoryByName supports surname prefixes in one bounded query', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { contactid: 'active', firstname: 'Ada', lastname: 'Lovelace', fullname: 'Ada Lovelace', statecode: 0 },
      ],
    });

    await expect(contact.searchDirectoryByName('Love', { top: 50 })).resolves.toEqual([
      expect.objectContaining({ contactid: 'active' }),
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('contacts', expect.objectContaining({
      filter: "(startswith(lastname,'Love') or startswith(firstname,'Love'))",
      orderby: 'statecode asc,lastname asc,firstname asc',
      top: 50,
    }));
  });

  test('searchDirectoryByName caps one bounded query at 51 rows for truncation detection', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });

    await contact.searchDirectoryByName('Harris', { top: 500 });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('contacts', expect.objectContaining({ top: 51 }));
  });

  test('searchDirectoryByName supports partial full names and escapes filter literals', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });

    await expect(contact.searchDirectoryByName("Ada O'Ne", { top: 5 })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toMatchObject({
      filter: "(startswith(fullname,'Ada O''Ne') or (startswith(firstname,'Ada') and startswith(lastname,'O''Ne')))",
      top: 5,
    });
  });

  test('searchDirectoryByName skips blank input without a Dataverse request', async () => {
    const query = jest.spyOn(DynamicsService, 'queryRecords');
    await expect(contact.searchDirectoryByName('   ')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

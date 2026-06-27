/**
 * @jest-environment node
 */

import { syncReviewerNameTitleToContact } from '../../lib/services/sync-reviewer-name-title-to-contact.js';

function fakeContacts(result = { updated: ['firstname', 'lastname', 'nickname', 'jobtitle'] }) {
  return {
    updateIdentityFields: jest.fn().mockResolvedValue(result),
  };
}

describe('syncReviewerNameTitleToContact', () => {
  test('untrusted caller skips and does not update contact', async () => {
    const contactsAdapter = fakeContacts();
    const out = await syncReviewerNameTitleToContact({
      reviewer: { wmkf_identitystatus: 'confirmed', _wmkf_contact_value: 'contact-1' },
      suggestion: {
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewernickname: 'Addie',
        wmkf_reviewertitle: 'Professor',
      },
    }, { contactsAdapter });

    expect(out).toEqual({ skipped: 'untrusted' });
    expect(contactsAdapter.updateIdentityFields).not.toHaveBeenCalled();
  });

  test('trusted accept-path syncs regardless of identitystatus when contact is present', async () => {
    const contactsAdapter = fakeContacts({ updated: ['firstname', 'lastname', 'nickname', 'jobtitle'] });
    const out = await syncReviewerNameTitleToContact({
      trusted: true,
      reviewer: { wmkf_identitystatus: 'unresolved', _wmkf_contact_value: 'contact-1' },
      suggestion: {
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewernickname: 'Addie',
        wmkf_reviewertitle: 'Professor',
      },
    }, { contactsAdapter });

    expect(out).toEqual({ updated: ['firstname', 'lastname', 'nickname', 'jobtitle'] });
    expect(contactsAdapter.updateIdentityFields).toHaveBeenCalledWith(
      'contact-1',
      { firstName: 'Ada', lastName: 'Lovelace', nickname: 'Addie', jobTitle: 'Professor' },
      { actingUserSystemId: undefined },
    );
  });

  test('no contactId on reviewer or argument skips no_contact', async () => {
    const contactsAdapter = fakeContacts();
    const out = await syncReviewerNameTitleToContact({
      trusted: true,
      reviewer: { wmkf_identitystatus: 'confirmed' },
      suggestion: {
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewertitle: 'Professor',
      },
    }, { contactsAdapter });

    expect(out).toEqual({ skipped: 'no_contact' });
    expect(contactsAdapter.updateIdentityFields).not.toHaveBeenCalled();
  });

  test('happy path writes all four non-empty fields', async () => {
    const contactsAdapter = fakeContacts({ updated: ['firstname', 'lastname', 'nickname', 'jobtitle'] });
    const out = await syncReviewerNameTitleToContact({
      trusted: true,
      reviewer: { wmkf_identitystatus: 'probable', _wmkf_contact_value: 'contact-pointer' },
      suggestion: {
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewernickname: 'Addie',
        wmkf_reviewertitle: 'Professor',
      },
      contactId: 'contact-explicit',
      actingUserSystemId: 'user-1',
    }, { contactsAdapter });

    expect(out).toEqual({ updated: ['firstname', 'lastname', 'nickname', 'jobtitle'] });
    expect(contactsAdapter.updateIdentityFields).toHaveBeenCalledWith(
      'contact-explicit',
      { firstName: 'Ada', lastName: 'Lovelace', nickname: 'Addie', jobTitle: 'Professor' },
      { actingUserSystemId: 'user-1' },
    );
  });

  test('partial source writes only nickname and title when they are the only non-empty fields', async () => {
    const contactsAdapter = fakeContacts({ updated: ['nickname', 'jobtitle'] });
    const out = await syncReviewerNameTitleToContact({
      trusted: true,
      reviewer: { wmkf_identitystatus: 'confirmed', _wmkf_contact_value: 'contact-1' },
      suggestion: {
        wmkf_reviewerfirstname: '',
        wmkf_reviewerlastname: '   ',
        wmkf_reviewernickname: 'Ada',
        wmkf_reviewertitle: 'Assistant Professor',
      },
    }, { contactsAdapter });

    expect(out).toEqual({ updated: ['nickname', 'jobtitle'] });
    expect(contactsAdapter.updateIdentityFields).toHaveBeenCalledWith(
      'contact-1',
      { nickname: 'Ada', jobTitle: 'Assistant Professor' },
      { actingUserSystemId: undefined },
    );
  });

  test('empty and blank source fields are not written', async () => {
    const contactsAdapter = fakeContacts();
    const out = await syncReviewerNameTitleToContact({
      trusted: true,
      reviewer: { wmkf_identitystatus: 'confirmed', _wmkf_contact_value: 'contact-1' },
      suggestion: {
        wmkf_reviewerfirstname: '',
        wmkf_reviewerlastname: '   ',
        wmkf_reviewernickname: ' ',
        wmkf_reviewertitle: null,
      },
    }, { contactsAdapter });

    expect(out).toEqual({ skipped: 'no_fields' });
    expect(contactsAdapter.updateIdentityFields).not.toHaveBeenCalled();
  });

  test('adapter failure is caught and returned as non-fatal sync_failed', async () => {
    const error = new Error('Dataverse PATCH failed');
    const contactsAdapter = {
      updateIdentityFields: jest.fn().mockRejectedValue(error),
    };
    const warn = jest.fn();

    const out = await syncReviewerNameTitleToContact({
      trusted: true,
      reviewer: { wmkf_identitystatus: 'confirmed', _wmkf_contact_value: 'contact-1' },
      suggestion: {
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewernickname: 'Addie',
        wmkf_reviewertitle: 'Professor',
      },
    }, { contactsAdapter, warn });

    expect(out).toEqual({ skipped: 'sync_failed', error });
    expect(contactsAdapter.updateIdentityFields).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[sync-reviewer-name-title-to-contact] contact identity sync failed (non-fatal):',
      'Dataverse PATCH failed',
    );
  });
});

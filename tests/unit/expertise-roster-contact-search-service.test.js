/** @jest-environment node */

import {
  getRosterContactById,
  normalizeRosterContactSearchQuery,
  searchRosterContacts,
} from '../../lib/services/expertise-finder/roster-contact-link-service';

const guid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

test('contact search validation trims whitespace and rejects values outside 2–100 characters', () => {
  expect(normalizeRosterContactSearchQuery('  Ada   Lovelace ')).toBe('Ada Lovelace');
  expect(() => normalizeRosterContactSearchQuery('a')).toThrow(/between 2 and 100/i);
  expect(() => normalizeRosterContactSearchQuery('x'.repeat(101))).toThrow(/between 2 and 100/i);
});

test('contact search returns a bounded, normalized availability contract', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    contactid: guid(index + 1),
    fullname: `Person ${index + 1}`,
    emailaddress1: index === 1 ? null : ` PERSON${index + 1}@Example.org `,
    statecode: index === 2 ? 1 : 0,
  }));
  const searchContactsByName = jest.fn(async () => rows);

  const result = await searchRosterContacts('Person', { searchContactsByName });

  expect(searchContactsByName).toHaveBeenCalledWith('Person', { top: 51 });
  expect(result.contacts).toHaveLength(50);
  expect(result).toMatchObject({ truncated: true, limit: 50 });
  expect(result.contacts[0]).toMatchObject({ email: 'person1@example.org', active: true, available: true, reason: null });
  expect(result.contacts[1]).toMatchObject({ email: null, active: true, available: false, reason: 'contact_email_missing' });
  expect(result.contacts[2]).toMatchObject({ email: null, active: false, available: false, reason: 'contact_inactive' });
});

test('exact linked-contact reads return current health and represent a missing Contact explicitly', async () => {
  const id = guid(1);
  await expect(getRosterContactById(id, {
    getContactsByIds: jest.fn(async () => [{ contactid: id, fullname: 'Ada', emailaddress1: ' ADA@example.org ', statecode: 0 }]),
  })).resolves.toEqual({
    contactId: id, name: 'Ada', email: 'ada@example.org', active: true, available: true, reason: null,
  });
  await expect(getRosterContactById(id, {
    getContactsByIds: jest.fn(async () => []),
  })).resolves.toEqual({
    contactId: id, name: '', email: null, active: false, available: false, reason: 'contact_missing',
  });
});

test('invalid and duplicate Contact IDs are omitted without expanding the result', async () => {
  const id = guid(1);
  const result = await searchRosterContacts('Ada', {
    searchContactsByName: jest.fn(async () => [
      { contactid: 'not-a-guid', fullname: 'Bad', emailaddress1: 'bad@example.org', statecode: 0 },
      { contactid: id, fullname: 'Ada', emailaddress1: 'ada@example.org', statecode: 0 },
      { contactid: id.toUpperCase(), fullname: 'Ada duplicate', emailaddress1: 'other@example.org', statecode: 0 },
    ]),
  });
  expect(result.contacts).toEqual([expect.objectContaining({ contactId: id, name: 'Ada' })]);
  expect(result.truncated).toBe(false);
});

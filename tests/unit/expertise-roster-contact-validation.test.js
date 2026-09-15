/** @jest-environment node */

import {
  assertLinkedPreferredEmail,
  normalizeDataverseContactId,
} from '../../pages/api/expertise-finder/roster';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

test('Contact IDs normalize empty values to null and GUIDs to lowercase', () => {
  expect(normalizeDataverseContactId(null)).toBeNull();
  expect(normalizeDataverseContactId('')).toBeNull();
  expect(normalizeDataverseContactId('   ')).toBeNull();
  expect(normalizeDataverseContactId(CONTACT_ID.toUpperCase())).toBe(CONTACT_ID);
  expect(() => normalizeDataverseContactId('not-a-guid')).toThrow(/must be a GUID/i);
});

test('linked preferred-email validation covers every D2a combination', () => {
  expect(() => assertLinkedPreferredEmail({ resultingContactId: CONTACT_ID, submittedPreferredEmail: 'new@example.org', creating: true })).toThrow(/cannot be changed/i);
  expect(() => assertLinkedPreferredEmail({ resultingContactId: CONTACT_ID, submittedPreferredEmail: 'new@example.org', storedPreferredEmail: 'old@example.org' })).toThrow(/cannot be changed/i);
  expect(() => assertLinkedPreferredEmail({ resultingContactId: CONTACT_ID, submittedPreferredEmail: ' OLD@example.org ', storedPreferredEmail: 'old@example.org' })).not.toThrow();
  expect(() => assertLinkedPreferredEmail({ resultingContactId: CONTACT_ID, submittedPreferredEmail: '' })).not.toThrow();
  expect(() => assertLinkedPreferredEmail({ resultingContactId: CONTACT_ID, submittedPreferredEmail: null })).not.toThrow();
  expect(() => assertLinkedPreferredEmail({ resultingContactId: null, submittedPreferredEmail: 'new@example.org', storedPreferredEmail: 'old@example.org' })).not.toThrow();
  expect(() => assertLinkedPreferredEmail({ resultingContactId: CONTACT_ID, submittedPreferredEmail: undefined, storedPreferredEmail: 'old@example.org' })).not.toThrow();
});

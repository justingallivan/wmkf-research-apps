const { holdFindContact, staffContactRequestEnabled } = require('../../lib/services/contact-enrichment/staff-contact-pilot');
const { heldFindContactEmails } = require('../../lib/utils/reviewer-address-trust');

const guid = '12345678-0000-4000-8000-000000000001';

test.each(['', 'bad', guid + ',bad', Array(21).fill(guid).join(',')])('enrollment fails closed', ids => {
  const before = process.env.J27_STAFF_CONTACT_REQUEST_IDS;
  try {
    process.env.J27_STAFF_CONTACT_REQUEST_IDS = ids;
    expect(staffContactRequestEnabled(guid)).toBe(false);
    process.env.J27_STAFF_CONTACT_REQUEST_IDS = guid;
    expect(staffContactRequestEnabled(guid)).toBe(true);
    expect(staffContactRequestEnabled(guid.replace(/1$/, '2'))).toBe(false);
  } finally {
    if (before == null) delete process.env.J27_STAFF_CONTACT_REQUEST_IDS;
    else process.env.J27_STAFF_CONTACT_REQUEST_IDS = before;
  }
});

test.each(['institution_page','serp_search','claude_search','search_contested'])('lookup produces no primary for %s', source => {
  const email = 'reviewer@example.edu';
  const row = { isClaudeSuggestion: true, email, contactEnrichment: { email, emailSource: source,
    emailPersistAllowed: true, tierResults: {} } };
  holdFindContact(row, row);
  expect(row.email).toBeNull();
  expect(row.contactEnrichment).toMatchObject({ email: null, emailPersistAllowed: false });
  expect(heldFindContactEmails(row)).toEqual(source === 'search_contested' ? [] : [email]);
});

test.each([{isClaudeSuggestion:false},{isClaudeSuggestion:true,isApplicantRecommended:true}])('leaves other origins intact', origin => {
  const ce = { email:'other@example.edu', emailSource:'serp_search' };
  holdFindContact(origin, { contactEnrichment:ce });
  expect(ce.email).toBe('other@example.edu');
});

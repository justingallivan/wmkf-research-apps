const { holdFindContact } = require('../../lib/services/contact-enrichment/staff-contact-pilot');
const { heldFindContactEmails } = require('../../lib/utils/reviewer-address-trust');

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

test.each(['serp_search', 'search_contested'])('a literature-sourced Find candidate holds a %s address', source => {
  const email = 'author@example.edu';
  const row = { provenance: { kind: 'literature_retrieved' }, email, contactEnrichment: {
    email, emailSource: source, emailPersistAllowed: true, tierResults: {},
  } };
  holdFindContact(row, row);
  expect(row.email).toBeNull();
  expect(row.contactEnrichment.emailPersistAllowed).toBe(false);
  expect(heldFindContactEmails(row)).toEqual(source === 'search_contested' ? [] : [email]);
});

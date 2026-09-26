/**
 * Test Request Factory synthetic-reviewer seeder (slice 6c-ii Stage B):
 * lib/services/reviewer-engagement/seed-synthetic-review.js. Pure-function
 * tests only -- no I/O.
 */
import {
  syntheticPersonProjection,
  SYNTHETIC_PERSON_PROJECTION_FIELDS,
  SUGGESTION_CREATE_ALLOWLIST,
  buildSuggestionCreateBody,
  buildCompletionWrite,
} from '../../lib/services/reviewer-engagement/seed-synthetic-review.js';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';
const SUGGESTION_ID = '44444444-4444-4444-8444-444444444444';

function bundleReviewer(overrides = {}) {
  return {
    suggestionId: SUGGESTION_ID,
    personId: '55555555-5555-4555-8555-555555555555',
    person: {
      wmkf_name: 'Jane Reviewer',
      wmkf_firstname: 'Jane',
      wmkf_lastname: 'Reviewer',
      wmkf_areaofexpertise: 'Genomics',
      wmkf_primaryaffiliation: 'Example University',
      wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology',
      wmkf_maininstitution: 'Example University',
    },
    personIsSynthetic: false,
    suggestion: {
      wmkf_suggestionlabel: 'Auto Suggestion', wmkf_programarea: 100000000, wmkf_relevancescore: 90,
      wmkf_matchreason: 'expertise match', wmkf_sources: 'claude', wmkf_selected: true, wmkf_invited: true,
      wmkf_accepted: true, wmkf_declined: false, wmkf_responsetype: 100000000,
      wmkf_emailsentat: '2026-01-01T00:00:00Z', wmkf_responsereceivedat: '2026-01-02T00:00:00Z',
      wmkf_materialssentat: '2026-01-03T00:00:00Z',
      wmkf_reviewreceivedat: '2026-01-10T00:00:00Z', wmkf_completedat: '2026-01-10T00:00:00Z',
      wmkf_thankyousentat: null, wmkf_reviewstatus: 100000001,
      wmkf_revieweraffiliation: 'Example University', wmkf_reviewuploadedbystaff: false,
      wmkf_reviewerfirstname: 'Jane', wmkf_reviewerlastname: 'Reviewer', wmkf_reviewernickname: null,
      wmkf_reviewertitle: 'Dr.', wmkf_applicantdisposition: null,
    },
    answers: [
      {
        wmkf_questionkey: 'riskLevel', wmkf_questionorder: 1, wmkf_questiontext: 'Risk?', wmkf_questiontype: 'picklist',
        wmkf_answerhtml: null, wmkf_answertext: 'Low', wmkf_answervalue: 1, wmkf_answervalues: null,
        wmkf_questionoptions: JSON.stringify([{ value: 1, label: 'Low' }]),
      },
    ],
    reviewForm: 'uploaded',
    files: [],
    ...overrides,
  };
}

describe('syntheticPersonProjection', () => {
  it('prefixes the name, copies expertise/affiliation fields verbatim with null preserved, sets the marker true, derives the organizationname shadow', () => {
    const projection = syntheticPersonProjection(bundleReviewer(), 'throwaway@example.test');
    expect(projection).toEqual({
      wmkf_name: 'TEST · Jane Reviewer',
      wmkf_firstname: 'Jane',
      wmkf_lastname: 'Reviewer',
      wmkf_emailaddress: 'throwaway@example.test',
      wmkf_issyntheticreviewer: true,
      wmkf_areaofexpertise: 'Genomics',
      wmkf_primaryaffiliation: 'Example University',
      wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology',
      wmkf_maininstitution: 'Example University',
      wmkf_organizationname: 'Example University',
    });
  });

  it('preserves null on every copied field when the source carries none, including the organizationname shadow', () => {
    const reviewer = bundleReviewer({
      person: { wmkf_name: 'X', wmkf_firstname: null, wmkf_lastname: null, wmkf_areaofexpertise: null, wmkf_primaryaffiliation: null, wmkf_academicrank: null, wmkf_primarydepartment: null, wmkf_maininstitution: null },
    });
    const projection = syntheticPersonProjection(reviewer, 'a@example.test');
    expect(projection.wmkf_firstname).toBeNull();
    expect(projection.wmkf_areaofexpertise).toBeNull();
    expect(projection.wmkf_maininstitution).toBeNull();
    expect(projection.wmkf_organizationname).toBeNull();
  });

  it('clamps the organizationname shadow to 100 chars (byte-mirror of potential-reviewer.js clamp()), the primaryaffiliation field itself uncapped', () => {
    const longAffiliation = `${'A'.repeat(150)}`;
    const reviewer = bundleReviewer({ person: { ...bundleReviewer().person, wmkf_primaryaffiliation: longAffiliation } });
    const projection = syntheticPersonProjection(reviewer, 'a@example.test');
    expect(projection.wmkf_primaryaffiliation).toBe(longAffiliation);
    expect(projection.wmkf_organizationname).toHaveLength(100);
    expect(projection.wmkf_organizationname.endsWith('…')).toBe(true);
    expect(projection.wmkf_organizationname.startsWith('A'.repeat(99))).toBe(true);
  });

  it('never emits an ORCID, Contact link, email-source, or trust-state field', () => {
    const projection = syntheticPersonProjection(bundleReviewer(), 'a@example.test');
    for (const forbidden of ['wmkf_orcid', 'wmkf_orcidurl', '_wmkf_contact_value', 'wmkf_emailsource', 'wmkf_addresstruststatejson']) {
      expect(Object.prototype.hasOwnProperty.call(projection, forbidden)).toBe(false);
    }
  });
});

describe('SYNTHETIC_PERSON_PROJECTION_FIELDS', () => {
  it('is exactly the key set syntheticPersonProjection writes, for any input', () => {
    const keys = Object.keys(syntheticPersonProjection(bundleReviewer(), 'a@example.test')).sort();
    expect([...SYNTHETIC_PERSON_PROJECTION_FIELDS].sort()).toEqual(keys);
  });
});

describe('buildSuggestionCreateBody / SUGGESTION_CREATE_ALLOWLIST', () => {
  it('the body key set is a subset of the allowlist for a fully populated bundle reviewer', () => {
    const body = buildSuggestionCreateBody(bundleReviewer(), {
      destinationRequestId: REQUEST_ID, destinationPersonId: PERSON_ID, grantCycleCode: 'S330',
    });
    for (const key of Object.keys(body)) {
      expect(SUGGESTION_CREATE_ALLOWLIST).toContain(key);
    }
  });

  it('never carries a completion, file-pointer, or token/honorarium field', () => {
    const body = buildSuggestionCreateBody(bundleReviewer(), {
      destinationRequestId: REQUEST_ID, destinationPersonId: PERSON_ID, grantCycleCode: 'S330',
    });
    for (const forbidden of [
      'wmkf_reviewreceivedat', 'wmkf_reviewstatus', 'wmkf_completedat', 'wmkf_thankyousentat',
      'wmkf_reviewuploadedbystaff', 'wmkf_reviewsharepointfolder', 'wmkf_reviewfilename',
      'wmkf_honorariumrequest', 'wmkf_externaltoken',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body, forbidden)).toBe(false);
    }
  });

  it('crash-boundary: the completion fields are null after the create alone (proven by the body itself carrying none)', () => {
    // The create body is the ONLY write in the create step; if it never
    // carries a completion field, Dataverse's own schema default (false/null)
    // is what a fresh row reads back immediately after this POST, before any
    // answers changeset runs.
    const body = buildSuggestionCreateBody(bundleReviewer(), {
      destinationRequestId: REQUEST_ID, destinationPersonId: PERSON_ID, grantCycleCode: 'S330',
    });
    expect('wmkf_reviewreceivedat' in body).toBe(false);
    expect('wmkf_completedat' in body).toBe(false);
  });

  it('binds the destination person/request and the derived (never source) grant cycle code', () => {
    const body = buildSuggestionCreateBody(bundleReviewer(), {
      destinationRequestId: REQUEST_ID, destinationPersonId: PERSON_ID, grantCycleCode: 'S330',
    });
    expect(body['wmkf_PotentialReviewer@odata.bind']).toBe(`/wmkf_potentialreviewerses(${PERSON_ID})`);
    expect(body['wmkf_Request@odata.bind']).toBe(`/akoya_requests(${REQUEST_ID})`);
    expect(body.wmkf_grantcyclecode).toBe('S330');
  });

  it('copies candidate/lifecycle fields verbatim with null preserved', () => {
    const body = buildSuggestionCreateBody(bundleReviewer(), {
      destinationRequestId: REQUEST_ID, destinationPersonId: PERSON_ID, grantCycleCode: 'S330',
    });
    expect(body.wmkf_suggestionlabel).toBe('Auto Suggestion');
    expect(body.wmkf_reviewernickname).toBeNull();
  });
});

describe('buildCompletionWrite', () => {
  it('unreceived: no write at all', () => {
    expect(buildCompletionWrite(bundleReviewer({ reviewForm: 'unreceived' }), { suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"' })).toBeNull();
  });

  it('uploaded with answers: an atomic parent-with-children changeset, answers before the parent PATCH', () => {
    const write = buildCompletionWrite(bundleReviewer(), { suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"' });
    expect(write.answerCount).toBe(1);
    expect(write.operations).toHaveLength(2);
    expect(write.operations[0].method).toBe('PATCH');
    expect(write.operations[0].keyPredicate).toContain('riskLevel');
    expect(write.operations[1].method).toBe('PATCH');
    expect(write.operations[1].key).toBe(SUGGESTION_ID);
    expect(write.operations[1].ifMatch).toBe('W/"1"');
  });

  it('received_no_file with zero answers: a single parent-only PATCH op', () => {
    const write = buildCompletionWrite(bundleReviewer({ reviewForm: 'received_no_file', answers: [], files: [] }), {
      suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"',
    });
    expect(write.answerCount).toBe(0);
    expect(write.operations).toHaveLength(1);
    expect(write.operations[0].method).toBe('PATCH');
    expect(write.operations[0].key).toBe(SUGGESTION_ID);
  });

  it('received_no_file with answers: an atomic changeset (answer-bearing manual-entry receipt shape)', () => {
    const write = buildCompletionWrite(bundleReviewer({ reviewForm: 'received_no_file', files: [] }), {
      suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"',
    });
    expect(write.answerCount).toBe(1);
    expect(write.operations).toHaveLength(2);
  });

  it('D-R6: stamps thank-you at the received time when the source has none', () => {
    const write = buildCompletionWrite(bundleReviewer(), { suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"' });
    const parent = write.operations[write.operations.length - 1];
    expect(parent.body.wmkf_thankyousentat).toBe('2026-01-10T00:00:00Z');
  });

  it('never carries the file pointers when filePointers is not supplied (Stage B seam)', () => {
    const write = buildCompletionWrite(bundleReviewer(), { suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"' });
    const parent = write.operations[write.operations.length - 1];
    expect('wmkf_reviewsharepointfolder' in parent.body).toBe(false);
    expect('wmkf_reviewfilename' in parent.body).toBe(false);
  });

  it('carries the file pointers when filePointers is supplied (Stage C seam)', () => {
    const write = buildCompletionWrite(bundleReviewer({ reviewForm: 'received_no_file', answers: [], files: [] }), {
      suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"', filePointers: { folder: 'Reviewer_Uploads/x/attempt_1', filename: 'Review_1.pdf' },
    });
    const parent = write.operations[0];
    expect(parent.body.wmkf_reviewsharepointfolder).toBe('Reviewer_Uploads/x/attempt_1');
    expect(parent.body.wmkf_reviewfilename).toBe('Review_1.pdf');
  });

  it('throws on malformed JSON in a bundle answer field rather than silently dropping it', () => {
    const reviewer = bundleReviewer({ answers: [{ ...bundleReviewer().answers[0], wmkf_answervalues: '{not json' }] });
    expect(() => buildCompletionWrite(reviewer, { suggestionId: SUGGESTION_ID, ifMatch: 'W/"1"' })).toThrow(/not valid JSON/);
  });
});

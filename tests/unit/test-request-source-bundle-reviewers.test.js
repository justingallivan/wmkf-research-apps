/**
 * @jest-environment node
 *
 * 6c-ii Stage A2: bundle v3's reviewers[] section -- projection/validator,
 * the strict rejection list, the review-form classifier, the two-pass
 * consistency fence, version 2/3 compatibility, and the CLI's
 * reviews-recipe refusal of a v2 bundle.
 */
import { jest } from '@jest/globals';
import {
  SOURCE_BUNDLE_KIND,
  REVIEW_FORM,
  buildSourceBundle,
  readSourceBundle,
  exportTestRequestSourceBundle,
  assertReviewerSourceUnchanged,
  assertBundleHasReviewerSectionForRecipe,
  classifyReviewerForm,
} from '../../lib/services/test-requests/source-bundle.js';

const REQUEST_ID = 'E43AE6EA-698F-F111-8076-6045BD018A07';
const SUGGESTION_ID = 'C3F00000-1111-2222-3333-444455556666';
const PERSON_ID = 'D4F00000-1111-2222-3333-444455556666';

const sourceRow = (over = {}) => ({
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '1003222',
  akoya_requesttype: 100000001,
  akoya_purpose: 'Confidential purpose',
  akoya_request: 1000000,
  akoya_fiscalyear: 'December 2026',
  wmkf_meetingdate: '2026-12-03T00:00:00Z',
  versionnumber: 123456,
  ...over,
});

const sharePointSite = {
  key: 'akoyago-shared',
  hostname: 'appriver3651007194.sharepoint.com',
  pathname: '/sites/akoyago',
};

function reviewFile(over = {}) {
  return {
    id: 'inv-review-1',
    kind: 'reviewerUpload',
    library: 'akoya_request',
    folder: `1003222_E43AE6EA/Reviewer_Uploads/smith_1a2b3c4d/attempt_${'a'.repeat(32)}`,
    name: 'review.pdf',
    driveId: 'b!drive-id',
    graphItemId: '01REVIEW',
    sharePointSite,
    size: 2048,
    mimeType: 'application/pdf',
    eTag: '"{ETAG},1"',
    versionId: '1.0',
    contentHash: 'b'.repeat(64),
    suggestionId: SUGGESTION_ID,
    ...over,
  };
}

function reviewerEntry(over = {}) {
  return {
    suggestionId: SUGGESTION_ID,
    personId: PERSON_ID,
    suggestionEtag: '"{SUG-ETAG},1"',
    personEtag: '"{PERSON-ETAG},1"',
    personIsSynthetic: false,
    person: {
      wmkf_name: 'Ada Lovelace',
      wmkf_firstname: 'Ada',
      wmkf_lastname: 'Lovelace',
      wmkf_areaofexpertise: 'Computing',
      wmkf_primaryaffiliation: 'Analytical Engine Institute',
      wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Mathematics',
      wmkf_maininstitution: 'Analytical Engine Institute',
    },
    suggestion: {
        wmkf_suggestionlabel: 'Suggestion 1',
        wmkf_programarea: 'Science',
        wmkf_relevancescore: 90,
        wmkf_matchreason: 'Strong match',
        wmkf_sources: 'literature_retrieved',
        wmkf_selected: true,
        wmkf_invited: true,
        wmkf_accepted: true,
        wmkf_declined: false,
        wmkf_responsetype: 100000000,
        wmkf_emailsentat: '2026-01-01T00:00:00Z',
        wmkf_responsereceivedat: '2026-01-02T00:00:00Z',
        wmkf_materialssentat: '2026-01-03T00:00:00Z',
        wmkf_reviewreceivedat: '2026-01-10T00:00:00Z',
        wmkf_completedat: '2026-01-10T00:00:00Z',
        wmkf_thankyousentat: '2026-01-10T00:00:00Z',
        wmkf_reviewstatus: 100000003,
        wmkf_revieweraffiliation: 'Analytical Engine Institute',
        wmkf_reviewuploadedbystaff: false,
        wmkf_reviewerfirstname: 'Ada',
        wmkf_reviewerlastname: 'Lovelace',
        wmkf_reviewernickname: null,
      wmkf_reviewertitle: 'Dr',
      wmkf_applicantdisposition: null,
    },
    answers: [
      {
        wmkf_questionkey: 'impact',
        wmkf_questionorder: 1,
        wmkf_questiontext: 'Impact?',
        wmkf_questiontype: 'picklist',
        wmkf_answerhtml: '<p>High</p>',
        wmkf_answertext: 'High',
        wmkf_answervalue: '1',
        wmkf_answervalues: null,
        wmkf_questionoptions: null,
        eTag: '"{ANSWER-ETAG},1"',
      },
    ],
    reviewForm: REVIEW_FORM.UPLOADED,
    files: [reviewFile()],
    ...over,
  };
}

function build(over = {}) {
  return buildSourceBundle({
    sourceRow: sourceRow(),
    documents: [],
    dataverseHost: 'wmkf.crm.dynamics.com',
    exportedAt: new Date('2026-09-23T12:00:00Z'),
    reviewers: [reviewerEntry()],
    ...over,
  });
}

describe('projection + strict validator', () => {
  test('projects the allowlisted person/suggestion/answer fields, version 3', () => {
    const bundle = build();
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toHaveLength(1);
    const [reviewer] = bundle.reviewers;
    expect(reviewer.suggestionId).toBe(SUGGESTION_ID);
    expect(reviewer.personId).toBe(PERSON_ID);
    expect(reviewer.person.wmkf_name).toBe('Ada Lovelace');
    expect(reviewer.person).not.toHaveProperty('wmkf_emailaddress');
    expect(reviewer.suggestion.wmkf_suggestionlabel).toBe('Suggestion 1');
    expect(reviewer.answers).toEqual([{
      wmkf_questionkey: 'impact',
      wmkf_questionorder: 1,
      wmkf_questiontext: 'Impact?',
      wmkf_questiontype: 'picklist',
      wmkf_answerhtml: '<p>High</p>',
      wmkf_answertext: 'High',
      wmkf_answervalue: '1',
      wmkf_answervalues: null,
      wmkf_questionoptions: null,
    }]);
    expect(reviewer.files).toHaveLength(1);
    expect(reviewer.files[0].kind).toBe('reviewerUpload');
  });

  test('a bundle with no reviewers argument stays version 2 with no reviewers key', () => {
    const bundle = buildSourceBundle({
      sourceRow: sourceRow(),
      documents: [],
      dataverseHost: 'wmkf.crm.dynamics.com',
      exportedAt: new Date('2026-09-23T12:00:00Z'),
    });
    expect(bundle.version).toBe(2);
    expect(bundle).not.toHaveProperty('reviewers');
    expect(JSON.stringify(bundle)).not.toMatch(/"reviewers"/);
  });

  test('an empty reviewers array still produces a version-3 bundle with the section present', () => {
    const bundle = build({ reviewers: [] });
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toEqual([]);
  });

  test.each([
    ['_wmkf_contact_value', { person: { _wmkf_contact_value: 'contact-1' } }],
    ['wmkf_addresstruststatejson', { person: { wmkf_addresstruststatejson: '{}' } }],
    ['wmkf_emailsource', { person: { wmkf_emailsource: 'manual' } }],
    ['wmkf_orcid', { person: { wmkf_orcid: '0000-0002-1825-0097' } }],
    ['wmkf_orcidurl', { person: { wmkf_orcidurl: 'https://orcid.org/0000-0002-1825-0097' } }],
    ['wmkf_proposalfirstaccessed', { person: { wmkf_proposalfirstaccessed: '2026-01-01T00:00:00Z' } }],
    ['wmkf_externaltokenhash', { suggestion: { wmkf_externaltokenhash: 'abc' } }],
    ['_wmkf_honorariumrequest_value', { suggestion: { _wmkf_honorariumrequest_value: 'req-1' } }],
    ['wmkf_honorariumrequest', { suggestion: { wmkf_honorariumrequest: 'req-1' } }],
    // P2-1 (Opus round 1, adjudication 3): wmkf_summarybloburl is a real URL
    // field (entity-registry.js:188); the guessed wmkf_proposalurl /
    // wmkf_proposalpassword names were dropped (not real fields).
    ['wmkf_summarybloburl', { suggestion: { wmkf_summarybloburl: 'https://blob.example/summary.txt' } }],
  ])('rejects a bundle carrying the forbidden field %s', (_name, rawOverride) => {
    const base = reviewerEntry();
    const entry = reviewerEntry({
      person: { ...base.person, ...(rawOverride.person || {}) },
      suggestion: { ...base.suggestion, ...(rawOverride.suggestion || {}) },
    });
    expect(() => build({ reviewers: [entry] })).toThrow(/forbidden field/);
  });

  test('rejects a real person\'s address when personIsSynthetic is not true', () => {
    const base = reviewerEntry();
    const entry = reviewerEntry({
      personIsSynthetic: false,
      person: { ...base.person, wmkf_emailaddress: 'real@example.edu' },
    });
    expect(() => build({ reviewers: [entry] })).toThrow(/personIsSynthetic must be true/);
  });

  test('exports the address only when personIsSynthetic is true', () => {
    const base = reviewerEntry();
    const entry = reviewerEntry({
      personIsSynthetic: true,
      person: { ...base.person, wmkf_emailaddress: 'synthetic@example.edu' },
    });
    const bundle = build({ reviewers: [entry] });
    expect(bundle.reviewers[0].person.wmkf_emailaddress).toBe('synthetic@example.edu');
    expect(bundle.reviewers[0].personIsSynthetic).toBe(true);
  });

  test('rejects more than one reviewer for the same suggestion', () => {
    expect(() => build({ reviewers: [reviewerEntry(), reviewerEntry()] })).toThrow(/more than one reviewer/);
  });

  test('rejects a review file not keyed to its own suggestion', () => {
    const entry = reviewerEntry({ files: [reviewFile({ suggestionId: 'someone-elses-suggestion' })] });
    expect(() => build({ reviewers: [entry] })).toThrow(/not keyed to its own suggestion/);
  });

  test('rejects an uploaded review with no files', () => {
    const entry = reviewerEntry({ files: [] });
    expect(() => build({ reviewers: [entry] })).toThrow(/carries no files/);
  });

  test('rejects a non-uploaded review that carries files', () => {
    const entry = reviewerEntry({ reviewForm: REVIEW_FORM.RECEIVED_NO_FILE, files: [reviewFile()] });
    expect(() => build({ reviewers: [entry] })).toThrow(/is not uploaded but carries files/);
  });
});

describe('classifyReviewerForm', () => {
  const classify = (result) => (folder) => result;

  test('a complete attempt_upload pointer pair is uploaded', () => {
    expect(classifyReviewerForm(
      { folder: 'x', filename: 'y', reviewReceivedAt: '2026-01-01' },
      classify('attempt_upload'),
    )).toBe(REVIEW_FORM.UPLOADED);
  });

  test('a complete filer-generated pointer pair is received_no_file', () => {
    expect(classifyReviewerForm(
      { folder: 'x', filename: 'y', reviewReceivedAt: '2026-01-01' },
      classify('generated'),
    )).toBe(REVIEW_FORM.RECEIVED_NO_FILE);
  });

  // P2-2 (Opus round 1): the plan requires an UNRECOGNIZED pointer state to
  // fail the export. `legacy` (a pre-request-level-Reviews-folder retained
  // file, review-file-provenance.js:35) is not a form Stage A/B/C models, so
  // it must fail closed, not be silently downgraded to received_no_file.
  test('a complete legacy-provenance pointer pair fails the export', () => {
    expect(() => classifyReviewerForm(
      { folder: 'x', filename: 'y', reviewReceivedAt: '2026-01-01' },
      classify('legacy'),
    )).toThrow(/unrecognized provenance/);
  });

  test('no pointers with a received stamp is received_no_file', () => {
    expect(classifyReviewerForm(
      { folder: null, filename: null, reviewReceivedAt: '2026-01-01' },
      classify('none'),
    )).toBe(REVIEW_FORM.RECEIVED_NO_FILE);
  });

  test('no pointers and no stamp is unreceived', () => {
    expect(classifyReviewerForm(
      { folder: null, filename: null, reviewReceivedAt: null },
      classify('none'),
    )).toBe(REVIEW_FORM.UNRECEIVED);
  });

  test('a partial pointer pair fails the export', () => {
    expect(() => classifyReviewerForm(
      { folder: 'x', filename: null, reviewReceivedAt: null },
      classify('none'),
    )).toThrow(/partial file pointer pair/);
  });

  test('an unrecognized provenance result fails the export', () => {
    expect(() => classifyReviewerForm(
      { folder: 'x', filename: 'y', reviewReceivedAt: null },
      classify('something-unknown'),
    )).toThrow(/unrecognized provenance/);
  });

  // P2-2: the classifier dependency defaults to the REAL shared helper (no
  // stub in production code paths); these fixtures use real folder paths
  // through the real classifyReviewFileProvenance, not a stub.
  describe('with the real classifyReviewFileProvenance (no stub, default parameter)', () => {
    test('a request-level Reviews folder (filer-generated) is received_no_file, file not exported', () => {
      const form = classifyReviewerForm({
        folder: `1003222_E43AE6EA/smith_${'a'.repeat(32)}/Reviews`,
        filename: 'Review.docx',
        reviewReceivedAt: '2026-01-10T00:00:00Z',
      });
      expect(form).toBe(REVIEW_FORM.RECEIVED_NO_FILE);
    });

    test('a Reviewer_Uploads/.../attempt_<32hex> folder is uploaded', () => {
      const form = classifyReviewerForm({
        folder: `1003222_E43AE6EA/Reviewer_Uploads/smith_1a2b3c4d/attempt_${'a'.repeat(32)}`,
        filename: 'review.pdf',
        reviewReceivedAt: '2026-01-10T00:00:00Z',
      });
      expect(form).toBe(REVIEW_FORM.UPLOADED);
    });

    test('a legacy (unrecognized) real path fails the export', () => {
      expect(() => classifyReviewerForm({
        folder: '1003222_E43AE6EA/Reviewer_Uploads/Generated/notactuallyhex',
        filename: 'Review.docx',
        reviewReceivedAt: '2026-01-10T00:00:00Z',
      })).toThrow(/unrecognized provenance/);
    });

    test('a partial pointer pair fails the export (real classifier never consulted)', () => {
      expect(() => classifyReviewerForm({
        folder: `1003222_E43AE6EA/Reviewer_Uploads/smith_1a2b3c4d/attempt_${'a'.repeat(32)}`,
        filename: null,
        reviewReceivedAt: null,
      })).toThrow(/partial file pointer pair/);
    });
  });
});

describe('version 2/3 read compatibility', () => {
  test('round-trips a version-3 bundle through readSourceBundle', () => {
    const bundle = build();
    const parsed = readSourceBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.version).toBe(3);
    expect(parsed.reviewers).toEqual(bundle.reviewers);
  });

  test('reads a legacy version-2 bundle (no reviewers section) unchanged', () => {
    const legacy = {
      kind: SOURCE_BUNDLE_KIND,
      version: 2,
      exportedAt: '2026-09-23T12:00:00.000Z',
      source: { dataverseHost: 'wmkf.crm.dynamics.com', request: { akoya_requestid: REQUEST_ID.toLowerCase(), akoya_requestnum: '1003222', akoya_requesttype: 100000001, revision: '123456' } },
      documents: [],
    };
    const parsed = readSourceBundle(legacy);
    expect(parsed.version).toBe(2);
    expect(parsed).not.toHaveProperty('reviewers');
  });

  test('refuses a version-3 bundle missing its reviewers array', () => {
    const malformed = {
      kind: SOURCE_BUNDLE_KIND,
      version: 3,
      exportedAt: '2026-09-23T12:00:00.000Z',
      source: { dataverseHost: 'wmkf.crm.dynamics.com', request: { akoya_requestid: REQUEST_ID.toLowerCase(), akoya_requestnum: '1003222', akoya_requesttype: 100000001, revision: '123456' } },
      documents: [],
    };
    expect(() => readSourceBundle(malformed)).toThrow(/missing its reviewers section/);
  });

  test('refuses a version-2 bundle that carries a reviewers key', () => {
    const malformed = {
      kind: SOURCE_BUNDLE_KIND,
      version: 2,
      exportedAt: '2026-09-23T12:00:00.000Z',
      source: { dataverseHost: 'wmkf.crm.dynamics.com', request: { akoya_requestid: REQUEST_ID.toLowerCase(), akoya_requestnum: '1003222', akoya_requesttype: 100000001, revision: '123456' } },
      documents: [],
      reviewers: [],
    };
    expect(() => readSourceBundle(malformed)).toThrow(/must not carry a reviewers section/);
  });
});

describe('assertBundleHasReviewerSectionForRecipe', () => {
  test('reviews recipe refuses a bundle with no reviewers section', () => {
    expect(() => assertBundleHasReviewerSectionForRecipe('reviews', { reviewers: undefined }))
      .toThrow(/requires a source bundle with a reviewers/);
  });

  test('reviews recipe accepts an empty reviewers array', () => {
    expect(() => assertBundleHasReviewerSectionForRecipe('reviews', { reviewers: [] })).not.toThrow();
  });

  test.each(['basic', 'initial_assessment'])('%s recipe accepts a bundle with no reviewers section', (recipe) => {
    expect(() => assertBundleHasReviewerSectionForRecipe(recipe, { reviewers: undefined })).not.toThrow();
  });
});

describe('two-pass consistency fence over reviewer child rows', () => {
  test('passes when the re-read set is unchanged', () => {
    const hydrated = [reviewerEntry()];
    const current = [{
      suggestionId: SUGGESTION_ID,
      suggestionEtag: '"{SUG-ETAG},1"',
      personId: PERSON_ID,
      personEtag: '"{PERSON-ETAG},1"',
      answers: [{ questionKey: 'impact', eTag: '"{ANSWER-ETAG},1"' }],
      files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
    }];
    expect(() => assertReviewerSourceUnchanged(hydrated, current)).not.toThrow();
  });

  test('rejects an extra answer row on re-read', () => {
    const hydrated = [reviewerEntry()];
    const current = [{
      suggestionId: SUGGESTION_ID,
      suggestionEtag: '"{SUG-ETAG},1"',
      personId: PERSON_ID,
      personEtag: '"{PERSON-ETAG},1"',
      answers: [
        { questionKey: 'impact', eTag: '"{ANSWER-ETAG},1"' },
        { questionKey: 'risk', eTag: '"{ANSWER-ETAG-2},1"' },
      ],
      files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
    }];
    expect(() => assertReviewerSourceUnchanged(hydrated, current)).toThrow(/reviewer_source_changed|Reviewer source/);
  });

  test('rejects a changed eTag on re-read', () => {
    const hydrated = [reviewerEntry()];
    const current = [{
      suggestionId: SUGGESTION_ID,
      suggestionEtag: '"{SUG-ETAG-CHANGED},1"',
      personId: PERSON_ID,
      personEtag: '"{PERSON-ETAG},1"',
      answers: [{ questionKey: 'impact', eTag: '"{ANSWER-ETAG},1"' }],
      files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
    }];
    let error;
    try { assertReviewerSourceUnchanged(hydrated, current); } catch (e) { error = e; }
    expect(error).toBeTruthy();
    expect(error.code).toBe('reviewer_source_changed');
  });

  test('rejects a missing suggestion on re-read', () => {
    const hydrated = [reviewerEntry()];
    expect(() => assertReviewerSourceUnchanged(hydrated, [])).toThrow();
  });
});

describe('exportTestRequestSourceBundle wires the reviewer dependency triad', () => {
  function baseDocumentDeps() {
    return {
      readSourceRow: jest.fn(async () => sourceRow()),
      discoverDocuments: jest.fn(async () => ({ documents: [], errors: [] })),
      assertReadLimits: jest.fn(),
      hydrateDocument: jest.fn(),
      getDriveId: jest.fn(),
      getFileMetadataById: jest.fn(),
      readSourceRevision: jest.fn(async () => '123456'),
    };
  }

  test('produces a version-3 bundle when the reviewer triad is supplied and the re-read matches', async () => {
    const identity = {
      suggestionId: SUGGESTION_ID,
      suggestionEtag: '"{SUG-ETAG},1"',
      personId: PERSON_ID,
      personEtag: '"{PERSON-ETAG},1"',
      answers: [{ questionKey: 'impact', eTag: '"{ANSWER-ETAG},1"' }],
      files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
    };
    const deps = {
      ...baseDocumentDeps(),
      discoverReviewers: jest.fn(async () => ({ reviewers: [{ suggestionId: SUGGESTION_ID }], errors: [] })),
      hydrateReviewer: jest.fn(async () => reviewerEntry()),
      readCurrentReviewerIdentity: jest.fn(async () => identity),
    };
    const bundle = await exportTestRequestSourceBundle(
      { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
      deps,
    );
    expect(bundle.version).toBe(3);
    expect(bundle.reviewers).toHaveLength(1);
  });

  test('fails closed as reviewer_source_changed when the re-read set drifted', async () => {
    const deps = {
      ...baseDocumentDeps(),
      discoverReviewers: jest.fn(async () => ({ reviewers: [{ suggestionId: SUGGESTION_ID }], errors: [] })),
      hydrateReviewer: jest.fn(async () => reviewerEntry()),
      readCurrentReviewerIdentity: jest.fn(async () => ({
        suggestionId: SUGGESTION_ID,
        suggestionEtag: '"{SUG-ETAG-CHANGED},1"',
        personId: PERSON_ID,
        personEtag: '"{PERSON-ETAG},1"',
        answers: [{ questionKey: 'impact', eTag: '"{ANSWER-ETAG},1"' }],
        files: [{ graphItemId: '01REVIEW', eTag: '"{ETAG},1"', versionId: '1.0' }],
      })),
    };
    let error;
    try {
      await exportTestRequestSourceBundle(
        { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
        deps,
      );
    } catch (e) { error = e; }
    expect(error?.code).toBe('reviewer_source_changed');
  });

  test('produces a version-2 bundle when no reviewer dependencies are supplied (basic/IA path unchanged)', async () => {
    const bundle = await exportTestRequestSourceBundle(
      { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
      baseDocumentDeps(),
    );
    expect(bundle.version).toBe(2);
    expect(bundle).not.toHaveProperty('reviewers');
  });
});

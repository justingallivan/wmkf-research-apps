/**
 * @jest-environment node
 *
 * Codex adversarial round-1 finding 1: `exportTestRequestSourceBundle`
 * re-reads and re-fences the Pre-Site document row AFTER every other export
 * read (the same point the existing end-of-export Request-revision fence
 * runs), because a request-document edit need not bump the parent Request's
 * revision. Mirrors test-request-source-bundle-reviewers.test.js's own
 * "exportTestRequestSourceBundle wires the ... dependency" pattern.
 */
import { jest } from '@jest/globals';
import { exportTestRequestSourceBundle } from '../../lib/services/test-requests/source-bundle.js';

const REQUEST_ID = 'E43AE6EA-698F-F111-8076-6045BD018A07';
const SUGGESTION_ID = 'C3F00000-1111-2222-3333-444455556666';
const PERSON_ID = 'D4F00000-1111-2222-3333-444455556666';
const WORD_ROW_ID = 'cccccccc-0000-0000-0000-000000000001';
const OTHER_WORD_ROW_ID = 'dddddddd-0000-0000-0000-000000000002';

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

const realProposalCore = () => ({
  executiveSummary: 'A concise executive summary paragraph.',
  impactOverview: 'A concise impact overview paragraph.',
  methodologyOverview: 'A concise methodology overview paragraph.',
  personnelOverview: 'A concise personnel overview paragraph.',
  keckFundingRationale: 'A concise Keck funding rationale paragraph.',
  backgroundAndImpact: 'A concise background and impact paragraph.',
  detailedMethodology: 'A concise detailed methodology paragraph.',
  personnelDetails: 'A concise personnel details paragraph.',
});

function draftResult(over = {}) {
  return {
    draft: {
      requestDocumentId: WORD_ROW_ID,
      sectionFields: {
        wmkf_presiteexecutivesummary: 'Executive summary.',
        wmkf_presiteimpactoverview: 'Impact overview.',
        wmkf_presitemethodologyoverview: 'Methodology overview.',
        wmkf_presitepersonneloverview: 'Personnel overview.',
        wmkf_presitekeckfundingrationale: 'Keck funding rationale.',
        wmkf_presitebackgroundandimpact: 'Background and impact.',
        wmkf_presitedetailedmethodology: 'Detailed methodology.',
        wmkf_presitepersonneldetails: 'Personnel details.',
      },
      proposalCoreJson: { schemaVersion: 4, proposalCore: realProposalCore(), diagnostics: [] },
    },
    identity: {
      requestDocumentId: WORD_ROW_ID,
      eTag: 'W/"1"',
      operationstatus: 100000001, // READY
      lifecyclestate: 100000004, // FINAL
    },
    ...over,
  };
}

function baseDocumentDeps() {
  return {
    readSourceRow: jest.fn(async () => sourceRow()),
    discoverDocuments: jest.fn(async () => ({ documents: [], errors: [] })),
    assertReadLimits: jest.fn(),
    hydrateDocument: jest.fn(),
    getDriveId: jest.fn(),
    getFileMetadataById: jest.fn(),
    readSourceRevision: jest.fn(async () => '123456'),
    // Bundle v4 requires the reviewer triad too (v4 extends v3); an empty
    // reviewer set is enough to exercise the Pre-Site fence in isolation.
    discoverReviewers: jest.fn(async () => ({ reviewers: [], errors: [] })),
    hydrateReviewer: jest.fn(),
    readCurrentReviewerIdentity: jest.fn(),
  };
}

function depsWithPreSite(first, second) {
  const readPreSiteVisitDraft = jest.fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second ?? first);
  return {
    ...baseDocumentDeps(),
    readPreSiteVisitDraft,
    readAbstract: jest.fn(async () => 'The source abstract.'),
  };
}

async function runExport(deps) {
  return exportTestRequestSourceBundle(
    { sourceRequestNumber: '1003222', dataverseHost: 'wmkf.crm.dynamics.com', exportedAt: new Date('2026-09-23T12:00:00Z') },
    deps,
  );
}

describe('exportTestRequestSourceBundle re-fences the Pre-Site document row (Codex adversarial round-1 finding 1)', () => {
  test('produces a version-4 bundle when the Pre-Site row is unchanged between the two reads', async () => {
    const first = draftResult();
    const deps = depsWithPreSite(first);
    const bundle = await runExport(deps);
    expect(bundle.version).toBe(4);
    expect(bundle.preSiteVisit.requestDocumentId).toBe(WORD_ROW_ID);
    expect(deps.readPreSiteVisitDraft).toHaveBeenCalledTimes(2);
  });

  test('refuses when the eTag changed between the two reads', async () => {
    const first = draftResult();
    const second = draftResult({ identity: { ...first.identity, eTag: 'W/"2"' } });
    let error;
    try {
      await runExport(depsWithPreSite(first, second));
    } catch (e) { error = e; }
    expect(error?.code).toBe('pre_site_visit_source_changed');
  });

  test('refuses when the operationstatus changed between the two reads (e.g. Ready -> Generating mid-export)', async () => {
    const first = draftResult();
    const second = draftResult({ identity: { ...first.identity, operationstatus: 100000000 } }); // GENERATING
    let error;
    try {
      await runExport(depsWithPreSite(first, second));
    } catch (e) { error = e; }
    expect(error?.code).toBe('pre_site_visit_source_changed');
  });

  test('refuses when the pointer moved to a different row between the two reads', async () => {
    const first = draftResult();
    const second = draftResult({
      draft: { ...first.draft, requestDocumentId: OTHER_WORD_ROW_ID },
      identity: { ...first.identity, requestDocumentId: OTHER_WORD_ROW_ID },
    });
    let error;
    try {
      await runExport(depsWithPreSite(first, second));
    } catch (e) { error = e; }
    expect(error?.code).toBe('pre_site_visit_source_changed');
  });

  test('refuses when a section field changed between the two reads (draft drift, identity unchanged)', async () => {
    const first = draftResult();
    const second = draftResult({
      draft: {
        ...first.draft,
        sectionFields: { ...first.draft.sectionFields, wmkf_presiteexecutivesummary: 'Edited mid-export.' },
      },
    });
    let error;
    try {
      await runExport(depsWithPreSite(first, second));
    } catch (e) { error = e; }
    expect(error?.code).toBe('pre_site_visit_source_changed');
  });

  test('produces a version-3 bundle (no Pre-Site section, no re-fence) when readPreSiteVisitDraft is not supplied', async () => {
    const deps = baseDocumentDeps();
    const bundle = await runExport(deps);
    expect(bundle.version).toBe(3);
    expect(bundle.preSiteVisit).toBeUndefined();
  });
});

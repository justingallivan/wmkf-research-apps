/** @jest-environment node */
import { jest } from '@jest/globals';
import {
  SOURCE_BUNDLE_KIND,
  SOURCE_BUNDLE_VERSION,
  buildSourceBundle,
  exportTestRequestSourceBundle,
  readSourceBundle,
  summarizeSourceBundle,
} from '../../lib/services/test-requests/source-bundle.js';
import { PROPOSAL_CORE_KEYS, PRE_SITE_VISIT_CONTENT_POLICY } from '../../shared/config/prompts/pre-site-visit-proposal-core.js';

const REQUEST_ID = 'E43AE6EA-698F-F111-8076-6045BD018A07';
const PURPOSE = 'Confidential source purpose text';
const sourceRow = (over = {}) => ({
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '1003222',
  akoya_requesttype: 100000001,
  akoya_purpose: PURPOSE,
  wmkf_abstract: 'Applicant source abstract',
  akoya_request: 1000000,
  akoya_fiscalyear: 'December 2026',
  wmkf_meetingdate: '2026-12-03T00:00:00Z',
  versionnumber: 123456,
  ...over,
});
const document = (over = {}) => ({
  id: 'inv-1',
  kind: 'reviewerProposal',
  library: 'akoya_request',
  folder: '1003222_E43AE6EA/Reviewer Materials',
  name: 'Proposal_1003222.pdf',
  driveId: 'b!drive-id',
  graphItemId: '01ABC',
  sharePointSite: {
    key: 'akoyago-shared',
    hostname: 'appriver3651007194.sharepoint.com',
    pathname: '/sites/akoyago',
  },
  size: 1024,
  mimeType: 'application/pdf',
  eTag: '"{ETAG},1"',
  versionId: '1.0',
  contentHash: 'a'.repeat(64),
  ...over,
});
const build = (over = {}) => buildSourceBundle({
  sourceRow: sourceRow(),
  documents: [document()],
  dataverseHost: 'WMKF.crm.dynamics.com',
  exportedAt: new Date('2026-09-23T12:00:00Z'),
  ...over,
});

const inventoryDocument = (over = {}) => ({
  id: 'inv-1',
  kind: 'reviewerProposal',
  label: 'Reviewer proposal',
  library: 'akoya_request',
  folder: '1003222_E43AE6EA/Reviewer Materials',
  name: 'Proposal_1003222.pdf',
  graphItemId: '01ABC',
  size: 1024,
  mimeType: 'application/pdf',
  lastModified: '2026-09-23T12:00:00Z',
  source: 'dynamics',
  copyMode: 'copy-rename',
  ...over,
});

function exportDependencies({ inventories, metadata } = {}) {
  const passes = inventories || [[inventoryDocument()], [inventoryDocument()]];
  const freshMetadata = metadata || {
    id: '01ABC',
    name: 'Proposal_1003222.pdf',
    size: 1024,
    mimeType: 'application/pdf',
    eTag: '"{ETAG},1"',
    versionId: '1.0',
  };
  return {
    readSourceRow: jest.fn(async () => sourceRow()),
    discoverDocuments: jest.fn()
      .mockResolvedValueOnce({ documents: passes[0], errors: [] })
      .mockResolvedValueOnce({ documents: passes[1], errors: [] }),
    assertReadLimits: jest.fn(),
    hydrateDocument: jest.fn(async () => document()),
    getDriveId: jest.fn(async () => 'b!drive-id'),
    getFileMetadataById: jest.fn(async () => freshMetadata),
    readSourceRevision: jest.fn(async () => '123456'),
  };
}

const exportBundle = (dependencies) => exportTestRequestSourceBundle({
  sourceRequestNumber: '1003222',
  dataverseHost: 'wmkf.crm.dynamics.com',
  exportedAt: new Date('2026-09-23T12:00:00Z'),
}, dependencies);

test('builds a canonical bundle from the clone projection', () => {
  const bundle = build();
  expect(bundle).toMatchObject({
    kind: SOURCE_BUNDLE_KIND,
    // No reviewer section supplied here -> version 2, even though the
    // module's SOURCE_BUNDLE_VERSION constant (the version a bundle WITH a
    // reviewers[] section gets) is now 3 (6c-ii Stage A, bundle v3).
    version: 2,
    exportedAt: '2026-09-23T12:00:00.000Z',
    source: {
      dataverseHost: 'wmkf.crm.dynamics.com',
      request: {
        akoya_requestid: REQUEST_ID.toLowerCase(),
        akoya_requestnum: '1003222',
        akoya_purpose: PURPOSE,
        wmkf_meetingdate: '2026-12-03',
        revision: '123456',
      },
    },
  });
  expect(bundle.documents).toEqual([document()]);
});

// P1-1 (Opus round 1, 2026-09-25): pins a v2 bundle's exact byte shape and
// digest against the PRE-Stage-A module (39f641bac, before the reviewers[]
// section and the DOCUMENT_FIELDS/suggestionId change). Adding `suggestionId`
// to DOCUMENT_FIELDS unconditionally (the P1-1 regression) made every
// document emit `suggestionId: null`, changing this hash from
// 997d5044...86b8f to f3b08cdd... and breaking `bundleSha256` verification
// (run-runner.js ~296) for any run reserved before the reviewer-section
// commit. Golden hash derived 2026-09-25 by loading
// `git show 39f641bac:lib/services/test-requests/source-bundle.js` (plus its
// then-unchanged lib/dataverse/core/target-registry.js,
// lib/services/sharepoint-target-registry.js and
// lib/services/test-requests/sandbox-clone.js) into a scratch copy, calling
// its buildSourceBundle with this file's exact `sourceRow()`/`document()`
// fixtures (host 'wmkf.crm.dynamics.com', exportedAt
// 2026-09-23T12:00:00Z), and SHA-256-hashing JSON.stringify(bundle). To
// reproduce: `git show 39f641bac:lib/services/test-requests/source-bundle.js`
// into a sibling-relative copy and repeat the same computation.
test('golden digest: a v2 bundle from these fixtures is byte- and digest-identical to 39f641bac', () => {
  const bundle = build();
  const json = JSON.stringify(bundle);
  expect(json).not.toMatch(/"suggestionId"/);
  const sha256 = require('crypto').createHash('sha256').update(json).digest('hex');
  expect(sha256).toBe('997d50447a5ef34d53340cbfe925c4102a3ca05d52a85fcb7cdb049993486b8f');
});

test('round-trips through JSON and readSourceBundle unchanged', () => {
  const bundle = build();
  expect(readSourceBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
});

test.each([
  ['buildSourceBundle', () => build({ dataverseHost: 'foreign.crm.dynamics.com' })],
  ['readSourceBundle', () => {
    const bundle = build();
    bundle.source.dataverseHost = 'foreign.crm.dynamics.com';
    return readSourceBundle(bundle);
  }],
])('%s rejects a foreign Dataverse host', (_label, action) => {
  expect(action).toThrow(/registered production host/);
});

test.each([
  ['buildSourceBundle', () => build({
    documents: [document({
      sharePointSite: {
        key: 'unregistered',
        hostname: 'foreign.sharepoint.com',
        pathname: '/sites/unregistered',
      },
    })],
  })],
  ['readSourceBundle', () => {
    const bundle = build();
    bundle.documents[0].sharePointSite = {
      key: 'unregistered',
      hostname: 'foreign.sharepoint.com',
      pathname: '/sites/unregistered',
    };
    return readSourceBundle(bundle);
  }],
])('%s rejects an unregistered SharePoint site', (_label, action) => {
  expect(action).toThrow(/registered SharePoint site/);
});

test('rejects documents from mixed SharePoint sites', () => {
  expect(() => build({
    documents: [
      document(),
      document({
        id: 'inv-2',
        kind: 'proposalNarrative',
        sharePointSite: {
          key: 'other-site',
          hostname: 'appriver3651007194.sharepoint.com',
          pathname: '/sites/other',
        },
      }),
    ],
  })).toThrow(/mixed SharePoint sites/);
});

test('exports after an unchanged strict discovery and metadata pass', async () => {
  const dependencies = exportDependencies();

  await expect(exportBundle(dependencies)).resolves.toEqual(build({ applicantAbstract: 'Applicant source abstract' }));
  expect(dependencies.discoverDocuments).toHaveBeenCalledTimes(2);
  expect(dependencies.assertReadLimits).toHaveBeenCalledTimes(2);
  expect(dependencies.readSourceRevision).toHaveBeenCalledWith(REQUEST_ID.toLowerCase());
});

test('export refuses an undefined abstract projection instead of downgrading to a legacy bundle', async () => {
  const dependencies = exportDependencies();
  dependencies.readSourceRow.mockResolvedValueOnce(sourceRow({ wmkf_abstract: undefined }));
  await expect(exportBundle(dependencies)).rejects.toThrow(/abstract was not selected/);
});

test('bundle v5 carries the abstract as a required null-or-exact-string member', () => {
  const bundle = build({ applicantAbstract: '  Applicant text\n' });
  expect(bundle.version).toBe(5);
  expect(bundle.abstract).toBe('  Applicant text\n');
  expect(readSourceBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  expect(build({ applicantAbstract: '' }).abstract).toBeNull();
  expect(build({ applicantAbstract: null }).abstract).toBeNull();
  expect(() => readSourceBundle({ ...bundle, abstract: undefined })).toThrow(/missing its abstract member/);
  expect(readSourceBundle({ ...bundle, abstract: 'x'.repeat(30001) }).abstract).toHaveLength(30001);
});

test('rejects an unavailable archive bucket before hydrating source documents', async () => {
  const dependencies = exportDependencies();
  dependencies.discoverDocuments.mockReset().mockResolvedValue({
    documents: [],
    errors: [{ source: 'archive', code: 'SOURCE_BUCKET_UNAVAILABLE' }],
  });

  await expect(exportBundle(dependencies)).rejects.toThrow(
    /Source document inventory is incomplete: archive:SOURCE_BUCKET_UNAVAILABLE/,
  );
  expect(dependencies.hydrateDocument).not.toHaveBeenCalled();
  expect(dependencies.readSourceRevision).not.toHaveBeenCalled();
});

test.each([
  ['added', [[inventoryDocument()], [inventoryDocument(), inventoryDocument({
    id: 'inv-2', kind: 'proposalNarrative', folder: '1003222_E43AE6EA/AI Materials',
    name: 'ProposalNarrative_1003222.pdf', graphItemId: '01DEF',
  })]]],
  ['removed', [[inventoryDocument()], []]],
  ['moved', [[inventoryDocument()], [inventoryDocument({ folder: '1003222_E43AE6EA/AI Materials' })]]],
])('rejects a document %s between discovery passes', async (_label, inventories) => {
  const dependencies = exportDependencies({ inventories });
  if (_label === 'added') {
    dependencies.getFileMetadataById.mockImplementation(async (_driveId, itemId) => (
      itemId === '01DEF'
        ? {
          id: '01DEF', name: 'ProposalNarrative_1003222.pdf', size: 1024,
          mimeType: 'application/pdf', eTag: '"{ETAG-2},1"', versionId: '1.0',
        }
        : {
          id: '01ABC', name: 'Proposal_1003222.pdf', size: 1024,
          mimeType: 'application/pdf', eTag: '"{ETAG},1"', versionId: '1.0',
        }
    ));
  }

  await expect(exportBundle(dependencies)).rejects.toThrow(/document set changed during export/);
  expect(dependencies.readSourceRevision).not.toHaveBeenCalled();
});

test('rejects fresh eTag or version drift after hydration', async () => {
  const dependencies = exportDependencies({
    metadata: {
      id: '01ABC', name: 'Proposal_1003222.pdf', size: 1024,
      mimeType: 'application/pdf', eTag: '"{ETAG},2"', versionId: '2.0',
    },
  });

  await expect(exportBundle(dependencies)).rejects.toThrow(/document set changed during export/);
  expect(dependencies.readSourceRevision).not.toHaveBeenCalled();
});

test.each([
  ['wrong kind', (b) => ({ ...b, kind: 'other' }), /not a Test Request source bundle/],
  ['unsupported v1 bundle', (b) => ({ ...b, version: 1 }), /Unsupported source bundle version: 1/],
  ['bad export time', (b) => ({ ...b, exportedAt: 'nope' }), /export time/],
  ['missing request', (b) => ({ ...b, source: { dataverseHost: 'x' } }), /request is missing/],
  ['bad request GUID', (b) => ({ ...b, source: { ...b.source, request: { ...b.source.request, akoya_requestid: 'x' } } }), /identity is invalid/],
  ['missing revision', (b) => ({ ...b, source: { ...b.source, request: { ...b.source.request, revision: null } } }), /revision is unavailable/],
  ['bad document hash', (b) => ({ ...b, documents: [{ ...b.documents[0], contentHash: 'short' }] }), /contentHash/],
  ['missing drive identity', (b) => ({ ...b, documents: [{ ...b.documents[0], driveId: null }] }), /driveId/],
  ['missing SharePoint site identity', (b) => ({ ...b, documents: [{ ...b.documents[0], sharePointSite: null }] }), /sharePointSite/],
  ['bad SharePoint site path', (b) => ({
    ...b,
    documents: [{ ...b.documents[0], sharePointSite: { ...b.documents[0].sharePointSite, pathname: 'sites/akoyago' } }],
  }), /sharePointSite/],
  ['unknown document kind', (b) => ({ ...b, documents: [{ ...b.documents[0], kind: 'other' }] }), /kind/],
])('readSourceBundle rejects %s', (_label, mutate, pattern) => {
  expect(() => readSourceBundle(mutate(JSON.parse(JSON.stringify(build()))))).toThrow(pattern);
});

test('rejects duplicate document kinds', () => {
  expect(() => build({ documents: [document(), document({ id: 'inv-2' })] })).toThrow(/more than one reviewerProposal/);
});

test('rejects a missing request number', () => {
  expect(() => build({ sourceRow: sourceRow({ akoya_requestnum: null }) })).toThrow(/Request number/);
});

// ───────── Bundle v3 golden digest (slice 4a) ─────────
// Same method as the v2 golden above, run against the module as it existed
// immediately before this slice's edits (git HEAD at branch creation,
// `_golden_orig_source_bundle.js` scratch copy, deleted after use) and
// confirmed byte-identical against the CURRENT module with these same
// fixtures -- proving slice 4a's v4 additions do not perturb the v3
// projection or its digest.
const reviewerFixture = (over = {}) => ({
  suggestionId: 'aaaaaaaa-0000-0000-0000-000000000001',
  personId: 'bbbbbbbb-0000-0000-0000-000000000001',
  person: {
    wmkf_name: 'Jane Reviewer',
    wmkf_firstname: 'Jane',
    wmkf_lastname: 'Reviewer',
    wmkf_areaofexpertise: 'Genomics',
    wmkf_primaryaffiliation: 'Test University',
    wmkf_academicrank: 'Professor',
    wmkf_primarydepartment: 'Biology',
    wmkf_maininstitution: 'Test University',
  },
  personIsSynthetic: false,
  suggestion: {
    wmkf_suggestionlabel: 'A',
    wmkf_programarea: 'Science',
    wmkf_relevancescore: 90,
    wmkf_matchreason: 'expertise',
    wmkf_sources: 'manual',
    wmkf_selected: true,
    wmkf_invited: true,
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_responsetype: 100000000,
    wmkf_emailsentat: '2026-09-01T00:00:00Z',
    wmkf_responsereceivedat: '2026-09-02T00:00:00Z',
    wmkf_materialssentat: '2026-09-03T00:00:00Z',
    wmkf_reviewreceivedat: '2026-09-10T00:00:00Z',
    wmkf_completedat: '2026-09-10T00:00:00Z',
    wmkf_thankyousentat: '2026-09-11T00:00:00Z',
    wmkf_reviewstatus: 100000001,
    wmkf_revieweraffiliation: 'Test University',
    wmkf_reviewuploadedbystaff: false,
    wmkf_reviewerfirstname: 'Jane',
    wmkf_reviewerlastname: 'Reviewer',
    wmkf_reviewernickname: null,
    wmkf_reviewertitle: 'Dr.',
    wmkf_applicantdisposition: null,
  },
  answers: [],
  reviewForm: 'unreceived',
  files: [],
  ...over,
});

test('golden digest: a v3 bundle from these fixtures is byte- and digest-identical to the module before slice 4a', () => {
  const bundle = build({ reviewers: [reviewerFixture()] });
  expect(bundle.version).toBe(3);
  const json = JSON.stringify(bundle);
  const sha256 = require('crypto').createHash('sha256').update(json).digest('hex');
  expect(sha256).toBe('f9dab4bfe3f86c409676587be3611797268b03bb160e04c3e77d631653a3f325');
});

// ───────── Bundle v4 (slice 4a, "Recipe 4") ─────────

const preSiteSectionFields = (over = {}) => ({
  wmkf_presiteexecutivesummary: 'Executive summary text.',
  wmkf_presiteimpactoverview: 'Impact overview text.',
  wmkf_presitemethodologyoverview: 'Methodology overview text.',
  wmkf_presitepersonneloverview: 'Personnel overview text.',
  wmkf_presitekeckfundingrationale: 'Keck funding rationale text.',
  wmkf_presitebackgroundandimpact: 'Background and impact text.',
  wmkf_presitedetailedmethodology: 'Detailed methodology text.',
  wmkf_presitepersonneldetails: 'Personnel details text.',
  ...over,
});
// Codex adversarial round-1 finding 2: a canonical, REAL-shaped proposalCore
// (exactly PROPOSAL_CORE_KEYS, the app's own key set) -- {a: 1}/{someField}
// no longer round-trips, by design.
const realProposalCore = (over = {}) => ({
  executiveSummary: 'A concise executive summary paragraph.',
  impactOverview: 'A concise impact overview paragraph.',
  methodologyOverview: 'A concise methodology overview paragraph.',
  personnelOverview: 'A concise personnel overview paragraph.',
  keckFundingRationale: 'A concise Keck funding rationale paragraph.',
  backgroundAndImpact: 'A concise background and impact paragraph.',
  detailedMethodology: 'A concise detailed methodology paragraph.',
  personnelDetails: 'A concise personnel details paragraph.',
  ...over,
});
const proposalCoreJson = (over = {}) => ({
  schemaVersion: 4,
  proposalCore: realProposalCore(),
  diagnostics: [{ code: 'referee_section_manual' }],
  ...over,
});
// Slice 4c: draft.personnel is required by projectPreSiteVisitSection's
// validation.
const preSitePersonnel = (over = {}) => ({
  principalInvestigator: 'Dr. PI Name',
  coPrincipalInvestigators: ['Beau CoPI'],
  ...over,
});
const preSiteVisitFixture = (over = {}) => ({
  requestDocumentId: 'cccccccc-0000-0000-0000-000000000001',
  sectionFields: preSiteSectionFields(),
  proposalCoreJson: proposalCoreJson(),
  personnel: preSitePersonnel(),
  ...over,
});

describe('bundle v4: preSiteVisit section + abstract', () => {
  test('a bundle with preSiteVisit is version 4 and carries preSiteVisit + abstract', () => {
    const bundle = build({
      reviewers: [reviewerFixture()],
      preSiteVisit: preSiteVisitFixture(),
      abstract: 'The source abstract text.',
    });
    expect(bundle.version).toBe(4);
    expect(bundle.preSiteVisit).toEqual(preSiteVisitFixture());
    expect(bundle.abstract).toBe('The source abstract text.');
  });

  test('abstract may be null', () => {
    const bundle = build({ reviewers: [reviewerFixture()], preSiteVisit: preSiteVisitFixture(), abstract: null });
    expect(bundle.abstract).toBeNull();
  });

  test('preSiteVisit requires reviewers too (v4 extends v3)', () => {
    expect(() => build({ preSiteVisit: preSiteVisitFixture() }))
      .toThrow(/requires a reviewers\[\] section/);
  });

  test('round-trips a v4 bundle through JSON and readSourceBundle unchanged', () => {
    const bundle = build({ reviewers: [reviewerFixture()], preSiteVisit: preSiteVisitFixture(), abstract: 'abs' });
    expect(readSourceBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  test('rejects an unknown top-level preSiteVisit key', () => {
    expect(() => build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), extra: 'nope' },
    })).toThrow(/unknown key/);
  });

  test('rejects an unknown sectionFields key', () => {
    expect(() => build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), sectionFields: { ...preSiteSectionFields(), bogus: 'x' } },
    })).toThrow(/unknown key/);
  });

  test('rejects a sectionFields value over the per-field cap', () => {
    expect(() => build({
      reviewers: [reviewerFixture()],
      preSiteVisit: {
        ...preSiteVisitFixture(),
        sectionFields: { ...preSiteSectionFields(), wmkf_presiteexecutivesummary: 'x'.repeat(30001) },
      },
    })).toThrow(/section field\(s\) invalid/);
  });

  test('rejects an unknown proposalCoreJson envelope key', () => {
    expect(() => build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), extra: 'nope' } },
    })).toThrow(/envelope carries unknown key/);
  });

  test.each([1, 5, 'four', null])('rejects an unsupported proposalCoreJson schemaVersion (%p)', (schemaVersion) => {
    expect(() => build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), schemaVersion } },
    })).toThrow(/unsupported schemaVersion/);
  });

  test.each([2, 3, 4])('accepts every schemaVersion artifact-model.js itself accepts (%d)', (schemaVersion) => {
    const bundle = build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), schemaVersion } },
    });
    expect(bundle.preSiteVisit.proposalCoreJson.schemaVersion).toBe(schemaVersion);
  });

  // Codex adversarial round-1 finding 2: proposalCore is canonicalized
  // through the app's OWN key set/validator, never passed through unchanged.
  describe('proposalCore canonicalization (Codex adversarial round-1 finding 2)', () => {
    test('refuses an unknown key inside proposalCore', () => {
      expect(() => build({
        reviewers: [reviewerFixture()],
        preSiteVisit: {
          ...preSiteVisitFixture(),
          proposalCoreJson: { ...proposalCoreJson(), proposalCore: realProposalCore({ forbiddenExtra: 'smuggled' }) },
        },
      })).toThrow(/proposal core is invalid/);
    });

    test.each(PROPOSAL_CORE_KEYS)('refuses a missing %s key', (missingKey) => {
      const { [missingKey]: _omit, ...incomplete } = realProposalCore();
      expect(() => build({
        reviewers: [reviewerFixture()],
        preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), proposalCore: incomplete } },
      })).toThrow(/proposal core is invalid/);
    });

    test.each(PROPOSAL_CORE_KEYS)('refuses a wrong-type (non-string) %s value', (key) => {
      expect(() => build({
        reviewers: [reviewerFixture()],
        preSiteVisit: {
          ...preSiteVisitFixture(),
          proposalCoreJson: { ...proposalCoreJson(), proposalCore: realProposalCore({ [key]: 12345 }) },
        },
      })).toThrow(/proposal core is invalid/);
    });

    // The Dataverse-column-size ceiling: PRE_SITE_VISIT_CONTENT_POLICY.
    // sinkMaxChars (30000), the SAME cap the app enforces on generated
    // section content and on each Pre-Site section field in this bundle.
    test.each(PROPOSAL_CORE_KEYS)('refuses an oversize %s value (over the sinkMaxChars ceiling)', (key) => {
      expect(() => build({
        reviewers: [reviewerFixture()],
        preSiteVisit: {
          ...preSiteVisitFixture(),
          proposalCoreJson: {
            ...proposalCoreJson(),
            proposalCore: realProposalCore({ [key]: 'x'.repeat(PRE_SITE_VISIT_CONTENT_POLICY.sinkMaxChars + 1) }),
          },
        },
      })).toThrow(/proposal core is invalid/);
    });

    test('a value exactly at the sinkMaxChars ceiling is accepted', () => {
      const bundle = build({
        reviewers: [reviewerFixture()],
        preSiteVisit: {
          ...preSiteVisitFixture(),
          proposalCoreJson: {
            ...proposalCoreJson(),
            proposalCore: realProposalCore({ executiveSummary: 'x'.repeat(PRE_SITE_VISIT_CONTENT_POLICY.sinkMaxChars) }),
          },
        },
      });
      expect(bundle.preSiteVisit.proposalCoreJson.proposalCore.executiveSummary).toHaveLength(
        PRE_SITE_VISIT_CONTENT_POLICY.sinkMaxChars,
      );
    });

    test('a canonical real-shaped proposalCore round-trips byte-identical (never re-normalized)', () => {
      const core = realProposalCore();
      const bundle = build({
        reviewers: [reviewerFixture()],
        preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), proposalCore: core } },
      });
      expect(bundle.preSiteVisit.proposalCoreJson.proposalCore).toEqual(core);
      // And the whole bundle round-trips through JSON + readSourceBundle too.
      expect(readSourceBundle(JSON.parse(JSON.stringify(bundle))).preSiteVisit.proposalCoreJson.proposalCore)
        .toEqual(core);
    });
  });

  // Codex adversarial round-1 finding 2: diagnostics is canonicalized through
  // artifact-model.js's own `validateDiagnostics` (unknown per-entry keys are
  // dropped by that function's own established allowlist behavior; malformed
  // entries and a non-array/over-length array are refused).
  describe('diagnostics canonicalization (Codex adversarial round-1 finding 2)', () => {
    test('refuses a malformed diagnostic entry (missing code)', () => {
      expect(() => build({
        reviewers: [reviewerFixture()],
        preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), diagnostics: [{ section: 'x' }] } },
      })).toThrow(/diagnostics require reconciliation/);
    });

    test('refuses a diagnostics value that is not an array', () => {
      expect(() => build({
        reviewers: [reviewerFixture()],
        preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), diagnostics: { code: 'x' } } },
      })).toThrow(/diagnostics must be an array/);
    });

    test('drops an unknown key inside a diagnostic entry (artifact-model.js\'s own established allowlist behavior)', () => {
      const bundle = build({
        reviewers: [reviewerFixture()],
        preSiteVisit: {
          ...preSiteVisitFixture(),
          proposalCoreJson: { ...proposalCoreJson(), diagnostics: [{ code: 'personnel_name_not_matched', smuggled: 'nope' }] },
        },
      });
      expect(bundle.preSiteVisit.proposalCoreJson.diagnostics).toEqual([{ code: 'personnel_name_not_matched' }]);
    });
  });

  // Opus round-1: preserve the source envelope's own keys rather than
  // fabricating `diagnostics: []` for an envelope that never had the key.
  test('proposalCoreJson omits diagnostics when the source envelope never had it (does not fabricate [])', () => {
    const { diagnostics, ...envelopeWithoutDiagnostics } = proposalCoreJson();
    const bundle = build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: envelopeWithoutDiagnostics },
    });
    expect(Object.prototype.hasOwnProperty.call(bundle.preSiteVisit.proposalCoreJson, 'diagnostics')).toBe(false);
  });

  test('proposalCoreJson preserves an explicit diagnostics value (including an empty array) unchanged', () => {
    const bundle = build({
      reviewers: [reviewerFixture()],
      preSiteVisit: { ...preSiteVisitFixture(), proposalCoreJson: { ...proposalCoreJson(), diagnostics: [] } },
    });
    expect(bundle.preSiteVisit.proposalCoreJson.diagnostics).toEqual([]);
  });

  test('an abstract over the cap is rejected', () => {
    expect(() => build({
      reviewers: [reviewerFixture()], preSiteVisit: preSiteVisitFixture(), abstract: 'x'.repeat(30001),
    })).toThrow(/abstract is invalid/);
  });

  // Opus round-1 P3-2: the previous version of this test built its bundle
  // from a fixture that never contained the forbidden fields in the first
  // place, so it passed vacuously regardless of whether the schema actually
  // excludes them. This version puts each forbidden field INTO the fixture
  // (as a caller would if it tried to smuggle a raw row's field through, at
  // the level where each one would actually land: top-level preSiteVisit for
  // the request-document-scoped fields, sectionFields for a field name
  // collision there) and asserts `build` REFUSES it (unknown key) rather
  // than merely checking the successful output's JSON for absence.
  test.each([
    ['wmkf_presiteinputsnapshotjson', 'preSiteVisit'],
    ['wmkf_inputfingerprint', 'preSiteVisit'],
    ['wmkf_generationkey', 'preSiteVisit'],
    ['wmkf_lifecyclestate', 'preSiteVisit'],
    ['wmkf_claimtoken', 'preSiteVisit'],
    ['_wmkf_airun_value', 'preSiteVisit'],
    ['wmkf_presiteinputsnapshotjson', 'sectionFields'],
    ['wmkf_lifecyclestate', 'sectionFields'],
    ['wmkf_claimtoken', 'sectionFields'],
  ])('the bundle validator refuses the forbidden field %s if smuggled into %s', (field, location) => {
    const preSiteVisit = location === 'preSiteVisit'
      ? { ...preSiteVisitFixture(), [field]: 'smuggled-value' }
      : { ...preSiteVisitFixture(), sectionFields: { ...preSiteSectionFields(), [field]: 'smuggled-value' } };
    expect(() => build({ reviewers: [reviewerFixture()], preSiteVisit, abstract: 'abs' }))
      .toThrow(/unknown key/);
  });

  test.each([2, 3])('version %d bundle must not carry a preSiteVisit section or abstract', (version) => {
    const legacyBundle = version === 2 ? build() : build({ reviewers: [reviewerFixture()] });
    expect(() => readSourceBundle({ ...legacyBundle, preSiteVisit: preSiteVisitFixture() }))
      .toThrow(/must not carry a preSiteVisit section/);
    expect(() => readSourceBundle({ ...legacyBundle, abstract: 'x' }))
      .toThrow(/must not carry an abstract/);
  });

  test('version 4 bundle missing its preSiteVisit section is refused', () => {
    const v3 = build({ reviewers: [reviewerFixture()] });
    expect(() => readSourceBundle({ ...v3, version: 4 })).toThrow(/missing its preSiteVisit section/);
  });

  // Slice 4c: projectPreSitePersonnel's own validation, each bad shape
  // refused on its own (never inferred from the happy-path fixture).
  describe('personnel validation (Slice 4c)', () => {
    function buildWithPersonnel(personnel) {
      return build({
        reviewers: [reviewerFixture()],
        preSiteVisit: { ...preSiteVisitFixture(), personnel },
      });
    }

    test('rejects a non-object personnel value', () => {
      expect(() => buildWithPersonnel('Dr. PI Name')).toThrow(/personnel is invalid/);
    });

    test('rejects an array personnel value', () => {
      expect(() => buildWithPersonnel(['Dr. PI Name'])).toThrow(/personnel is invalid/);
    });

    test('rejects a null personnel value', () => {
      expect(() => buildWithPersonnel(null)).toThrow(/personnel is invalid/);
    });

    test('rejects an unknown personnel key', () => {
      expect(() => buildWithPersonnel({ ...preSitePersonnel(), extra: 'nope' }))
        .toThrow(/unknown key/);
    });

    test('rejects a missing principalInvestigator', () => {
      const { principalInvestigator, ...rest } = preSitePersonnel();
      expect(() => buildWithPersonnel(rest)).toThrow(/missing a valid principal investigator/);
    });

    test('rejects an empty-string principalInvestigator', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ principalInvestigator: '' })))
        .toThrow(/missing a valid principal investigator/);
    });

    test('rejects a whitespace-only principalInvestigator', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ principalInvestigator: '   ' })))
        .toThrow(/missing a valid principal investigator/);
    });

    test('rejects a non-string principalInvestigator', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ principalInvestigator: 42 })))
        .toThrow(/missing a valid principal investigator/);
    });

    test('rejects a principalInvestigator over the 300-char cap', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ principalInvestigator: 'x'.repeat(301) })))
        .toThrow(/missing a valid principal investigator/);
    });

    test('accepts a principalInvestigator at exactly the 300-char cap', () => {
      const bundle = buildWithPersonnel(preSitePersonnel({ principalInvestigator: 'x'.repeat(300) }));
      expect(bundle.preSiteVisit.personnel.principalInvestigator).toHaveLength(300);
    });

    test('rejects coPrincipalInvestigators that is not an array', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ coPrincipalInvestigators: 'Beau CoPI' })))
        .toThrow(/co-principal-investigators must be an array/);
    });

    test('rejects more than 20 coPrincipalInvestigators', () => {
      const coPrincipalInvestigators = Array.from({ length: 21 }, (_, i) => `Co-PI ${i}`);
      expect(() => buildWithPersonnel(preSitePersonnel({ coPrincipalInvestigators })))
        .toThrow(/count exceeds 20/);
    });

    test('accepts exactly 20 coPrincipalInvestigators', () => {
      const coPrincipalInvestigators = Array.from({ length: 20 }, (_, i) => `Co-PI ${i}`);
      const bundle = buildWithPersonnel(preSitePersonnel({ coPrincipalInvestigators }));
      expect(bundle.preSiteVisit.personnel.coPrincipalInvestigators).toHaveLength(20);
    });

    test('rejects a non-string entry in coPrincipalInvestigators', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ coPrincipalInvestigators: ['Beau CoPI', 42] })))
        .toThrow(/co-principal-investigator #2 is invalid/);
    });

    test('rejects an empty-string entry in coPrincipalInvestigators', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ coPrincipalInvestigators: [''] })))
        .toThrow(/co-principal-investigator #1 is invalid/);
    });

    test('rejects a coPrincipalInvestigators entry over the 300-char cap', () => {
      expect(() => buildWithPersonnel(preSitePersonnel({ coPrincipalInvestigators: ['x'.repeat(301)] })))
        .toThrow(/co-principal-investigator #1 is invalid/);
    });

    test('defaults coPrincipalInvestigators to an empty array when omitted', () => {
      const { coPrincipalInvestigators, ...rest } = preSitePersonnel();
      const bundle = buildWithPersonnel(rest);
      expect(bundle.preSiteVisit.personnel.coPrincipalInvestigators).toEqual([]);
    });

    test('trims principalInvestigator and each coPrincipalInvestigators entry', () => {
      const bundle = buildWithPersonnel(preSitePersonnel({
        principalInvestigator: '  Dr. PI Name  ',
        coPrincipalInvestigators: ['  Beau CoPI  '],
      }));
      expect(bundle.preSiteVisit.personnel).toEqual({
        principalInvestigator: 'Dr. PI Name',
        coPrincipalInvestigators: ['Beau CoPI'],
      });
    });
  });
});

test('summary carries identities and hash prefixes but never source text', () => {
  const summary = summarizeSourceBundle(build());
  expect(JSON.stringify(summary)).not.toContain(PURPOSE);
  expect(summary).toMatchObject({
    requestNumber: '1003222',
    requestId: REQUEST_ID.toLowerCase(),
    hasPurpose: true,
    documents: [{ kind: 'reviewerProposal', sha256Prefix: 'aaaaaaaaaaaa' }],
  });
});

/**
 * @jest-environment node
 *
 * P2-C (Opus round 2): the export script's `--with-reviewers` /
 * `--source-marker-column=present|absent` argument parsing, and that the
 * exporter receives the reviewer dependency triad ONLY when
 * `--with-reviewers` is set. Importing the script does not run `main()`
 * (guarded by an argv[1]/import.meta.url entrypoint check), so these pure
 * helpers can be exercised directly.
 */
import {
  parseArgs, buildReviewerDependencies, buildPreSiteDependencies,
} from '../../scripts/export-test-request-source-bundle.mjs';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  PRE_SITE_VISIT_CONTRACT,
} from '../../shared/config/requestDocument.js';

const OUT = '/tmp/does-not-exist-source-bundle-cli-test.json';

function baseArgv(extra = []) {
  return ['--source-request-number=1003222', `--out=${OUT}`, ...extra];
}

describe('parseArgs', () => {
  test('--with-reviewers defaults off, --source-marker-column defaults null', () => {
    const args = parseArgs(baseArgv());
    expect(args.withReviewers).toBe(false);
    expect(args.sourceMarkerColumn).toBeNull();
  });

  test('--with-reviewers requires --source-marker-column', () => {
    expect(() => parseArgs(baseArgv(['--with-reviewers'])))
      .toThrow(/requires --source-marker-column/);
  });

  test('--with-reviewers --source-marker-column=absent parses cleanly', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent']));
    expect(args.withReviewers).toBe(true);
    expect(args.sourceMarkerColumn).toBe('absent');
  });

  test('--with-reviewers --source-marker-column=present parses cleanly', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=present']));
    expect(args.withReviewers).toBe(true);
    expect(args.sourceMarkerColumn).toBe('present');
  });

  test('rejects an invalid --source-marker-column value', () => {
    expect(() => parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=maybe'])))
      .toThrow(/requires --source-marker-column/);
  });

  test('--source-marker-column without --with-reviewers is rejected', () => {
    expect(() => parseArgs(baseArgv(['--source-marker-column=absent'])))
      .toThrow(/valid only with --with-reviewers/);
  });
});

describe('buildReviewerDependencies', () => {
  const client = { get: jest.fn() };
  const graph = {
    getDriveId: jest.fn(), getFileMetadataById: jest.fn(), downloadFile: jest.fn(),
    listFiles: jest.fn(), getSharePointTargetInfo: jest.fn(),
  };

  test('returns null (no reviewer dependencies at all) when --with-reviewers is not set', () => {
    const args = parseArgs(baseArgv());
    const deps = buildReviewerDependencies(args, { client, graph });
    expect(deps).toBeNull();
  });

  test('returns the real triad, with markerColumnPresent=false, for --source-marker-column=absent', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent']));
    const deps = buildReviewerDependencies(args, { client, graph });
    expect(deps).not.toBeNull();
    expect(typeof deps.discoverReviewers).toBe('function');
    expect(typeof deps.hydrateReviewer).toBe('function');
    expect(typeof deps.readCurrentReviewerIdentity).toBe('function');
  });

  test('returns the real triad for --source-marker-column=present', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=present']));
    const deps = buildReviewerDependencies(args, { client, graph });
    expect(deps).not.toBeNull();
  });
});

// Slice 4a: --with-pre-site (bundle v4) requires --with-reviewers (v4
// extends v3), off by default, mirroring --with-reviewers's own posture.
describe('parseArgs: --with-pre-site (slice 4a)', () => {
  test('--with-pre-site defaults off', () => {
    const args = parseArgs(baseArgv());
    expect(args.withPreSite).toBe(false);
  });

  test('--with-pre-site without --with-reviewers is rejected', () => {
    expect(() => parseArgs(baseArgv(['--with-pre-site'])))
      .toThrow(/--with-pre-site requires --with-reviewers/);
  });

  test('--with-pre-site --with-reviewers --source-marker-column=absent parses cleanly', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent', '--with-pre-site']));
    expect(args.withPreSite).toBe(true);
  });
});

describe('buildPreSiteDependencies', () => {
  const client = { get: jest.fn() };

  test('returns null (no Pre-Site dependencies at all) when --with-pre-site is not set', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent']));
    expect(buildPreSiteDependencies(args, { client })).toBeNull();
  });

  test('returns the readPreSiteVisitDraft/readAbstract pair when --with-pre-site is set', () => {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent', '--with-pre-site']));
    const deps = buildPreSiteDependencies(args, { client });
    expect(deps).not.toBeNull();
    expect(typeof deps.readPreSiteVisitDraft).toBe('function');
    expect(typeof deps.readAbstract).toBe('function');
  });
});

// Opus round-1 P3-4: listPreSiteDocuments (private) is exercised indirectly
// through readPreSiteVisitDraft, which is the only exported seam into it.
describe('readPreSiteVisitDraft: bounded, unpaged Pre-Site document read (Opus round-1 P3-4)', () => {
  const SOURCE_REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';

  function fakeClient(documentsBody) {
    return {
      get: jest.fn(async (url) => {
        if (url.startsWith('/akoya_requests(')) {
          return { ok: true, status: 200, body: { akoya_requestid: SOURCE_REQUEST_ID, _wmkf_currentpresitevisit_value: null } };
        }
        if (url.startsWith('/wmkf_requestdocuments')) {
          return { ok: true, status: 200, body: documentsBody };
        }
        throw new Error(`unexpected URL in test: ${url}`);
      }),
    };
  }

  async function readDraft(documentsBody) {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent', '--with-pre-site']));
    const deps = buildPreSiteDependencies(args, { client: fakeClient(documentsBody) });
    return deps.readPreSiteVisitDraft({ akoya_requestid: SOURCE_REQUEST_ID });
  }

  test('refuses when the result carries an @odata.nextLink', async () => {
    await expect(readDraft({ value: [], '@odata.nextLink': 'https://example/next-page' }))
      .rejects.toThrow(/not complete/);
  });

  test('refuses when the result reaches the row cap (50)', async () => {
    const value = Array.from({ length: 50 }, (_, i) => ({ wmkf_requestdocumentid: `row-${i}` }));
    await expect(readDraft({ value })).rejects.toThrow(/not complete/);
  });

  test('accepts a result below the cap with no continuation link (control case, still refuses for an unrelated reason: no matching row)', async () => {
    // A single page well under the cap must NOT trip the P3-4 refusal --
    // this proves the cap check does not fire on ordinary, complete reads.
    // The read then legitimately fails for readPreSiteVisitDraftForExport's
    // OWN reason (no Pre-Site Word artifact among 49 unrelated rows), never
    // the bounded-read refusal.
    const value = Array.from({ length: 49 }, (_, i) => ({ wmkf_requestdocumentid: `row-${i}` }));
    await expect(readDraft({ value })).rejects.toThrow(/no Pre-Site Word artifact/);
  });
});

// Slice 4c: exercises the exporter script's OWN PI/Co-PI reads
// (getRequestForPreSite's raw-annotation read, listCoPIRecords/
// coPiNamesFromRecords's byte-mirrored query) through the only exported
// seam into them, buildPreSiteDependencies().readPreSiteVisitDraft --
// never module-internal, since these helpers are not exported.
describe('exporter personnel read (Slice 4c: PI present/missing, Co-PI order)', () => {
  const SOURCE_REQUEST_ID = 'e43ae6ea-698f-f111-8076-6045bd018a07';
  const WORD_ROW_ID = 'cccccccc-0000-0000-0000-000000000001';

  function wordRow(over = {}) {
    return {
      wmkf_requestdocumentid: WORD_ROW_ID,
      '@odata.etag': 'W/"1"',
      _wmkf_request_value: SOURCE_REQUEST_ID,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      wmkf_producer: 'request-workbench',
      wmkf_presiteexecutivesummary: 'Executive summary.',
      wmkf_presiteimpactoverview: 'Impact overview.',
      wmkf_presitemethodologyoverview: 'Methodology overview.',
      wmkf_presitepersonneloverview: 'Personnel overview.',
      wmkf_presitekeckfundingrationale: 'Keck funding rationale.',
      wmkf_presitebackgroundandimpact: 'Background and impact.',
      wmkf_presitedetailedmethodology: 'Detailed methodology.',
      wmkf_presitepersonneldetails: 'Personnel details.',
      wmkf_presiteproposalcorejson: JSON.stringify({ schemaVersion: 4, proposalCore: { a: 1 }, diagnostics: [] }),
      ...over,
    };
  }

  // coPiRecords: array of {_wmkf_contact_value, wmkf_Contact: {fullname}}
  // rows, in the order the fake Dataverse response returns them -- proves
  // coPiNamesFromRecords preserves that order rather than re-sorting.
  function fakeClient({ projectLeaderFormatted, coPiRecords = [] }) {
    return {
      get: jest.fn(async (url) => {
        if (url.startsWith(`/akoya_requests(${SOURCE_REQUEST_ID})`)) {
          return {
            ok: true,
            status: 200,
            body: {
              akoya_requestid: SOURCE_REQUEST_ID,
              _wmkf_currentpresitevisit_value: WORD_ROW_ID,
              _wmkf_projectleader_value: 'ffffffff-0000-0000-0000-000000000000',
              '_wmkf_projectleader_value@OData.Community.Display.V1.FormattedValue': projectLeaderFormatted,
            },
          };
        }
        if (url.startsWith('/wmkf_requestdocuments')) {
          return { ok: true, status: 200, body: { value: [wordRow()] } };
        }
        if (url.startsWith('/wmkf_apprequestpersons')) {
          return { ok: true, status: 200, body: { value: coPiRecords } };
        }
        throw new Error(`unexpected URL in test: ${url}`);
      }),
    };
  }

  async function readDraft(clientOpts) {
    const args = parseArgs(baseArgv(['--with-reviewers', '--source-marker-column=absent', '--with-pre-site']));
    const deps = buildPreSiteDependencies(args, { client: fakeClient(clientOpts) });
    return deps.readPreSiteVisitDraft({ akoya_requestid: SOURCE_REQUEST_ID });
  }

  test('PI present, no Co-PIs: draft.personnel carries the formatted PI name and an empty Co-PI list', async () => {
    const { draft } = await readDraft({ projectLeaderFormatted: 'Dr. Ada Lovelace', coPiRecords: [] });
    expect(draft.personnel).toEqual({ principalInvestigator: 'Dr. Ada Lovelace', coPrincipalInvestigators: [] });
  });

  test('PI missing: the exporter refuses with a clear "cannot render" error', async () => {
    await expect(readDraft({ projectLeaderFormatted: undefined, coPiRecords: [] }))
      .rejects.toThrow(/cannot render requireIdentity without one/);
  });

  test('Co-PI order: coPrincipalInvestigators preserves the order the Co-PI junction rows arrived in', async () => {
    const coPiRecords = [
      { _wmkf_contact_value: 'aaaaaaaa-0000-0000-0000-000000000001', wmkf_Contact: { fullname: 'Beau CoPI' } },
      { _wmkf_contact_value: 'aaaaaaaa-0000-0000-0000-000000000002', wmkf_Contact: { fullname: 'Ada CoPI' } },
    ];
    const { draft } = await readDraft({ projectLeaderFormatted: 'Dr. Ada Lovelace', coPiRecords });
    expect(draft.personnel.coPrincipalInvestigators).toEqual(['Beau CoPI', 'Ada CoPI']);
  });

  test('Co-PI dedupe: a repeated contact id is not double-counted (byte-mirrors fetchCoPIs)', async () => {
    const coPiRecords = [
      { _wmkf_contact_value: 'aaaaaaaa-0000-0000-0000-000000000001', wmkf_Contact: { fullname: 'Beau CoPI' } },
      { _wmkf_contact_value: 'aaaaaaaa-0000-0000-0000-000000000001', wmkf_Contact: { fullname: 'Beau CoPI Duplicate Row' } },
    ];
    const { draft } = await readDraft({ projectLeaderFormatted: 'Dr. Ada Lovelace', coPiRecords });
    expect(draft.personnel.coPrincipalInvestigators).toEqual(['Beau CoPI']);
  });
});

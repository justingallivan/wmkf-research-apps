/**
 * Test Request Factory `pre_site_visit` recipe (slice 4b) sandbox deps
 * (lib/services/test-requests/presite-sandbox-deps.js).
 *
 * I9 (no production-bound dependency reachable): asserts the two sandbox
 * dependency objects are COMPLETE against the two production
 * `DEFAULT_DEPENDENCIES` key sets they must cover (artifact-dependencies.js
 * for `createPresiteSandboxDeps`, proposal-core-service.js's own for
 * `createPresiteInputDeps`) -- a future default added to either production
 * object without a matching sandbox key would otherwise silently fall
 * through to `dependencies.<key> || DEFAULT_DEPENDENCIES.<key>` at a real
 * call site (the exact shape the design doc's I9 warns about).
 *
 * I8 (no LLM call reachable): `runProposalCore`, `getExecutorBudget` and
 * `runPrompt` throw rather than fall through to a production default.
 */
// P1 (Opus round 1): a fake Dataverse TRANSPORT client only -- never a
// wholesale mock of loadPreSiteVisitInputs or createPresiteInputDeps, both
// of which stay real below so the REAL program-grant select/filter (and
// every other real read) is what gets exercised.
jest.mock('../../lib/dataverse/client.js', () => ({
  getAccessToken: jest.fn(async () => 'fake-sandbox-token'),
  createClient: jest.fn(),
}));

import { DEFAULT_DEPENDENCIES as ARTIFACT_SERVICE_DEFAULT_DEPENDENCIES } from '../../lib/services/pre-site-visit/artifact-dependencies.js';
import {
  createPresiteAiRunDeps,
  createPresiteInputDeps,
  createPresiteSandboxDeps,
} from '../../lib/services/test-requests/presite-sandbox-deps.js';
import { loadPreSiteVisitInputs } from '../../lib/services/pre-site-visit/proposal-core-service.js';
import { PROGRAM_GRANT_SELECT, programGrantFilter } from '../../lib/services/pre-site-visit/funding-history.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { createClient } from '../../lib/dataverse/client.js';

// proposal-core-service.js's own DEFAULT_DEPENDENCIES is not exported (it is
// a module-private const); this is the exact key list read from source
// (proposal-core-service.js:85-98) -- the mutation this test class guards
// against is a NEW key added to that object without a matching entry here
// AND in presite-sandbox-deps.js, so it is pinned as a literal, not derived.
const PROPOSAL_CORE_SERVICE_DEFAULT_DEPENDENCY_KEYS = [
  'getRequest', 'getApplicant', 'getCoPIs', 'getProposalNarrative', 'getProgramGrants',
  'getExecutorBudget', 'runPrompt', 'getWriteupRoster', 'composeRefereeSection',
];

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const NOOP_GRAPH = Object.freeze({
  ensureFolderPath: async () => { throw new Error('graph.ensureFolderPath should not be called by this test'); },
  uploadFile: async () => { throw new Error('graph.uploadFile should not be called by this test'); },
  getFileMetadataByPath: async () => { throw new Error('graph.getFileMetadataByPath should not be called by this test'); },
  downloadFile: async () => { throw new Error('graph.downloadFile should not be called by this test'); },
  deleteFile: async () => { throw new Error('graph.deleteFile should not be called by this test'); },
});

describe('createPresiteSandboxDeps (I9: complete against artifact-dependencies.js DEFAULT_DEPENDENCIES)', () => {
  const deps = createPresiteSandboxDeps({
    resourceUrl: SANDBOX_URL,
    loadInputs: async () => { throw new Error('unused in this test'); },
    graph: NOOP_GRAPH,
  });

  it('declares every key artifact-dependencies.js DEFAULT_DEPENDENCIES declares', () => {
    for (const key of Object.keys(ARTIFACT_SERVICE_DEFAULT_DEPENDENCIES)) {
      expect(typeof deps[key]).toBe('function');
    }
  });

  it('runProposalCore is a throwing sentinel (I8): the seeded draft is always found, so this is a safety net, never reached', async () => {
    await expect(deps.runProposalCore({})).rejects.toThrow(/must never be reached/);
  });

  it('getBuckets is a throwing sentinel: the seeded row is always found by generation key, so a fresh-create bucket resolution is never reached', async () => {
    await expect(deps.getBuckets('req', 'num')).rejects.toThrow(/must never be reached/);
  });

  it('refuses a non-sandbox Dataverse host', () => {
    expect(() => createPresiteSandboxDeps({
      resourceUrl: 'https://wmkf.crm.dynamics.com',
      loadInputs: async () => null,
      graph: NOOP_GRAPH,
    })).toThrow(/refusing non-sandbox Dataverse host/);
  });

  it('refuses a resourceUrl carrying a path/port (not a bare origin)', () => {
    expect(() => createPresiteSandboxDeps({
      resourceUrl: `${SANDBOX_URL}/extra`,
      loadInputs: async () => null,
      graph: NOOP_GRAPH,
    })).toThrow(/bare origin/);
  });

  it('loadInputs is the exact function reference the caller supplied (never rebuilt) -- required for seed/render snapshot equality', () => {
    const sentinel = async () => 'sentinel-result';
    const withSentinel = createPresiteSandboxDeps({ resourceUrl: SANDBOX_URL, loadInputs: sentinel, graph: NOOP_GRAPH });
    expect(withSentinel.loadInputs).toBe(sentinel);
  });

  // Item 5 (create-only): artifact-service.js calls `dependencies.uploadFile(
  // library, folder, filename, content, contentType)` with only 5 positional
  // args -- no options object -- so GraphService.uploadFile would otherwise
  // default to conflictBehavior 'replace'. The wrapper, not the caller, must
  // supply 'fail'. A legitimate resume never reaches this call with a
  // colliding name in the first place: fileNameFor (artifact-model.js)
  // suffixes every filename with the claim token, so each claim owns a
  // unique name, and recoverUploadedFile (artifact-upload-recovery.js) does
  // getFileMetadataByPath first and skips a fresh upload when the item is
  // already there -- only a TRUE name collision (a bug, or two independent
  // claims racing) ever reaches uploadFile at all, and that must refuse,
  // never silently replace.
  it('uploadFile always forces conflictBehavior "fail", regardless of what the caller passes (or omits)', async () => {
    const uploadFile = jest.fn(async () => ({ id: 'item-1' }));
    const deps = createPresiteSandboxDeps({
      resourceUrl: SANDBOX_URL,
      loadInputs: async () => null,
      graph: { ...NOOP_GRAPH, uploadFile },
    });
    await deps.uploadFile('akoya_request', 'folder', 'name.docx', Buffer.from('x'), 'application/vnd.docx');
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][5]).toEqual({ conflictBehavior: 'fail' });
  });

  it('uploadFile ignores a caller-supplied 6th argument -- "fail" is not merged with or overridden by it', async () => {
    const uploadFile = jest.fn(async () => ({ id: 'item-1' }));
    const deps = createPresiteSandboxDeps({
      resourceUrl: SANDBOX_URL,
      loadInputs: async () => null,
      graph: { ...NOOP_GRAPH, uploadFile },
    });
    await deps.uploadFile(
      'akoya_request', 'folder', 'name.docx', Buffer.from('x'), 'application/vnd.docx',
      { conflictBehavior: 'replace' },
    );
    expect(uploadFile.mock.calls[0][5]).toEqual({ conflictBehavior: 'fail' });
  });
});

describe('createPresiteInputDeps (I9: complete against proposal-core-service.js DEFAULT_DEPENDENCIES)', () => {
  const deps = createPresiteInputDeps({
    resourceUrl: SANDBOX_URL,
    graph: NOOP_GRAPH,
    findProposalNarrativeLocation: async () => null,
  });

  it('declares every key proposal-core-service.js DEFAULT_DEPENDENCIES declares', () => {
    for (const key of PROPOSAL_CORE_SERVICE_DEFAULT_DEPENDENCY_KEYS) {
      expect(typeof deps[key]).toBe('function');
    }
  });

  it('getExecutorBudget is a throwing sentinel: never called by loadPreSiteVisitInputs itself, only by the AI-execution path behind runProposalCore', async () => {
    await expect(deps.getExecutorBudget()).rejects.toThrow(/must never be reached/);
  });

  it('runPrompt is a throwing sentinel: same reasoning as getExecutorBudget', async () => {
    await expect(deps.runPrompt()).rejects.toThrow(/must never be reached/);
  });

  it('getCoPIs resolves to an empty, deterministic list (documented simplification: no wmkf_apprequestperson rows on a sandbox clone)', async () => {
    await expect(deps.getCoPIs('any-request-id')).resolves.toEqual([]);
  });
});

describe('createPresiteInputDeps + loadPreSiteVisitInputs (P1: the real program-grant select/filter, not a hand-copied one)', () => {
  const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
  const APPLICANT_ID = '22222222-2222-2222-2222-222222222222';

  const REQUEST_ROW = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1000342',
    akoya_title: 'A Study of Something',
    _akoya_applicantid_value: APPLICANT_ID,
    _wmkf_projectleader_value_formatted: 'Dr. PI Name',
    _akoya_programid_value_formatted: 'Science',
    _wmkf_programdirector_value_formatted: 'Director Name',
    wmkf_meetingdate: '2026-09-01',
    akoya_request: 50000,
    wmkf_invitedamount: 50000,
    akoya_expenses: 60000,
    akoya_begindate: '2026-01-01',
    akoya_enddate: '2026-12-31',
  };
  const CONSISTENT_GRANT_ROW = {
    akoya_requestid: '33333333-3333-3333-3333-333333333333',
    akoya_requestnum: '900001',
    akoya_fiscalyear: '2025',
    akoya_decisiondate: '2025-01-01',
    wmkf_meetingdate: '2025-01-01',
    akoya_grant: 10000,
    _wmkf_grantprogram_value_formatted: 'Research',
    wmkf_wmkfprojectdescription: 'A prior award.',
  };
  function applicantRow({ count, sum }) {
    return {
      akoya_aka: 'Test University',
      name: 'Test University Inc',
      address1_city: 'Testville',
      address1_stateorprovince: 'CA',
      wmkf_countofprogramgrants: count,
      wmkf_sumofprogramgrants: sum,
    };
  }

  /** Wires the REAL createPresiteInputDeps over a fake TRANSPORT client (dataverse/client.js is module-mocked above); grantRows/applicant are the only per-test variables. */
  function buildDeps({ grantRows, applicant }) {
    const capturedGrantUrls = [];
    createClient.mockReturnValue({
      get: jest.fn(async (url) => {
        if (url.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: REQUEST_ROW };
        if (url.startsWith(`/accounts(${APPLICANT_ID})`)) return { ok: true, status: 200, body: applicant };
        if (url.startsWith('/akoya_requests?')) { capturedGrantUrls.push(url); return { ok: true, status: 200, body: { value: grantRows } }; }
        if (url.startsWith('/wmkf_appreviewersuggestions?')) return { ok: true, status: 200, body: { value: [] } };
        throw new Error(`unexpected sandbox GET ${url}`);
      }),
    });
    const deps = createPresiteInputDeps({
      resourceUrl: SANDBOX_URL,
      graph: { downloadFile: async () => ({ buffer: Buffer.from('narrative bytes') }) },
      findProposalNarrativeLocation: async () => ({ driveId: 'd1', itemId: 'i1', filename: 'ProposalNarrative_1000342.pdf', siteId: 's1', versionId: 'v1' }),
    });
    return { deps, capturedGrantUrls };
  }

  it('queries program grants with production\'s own select and filter (PROGRAM_GRANT_SELECT/programGrantFilter from funding-history.js), not a hand-copied definition', async () => {
    const { deps, capturedGrantUrls } = buildDeps({ grantRows: [CONSISTENT_GRANT_ROW], applicant: applicantRow({ count: 1, sum: 10000 }) });
    await withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps));
    expect(capturedGrantUrls).toHaveLength(1);
    const url = new URL(`https://x${capturedGrantUrls[0]}`);
    expect(url.searchParams.get('$select')).toBe(PROGRAM_GRANT_SELECT);
    expect(url.searchParams.get('$filter')).toBe(programGrantFilter(APPLICANT_ID));
  });

  it('rollup reconciliation passes for consistent fake data (count/sum agree with the live row)', async () => {
    const { deps } = buildDeps({ grantRows: [CONSISTENT_GRANT_ROW], applicant: applicantRow({ count: 1, sum: 10000 }) });
    const result = await withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps));
    expect(result.context.documentFields.institutionalFundingHistory).toEqual(expect.stringContaining('Test University'));
  });

  it('fails closed for inconsistent fake data (rollup count disagrees with the live row)', async () => {
    const { deps } = buildDeps({ grantRows: [CONSISTENT_GRANT_ROW], applicant: applicantRow({ count: 2, sum: 10000 }) });
    await expect(
      withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps)),
    ).rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable' });
  });
});

describe('sandboxGetWriteupRoster (P2b, Opus round 1: deterministic reviewer order regardless of Dataverse list order)', () => {
  const REQUEST_ID = '44444444-4444-4444-4444-444444444444';
  const SUGGESTION_A = '55555555-5555-5555-5555-555555555555'; // -> Alpha Adams
  const SUGGESTION_B = '66666666-6666-6666-6666-666666666666'; // -> Zeta Zimmer
  const PERSON_A = '77777777-7777-7777-7777-777777777777';
  const PERSON_B = '88888888-8888-8888-8888-888888888888';

  function buildDeps(suggestionOrder) {
    createClient.mockReturnValue({
      get: jest.fn(async (url) => {
        if (url.startsWith('/wmkf_appreviewersuggestions?')) {
          return { ok: true, status: 200, body: { value: suggestionOrder.map((id) => ({ wmkf_appreviewersuggestionid: id })) } };
        }
        if (url.startsWith(`/wmkf_appreviewersuggestions(${SUGGESTION_A})`)) {
          return { ok: true, status: 200, body: { wmkf_appreviewersuggestionid: SUGGESTION_A, wmkf_accepted: true, wmkf_reviewreceivedat: null, _wmkf_potentialreviewer_value: PERSON_A, wmkf_revieweraffiliation: null } };
        }
        if (url.startsWith(`/wmkf_appreviewersuggestions(${SUGGESTION_B})`)) {
          return { ok: true, status: 200, body: { wmkf_appreviewersuggestionid: SUGGESTION_B, wmkf_accepted: true, wmkf_reviewreceivedat: null, _wmkf_potentialreviewer_value: PERSON_B, wmkf_revieweraffiliation: null } };
        }
        if (url.startsWith(`/wmkf_potentialreviewerses(${PERSON_A})`)) {
          return { ok: true, status: 200, body: { wmkf_potentialreviewersid: PERSON_A, wmkf_name: 'Alpha Adams' } };
        }
        if (url.startsWith(`/wmkf_potentialreviewerses(${PERSON_B})`)) {
          return { ok: true, status: 200, body: { wmkf_potentialreviewersid: PERSON_B, wmkf_name: 'Zeta Zimmer' } };
        }
        throw new Error(`unexpected sandbox GET ${url}`);
      }),
    });
    return createPresiteInputDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, findProposalNarrativeLocation: async () => null });
  }

  it('a fake returning suggestion rows in different orders on "seed" vs "render" still produces the same reviewer order and byte-identical roster', async () => {
    const seedDeps = buildDeps([SUGGESTION_B, SUGGESTION_A]);
    const seedRoster = await withDalContext('presite-sandbox-deps-test', () => seedDeps.getWriteupRoster(REQUEST_ID));
    const renderDeps = buildDeps([SUGGESTION_A, SUGGESTION_B]);
    const renderRoster = await withDalContext('presite-sandbox-deps-test', () => renderDeps.getWriteupRoster(REQUEST_ID));
    expect(seedRoster.reviewers.map((r) => r.name)).toEqual(['Alpha Adams', 'Zeta Zimmer']);
    expect(JSON.stringify(seedRoster)).toBe(JSON.stringify(renderRoster));
  });
});

describe('createPresiteAiRunDeps', () => {
  it('exposes createAiRun/getAiRunById/getCurrentPrompt only, sandbox-host-validated', () => {
    const deps = createPresiteAiRunDeps({ resourceUrl: SANDBOX_URL });
    expect(typeof deps.createAiRun).toBe('function');
    expect(typeof deps.getAiRunById).toBe('function');
    expect(typeof deps.getCurrentPrompt).toBe('function');
    expect(() => createPresiteAiRunDeps({ resourceUrl: 'https://wmkf.crm.dynamics.com' }))
      .toThrow(/refusing non-sandbox Dataverse host/);
  });
});

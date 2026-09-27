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

// Slice 5a (I10): only `create` is replaced, so the brief builder's
// createDocument can be observed forcing SANDBOX_REHEARSAL one layer below
// the producer's own ALLOW_UNATTRIBUTED call. No other test here creates.
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/request-document.js'),
  create: jest.fn(async () => ({ wmkf_requestdocumentid: 'created-id' })),
}));

import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../../lib/services/request-document-actor-service.js';
import { DEFAULT_DEPENDENCIES as ARTIFACT_SERVICE_DEFAULT_DEPENDENCIES } from '../../lib/services/pre-site-visit/artifact-dependencies.js';
import {
  createPresiteAiRunDeps,
  createPresiteInputDeps,
  createPresiteSandboxDeps,
  createPreRpBriefSandboxDeps,
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
    personnel: { principalInvestigator: 'Ada Principal', coPrincipalInvestigators: ['Beau CoPI'] },
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

  // Slice 4c: getCoPIs now synthesizes TEST-prefixed names from the bundle's
  // personnel (no wmkf_apprequestperson rows exist on a sandbox clone, so
  // this can never be a REAL read) instead of an unconditional [].
  it('getCoPIs resolves to the bundle\'s Co-PI names, each TEST-prefixed, same order', async () => {
    await expect(deps.getCoPIs('any-request-id')).resolves.toEqual(['TEST · Beau CoPI']);
  });

  it('createPresiteInputDeps refuses without a principalInvestigator (missing personnel)', () => {
    expect(() => createPresiteInputDeps({
      resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, findProposalNarrativeLocation: async () => null,
    })).toThrow(/requires bundle personnel/);
    expect(() => createPresiteInputDeps({
      resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, findProposalNarrativeLocation: async () => null,
      personnel: { principalInvestigator: '   ' },
    })).toThrow(/requires bundle personnel/);
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
  function buildDeps({ grantRows, applicant, personnel }) {
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
      personnel: personnel || { principalInvestigator: 'Dr. PI Name', coPrincipalInvestigators: [] },
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

  // Slice 4c live-proof finding (sandbox run 126881bc…, Request 1000347):
  // seed_presite_draft stopped at requireIdentity (proposal-core-
  // service.js:151-163) with "missing required Pre-Site Visit context:
  // principal investigator" -- the clone's Request has no project-leader
  // Contact to look up, and every 4b test mocked loadPreSiteVisitInputs
  // itself, so nothing ever ran requireIdentity for real over the sandbox
  // deps. This test runs the REAL loadPreSiteVisitInputs -> requireIdentity
  // chain over createPresiteInputDeps and proves it now succeeds.
  it('requireIdentity passes with the bundle personnel: context.personnel is [TEST-prefixed PI, then Co-PIs, in bundle order]', async () => {
    const { deps } = buildDeps({ grantRows: [CONSISTENT_GRANT_ROW], applicant: applicantRow({ count: 1, sum: 10000 }) });
    const result = await withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps));
    expect(result.context.personnel).toEqual([
      { name: 'TEST · Dr. PI Name', role: 'Principal Investigator' },
    ]);
  });

  it('requireIdentity passes with Co-PIs too, in the same order the bundle supplied them', async () => {
    const capturedGrantUrls = [];
    createClient.mockReturnValue({
      get: jest.fn(async (url) => {
        if (url.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: REQUEST_ROW };
        if (url.startsWith(`/accounts(${APPLICANT_ID})`)) return { ok: true, status: 200, body: applicantRow({ count: 1, sum: 10000 }) };
        if (url.startsWith('/akoya_requests?')) { capturedGrantUrls.push(url); return { ok: true, status: 200, body: { value: [CONSISTENT_GRANT_ROW] } }; }
        if (url.startsWith('/wmkf_appreviewersuggestions?')) return { ok: true, status: 200, body: { value: [] } };
        throw new Error(`unexpected sandbox GET ${url}`);
      }),
    });
    const deps = createPresiteInputDeps({
      resourceUrl: SANDBOX_URL,
      graph: { downloadFile: async () => ({ buffer: Buffer.from('narrative bytes') }) },
      findProposalNarrativeLocation: async () => ({ driveId: 'd1', itemId: 'i1', filename: 'ProposalNarrative_1000342.pdf', siteId: 's1', versionId: 'v1' }),
      personnel: { principalInvestigator: 'Dr. PI Name', coPrincipalInvestigators: ['Ada Co', 'Beau Co'] },
    });
    const result = await withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps));
    expect(result.context.personnel).toEqual([
      { name: 'TEST · Dr. PI Name', role: 'Principal Investigator' },
      { name: 'TEST · Ada Co', role: 'Co-Principal Investigator' },
      { name: 'TEST · Beau Co', role: 'Co-Principal Investigator' },
    ]);
  });

  // Reproduces the EXACT live-proof failure directly: a sandbox getRequest
  // that returns no formatted project-leader name (the clone's genuine
  // state -- no Contact to look up) and a getCoPIs returning [] (no
  // wmkf_apprequestperson rows), fed straight into the REAL
  // loadPreSiteVisitInputs with none of createPresiteInputDeps's own
  // synthesis. Confirms requireIdentity really did (and, without the
  // synthesis, still would) refuse this exact way -- the specific defect
  // this slice closes, not a hypothetical one.
  it('reproduces the live-proof failure directly: no PI name at all -> pre_site_visit_context_incomplete mentioning principal investigator', async () => {
    createClient.mockReturnValue({
      get: jest.fn(async (url) => {
        if (url.startsWith(`/akoya_requests(${REQUEST_ID})`)) return { ok: true, status: 200, body: { ...REQUEST_ROW, _wmkf_projectleader_value_formatted: undefined } };
        if (url.startsWith(`/accounts(${APPLICANT_ID})`)) return { ok: true, status: 200, body: applicantRow({ count: 1, sum: 10000 }) };
        if (url.startsWith('/akoya_requests?')) return { ok: true, status: 200, body: { value: [CONSISTENT_GRANT_ROW] } };
        if (url.startsWith('/wmkf_appreviewersuggestions?')) return { ok: true, status: 200, body: { value: [] } };
        throw new Error(`unexpected sandbox GET ${url}`);
      }),
    });
    const bareDeps = {
      getRequest: async (requestId) => {
        const resp = await createClient().get(`/akoya_requests(${requestId})`);
        return resp.body;
      },
      getApplicant: async (applicantId) => (await createClient().get(`/accounts(${applicantId})`)).body,
      getCoPIs: async () => [],
      getProposalNarrative: async () => ({ text: 'Narrative text '.repeat(20) }),
      getProgramGrants: async () => ({ records: [CONSISTENT_GRANT_ROW], capped: false }),
      getWriteupRoster: async () => ({ reviewers: [], blockers: [] }),
      composeRefereeSection: () => null,
    };
    await expect(
      withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, bareDeps)),
    ).rejects.toMatchObject({
      code: 'pre_site_visit_context_incomplete',
      message: expect.stringContaining('principal investigator'),
    });
  });

  // Slice 4c item 4: "same bundle => same snapshot bytes" -- two
  // independently constructed createPresiteInputDeps({...personnel}) calls,
  // fed the same fake transport, must produce byte-identical
  // loadPreSiteVisitInputs results (deterministic across seed and render,
  // which each build their own deps object from the same bundle).
  it('two independently built deps objects (same bundle personnel) produce byte-identical loadPreSiteVisitInputs results', async () => {
    const personnel = { principalInvestigator: 'Dr. PI Name', coPrincipalInvestigators: ['Ada Co', 'Beau Co'] };
    const { deps: depsA } = buildDeps({ grantRows: [CONSISTENT_GRANT_ROW], applicant: applicantRow({ count: 1, sum: 10000 }), personnel });
    const resultA = await withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, depsA));
    const { deps: depsB } = buildDeps({ grantRows: [CONSISTENT_GRANT_ROW], applicant: applicantRow({ count: 1, sum: 10000 }), personnel });
    const resultB = await withDalContext('presite-sandbox-deps-test', () => loadPreSiteVisitInputs({ requestId: REQUEST_ID }, depsB));
    expect(JSON.stringify(resultA)).toEqual(JSON.stringify(resultB));
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
    return createPresiteInputDeps({
      resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, findProposalNarrativeLocation: async () => null,
      personnel: { principalInvestigator: 'Ada Principal', coPrincipalInvestigators: [] },
    });
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

// Slice 5a (render_pre_rp_brief). pre-rp-brief/artifact-service.js's
// DEFAULT_DEPENDENCIES is module-private and used WHOLE (no per-key
// fallback), so every key is pinned as a literal read from source
// (artifact-service.js:51-71): a new default added there without a sandbox
// key here would otherwise be `undefined` at its call site.
const PRE_RP_BRIEF_DEFAULT_DEPENDENCY_KEYS = [
  'loadInputs', 'renderDocx', 'hashDocx', 'getRequest', 'getBuckets', 'findByGenerationKey', 'findByRequest',
  'hasSentAttemptForSource', 'listDistributionAttempts', 'createDocument', 'updateDocument', 'commitChangeset',
  'ensureFolderPath', 'uploadFile', 'downloadFile', 'deleteFile', 'newClaimToken',
];

describe('createPreRpBriefSandboxDeps (slice 5a; I9: complete against pre-rp-brief artifact-service DEFAULT_DEPENDENCIES)', () => {
  const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
  const getBuckets = async () => [{ library: 'akoya_request', folder: 'F', source: 'dynamics' }];
  const PERSONNEL = { principalInvestigator: 'Ada Principal', coPrincipalInvestigators: [] };

  beforeEach(() => {
    createClient.mockReset();
    createClient.mockImplementation(() => { throw new Error('no sandbox transport expected in this test'); });
  });

  it('declares every generatePreRpBrief dependency key as a function', () => {
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL });
    for (const key of PRE_RP_BRIEF_DEFAULT_DEPENDENCY_KEYS) {
      expect(typeof deps[key]).toBe('function');
    }
  });

  it('requires a caller-built getBuckets and forwards that exact reference (the env-bound default is never reachable)', () => {
    expect(() => createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, personnel: PERSONNEL })).toThrow(/requires getBuckets/);
    expect(() => createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets })).toThrow(/requires bundle personnel/);
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL });
    expect(deps.getBuckets).toBe(getBuckets);
  });

  it('refuses a non-sandbox Dataverse host', () => {
    expect(() => createPreRpBriefSandboxDeps({
      resourceUrl: 'https://wmkf.crm.dynamics.com', graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL,
    })).toThrow(/refusing non-sandbox Dataverse host/);
  });

  it('distribution-attempt readers are deterministic stubs (false / []) and never open a transport (owner decision; I9)', async () => {
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL });
    await expect(deps.hasSentAttemptForSource(REQUEST_ID, REQUEST_ID)).resolves.toBe(false);
    await expect(deps.listDistributionAttempts(REQUEST_ID, { limit: 100 })).resolves.toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('downloadFile is a throwing sentinel (generatePreRpBrief never downloads)', async () => {
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL });
    await expect(deps.downloadFile('d', 'i')).rejects.toThrow(/never reached by generatePreRpBrief/);
  });

  it('uploadFile always forces conflictBehavior "fail" (I2), even against a caller-supplied 6th argument', async () => {
    const uploadFile = jest.fn(async () => ({ driveId: 'drive-1', id: 'item-1', versionId: '1.0' }));
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: { ...NOOP_GRAPH, uploadFile }, getBuckets, personnel: PERSONNEL });
    await deps.uploadFile('akoya_request', 'folder', 'name.docx', Buffer.from('x'), 'application/vnd.docx', { conflictBehavior: 'replace' });
    expect(uploadFile.mock.calls[0][5]).toEqual({ conflictBehavior: 'fail' });
  });

  it('deleteFile deletes only the exact item this deps object uploaded', async () => {
    const deleteFile = jest.fn(async () => undefined);
    const uploadFile = jest.fn(async () => ({ driveId: 'drive-1', id: 'item-1', versionId: '1.0' }));
    const deps = createPreRpBriefSandboxDeps({
      resourceUrl: SANDBOX_URL, graph: { ...NOOP_GRAPH, uploadFile, deleteFile }, getBuckets, personnel: PERSONNEL,
    });
    await expect(deps.deleteFile('drive-1', 'item-1')).rejects.toThrow(/did not upload/);
    await deps.uploadFile('akoya_request', 'folder', 'name.docx', Buffer.from('x'), 'application/vnd.docx');
    await expect(deps.deleteFile('drive-1', 'item-2')).rejects.toThrow(/did not upload/);
    await expect(deps.deleteFile('drive-2', 'item-1')).rejects.toThrow(/did not upload/);
    expect(deleteFile).not.toHaveBeenCalled();
    await deps.deleteFile('drive-1', 'item-1');
    expect(deleteFile).toHaveBeenCalledWith('drive-1', 'item-1');
  });

  it('I10: createDocument forces SANDBOX_REHEARSAL and drops the acting user, over the sandbox svc, whatever policy the producer passes', async () => {
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL });
    await withDalContext('presite-sandbox-deps-test', () => deps.createDocument({ wmkf_name: 'x' }, {
      actingUserSystemId: REQUEST_ID,
      actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED,
      actorContext: { operation: 'pre-rp-brief-generation' },
    }));
    expect(requestDocumentAdapter.create).toHaveBeenCalledTimes(1);
    const [, options] = requestDocumentAdapter.create.mock.calls[0];
    expect(options.actorPolicy).toBe(REQUEST_DOCUMENT_ACTOR_POLICY.SANDBOX_REHEARSAL);
    expect(options).not.toHaveProperty('actingUserSystemId');
    expect(options.svc.baseUrl).toBe(`${SANDBOX_URL}/api/data/v9.2`);
    expect(options.actorContext).toEqual({ operation: 'pre-rp-brief-generation' });
  });

  it('loadInputs reads the abstract through the sandbox transport (real loadPreRpBriefInputs over the sandbox request select)', async () => {
    const urls = [];
    createClient.mockReset();
    createClient.mockReturnValue({
      get: jest.fn(async (url) => {
        urls.push(url);
        if (url.startsWith(`/akoya_requests(${REQUEST_ID})`)) {
          return {
            ok: true, status: 200,
            body: {
              akoya_requestid: REQUEST_ID, akoya_requestnum: '1000342', akoya_title: 'T',
              wmkf_meetingdate: '2026-12-01', wmkf_abstract: 'A sandbox abstract.',
            },
          };
        }
        if (url.startsWith('/wmkf_appreviewersuggestions?')) return { ok: true, status: 200, body: { value: [] } };
        throw new Error(`unexpected sandbox GET ${url}`);
      }),
    });
    const deps = createPreRpBriefSandboxDeps({ resourceUrl: SANDBOX_URL, graph: NOOP_GRAPH, getBuckets, personnel: PERSONNEL });
    const inputs = await withDalContext('presite-sandbox-deps-test', () => deps.loadInputs({ requestId: REQUEST_ID }));
    expect(inputs.envelope.request.abstract).toBe('A sandbox abstract.');
    expect(inputs.envelope.request.principalInvestigator).toBe('TEST · Ada Principal');
    expect(inputs.envelope.reviews).toEqual([]);
    expect(decodeURIComponent(urls[0])).toContain('wmkf_abstract');
    expect(createClient.mock.calls.every(([options]) => options.resourceUrl === SANDBOX_URL)).toBe(true);
  });
});

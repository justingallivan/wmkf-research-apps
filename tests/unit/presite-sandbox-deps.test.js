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
import { DEFAULT_DEPENDENCIES as ARTIFACT_SERVICE_DEFAULT_DEPENDENCIES } from '../../lib/services/pre-site-visit/artifact-dependencies.js';
import {
  createPresiteAiRunDeps,
  createPresiteInputDeps,
  createPresiteSandboxDeps,
} from '../../lib/services/test-requests/presite-sandbox-deps.js';

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

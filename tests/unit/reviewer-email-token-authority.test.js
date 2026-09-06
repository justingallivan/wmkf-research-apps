/**
 * @jest-environment node
 *
 * Reviewer email send-time token authority: durable-state concurrency
 * contract (Plan v4, S404). Exercises the REAL render-emails-service and
 * send-emails-service together against one controlled durable hash store.
 * Rendering must never write that store; sending must mint the authoritative
 * token after any legacy-token verification and substitute only that JWT.
 *
 * The harness mocks Dataverse transport but uses the REAL `hashToken` (SHA-256
 * of the JWT text), and the mocked `verifySuggestionToken` consults the same
 * mutable `durableHashBySuggestion` map the dispatch mock asserts against —
 * per the plan's harness requirement, this is not two independent fakes that
 * happen to agree.
 */

const { hashToken } = require('../../lib/services/external-token');

// ---- the ONE durable authority send writes and dispatch assertions read ----
let durableHashBySuggestion; // Map<suggestionId, hash>
let mintCounter;

// render-emails-service dependencies -----------------------------------------
const findById = jest.fn();
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
const getReviewerByIdWithSelect = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getReviewerByIdWithSelect(...a),
}));
const getRequestById = jest.fn();
const updateRequestById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
  updateById: (...a) => updateRequestById(...a),
}));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({ findByShortCode: jest.fn(async () => null) }));
jest.mock('../../lib/services/proposal-participants', () => ({ fetchCoPIs: jest.fn(async () => []) }));
jest.mock('../../lib/services/honorarium-config', () => ({ getHonorariumAmount: jest.fn(async () => 500) }));
jest.mock('../../lib/utils/cycle-code', () => ({ meetingDateToCycleCode: jest.fn(() => null) }));

const SEND_TIME_TOKEN_PLACEHOLDER_JWT = 'send_time_token.pending_authority.not_live';
const buildSendTimeExternalUrlPlaceholder = jest.fn(() => (
  `https://reviews.example.org/external/review/${SEND_TIME_TOKEN_PLACEHOLDER_JWT}`
));

// The one durable write path: send-time minting produces a fresh JWT and
// overwrites this recipient's stored hash.
const mintAndStore = jest.fn(async ({ suggestionId }) => {
  mintCounter += 1;
  const jwt = `${suggestionId}.send${mintCounter}.sig`;
  durableHashBySuggestion.set(suggestionId, hashToken(jwt));
  return { jwt, url: `https://reviews.example.org/external/review/${jwt}` };
});
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
  buildSendTimeExternalUrlPlaceholder: (...a) => buildSendTimeExternalUrlPlaceholder(...a),
  SEND_TIME_TOKEN_PLACEHOLDER_JWT,
}));

// send-emails-service dependencies -------------------------------------------
// The dispatch-time assertion the plan requires: extract every dispatched
// JWT and assert its hash still equals the durable store AT DISPATCH TIME.
let dispatchedJwts;
const createAndSendEmail = jest.fn(async (payload) => {
  const match = String(payload.body).match(/\/external\/review\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  expect(match).toBeTruthy();
  const jwt = match[1];
  dispatchedJwts.push(jwt);
  const [suggestionId] = jwt.split('.');
  expect(hashToken(jwt)).toBe(durableHashBySuggestion.get(suggestionId));
  return { emailId: 'email-1' };
});
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));
const getSystemUserById = jest.fn(async () => null);
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getByIdWithSelect: (...a) => getSystemUserById(...a),
}));
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));
jest.mock('../../lib/services/reviewer-campaign-timeline', () => ({
  getReviewerCampaignTimeline: jest.fn(async () => ({ timeline: { desiredCount: null } })),
}));
jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn(), isAllowedUrl: jest.fn(() => false) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn(async () => Buffer.from('PDF')) }));
jest.mock('../../lib/utils/cycle-material-ref', () => ({
  isPrivateCycleMaterialPathname: (p) => typeof p === 'string' && p.startsWith('cycle-materials/'),
}));

// The mocked verifySuggestionToken IS the token-authority gate under test —
// it reads the SAME durable map the dispatch mock reads, using the real
// hashToken, exactly as the plan's harness requirement specifies.
const verifySuggestionToken = jest.fn(async (jwt) => {
  const [suggestionId] = String(jwt).split('.');
  const currentHash = durableHashBySuggestion.get(suggestionId);
  if (currentHash === undefined) return { ok: false, reason: 'not_found' };
  if (hashToken(jwt) !== currentHash) return { ok: false, reason: 'hash_mismatch' };
  return { ok: true, payload: { suggestionId, requestId: REQUEST_ID } };
});
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: (...a) => verifySuggestionToken(...a),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = { subject: 'Materials', body: 'Hello,\n{{externalLink}}' };

let renderEmails;
let sendEmails;
beforeAll(async () => {
  ({ renderEmails } = await import('../../lib/services/review-manager/render-emails-service'));
  ({ sendEmails } = await import('../../lib/services/review-manager/send-emails-service'));
});

let SUGGESTIONS;
let PERSONS;

function suggestion(id, over = {}) {
  return { _wmkf_potentialreviewer_value: `person-${id}`, _wmkf_request_value: REQUEST_ID, wmkf_accepted: true, ...over };
}
function person(id, over = {}) {
  return {
    wmkf_name: `Dr. ${id}`,
    wmkf_emailaddress: `${id}@example.org`,
    wmkf_emailsource: 'orcid',
    wmkf_identitystatus: 'confirmed',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  durableHashBySuggestion = new Map();
  mintCounter = 0;
  dispatchedJwts = [];
  SUGGESTIONS = {};
  PERSONS = {};
  findById.mockImplementation(async (id) => SUGGESTIONS[id] ?? null);
  getReviewerByIdWithSelect.mockImplementation(async (id) => PERSONS[id] ?? null);
  getRequestById.mockImplementation(async () => ({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: 'R-1001',
    wmkf_meetingdate: null,
    wmkf_reviewduedate: null,
    _wmkf_programdirector_value: null,
  }));
});

// Render returns non-live placeholders and must not touch durable authority.
async function render(suggestionIds) {
  const out = await renderEmails({
    suggestionIds,
    template: TEMPLATE,
    settings: {},
    templateType: 'materials',
    actingUserSystemId: 'u-1',
  });
  return out.drafts;
}

async function send(drafts) {
  const emitted = [];
  await sendEmails(
    { requestBody: { drafts, templateType: 'materials' }, fromEmail: 'staff@wmkeck.org', actingUserSystemId: 'u-1' },
    (e) => emitted.push(e),
  );
  return emitted;
}
const resultOf = (emitted) => emitted.find((e) => e.event === 'result')?.data;

describe('v4 preview authority', () => {
  test('repeated and overlapping renders do not mint or rotate durable hashes', async () => {
    const SUG_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
    const SUG_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
    SUGGESTIONS = { [SUG_A]: suggestion(SUG_A), [SUG_B]: suggestion(SUG_B) };
    PERSONS = { [`person-${SUG_A}`]: person('a'), [`person-${SUG_B}`]: person('b') };

    const draftsA = await render([SUG_A, SUG_B]);
    const draftsB = await render([SUG_B]);

    expect(mintAndStore).not.toHaveBeenCalled();
    expect(durableHashBySuggestion.size).toBe(0);
    for (const d of [...draftsA, ...draftsB]) {
      expect(`${d.subject}\n${d.body}`).toContain(SEND_TIME_TOKEN_PLACEHOLDER_JWT);
    }

    const emitted = await send(draftsA);
    const r = resultOf(emitted);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_A, SUG_B]);
    expect(r.failed).toEqual([]);
    expect(mintAndStore).toHaveBeenCalledTimes(2);
    expect(createAndSendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('v4 two-client sequential sends', () => {
  test('each client receives a fresh authoritative token at its own send boundary', async () => {
    const SUG_X = 'cccccccc-0000-0000-0000-00000000000c';
    SUGGESTIONS = { [SUG_X]: suggestion(SUG_X) };
    PERSONS = { [`person-${SUG_X}`]: person('x') };

    const draftsClientA = await render([SUG_X]);
    const draftsClientB = await render([SUG_X]);

    const emittedA = await send(draftsClientA);
    const emittedB = await send(draftsClientB);
    expect(resultOf(emittedA).sent.map((s) => s.suggestionId)).toEqual([SUG_X]);
    expect(resultOf(emittedB).sent.map((s) => s.suggestionId)).toEqual([SUG_X]);
    expect(dispatchedJwts).toHaveLength(2);
    expect(dispatchedJwts[0]).not.toBe(dispatchedJwts[1]);
    expect(createAndSendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('v4 rotate-after-verification race', () => {
  test('durable hash rotated after verification read but before dispatch cannot send the stale JWT', async () => {
    const SUG_Y = 'dddddddd-0000-0000-0000-00000000000d';
    SUGGESTIONS = { [SUG_Y]: suggestion(SUG_Y) };
    PERSONS = { [`person-${SUG_Y}`]: person('y') };
    const staleJwt = `${SUG_Y}.legacy.sig`;
    const interveningJwt = `${SUG_Y}.intervening.sig`;
    durableHashBySuggestion.set(SUG_Y, hashToken(staleJwt));
    verifySuggestionToken.mockImplementationOnce(async (jwt) => {
      // The verifier reads and accepts the then-current durable hash.
      expect(jwt).toBe(staleJwt);
      expect(hashToken(jwt)).toBe(durableHashBySuggestion.get(SUG_Y));
      // Another writer rotates authority after that read but before send resumes.
      durableHashBySuggestion.set(SUG_Y, hashToken(interveningJwt));
      return { ok: true, payload: { suggestionId: SUG_Y, requestId: REQUEST_ID } };
    });
    // Stage 6D: a "legacy/edited draft carrying a real JWT" (this test's own
    // scenario, per the header comment) still needs a fingerprint that
    // matches send-time reads — nothing about SUGGESTIONS/PERSONS/REQUEST
    // changes between render and send in this test, so render once to get a
    // real, matching draftFingerprint and substitute in the legacy body/link.
    const [renderedDraft] = await render([SUG_Y]);
    const legacyDraft = {
      ...renderedDraft,
      subject: 'Materials',
      body: `Hello,\nhttps://reviews.example.org/external/review/${staleJwt}?action=accept`,
      externalLinkExpected: true,
    };

    const emitted = await send([legacyDraft]);
    const r = resultOf(emitted);
    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_Y]);
    expect(r.failed).toEqual([]);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(mintAndStore).toHaveBeenCalledTimes(1);
    expect(dispatchedJwts).toHaveLength(1);
    expect(dispatchedJwts[0]).not.toBe(staleJwt);
    expect(dispatchedJwts[0]).not.toBe(interveningJwt);
    expect(hashToken(dispatchedJwts[0])).toBe(durableHashBySuggestion.get(SUG_Y));
    expect(createAndSendEmail.mock.calls[0][0].body).toContain('?action=accept');
  });
});

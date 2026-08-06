/**
 * @jest-environment node
 *
 * Reviewer email send-time token authority: durable-state concurrency
 * contract (Plan v3, S404 — outputs/plan-manage-panel-preview-retry-2026-08-06.md,
 * pins S5-S7). Exercises the REAL render-emails-service and send-emails-service
 * together against a controlled in-memory durable hash store, proving the
 * send-time gate — not client generation/epoch guards — is what orders two
 * racing durable renders. S1-S4 (the gate's own decision table) are pinned in
 * render-emails-service.test.js and send-emails-service.test.js.
 *
 * The harness mocks Dataverse transport but uses the REAL `hashToken` (SHA-256
 * of the JWT text), and the mocked `verifySuggestionToken` consults the same
 * mutable `durableHashBySuggestion` map the dispatch mock asserts against —
 * per the plan's harness requirement, this is not two independent fakes that
 * happen to agree.
 */

const { hashToken } = require('../../lib/services/external-token');

// ---- the ONE durable authority both render (writer) and send (reader) touch ----
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

// The one durable write path: every mint produces a fresh JWT (embedding the
// suggestionId + a monotonic render tag so the test can tell mints apart) and
// overwrites this recipient's stored hash — exactly what render-emails-service
// documents ("each render produces a fresh JWT and overwrites the prior hash").
const mintAndStore = jest.fn(async ({ suggestionId }) => {
  mintCounter += 1;
  const jwt = `${suggestionId}.r${mintCounter}.sig`;
  durableHashBySuggestion.set(suggestionId, hashToken(jwt));
  return { jwt, url: `https://reviews.example.org/external/review/${jwt}` };
});
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
}));

// send-emails-service dependencies -------------------------------------------
// The dispatch-time assertion the plan requires: extract every dispatched
// JWT and assert its hash still equals the durable store AT DISPATCH TIME.
const createAndSendEmail = jest.fn(async (payload) => {
  const match = String(payload.body).match(/\/external\/review\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  expect(match).toBeTruthy();
  const jwt = match[1];
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

// Render a single suggestion and return its ready draft (mints/rotates the
// durable hash as a side effect via the mocked mintAndStore above).
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

describe('S5: overlapped superseding render', () => {
  test('sending the FIRST render dispatches the untouched recipient and fails the superseded one closed', async () => {
    const SUG_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
    const SUG_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
    SUGGESTIONS = { [SUG_A]: suggestion(SUG_A), [SUG_B]: suggestion(SUG_B) };
    PERSONS = { [`person-${SUG_A}`]: person('a'), [`person-${SUG_B}`]: person('b') };

    // Render A: mints tokens for both recipients.
    const draftsA = await render([SUG_A, SUG_B]);

    // Overlapping Render B: re-renders (and re-mints) ONLY the B recipient
    // before A's send — durableHashBySuggestion[SUG_B] is now B's newer hash.
    await render([SUG_B]);

    // Send the FIRST render's drafts (both recipients, B's link now stale).
    const emitted = await send(draftsA);
    const r = resultOf(emitted);

    expect(r.sent.map((s) => s.suggestionId)).toEqual([SUG_A]);
    expect(r.failed).toEqual([expect.objectContaining({ suggestionId: SUG_B, code: 'external_link_superseded' })]);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1); // only SUG_A ever reached Dynamics
  });
});

describe('S6: two-client interleaving', () => {
  test('Client A\'s stale send fails closed with zero dispatches; Client B\'s current send dispatches once', async () => {
    const SUG_X = 'cccccccc-0000-0000-0000-00000000000c';
    SUGGESTIONS = { [SUG_X]: suggestion(SUG_X) };
    PERSONS = { [`person-${SUG_X}`]: person('x') };

    const draftsClientA = await render([SUG_X]); // token A minted; durable hash = hash(A)
    const draftsClientB = await render([SUG_X]); // token B minted; durable hash = hash(B), superseding A

    const emittedA = await send(draftsClientA);
    const rA = resultOf(emittedA);
    expect(rA.sent).toEqual([]);
    expect(rA.failed).toEqual([expect.objectContaining({ suggestionId: SUG_X, code: 'external_link_superseded' })]);
    expect(createAndSendEmail).not.toHaveBeenCalled();

    const emittedB = await send(draftsClientB);
    const rB = resultOf(emittedB);
    expect(rB.sent.map((s) => s.suggestionId)).toEqual([SUG_X]);
    expect(rB.failed).toEqual([]);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('S7: timed-out first request is not "no durable write"', () => {
  test('a late-landing first render still supersedes an intervening retry\'s token; only a fresh render after that sends cleanly', async () => {
    const SUG_Y = 'dddddddd-0000-0000-0000-00000000000d';
    SUGGESTIONS = { [SUG_Y]: suggestion(SUG_Y) };
    PERSONS = { [`person-${SUG_Y}`]: person('y') };

    // The FIRST request (conceptually issued first) is withheld by the client
    // as timed out; the PD retries, and that retry's render lands (and mints)
    // first in real time.
    const draftsRetryB = await render([SUG_Y]); // token B; durable hash = hash(B)

    // The "late" first request now finally lands server-side (its durable
    // write was never actually lost — a timeout is a client-side belief, not
    // a durable-state fact) and supersedes B.
    await render([SUG_Y]); // token A(second call); durable hash = hash(A), superseding B

    // Sending the retry's (now-stale) drafts must fail closed with ZERO dispatches.
    const emittedB = await send(draftsRetryB);
    const rB = resultOf(emittedB);
    expect(rB.sent).toEqual([]);
    expect(rB.failed).toEqual([expect.objectContaining({ suggestionId: SUG_Y, code: 'external_link_superseded' })]);
    expect(createAndSendEmail).not.toHaveBeenCalled();

    // A fresh render C is current and dispatches cleanly, satisfying the
    // dispatch-time hash assertion inside the createAndSendEmail mock.
    const draftsC = await render([SUG_Y]);
    const emittedC = await send(draftsC);
    const rC = resultOf(emittedC);
    expect(rC.sent.map((s) => s.suggestionId)).toEqual([SUG_Y]);
    expect(rC.failed).toEqual([]);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });
});

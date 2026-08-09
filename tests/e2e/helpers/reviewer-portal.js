// Test doubles for the external reviewer portal browser specs.
//
// The portal page (`pages/external/review/[token].js`) fetches
// `/api/external/review/[token]/context` on mount and POSTs accept/decline to
// `/api/external/review/[token]/respond`. We route-mock BOTH at the browser so
// the real page + components render and behave exactly as in prod, but no
// request ever reaches the Next server or Dataverse.
//
// The context fixture mirrors the real 200 shape in `context.js` (proposal /
// reviewer / prefill / policies / etag / engagementState).

const { reviewFormSchema } = require('../../../lib/external/review-form-schema');

const TOKEN = 'e2e-test-token';

// The authoring views render the form from the context-supplied question set
// (staff-editable-questions Phase B2). The seeded prod set is identical to the
// static schema, so the static fields are a faithful fixture. The version tag is
// arbitrary-but-stable; the client echoes it back on submit and a stale value
// drives the server's `set_changed` 409 (asserted in the spec).
const QUESTION_SET = reviewFormSchema.fields;
const QUESTION_SET_VERSION = 'e2e-questionset-v1';

// A short policy body fits the modal without scrolling → the ack button enables
// immediately (PolicyAckModal: `scrollHeight <= clientHeight` short-circuit).
const SHORT_BODY = 'This is a short policy. By acknowledging you confirm you have read it.';
// A long body forces the scroll-gate (ack disabled until scrolled to the bottom).
const LONG_BODY = Array.from({ length: 120 }, (_, i) =>
  `Policy clause ${i + 1}: the reviewer agrees to the terms described in this section.`).join('\n');

function buildPolicies({ longBody = false } = {}) {
  const body = longBody ? LONG_BODY : SHORT_BODY;
  return {
    'reviewer-coi': {
      slotCode: 'reviewer-coi',
      activeVersionId: 'coi-v1',
      versionLabel: 'v1',
      title: 'Conflict of Interest policy',
      body,
    },
    'reviewer-ai-use': {
      slotCode: 'reviewer-ai-use',
      activeVersionId: 'aiuse-v1',
      versionLabel: 'v1',
      title: 'AI Use policy',
      body,
    },
  };
}

// Build a context() 200 payload. `address`/`honorariumOptOut`/`longBody` are the
// knobs the specs vary; everything else is a sensible default.
function buildContext({ address, honorariumOptOut = false, longBody = false, view = 'stage2a' } = {}) {
  const defaultAddress = {
    line1: '123 Main St', line2: '', city: 'Townsville', state: 'CA',
    postalCode: '94000', country: 'US', phone: '+1 555 123 4567',
  };
  const accepted = ['accepted-pre-materials', 'stage2b', 'submitted'].includes(view);
  const declined = view === 'declined';
  // context.js attaches the question set only in the stage2b authoring view; it
  // is null everywhere else (the form isn't rendered). Mirror that here.
  const authoring = view === 'stage2b';
  return {
    ok: true,
    engagementState: { view, accepted, declined },
    etag: 'W/"etag-1"',
    proposal: {
      title: 'A Study of Test-Driven Reviewer Onboarding',
      meetingDate: '2026-07-01T00:00:00Z',
      abstract: 'An abstract describing the proposed work in brief.',
      applicantInstitution: 'Example University',
      projectLeader: 'Dr. Pat Leader',
      coPIs: ['Dr. Sam Co'],
    },
    reviewer: { name: 'Dr. Jane Reviewer', email: 'jane@uni.edu', organization: 'Example University' },
    reviewDeadline: '2026-07-15',
    tokenExpiresAt: '2026-08-01T00:00:00Z',
    submission: { receivedAt: null, filename: null },
    prefill: {
      affiliation: 'Example University',
      riskLevel: null, overallAssessment: null,
      firstName: 'Jane', lastName: 'Reviewer', nickname: 'Dr. Reviewer',
      title: 'Professor', email: 'jane@uni.edu', orcid: '0000-0002-1825-0097',
      honorariumOptOut,
      address: address === undefined ? defaultAddress : address,
    },
    policies: buildPolicies({ longBody }),
    files: [],
    questions: authoring ? QUESTION_SET : null,
    questionSetVersion: authoring ? QUESTION_SET_VERSION : null,
  };
}

/**
 * Wire up the portal route mocks on a page.
 *
 * @returns {{ respondCalls: Array, setContext: (ctx) => void }}
 *   respondCalls accumulates every parsed /respond POST body (assert against it).
 *   setContext swaps the context payload (e.g. to simulate the post-accept refetch).
 */
async function mockPortal(page, { context, respond } = {}) {
  const state = { context: context || buildContext(), respondCalls: [] };

  // GET /context — return the current fixture.
  await page.route(`**/api/external/review/${TOKEN}/context`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.context) });
  });

  // POST /respond — record the body, then return what the test wants. Default:
  // a successful accept that flips the context to the accepted view (so the
  // page's post-accept refetch transitions away from Stage 2a).
  await page.route(`**/api/external/review/${TOKEN}/respond`, async (route) => {
    const body = route.request().postDataJSON();
    state.respondCalls.push(body);
    if (respond) return respond(route, body, state);
    if (body.action === 'accept') {
      state.context = buildContext({ view: 'accepted-pre-materials' });
    } else if (body.action === 'decline') {
      state.context = buildContext({ view: 'declined' });
    }
    const engagementState = body.action === 'decline'
      ? { view: 'declined', accepted: false, declined: true }
      : { view: 'accepted-pre-materials', accepted: true, declined: false };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, idempotent: false, engagementState }),
    });
  });

  return {
    respondCalls: state.respondCalls,
    setContext: (ctx) => { state.context = ctx; },
  };
}

const portalUrl = (token = TOKEN) => `/external/review/${token}`;

module.exports = { TOKEN, buildContext, buildPolicies, mockPortal, portalUrl, SHORT_BODY, LONG_BODY, QUESTION_SET_VERSION };

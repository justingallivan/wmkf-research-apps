'use strict';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_NUM = '1002788';
const PROGRAM_ID = '99999999-9999-4999-8999-999999999999';
const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_TOKEN = 'pd-reviewer-rehearsal-token';
const REVIEWER_EMAIL = 'reviewer.capture@example.test';
const PD_EMAIL = 'program.director@example.test';
const PD_ID = '77777777-7777-4777-8777-777777777777';
const PD_ID_NEXT = '88888888-8888-4888-8888-888888888888';
const CANDIDATE_KEY = 'candidate:dr.saved reviewer';
const PASSIVE_DATA_PATHS = Object.freeze([
  'index.json',
  'workbench.json',
  'workbench/00000000-0000-4000-8000-000000000001.json',
  'guide.json',
  'profile-settings.json',
]);
const { buildContext, QUESTION_SET_VERSION } = require('../../tests/e2e/helpers/reviewer-portal');

const SCENARIOS = Object.freeze({
  BASELINE: 'baseline',
  PD_DRIFT: 'pd-drift',
  MANUAL_COI_BLOCKED: 'manual-coi-blocked',
  MANUAL_COI_UNAVAILABLE: 'manual-coi-unavailable',
  MANUAL_COI_UNKNOWN_ALLOWED: 'manual-coi-unknown-allowed',
  MATERIALS_PARTIAL: 'materials-partial',
  SAVED_FIND_EXCLUSION: 'saved-find-exclusion',
  DECLINE_RESET: 'decline-reset',
  REVIEWER_AUTHORING: 'reviewer-authoring',
});

const REQUEST_PATHS = Object.freeze({
  'GET /api/auth/status': 1,
  'GET /api/auth/session': 1,
  'GET /api/app-access': 1,
  'GET /api/user-profiles': 1,
  'GET /api/user-preferences': 1,
  'POST /api/user-preferences': 1,
  'GET /api/workbench/staffing': 1,
  'GET /api/workbench/board-writeups': 1,
  'GET /api/workbench/resolve-request': 1,
  'GET /api/workbench/dashboard': 1,
  'GET /api/workbench/applicant-reviewers': 1,
  'GET /api/workbench/reviewer-roster': 1,
  'PATCH /api/workbench/reviewer-roster': 1,
  'GET /api/workbench/decline-referrals': 1,
  'PATCH /api/workbench/decline-referrals': 1,
  'POST /api/workbench/reviewer-lookup': 1,
  'POST /api/workbench/manual-reviewer': 1,
  'POST /api/reviewer-finder/load-proposal': 1,
  'GET /api/reviewer-finder/my-candidates': 1,
  'POST /api/reviewer-finder/save-candidates': 1,
  'POST /api/reviewer-finder/analyze': 1,
  'POST /api/reviewer-finder/discover': 1,
  'POST /api/reviewer-finder/enrich-contacts': 1,
  'GET /api/review-manager/reviewers': 1,
  'GET /api/review-manager/materials-preflight': 1,
  'GET /api/review-manager/reviewer-vip-flags': 1,
  'GET /api/review-manager/release-settings': 1,
  'GET /api/email-defaults/reviewer-templates': 1,
  'GET /api/review-manager/campaign-config': 1,
  'GET /api/review-manager/campaign-timeline-defaults': 1,
  'POST /api/review-manager/campaign-config': 1,
  'POST /api/review-manager/render-emails': 1,
  'POST /api/review-manager/send-emails': 1,
  'POST /api/review-manager/render-withdraw-emails': 1,
  'POST /api/review-manager/withdraw-sufficient': 1,
  'GET /api/external/review/pd-reviewer-rehearsal-token/context': 1,
  'POST /api/external/review/pd-reviewer-rehearsal-token/respond': 1,
  'GET /api/external/review/pd-reviewer-rehearsal-token/draft': 1,
  'PUT /api/external/review/pd-reviewer-rehearsal-token/draft': 1,
  'POST /api/external/review/pd-reviewer-rehearsal-token/submit': 1,
});

function apiKey(method, pathname) {
  return `${String(method || '').toUpperCase()} ${pathname}`;
}

function isMockedApiRequest(request, { baseUrl, scenario = SCENARIOS.BASELINE } = {}) {
  if (!baseUrl || !request?.url || !request?.method) return false;
  if (!Object.values(SCENARIOS).includes(scenario)) return false;
  try {
    const requestUrl = new URL(request.url());
    const targetUrl = new URL(baseUrl);
    if (requestUrl.origin !== targetUrl.origin || !requestUrl.pathname.startsWith('/api/')) return false;
    return Boolean(REQUEST_PATHS[apiKey(request.method(), requestUrl.pathname)]);
  } catch {
    return false;
  }
}

function isMockedPassiveRequest(request, { baseUrl, buildId } = {}) {
  if (!baseUrl || !buildId || !request?.url || !request?.method) return false;
  const method = String(request.method()).toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) return false;
  try {
    const requestUrl = new URL(request.url());
    const targetUrl = new URL(baseUrl);
    if (requestUrl.origin !== targetUrl.origin) return false;
    if (requestUrl.pathname === '/_vercel/insights/script.js') return true;
    const expectedPrefix = `/_next/data/${buildId}/`;
    if (!requestUrl.pathname.startsWith(expectedPrefix)) return false;
    return PASSIVE_DATA_PATHS.includes(requestUrl.pathname.slice(expectedPrefix.length));
  } catch {
    return false;
  }
}

async function fulfillPassiveMock(route, { baseUrl, buildId, state } = {}) {
  const request = route.request();
  if (!isMockedPassiveRequest(request, { baseUrl, buildId })) return false;
  const url = new URL(request.url());
  const isAnalytics = url.pathname === '/_vercel/insights/script.js';
  const contentType = isAnalytics ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8';
  const body = request.method().toUpperCase() === 'HEAD'
    ? ''
    : isAnalytics
      ? '/* analytics disabled in private rehearsal */'
      : JSON.stringify({ pageProps: {}, __N_SSG: true });
  state?.passiveCalls?.push({ method: request.method().toUpperCase(), pathname: url.pathname });
  await route.fulfill({ status: 200, contentType, body });
  return true;
}

function json(status, body) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function candidate(overrides = {}) {
  return {
    suggestionId: SUGGESTION_ID,
    candidateKey: CANDIDATE_KEY,
    name: 'Dr. Saved Reviewer',
    affiliation: 'Example University',
    email: REVIEWER_EMAIL,
    invited: false,
    accepted: false,
    declined: false,
    reasoning: 'Synthetic rehearsal candidate for the current request.',
    keywords: 'clinical methods; instrumentation',
    emailConfidence: { level: 'high', reason: 'confirmed_identity' },
    applicantRecommended: false,
    manualAdded: false,
    ...overrides,
  };
}

function rosterSnapshot(savedKeys = []) {
  const saved = savedKeys.length ? [candidate()] : [];
  const active = savedKeys.length
    ? []
    : [candidate({ suggestionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidateKey: 'candidate:dr.active reviewer', name: 'Dr. Active Reviewer' })];
  return {
    success: true,
    active,
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys,
    allNames: saved.map((item) => item.name),
    repairRequests: [],
    repairRequestsUnavailable: false,
  };
}

function portalContext(view = 'stage2a') {
  const context = buildContext({ view });
  context.reviewer.email = REVIEWER_EMAIL;
  context.prefill.email = REVIEWER_EMAIL;
  return context;
}

function fillSyntheticTemplate(template, recipient, { origin, signature = 'Program Director', reviewDueDate = '' } = {}) {
  const link = new URL(`/external/review/${REVIEW_TOKEN}`, origin).toString();
  const values = {
    greeting: `Dear ${recipient.name || 'Reviewer'}`,
    recipientName: recipient.name || 'Reviewer',
    proposalTitle: 'Synthetic reviewer rehearsal',
    piName: 'Synthetic Principal Investigator',
    piInstitution: 'Example University',
    proposalDetails: 'Synthetic details for private rehearsal.',
    reviewDueDate: reviewDueDate || '',
    signature,
    externalLink: link,
  };
  const replace = (value) => String(value || '').replace(/\{\{(greeting|recipientName|proposalTitle|piName|piInstitution|proposalDetails|reviewDueDate|signature|externalLink)\}\}/g, (match, key) => values[key] ?? match);
  return { subject: replace(template?.subject), body: replace(template?.body) };
}

function syntheticTemplates() {
  return {
    invitation: {
      subject: 'Invitation to review {{proposalTitle}}',
      body: '{{greeting}},\n\nPlease consider reviewing {{proposalTitle}}.\n{{externalLink}}\n\n{{signature}}',
    },
    materials: {
      subject: 'Materials for {{proposalTitle}}',
      body: '{{greeting}},\n\nSynthetic materials for {{proposalTitle}} are ready. Review due {{reviewDueDate}}.\n{{externalLink}}\n\n{{signature}}',
    },
    followup: { subject: 'Follow-up: {{proposalTitle}}', body: '{{greeting}},\n\nA follow-up about {{proposalTitle}}.\n\n{{signature}}' },
    thankyou: { subject: 'Thank you', body: '{{greeting}},\n\nThank you.\n\n{{signature}}' },
  };
}

function createState(scenario, buildId = null) {
  const isPreseededManualCoi = [SCENARIOS.MANUAL_COI_BLOCKED, SCENARIOS.MANUAL_COI_UNAVAILABLE].includes(scenario);
  const preseededManual = candidate({
    name: 'Dr. Synthetic Reviewer',
    candidateKey: 'suggestion:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    suggestionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    sources: ['staff_manual'],
    manualAdded: true,
    mainInstitution: scenario === SCENARIOS.MANUAL_COI_BLOCKED ? 'Example University' : undefined,
  });
  const candidateRows = isPreseededManualCoi ? [preseededManual] : [
    candidate(),
    ...([SCENARIOS.BASELINE, SCENARIOS.PD_DRIFT].includes(scenario) ? [candidate({
      suggestionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      candidateKey: 'candidate:dr.pending reviewer',
      name: 'Dr. Pending Reviewer',
      email: 'pending.reviewer@example.test',
      invited: true,
    })] : []),
  ];
  const savedFindScenario = scenario === SCENARIOS.SAVED_FIND_EXCLUSION;
  const materialAccepted = {
    suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Dr. Accepted Reviewer',
    affiliation: 'Example University',
    email: REVIEWER_EMAIL,
    reviewStatus: 'accepted',
    tokenState: 'active',
    tokenExpiresAt: '2099-08-01T00:00:00Z',
    reminderCount: 0,
    notes: '',
    invited: true,
    accepted: true,
  };
  const materialPending = {
    suggestionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: 'Dr. Pending Reviewer',
    affiliation: 'Example Institute',
    email: 'pending.reviewer@example.test',
    reviewStatus: 'pending',
    tokenState: 'active',
    tokenExpiresAt: '2099-08-01T00:00:00Z',
    reminderCount: 0,
    notes: '',
    invited: true,
    accepted: false,
  };
  const inviteReviewer = {
    ...candidate(),
    reviewStatus: 'pending',
    tokenState: 'none',
    tokenExpiresAt: null,
    reminderCount: 0,
    notes: '',
  };
  const pendingWithdrawReviewer = {
    ...candidate({
      suggestionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      candidateKey: 'candidate:dr.pending reviewer',
      name: 'Dr. Pending Reviewer',
      email: 'pending.reviewer@example.test',
      invited: true,
    }),
    reviewStatus: 'pending',
    tokenState: 'active',
    tokenExpiresAt: '2099-08-01T00:00:00Z',
    reminderCount: 0,
    notes: '',
  };
  const state = {
    scenario,
    buildId,
    passiveCalls: [],
    candidateRows,
    roster: savedFindScenario
      ? {
        ...rosterSnapshot([]),
        active: [candidate()],
      }
      : rosterSnapshot([]),
    institutionScreen: {
      source: scenario === SCENARIOS.MANUAL_COI_BLOCKED ? 'staff_saved_main_institution' : null,
      mainInstitution: scenario === SCENARIOS.MANUAL_COI_BLOCKED ? 'Example University' : '',
      expected: scenario === SCENARIOS.MANUAL_COI_BLOCKED
        ? 'manual_institution_coi'
        : scenario === SCENARIOS.MANUAL_COI_UNAVAILABLE
          ? 'manual_institution_coi_unavailable'
          : null,
    },
    reviewerContext: portalContext(scenario === SCENARIOS.REVIEWER_AUTHORING ? 'stage2b' : 'stage2a'),
    reviewerRows: scenario === SCENARIOS.MATERIALS_PARTIAL
      ? [materialAccepted, materialPending]
      : isPreseededManualCoi
        ? [{ ...preseededManual, reviewStatus: 'pending', tokenState: 'none', tokenExpiresAt: null, reminderCount: 0, notes: '' }]
        : [SCENARIOS.BASELINE, SCENARIOS.PD_DRIFT].includes(scenario)
          ? [materialAccepted, inviteReviewer, pendingWithdrawReviewer]
        : [],
    referrals: scenario === SCENARIOS.DECLINE_RESET ? [{
      referralId: 'referral-1',
      suggestionId: SUGGESTION_ID,
      referralName: 'Dr. Suggested Reviewer',
      reviewerName: 'Dr. Declining Reviewer',
      email: 'suggested.reviewer@example.test',
      institution: 'Example Institute',
      referralVersion: 'v1',
      referralIndex: 0,
      dismissible: true,
      legacy: false,
    }] : [],
    calls: [],
    violations: [],
    transitions: [],
    manualAdds: [],
    manualResponses: [],
    rosterMutations: [],
    declineMutations: [],
    withdrawBodies: [],
    withdrawRenderBodies: [],
    withdrawCapturedEmails: [],
    withdrawTransitions: [],
    sentBodies: [],
    renderBodies: [],
    previewSnapshots: [],
    capturedEmails: [],
    materialsSentIds: [],
    currentProgramDirectorId: PD_ID,
    currentProgramDirectorEmail: PD_EMAIL,
    campaignConfig: {
      respondOffsetDays: 7,
      reviewDueDate: '2099-07-22',
      desiredCount: null,
      respondReminderEnabled: false,
      respondReminderLeadDays: null,
      reviewDueReminderEnabled: false,
      reviewDueReminderLeadDays: null,
      quotaNotifiedAt: null,
    },
    reviewDraft: null,
    reviewSubmit: null,
    reviewReceivedAt: null,
    resetCount: 0,
  };
  return state;
}

function installMocks(context, { baseUrl, buildId = null, scenario = SCENARIOS.BASELINE, onViolation = () => {} } = {}) {
  if (!baseUrl) throw new Error('base_url_required');
  if (!Object.values(SCENARIOS).includes(scenario)) throw new Error('unknown_scenario');
  const state = createState(scenario, buildId);
  const origin = new URL(baseUrl).origin;
  const respond = async (route, status, body, contentType = 'application/json') => route.fulfill({
    status, contentType, body: contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const reject = async (route, message) => {
    state.violations.push(message);
    onViolation(message);
    return route.abort();
  };

  const handler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const pathname = url.pathname;
    if (url.origin !== origin || !pathname.startsWith('/api/')) {
      return reject(route, 'api_origin_or_path_violation');
    }
    if (!isMockedApiRequest(request, { baseUrl, scenario })) {
      return reject(route, `${method} ${pathname} is outside the rehearsal fixture boundary`);
    }
    const key = apiKey(method, pathname);
    state.calls.push({ method, pathname });
    const body = method !== 'GET' && method !== 'HEAD'
      ? (() => { try { return request.postDataJSON() || {}; } catch { return {}; } })()
      : {};

    if (key === 'GET /api/auth/status') return respond(route, 200, { enabled: false });
    if (key === 'GET /api/auth/session') return respond(route, 200, {
      user: {
        name: 'Program Director',
        email: PD_EMAIL,
        azureId: 'pd-e2e-azure-id',
        userType: 'staff',
        profileId: 1,
        dynamicsSystemuserId: PD_ID,
      },
      expires: '2099-06-30T12:00:00.000Z',
    });
    if (key === 'GET /api/app-access') return respond(route, 200, { apps: ['reviewers'], isSuperuser: false });
    if (key === 'GET /api/user-profiles') return respond(route, 200, { profiles: [{ id: 1, name: 'Program Director', displayName: 'Program Director', isDefault: true, avatarColor: '#111827' }] });
    if (key === 'GET /api/user-preferences') {
      const value = url.searchParams.has('key') ? { value: '' } : { preferences: { email_signature: JSON.stringify({ signature: 'Program Director' }) } };
      return respond(route, 200, value);
    }
    if (key === 'POST /api/user-preferences') return respond(route, 200, { success: true });
    if (key === 'GET /api/workbench/staffing') {
      if (url.searchParams.get('capabilities') === 'true') {
        return respond(route, 200, { canManageSharedRoles: false, isSuperuser: false });
      }
      const emptyRole = { value: null, revision: null };
      return respond(route, 200, {
        canManageSharedRoles: false,
        isSuperuser: false,
        staff: [],
        roles: {
          president: emptyRole,
          cso: emptyRole,
          grantsManager: emptyRole,
          programCoordinator: emptyRole,
          systemsSpecialist: emptyRole,
        },
      });
    }
    if (key === 'GET /api/workbench/board-writeups') return respond(route, 200, {
      canRelease: false,
      canArchive: false,
      isSuperuser: false,
      cycles: [],
    });
    if (key === 'GET /api/workbench/resolve-request') return respond(route, 200, {
      success: true, requestId: REQUEST_ID, requestNumber: REQUEST_NUM,
      title: 'Synthetic reviewer rehearsal', cycleLabel: 'J26', grantProgram: 'Research',
      institution: 'Example University', programDirectorId: state.currentProgramDirectorId,
    });
    if (key === 'GET /api/workbench/dashboard') {
      const programDirector = { systemuserid: state.currentProgramDirectorId, fullName: 'Program Director' };
      const programs = [{ programId: PROGRAM_ID, name: 'Synthetic program' }];
      const programId = url.searchParams.get('programId') || PROGRAM_ID;
      const cycleCode = url.searchParams.get('cycleCode');
      const scopeParam = url.searchParams.get('scope');
      if (programId !== PROGRAM_ID || (cycleCode && cycleCode !== 'J26') || (scopeParam && !['my', 'all'].includes(scopeParam))) {
        return respond(route, 404, { success: false, error: 'Synthetic dashboard context not found' });
      }
      const program = programs.find((item) => item.programId === programId) || programs[0];
      const metadata = {
        success: true,
        programDirector,
        programs,
        programId: program.programId,
        defaultProgramId: PROGRAM_ID,
        programName: program.name,
      };
      if (!cycleCode) return respond(route, 200, {
        ...metadata,
        cycles: [{ code: 'J26', label: 'June 2026', year: 2026, month: 6, meetingDate: '2026-06-30', count: 1, setAsideCount: 0, myCount: 1, mySetAsideCount: 0 }],
        defaultCycleCode: 'J26',
        lastDecidedCycleCode: null,
      });
      const scope = url.searchParams.get('scope') || 'my';
      const includeSetAside = url.searchParams.get('includeSetAside') === '1';
      return respond(route, 200, {
        ...metadata,
        cycleCode,
        cycleLabel: cycleCode === 'J26' ? 'June 2026' : cycleCode,
        scope,
        includeSetAside,
        rollup: { total: 1, stages: { find: 0, invite: 1, awaiting: 0, review: 0, done: 0 } },
        proposals: [{ requestId: REQUEST_ID, requestNumber: REQUEST_NUM, title: 'Synthetic reviewer rehearsal', institution: 'Example University', programDirector: 'Program Director', projectLeader: 'Synthetic Principal Investigator', workRemaining: 'invite' }],
      });
    }
    if (key === 'GET /api/workbench/applicant-reviewers') return respond(route, 200, {
      success: true, recommended: [], recommendedFailed: [], knownLookupFailed: [], slotsPopulated: 0,
      excludedNames: ['Dr. Already Excluded'], excludedRaw: 'Dr. Already Excluded', excludedParseFailed: false,
    });
    if (key === 'GET /api/workbench/reviewer-roster') return respond(route, 200, state.roster);
    if (key === 'PATCH /api/workbench/reviewer-roster') {
      state.rosterMutations.push(body);
      if (scenario === SCENARIOS.SAVED_FIND_EXCLUSION && body.action === 'exclude') {
        state.roster = rosterSnapshot([CANDIDATE_KEY]);
        return respond(route, 409, { success: false, code: 'candidate_already_saved', error: 'This reviewer is already on Invite.' });
      }
      return respond(route, 200, { success: true, action: body.action });
    }
    if (key === 'GET /api/workbench/decline-referrals') return respond(route, 200, { success: true, referrals: state.referrals });
    if (key === 'PATCH /api/workbench/decline-referrals') {
      state.declineMutations.push(body);
      const index = state.referrals.findIndex((referral) => referral.suggestionId === body.suggestionId);
      if (index >= 0) state.referrals.splice(index, 1);
      state.transitions.push({ type: 'decline-referral-dismissed', suggestionId: body.suggestionId });
      return respond(route, 200, { success: true });
    }
    if (key === 'POST /api/workbench/reviewer-lookup') return respond(route, 200, { outcome: 'none' });
    if (key === 'POST /api/workbench/manual-reviewer') {
      state.manualAdds.push(body);
      const added = candidate({
        suggestionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        candidateKey: 'suggestion:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        potentialReviewerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        contactId: null,
        name: body.name,
        email: body.email || null,
        affiliation: body.affiliation || null,
        sources: ['staff_manual'],
        manualAdded: true,
        invitable: true,
      });
      state.candidateRows.push(added);
      state.reviewerRows.push({
        ...added,
        reviewStatus: 'pending',
        tokenState: 'none',
        tokenExpiresAt: null,
        reminderCount: 0,
        notes: '',
      });
      state.transitions.push({ type: 'manual-reviewer-added', name: added.name });
      const success = { success: true, candidate: added, created: { person: true, suggestion: true } };
      state.manualResponses.push({ status: 200, payload: success });
      return respond(route, 200, success);
    }
    if (key === 'POST /api/reviewer-finder/load-proposal') return respond(route, 200, {
      success: true, filename: 'Synthetic reviewer proposal.pdf', blobUrl: `${origin}/fixture/reviewer-proposal.pdf`,
      proposalKey: 'Reviewer Materials::1002788::Synthetic reviewer proposal.pdf',
      picked: 'Reviewer Materials::1002788::Synthetic reviewer proposal.pdf',
      allFiles: [{ library: 'Reviewer Materials', folder: '1002788', name: 'Synthetic reviewer proposal.pdf', classification: 'proposal' }],
    });
    if (key === 'GET /api/reviewer-finder/my-candidates') return respond(route, 200, { proposals: [{ proposalId: REQUEST_ID, candidates: state.candidateRows }] });
    if (key === 'POST /api/reviewer-finder/save-candidates') {
      const keys = (body.candidates || []).map((item) => item.candidateKey || CANDIDATE_KEY);
      const existing = keys.find((candidateKey) => state.roster.savedKeys.includes(candidateKey));
      if (existing) return respond(route, 409, { success: false, code: 'candidate_already_saved', savedKeys: state.roster.savedKeys, totalRequested: keys.length, results: [] });
      state.roster.savedKeys.push(...keys);
      return respond(route, 200, {
        success: true,
        savedCount: keys.length,
        savedNames: (body.candidates || []).map((item) => item.name).filter(Boolean),
        savedKeys: keys,
        totalRequested: keys.length,
        results: (body.candidates || []).map((item, index) => ({
          index,
          candidateKey: item.candidateKey || CANDIDATE_KEY,
          name: item.name,
          outcome: 'saved',
          code: 'saved',
        })),
      });
    }
    if (key === 'POST /api/reviewer-finder/analyze') return respond(route, 200, { success: false, error: 'Rehearsal search intentionally disabled.' });
    if (key === 'POST /api/reviewer-finder/discover') return respond(route, 200, { success: true, candidates: [] });
    if (key === 'POST /api/reviewer-finder/enrich-contacts') return respond(route, 200, { success: true, candidates: [] });
    if (key === 'GET /api/review-manager/reviewers') return respond(route, 200, { success: true, proposals: [{ proposalId: REQUEST_ID, proposalTitle: 'Synthetic reviewer rehearsal', reviewDeadline: '2099-07-22', reviewers: state.reviewerRows }] });
    if (key === 'GET /api/review-manager/materials-preflight') {
      if (scenario === SCENARIOS.MATERIALS_PARTIAL) return respond(route, 200, { ok: false, reason: 'materials_unavailable' });
      return respond(route, 200, { ok: true, fileCount: 1 });
    }
    if (key === 'GET /api/review-manager/reviewer-vip-flags') return respond(route, 200, { pdSystemUserId: state.currentProgramDirectorId, flaggedPotentialReviewerIds: [] });
    if (key === 'GET /api/review-manager/release-settings') return respond(route, 200, { attachProposalEmail: false });
    if (key === 'GET /api/email-defaults/reviewer-templates') return respond(route, 200, { templates: syntheticTemplates(), configured: true, unavailable: false });
    if (key === 'GET /api/review-manager/campaign-config') {
      if (url.searchParams.get('requestId') !== REQUEST_ID) return respond(route, 404, { error: 'No request found' });
      return respond(route, 200, { requestId: REQUEST_ID, config: { ...state.campaignConfig } });
    }
    if (key === 'POST /api/review-manager/campaign-config') {
      const writable = new Set(['respondOffsetDays', 'reviewDueDate', 'respondReminderEnabled', 'respondReminderLeadDays', 'reviewDueReminderEnabled', 'reviewDueReminderLeadDays', 'desiredCount']);
      const config = body.config;
      if (body.requestId !== REQUEST_ID || !config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).length === 0) {
        return respond(route, 400, { error: 'config must contain at least one editable field' });
      }
      for (const [name, value] of Object.entries(config)) {
        if (!writable.has(name)) return respond(route, 400, { error: `Unknown or read-only config field: ${name}` });
        if (value === null) continue;
        if (['respondOffsetDays', 'respondReminderLeadDays', 'reviewDueReminderLeadDays', 'desiredCount'].includes(name)
            && (!Number.isInteger(value) || value < 0)) return respond(route, 400, { error: `${name} must be a non-negative integer` });
        if (['respondReminderEnabled', 'reviewDueReminderEnabled'].includes(name) && typeof value !== 'boolean') {
          return respond(route, 400, { error: `${name} must be a boolean` });
        }
        if (name === 'reviewDueDate' && value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
            || !Number.isFinite(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
          return respond(route, 400, { error: 'reviewDueDate must be a YYYY-MM-DD date or null' });
        }
      }
      state.campaignConfig = { ...state.campaignConfig, ...(body.config || {}) };
      return respond(route, 200, { success: true, requestId: REQUEST_ID, config: { ...state.campaignConfig } });
    }
    if (key === 'POST /api/review-manager/render-withdraw-emails') {
      state.withdrawRenderBodies.push(body);
      const drafts = (body.suggestionIds || []).map((suggestionId) => {
        const recipient = state.reviewerRows.find((row) => row.suggestionId === suggestionId)
          || { name: 'Dr. Pending Reviewer', email: 'pending.reviewer@example.test' };
        return {
          suggestionId,
          status: 'ok',
          name: recipient.name,
          to: recipient.email,
          from: PD_EMAIL,
          senderId: PD_ID,
          subject: `Thank you — Request ${REQUEST_NUM}`,
          bodyText: `Dear ${recipient.name},\n\nThank you for considering this review.\n\nProgram Director`,
        };
      });
      return respond(route, 200, { ok: true, drafts });
    }
    if (key === 'POST /api/review-manager/withdraw-sufficient') {
      state.withdrawBodies.push(body);
      const ids = [...new Set(body.suggestionIds || [])];
      const reason = body.reason || 'no_longer_needed';
      const reviewedMode = body.overrides !== null && body.overrides !== undefined;
      const emailRequested = body.sendEmail === undefined
        ? reason === 'no_longer_needed' || reviewedMode
        : body.sendEmail === true;
      const shouldSendEmail = emailRequested
        && (reason === 'no_longer_needed' || reviewedMode);
      const results = ids.map((suggestionId) => {
        const recipient = state.reviewerRows.find((row) => row.suggestionId === suggestionId);
        if (!recipient) return { suggestionId, status: 'not_found' };
        const stillPending = recipient.invited === true
          && recipient.accepted !== true
          && recipient.declined !== true
          && recipient.responseType == null;
        if (!stillPending) return { suggestionId, status: 'not_pending' };
        if (!shouldSendEmail) return { suggestionId, status: 'withdrawn_no_email_by_reason', reason };
        if (!state.currentProgramDirectorId || !state.currentProgramDirectorEmail) return { suggestionId, status: 'withdrawn_no_pd', reason };
        if (!recipient?.email) return { suggestionId, status: 'withdrawn_no_email', reason };
        state.withdrawCapturedEmails.push({
          suggestionId,
          deliveryMode: 'capture',
          from: state.currentProgramDirectorEmail,
          to: recipient.email,
          subject: body.overrides?.[suggestionId]?.subject || `Thank you — Request ${REQUEST_NUM}`,
        });
        return { suggestionId, status: 'withdrawn_emailed', reason };
      });
      const withdrawnIds = new Set(results.filter((row) => row.status.startsWith('withdrawn_')).map((row) => row.suggestionId));
      state.reviewerRows = state.reviewerRows.map((row) => (withdrawnIds.has(row.suggestionId)
        ? { ...row, responseType: 'withdrawn_sufficient' }
        : row));
      state.candidateRows = state.candidateRows.map((row) => (withdrawnIds.has(row.suggestionId)
        ? { ...row, invited: true, accepted: false, declined: false, responseType: 'withdrawn_sufficient', withdrawnSufficientAt: '2099-06-30T12:00:00Z' }
        : row));
      state.withdrawTransitions.push(...results.map(({ suggestionId, status, reason: resultReason }) => ({ suggestionId, status, reason: resultReason })));
      return respond(route, 200, { ok: true, withdrawn: withdrawnIds.size, results });
    }
    if (key === 'GET /api/review-manager/campaign-timeline-defaults') return respond(route, 200, {
      key: 'reviewer.campaign_timeline_defaults',
      timeline: { cycleLabel: 'J26', inviteStartDate: '2099-06-30', respondOffsetDays: 7, proposalReleaseDate: '2099-07-15', reviewDueDate: '2099-07-22' },
      isDefault: false,
      malformed: false,
    });
    if (key === 'POST /api/review-manager/render-emails') {
      state.renderBodies.push(body);
      if (!Array.isArray(body.suggestionIds) || body.suggestionIds.length === 0) return respond(route, 400, { error: 'suggestionIds array is required' });
      if (!body.template || !body.template.subject || !body.template.body) return respond(route, 400, { error: 'template with subject and body is required' });
      if (!['invitation', 'materials', 'followup', 'thankyou'].includes(body.templateType || 'materials')) {
        return respond(route, 400, { error: `Unknown templateType: ${body.templateType}` });
      }
      state.previewSnapshots.push({
        templateType: body.templateType,
        programDirectorId: state.currentProgramDirectorId,
        suggestionIds: body.suggestionIds || [],
      });
      const selectedTemplate = body.template && typeof body.template === 'object'
        ? body.template
        : syntheticTemplates()[body.templateType];
      const signature = body.settings?.signature || 'Program Director';
      const resolved = body.suggestionIds.map((suggestionId) => ({ suggestionId,
        recipient: state.candidateRows.find((row) => row.suggestionId === suggestionId)
          || state.reviewerRows.find((row) => row.suggestionId === suggestionId)
      })).filter((item) => item.recipient);
      if (resolved.length === 0) return respond(route, 404, { error: 'No reviewers found for the provided IDs' });
      const reviewDueDate = Object.prototype.hasOwnProperty.call(body.settings || {}, 'reviewDueDate')
        ? body.settings.reviewDueDate
        : state.campaignConfig.reviewDueDate;
      const drafts = resolved.map(({ suggestionId, recipient }) => {
        const rendered = fillSyntheticTemplate(selectedTemplate, recipient, { origin, signature, reviewDueDate });
        return {
        suggestionId, candidateName: recipient.name, candidateEmail: recipient.email,
        subject: rendered.subject,
        body: rendered.body,
        emailConfidence: { level: 'high', reason: 'confirmed_identity' },
      };
      });
      return respond(route, 200, { drafts, stats: { total: drafts.length, ready: drafts.length, skipped: body.suggestionIds.length - drafts.length } });
    }
    if (key === 'POST /api/review-manager/send-emails') {
      state.sentBodies.push(body);
      if (scenario === SCENARIOS.PD_DRIFT) {
        const previewSnapshot = state.previewSnapshots.at(-1) || null;
        const previewProgramDirectorId = previewSnapshot?.programDirectorId || null;
        state.currentProgramDirectorId = PD_ID_NEXT;
        const assignmentChanged = previewProgramDirectorId !== state.currentProgramDirectorId;
        const skipped = (body.drafts || []).map((draft) => ({
          suggestionId: draft.suggestionId,
          candidateName: 'Dr. Saved Reviewer',
          candidateEmail: REVIEWER_EMAIL,
          reason: 'program_director_changed',
        }));
        state.transitions.push({
          type: 'pd-drift-skipped',
          previewProgramDirectorId,
          currentProgramDirectorId: state.currentProgramDirectorId,
          assignmentChanged,
          count: skipped.length,
        });
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: [
          'event: progress', `data: ${JSON.stringify({ current: 0, total: skipped.length, message: 'Checking assigned Program Director.' })}`, '',
          'event: result', `data: ${JSON.stringify({ sent: [], failed: [], skipped, stats: { sent: 0, failed: 0, skipped: skipped.length, total: skipped.length } })}`, '',
          'event: complete', `data: ${JSON.stringify({ message: 'No emails sent because the assigned Program Director changed.', sent: 0, failed: 0, skipped: skipped.length })}`, '', '',
        ].join('\n') });
      }
      if ([SCENARIOS.MANUAL_COI_BLOCKED, SCENARIOS.MANUAL_COI_UNAVAILABLE].includes(scenario)) {
        const reason = scenario === SCENARIOS.MANUAL_COI_BLOCKED
          ? 'manual_institution_coi'
          : 'manual_institution_coi_unavailable';
        const skipped = (body.drafts || []).map((draft) => ({
          suggestionId: draft.suggestionId,
          candidateName: state.candidateRows.find((row) => row.suggestionId === draft.suggestionId)?.name || 'Dr. Synthetic Reviewer',
          candidateEmail: state.candidateRows.find((row) => row.suggestionId === draft.suggestionId)?.email || 'synthetic.reviewer@example.test',
          reason,
        }));
        state.transitions.push({ type: 'manual-first-invite-skipped', reason, count: skipped.length });
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: [
          'event: progress', `data: ${JSON.stringify({ current: 0, total: skipped.length, message: 'Checking first-invitation institution screen.' })}`, '',
          'event: result', `data: ${JSON.stringify({ sent: [], failed: [], skipped, stats: { sent: 0, failed: 0, skipped: skipped.length, total: skipped.length } })}`, '',
          'event: complete', `data: ${JSON.stringify({ message: 'No emails were sent because the first-invitation institution screen did not pass.', sent: 0, failed: 0, skipped: skipped.length })}`, '', '',
        ].join('\n') });
      }
      if (scenario === SCENARIOS.MANUAL_COI_UNKNOWN_ALLOWED) {
        state.transitions.push({ type: 'manual-first-invite-allowed', mainInstitution: state.institutionScreen.mainInstitution });
      }
      if (body.templateType === 'materials') {
        const drafts = body.drafts || [];
        const skipped = [];
        const eligibleDrafts = [];
        for (const draft of drafts) {
          const recipient = state.reviewerRows.find((row) => row.suggestionId === draft.suggestionId);
          const reason = !recipient
            ? 'not_found'
            : recipient.materialsSentAt || recipient.reviewStatus === 'materials_sent'
              ? 'materials_already_sent'
              : recipient.reviewStatus !== 'accepted'
                ? 'not_accepted'
                : null;
          if (reason) skipped.push({ suggestionId: draft.suggestionId, candidateName: recipient?.name || draft.candidateName || '', candidateEmail: recipient?.email || draft.candidateEmail || '', reason });
          else eligibleDrafts.push(draft);
        }
        const ids = eligibleDrafts.map((draft) => draft.suggestionId);
        state.materialsSentIds.push(...ids);
        state.reviewerRows = state.reviewerRows.map((row) => (ids.includes(row.suggestionId)
          ? { ...row, reviewStatus: 'materials_sent', materialsSentAt: '2099-06-30T12:00:00Z' }
          : row));
        state.candidateRows = state.candidateRows.map((row) => (ids.includes(row.suggestionId)
          ? { ...row, responseType: 'accepted' }
          : row));
        if (ids.includes(SUGGESTION_ID)) state.reviewerContext = portalContext('stage2b');
        const sent = eligibleDrafts.map((draft) => {
          const recipient = state.reviewerRows.find((row) => row.suggestionId === draft.suggestionId)
            || { name: 'Dr. Accepted Reviewer', email: REVIEWER_EMAIL };
          return {
            suggestionId: draft.suggestionId,
            candidateName: recipient.name,
            candidateEmail: recipient.email,
            deliveryMode: 'capture',
            emailId: `captured-materials-${draft.suggestionId}`,
            capturedEmail: {
              subject: draft.subject,
              from: PD_EMAIL,
              to: recipient.email,
              htmlBody: '<main>Reviewer materials rehearsal</main>',
            },
          };
        });
        state.capturedEmails.push(...sent.map((item) => item.capturedEmail));
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: [
          'event: progress', `data: ${JSON.stringify({ current: sent.length, total: drafts.length, message: 'Captured materials email.' })}`, '',
          'event: result', `data: ${JSON.stringify({ sent, failed: [], skipped, stats: { sent: sent.length, failed: 0, skipped: skipped.length, total: drafts.length } })}`, '',
          'event: complete', `data: ${JSON.stringify({ message: sent.length ? 'Sent for delivery.' : 'No materials emails were sent.', sent: sent.length, failed: 0, skipped: skipped.length })}`, '', '',
        ].join('\n') });
      }
      const invitedIds = new Set((body.drafts || []).map((draft) => draft.suggestionId));
      state.candidateRows = state.candidateRows.map((row) => (invitedIds.has(row.suggestionId)
        ? { ...row, invited: true, emailSentAt: '2099-06-30T12:00:00Z' }
        : row));
      state.reviewerRows = state.reviewerRows.map((row) => (invitedIds.has(row.suggestionId)
        ? { ...row, invited: true, tokenState: 'active', tokenExpiresAt: '2099-08-01T00:00:00Z' }
        : row));
      state.transitions.push({ type: 'invite-captured', count: (body.drafts || []).length });
      const sent = (body.drafts || []).map((draft) => {
        const recipient = state.candidateRows.find((row) => row.suggestionId === draft.suggestionId) || { name: 'Dr. Saved Reviewer', email: REVIEWER_EMAIL };
        return {
        suggestionId: draft.suggestionId, candidateName: recipient.name, candidateEmail: recipient.email,
        deliveryMode: 'capture', emailId: `captured-${draft.suggestionId}`,
        capturedEmail: { subject: draft.subject, from: PD_EMAIL, to: recipient.email,
          htmlBody: `<main><a href="${new URL(`/external/review/${REVIEW_TOKEN}?action=accept`, origin)}">Yes, I Can Review</a><a href="${new URL(`/external/review/${REVIEW_TOKEN}?action=decline`, origin)}">No, I Cannot Review</a></main>` },
      }; });
      state.capturedEmails.push(...sent.map((item) => item.capturedEmail));
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: [
        'event: progress', `data: ${JSON.stringify({ current: sent.length, total: sent.length, message: 'Captured invitation.' })}`, '',
        'event: result', `data: ${JSON.stringify({ sent, failed: [], skipped: [], stats: { sent: sent.length, failed: 0, skipped: 0, total: sent.length } })}`, '',
        'event: complete', `data: ${JSON.stringify({ message: `Sent ${sent.length} of ${sent.length} email(s)`, sent: sent.length, failed: 0, skipped: 0 })}`, '', '',
      ].join('\n') });
    }
    if (key === `GET /api/external/review/${REVIEW_TOKEN}/context`) return respond(route, 200, state.reviewerContext);
    if (key === `POST /api/external/review/${REVIEW_TOKEN}/respond`) {
      state.transitions.push({ type: `reviewer-${body.action}`, action: body.action });
      if (body.action === 'accept') {
        state.reviewerContext = portalContext('accepted-pre-materials');
        state.candidateRows = state.candidateRows.map((row) => row.suggestionId === SUGGESTION_ID
          ? { ...row, invited: true, accepted: true, declined: false, responseType: 'accepted', responseReceivedAt: '2099-06-30T12:10:00Z' }
          : row);
        state.reviewerRows = state.reviewerRows.map((row) => row.suggestionId === SUGGESTION_ID
          ? { ...row, invited: true, accepted: true, reviewStatus: 'accepted', responseType: 'accepted', responseReceivedAt: '2099-06-30T12:10:00Z' }
          : row);
      }
      if (body.action === 'decline') {
        state.reviewerContext = portalContext('declined');
        state.candidateRows = state.candidateRows.map((row) => row.suggestionId === SUGGESTION_ID
          ? { ...row, invited: true, accepted: false, declined: true, responseType: 'declined', responseReceivedAt: '2099-06-30T12:10:00Z' }
          : row);
        state.reviewerRows = state.reviewerRows.map((row) => row.suggestionId === SUGGESTION_ID
          ? { ...row, invited: true, accepted: false, reviewStatus: 'declined', responseType: 'declined', responseReceivedAt: '2099-06-30T12:10:00Z' }
          : row);
      }
      return respond(route, 200, { ok: true, idempotent: false, engagementState: state.reviewerContext.engagementState });
    }
    if (key === `GET /api/external/review/${REVIEW_TOKEN}/draft`) {
      return respond(route, 200, state.reviewSubmit
        ? { ok: true, draftJson: null, submitted: true }
        : { ok: true, draftJson: state.reviewDraft, submitted: false });
    }
    if (key === `PUT /api/external/review/${REVIEW_TOKEN}/draft`) {
      if (state.reviewSubmit) return respond(route, 409, {
        ok: false,
        reason: 'review_received_locked',
        message: 'This review has already been submitted. To make a change, please contact your Program Director.',
      });
      state.reviewDraft = body.draftJson || null;
      state.transitions.push({ type: 'review-draft-saved' });
      return respond(route, 200, { ok: true, draftId: 1, updatedAt: '2099-06-30T12:00:00Z' });
    }
    if (key === `POST /api/external/review/${REVIEW_TOKEN}/submit`) {
      if (state.reviewSubmit) return respond(route, 409, {
        ok: false,
        reason: 'review_received_locked',
        message: 'This review has already been submitted. To make a change, please contact your Program Director.',
      });
      state.reviewSubmit = body;
      state.reviewReceivedAt = '2099-06-30T12:05:00Z';
      state.reviewerContext = portalContext('submitted');
      state.reviewerContext.submission = { receivedAt: state.reviewReceivedAt, filename: null };
      state.reviewDraft = null;
      state.transitions.push({ type: 'review-submitted', setVersion: body.setVersion || null });
      return respond(route, 200, { ok: true, receivedAt: state.reviewReceivedAt });
    }
    return reject(route, `${method} ${pathname} fixture is declared but not implemented`);
  };

  context.route('**/*', async (route) => {
    const handled = await fulfillPassiveMock(route, { baseUrl, buildId, state });
    if (!handled) return route.fallback();
  });
  context.route('**/api/**', handler);
  return {
    state,
    reset() {
      const fresh = createState(scenario, buildId);
      Object.keys(state).forEach((key) => { if (key !== 'resetCount') delete state[key]; });
      Object.assign(state, fresh, { resetCount: state.resetCount + 1 });
    },
  };
}

module.exports = {
  CANDIDATE_KEY,
  PD_EMAIL,
  PD_ID,
  REQUEST_ID,
  REQUEST_NUM,
  REVIEW_TOKEN,
  REVIEWER_EMAIL,
  SCENARIOS,
  candidate,
  installMocks,
  isMockedPassiveRequest,
  isMockedApiRequest,
  fulfillPassiveMock,
  rosterSnapshot,
};

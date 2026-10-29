'use strict';

const {
  CANDIDATE_KEY,
  REQUEST_ID,
  SCENARIOS,
  fulfillPassiveMock,
  installMocks,
  isMockedPassiveRequest,
  isMockedApiRequest,
  rosterSnapshot,
} = require('../../scripts/lib/reviewer-rehearsal-fixtures.cjs');

const BASE_URL = 'http://localhost:3110';
const BUILD_ID = 'synthetic-build-123';

function request(pathname, method = 'GET', origin = BASE_URL) {
  return { url: () => `${origin}${pathname}`, method: () => method };
}

function harness(scenario) {
  let handler;
  const handlers = new Map();
  const context = { route: (matcher, callback) => { handlers.set(matcher, callback); handler = callback; } };
  const fixture = installMocks(context, { baseUrl: BASE_URL, buildId: BUILD_ID, scenario });
  async function invoke(pathname, method = 'GET', body = {}, origin = BASE_URL) {
    let fulfilled;
    let aborted = false;
    const route = {
      request: () => ({
        ...request(pathname, method, origin),
        postDataJSON: () => body,
      }),
      fulfill: async (response) => { fulfilled = response; },
      abort: async () => { aborted = true; },
    };
    await handler(route);
    return { response: fulfilled, aborted };
  }
  return { fixture, invoke, handlers };
}

describe('review rehearsal fixture boundary and state', () => {
  test('allows only the exact local API method/path while ignoring query strings', () => {
    expect(isMockedApiRequest(request('/api/workbench/reviewer-roster?requestId=' + REQUEST_ID), { baseUrl: BASE_URL })).toBe(true);
    expect(isMockedApiRequest(request('/api/workbench/reviewer-roster', 'POST'), { baseUrl: BASE_URL })).toBe(false);
    expect(isMockedApiRequest(request('/api/workbench/staffing', 'POST'), { baseUrl: BASE_URL })).toBe(false);
    expect(isMockedApiRequest(request('/api/workbench/board-writeups', 'POST'), { baseUrl: BASE_URL })).toBe(false);
    expect(isMockedApiRequest(request('/api/workbench/reviewer-roster', 'GET', 'https://example.test'), { baseUrl: BASE_URL })).toBe(false);
    expect(isMockedApiRequest(request('/api/unknown', 'GET'), { baseUrl: BASE_URL })).toBe(false);
    expect(isMockedApiRequest(request('/api/auth/status', 'GET'), { baseUrl: BASE_URL, scenario: 'unknown-scenario' })).toBe(false);
  });

  test('passive fixtures match only analytics and five exact pages under the known build ID', async () => {
    const passivePaths = [
      '/_vercel/insights/script.js',
      `/_next/data/${BUILD_ID}/index.json`,
      `/_next/data/${BUILD_ID}/workbench.json`,
      `/_next/data/${BUILD_ID}/workbench/00000000-0000-4000-8000-000000000001.json`,
      `/_next/data/${BUILD_ID}/guide.json`,
      `/_next/data/${BUILD_ID}/profile-settings.json`,
    ];
    for (const pathname of passivePaths) {
      expect(isMockedPassiveRequest(request(pathname), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(true);
      expect(isMockedPassiveRequest(request(pathname, 'HEAD'), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(true);
    }
    expect(isMockedPassiveRequest(request(`/_next/data/other-build/index.json`), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(isMockedPassiveRequest(request(`/_next/data/${BUILD_ID}/other.json`), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(isMockedPassiveRequest(request(`/_next/data/${BUILD_ID}/nested/index.json`), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(isMockedPassiveRequest(request(`/_next/data/${BUILD_ID}/workbench/00000000-0000-4000-8000-000000000002.json`), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(isMockedPassiveRequest(request(passivePaths[0], 'POST'), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(isMockedPassiveRequest(request(passivePaths[0], 'GET', 'https://example.test'), { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(isMockedPassiveRequest(request(passivePaths[1]), { baseUrl: BASE_URL })).toBe(false);

    const { fixture, handlers } = harness(SCENARIOS.BASELINE);
    const route = {
      request: () => request(`/_next/data/${BUILD_ID}/guide.json`),
      fulfill: jest.fn(async () => {}),
      fallback: jest.fn(async () => {}),
    };
    await handlers.get('**/*')(route);
    expect(route.fulfill).toHaveBeenCalledWith(expect.objectContaining({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ pageProps: {}, __N_SSG: true }),
    }));
    expect(route.fallback).not.toHaveBeenCalled();
    expect(fixture.state.passiveCalls).toEqual([{ method: 'GET', pathname: `/_next/data/${BUILD_ID}/guide.json` }]);

    const unmatched = {
      request: () => request(`/_next/data/other-build/guide.json`),
      fulfill: jest.fn(async () => {}),
      fallback: jest.fn(async () => {}),
    };
    expect(await fulfillPassiveMock(unmatched, { baseUrl: BASE_URL, buildId: BUILD_ID })).toBe(false);
    expect(unmatched.fulfill).not.toHaveBeenCalled();
  });

  test('staffing and Board initial reads return empty source-shaped snapshots', async () => {
    const { invoke } = harness(SCENARIOS.BASELINE);
    const staffing = await invoke('/api/workbench/staffing');
    expect(JSON.parse(staffing.response.body)).toEqual({
      canManageSharedRoles: false,
      isSuperuser: false,
      staff: [],
      roles: {
        president: { value: null, revision: null },
        cso: { value: null, revision: null },
        grantsManager: { value: null, revision: null },
        programCoordinator: { value: null, revision: null },
        systemsSpecialist: { value: null, revision: null },
      },
    });
    const capabilities = await invoke('/api/workbench/staffing?capabilities=true');
    expect(JSON.parse(capabilities.response.body)).toEqual({ canManageSharedRoles: false, isSuperuser: false });
    const board = await invoke('/api/workbench/board-writeups');
    expect(JSON.parse(board.response.body)).toEqual({ canRelease: false, canArchive: false, isSuperuser: false, cycles: [] });
  });

  test('dashboard fixtures return exact cycle metadata and echoed proposal-list context', async () => {
    const { invoke } = harness(SCENARIOS.BASELINE);
    const cycles = JSON.parse((await invoke('/api/workbench/dashboard?programId=99999999-9999-4999-8999-999999999999')).response.body);
    expect(cycles).toMatchObject({
      success: true,
      programId: '99999999-9999-4999-8999-999999999999',
      defaultProgramId: '99999999-9999-4999-8999-999999999999',
      defaultCycleCode: 'J26',
      cycles: [{ code: 'J26', label: 'June 2026' }],
    });
    const list = JSON.parse((await invoke('/api/workbench/dashboard?cycleCode=J26&scope=all&programId=99999999-9999-4999-8999-999999999999&includeSetAside=1')).response.body);
    expect(list).toMatchObject({
      success: true,
      programId: '99999999-9999-4999-8999-999999999999',
      cycleCode: 'J26',
      scope: 'all',
      includeSetAside: true,
      rollup: expect.any(Object),
      proposals: [{ requestId: REQUEST_ID, requestNumber: '1002788' }],
    });
    expect((await invoke('/api/workbench/dashboard?cycleCode=J99&scope=all&programId=99999999-9999-4999-8999-999999999999')).response.status).toBe(404);
  });

  test('baseline candidate projection includes a pending invite row for the invitation and withdrawal workflow', async () => {
    const { invoke } = harness(SCENARIOS.BASELINE);
    const payload = JSON.parse((await invoke(`/api/reviewer-finder/my-candidates?requestId=${REQUEST_ID}`)).response.body);
    expect(payload.proposals[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        suggestionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        name: 'Dr. Pending Reviewer',
        invited: true,
        accepted: false,
        declined: false,
      }),
    ]));
  });

  test('returns all seven roster arrays and the saved candidate key for the 409 rehearsal', () => {
    const snapshot = rosterSnapshot([CANDIDATE_KEY]);
    for (const key of ['active', 'excluded', 'ineligible', 'blocked', 'handled', 'savedKeys', 'allNames']) {
      expect(Array.isArray(snapshot[key])).toBe(true);
    }
    expect(snapshot.savedKeys).toEqual([CANDIDATE_KEY]);
  });

  test('saved Find race begins active, then the 409 reload returns only the persisted saved key', async () => {
    const { fixture, invoke } = harness(SCENARIOS.SAVED_FIND_EXCLUSION);
    const before = JSON.parse((await invoke(`/api/workbench/reviewer-roster?requestId=${REQUEST_ID}`)).response.body);
    expect(before.active.map((row) => row.candidateKey)).toEqual([CANDIDATE_KEY]);
    expect(before.savedKeys).toEqual([]);

    const patch = await invoke('/api/workbench/reviewer-roster', 'PATCH', {
      requestId: REQUEST_ID,
      action: 'exclude',
      candidate: { candidateKey: CANDIDATE_KEY, name: 'Dr. Saved Reviewer' },
    });
    expect(patch.response.status).toBe(409);
    const after = JSON.parse((await invoke(`/api/workbench/reviewer-roster?requestId=${REQUEST_ID}`)).response.body);
    expect(after.active).toEqual([]);
    expect(after.savedKeys).toEqual([CANDIDATE_KEY]);
    for (const key of ['active', 'excluded', 'ineligible', 'blocked', 'handled', 'savedKeys', 'allNames']) {
      expect(Array.isArray(after[key])).toBe(true);
    }
  });

  test('decline dismissal mutates only this fixture state and in-memory reset restores its referral', async () => {
    const { fixture, invoke } = harness(SCENARIOS.DECLINE_RESET);
    expect((await invoke(`/api/workbench/decline-referrals?requestId=${REQUEST_ID}`)).response.body).toContain('Dr. Suggested Reviewer');
    const patch = await invoke('/api/workbench/decline-referrals', 'PATCH', {
      requestId: REQUEST_ID,
      suggestionId: '11111111-1111-4111-8111-111111111111',
      referralVersion: 'v1',
      referralIndex: 0,
    });
    expect(JSON.parse(patch.response.body)).toEqual({ success: true });
    expect(fixture.state.declineMutations).toHaveLength(1);
    expect(fixture.state.referrals).toEqual([]);
    expect((await invoke(`/api/workbench/decline-referrals?requestId=${REQUEST_ID}`)).response.body).toContain('"referrals":[]');

    fixture.reset();
    expect(fixture.state.resetCount).toBe(1);
    expect(fixture.state.declineMutations).toEqual([]);
    expect(fixture.state.referrals).toHaveLength(1);
  });

  test('sparse manual Add succeeds independently of saved main-institution screening', async () => {
    const { fixture, invoke } = harness(SCENARIOS.BASELINE);
    const result = await invoke('/api/workbench/manual-reviewer', 'POST', {
      requestId: REQUEST_ID,
      name: 'Dr. Synthetic Reviewer',
      email: 'synthetic.reviewer@example.test',
      affiliation: 'Example University',
      note: '',
      referredBy: '',
      orcid: '',
      resolution: { mode: 'create_new' },
    });
    expect(result.response.status).toBe(200);
    const payload = JSON.parse(result.response.body);
    expect(payload).toMatchObject({
      success: true,
      candidate: { manualAdded: true, invitable: true, sources: ['staff_manual'] },
      created: { person: true, suggestion: true },
    });
    expect(payload.outcome).toBeUndefined();
    expect(payload.candidate.mainInstitution).toBeUndefined();
    expect(fixture.state.manualAdds[0].email).toBe('synthetic.reviewer@example.test');
    expect(fixture.state.manualResponses[0].status).toBe(200);
    expect(JSON.stringify(fixture.state)).not.toMatch(/@(?!example\.test\b)[^\s"']+/i);
  });

  test.each([
    [SCENARIOS.MANUAL_COI_BLOCKED, 'manual_institution_coi'],
    [SCENARIOS.MANUAL_COI_UNAVAILABLE, 'manual_institution_coi_unavailable'],
  ])('preseeded manual candidate first-invitation outcome is %s', async (scenario, expectedReason) => {
    const { fixture, invoke } = harness(scenario);
    const seeded = fixture.state.candidateRows[0];
    expect(seeded.manualAdded).toBe(true);
    expect(seeded.mainInstitution).toBe(expectedReason === 'manual_institution_coi' ? 'Example University' : undefined);
    expect(fixture.state.manualAdds).toEqual([]);
    const send = await invoke('/api/review-manager/send-emails', 'POST', {
      requestId: REQUEST_ID,
      drafts: [{ suggestionId: seeded.suggestionId, candidateName: seeded.name, candidateEmail: seeded.email }],
    });
    expect(send.response.contentType).toBe('text/event-stream');
    const resultEvent = send.response.body.split('\n').find((line) => line.startsWith('data: {"sent"'));
    const eventPayload = JSON.parse(resultEvent.slice('data: '.length));
    expect(eventPayload).toMatchObject({
      sent: [],
      skipped: [{ suggestionId: seeded.suggestionId, candidateName: 'Dr. Synthetic Reviewer', candidateEmail: 'reviewer.capture@example.test', reason: expectedReason }],
      stats: { sent: 0, failed: 0, skipped: 1, total: 1 },
    });
    expect(fixture.state.candidateRows.find((row) => row.suggestionId === seeded.suggestionId).invited).toBe(false);
    expect(JSON.stringify(fixture.state)).not.toMatch(/@(?!example\.test\b)[^\s"']+/i);
  });

  test('unknown main institution remains eligible after sparse manual Add and is captured on send', async () => {
    const { fixture, invoke } = harness(SCENARIOS.MANUAL_COI_UNKNOWN_ALLOWED);
    const add = await invoke('/api/workbench/manual-reviewer', 'POST', {
      requestId: REQUEST_ID,
      name: 'Dr. Synthetic Reviewer',
      email: 'synthetic.reviewer@example.test',
      affiliation: 'Example University',
      resolution: { mode: 'create_new' },
    });
    const payload = JSON.parse(add.response.body);
    expect(add.response.status).toBe(200);
    expect(payload.candidate).toMatchObject({ manualAdded: true, sources: ['staff_manual'], affiliation: 'Example University' });
    expect(payload.candidate.mainInstitution).toBeUndefined();
    expect(fixture.state.institutionScreen.mainInstitution).toBe('');

    const send = await invoke('/api/review-manager/send-emails', 'POST', {
      requestId: REQUEST_ID,
      templateType: 'invitation',
      drafts: [{ suggestionId: payload.candidate.suggestionId, candidateName: payload.candidate.name, candidateEmail: payload.candidate.email }],
    });
    const resultEvent = send.response.body.split('\n').find((line) => line.startsWith('data: {"sent"'));
    const eventPayload = JSON.parse(resultEvent.slice('data: '.length));
    expect(eventPayload.sent).toHaveLength(1);
    expect(eventPayload.skipped).toEqual([]);
    expect(fixture.state.candidateRows.find((row) => row.suggestionId === payload.candidate.suggestionId).invited).toBe(true);
    expect(fixture.state.capturedEmails[0].from).toBe('program.director@example.test');
  });

  test('PD drift compares preview assignment A with send assignment B, while materials partial completes for accepted rows only', async () => {
    const drift = harness(SCENARIOS.PD_DRIFT);
    await drift.invoke('/api/workbench/resolve-request?requestId=' + REQUEST_ID);
    await drift.invoke('/api/review-manager/reviewer-vip-flags?requestId=' + REQUEST_ID);
    await drift.invoke('/api/review-manager/render-emails', 'POST', {
      requestId: REQUEST_ID,
      templateType: 'invitation',
      suggestionIds: ['11111111-1111-4111-8111-111111111111'],
      template: { subject: 'Invitation to {{proposalTitle}}', body: '{{greeting}}, please review {{proposalTitle}}: {{externalLink}}' },
    });
    const driftResult = await drift.invoke('/api/review-manager/send-emails', 'POST', {
      drafts: [{ suggestionId: '11111111-1111-4111-8111-111111111111' }],
    });
    expect(driftResult.response.contentType).toBe('text/event-stream');
    expect(driftResult.response.body).toContain('program_director_changed');
    expect(drift.fixture.state.sentBodies).toHaveLength(1);
    expect(drift.fixture.state.previewSnapshots).toMatchObject([{ programDirectorId: '77777777-7777-4777-8777-777777777777' }]);
    expect(drift.fixture.state.currentProgramDirectorId).toBe('88888888-8888-4888-8888-888888888888');
    expect(drift.fixture.state.transitions).toEqual([{
      type: 'pd-drift-skipped',
      previewProgramDirectorId: '77777777-7777-4777-8777-777777777777',
      currentProgramDirectorId: '88888888-8888-4888-8888-888888888888',
      assignmentChanged: true,
      count: 1,
    }]);
    const afterResolve = await drift.invoke('/api/workbench/resolve-request?requestId=' + REQUEST_ID);
    const afterVip = await drift.invoke('/api/review-manager/reviewer-vip-flags?requestId=' + REQUEST_ID);
    expect(JSON.parse(afterResolve.response.body).programDirectorId).toBe('88888888-8888-4888-8888-888888888888');
    expect(JSON.parse(afterVip.response.body).pdSystemUserId).toBe('88888888-8888-4888-8888-888888888888');

    const materials = harness(SCENARIOS.MATERIALS_PARTIAL);
    const preflight = await materials.invoke(`/api/review-manager/materials-preflight?requestId=${REQUEST_ID}`);
    expect(JSON.parse(preflight.response.body)).toEqual({ ok: false, reason: 'materials_unavailable' });
    const preview = await materials.invoke('/api/review-manager/render-emails', 'POST', {
      requestId: REQUEST_ID,
      templateType: 'materials',
      suggestionIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      template: { subject: 'Materials for {{proposalTitle}}', body: 'Synthetic materials for {{proposalTitle}}. {{externalLink}}' },
    });
    expect(JSON.parse(preview.response.body).drafts[0]).toMatchObject({ candidateName: 'Dr. Accepted Reviewer' });
    const sent = await materials.invoke('/api/review-manager/send-emails', 'POST', {
      requestId: REQUEST_ID,
      templateType: 'materials',
      drafts: [{ suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', subject: 'Synthetic materials' }],
    });
    expect(sent.response.contentType).toBe('text/event-stream');
    expect(materials.fixture.state.materialsSentIds).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    expect(materials.fixture.state.reviewerRows.find((row) => row.suggestionId === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toMatchObject({ reviewStatus: 'pending', invited: true });

    const mixed = harness(SCENARIOS.MATERIALS_PARTIAL);
    const mixedSend = await mixed.invoke('/api/review-manager/send-emails', 'POST', {
      requestId: REQUEST_ID,
      templateType: 'materials',
      drafts: [
        { suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', subject: 'Synthetic accepted materials' },
        { suggestionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', subject: 'Must remain pending' },
      ],
    });
    const mixedResult = JSON.parse(mixedSend.response.body.split('\n').find((line) => line.startsWith('data: {"sent"')).slice('data: '.length));
    expect(mixedResult.sent.map((row) => row.suggestionId)).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    expect(mixedResult.skipped).toMatchObject([{ suggestionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reason: 'not_accepted' }]);
    expect(mixed.fixture.state.materialsSentIds).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    expect(mixed.fixture.state.reviewerRows.find((row) => row.suggestionId === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toMatchObject({ reviewStatus: 'pending', invited: true });
    const repeat = await mixed.invoke('/api/review-manager/send-emails', 'POST', {
      templateType: 'materials', drafts: [{ suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', subject: 'Repeat' }],
    });
    const repeatedResult = JSON.parse(repeat.response.body.split('\n').find((line) => line.startsWith('data: {"sent"')).slice('data: '.length));
    expect(repeatedResult.sent).toEqual([]);
    expect(repeatedResult.skipped).toMatchObject([{ suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'materials_already_sent' }]);
  });

  test('withdraw-sufficient captures a courtesy email for the active PD and updates only the selected pending row', async () => {
    const { fixture, invoke } = harness(SCENARIOS.BASELINE);
    const pending = fixture.state.reviewerRows.find((row) => row.name === 'Dr. Pending Reviewer');
    const rendered = await invoke('/api/review-manager/render-withdraw-emails', 'POST', {
      requestId: REQUEST_ID,
      suggestionIds: [pending.suggestionId],
    });
    expect(JSON.parse(rendered.response.body)).toMatchObject({
      ok: true,
      drafts: [{ suggestionId: pending.suggestionId, status: 'ok', to: 'pending.reviewer@example.test', from: 'program.director@example.test' }],
    });
    const withdrawn = await invoke('/api/review-manager/withdraw-sufficient', 'POST', {
      requestId: REQUEST_ID,
      suggestionIds: [pending.suggestionId],
      overrides: {
        [pending.suggestionId]: {
          subject: 'Thank you',
          bodyText: 'Thank you for considering this review.',
          to: 'pending.reviewer@example.test',
          from: 'program.director@example.test',
          senderId: '77777777-7777-4777-8777-777777777777',
        },
      },
    });
    expect(JSON.parse(withdrawn.response.body)).toEqual({
      ok: true,
      withdrawn: 1,
      results: [{ suggestionId: pending.suggestionId, status: 'withdrawn_emailed', reason: 'no_longer_needed' }],
    });
    expect(fixture.state.withdrawCapturedEmails).toEqual([{
      suggestionId: pending.suggestionId,
      deliveryMode: 'capture',
      from: 'program.director@example.test',
      to: 'pending.reviewer@example.test',
      subject: 'Thank you',
    }]);
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === pending.suggestionId).responseType).toBe('withdrawn_sufficient');
    const candidates = JSON.parse((await invoke(`/api/reviewer-finder/my-candidates?requestId=${REQUEST_ID}`)).response.body).proposals[0].candidates;
    expect(candidates.find((row) => row.suggestionId === pending.suggestionId)).toMatchObject({
      invited: true,
      accepted: false,
      declined: false,
      responseType: 'withdrawn_sufficient',
    });
    expect(candidates.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ invited: false });
    expect(fixture.state.reviewerRows.find((row) => row.name === 'Dr. Accepted Reviewer').reviewStatus).toBe('accepted');
  });

  test('portal acceptance updates only the associated saved candidate and reviewer projection', async () => {
    const { fixture, invoke } = harness(SCENARIOS.BASELINE);
    await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/respond`, 'POST', { action: 'accept' });
    expect(JSON.parse((await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/context`)).response.body).engagementState.accepted).toBe(true);
    const candidates = JSON.parse((await invoke(`/api/reviewer-finder/my-candidates?requestId=${REQUEST_ID}`)).response.body).proposals[0].candidates;
    expect(candidates.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ accepted: true, responseType: 'accepted' });
    const reviewers = JSON.parse((await invoke(`/api/review-manager/reviewers?requestId=${REQUEST_ID}`)).response.body).proposals[0].reviewers;
    expect(reviewers.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ accepted: true, reviewStatus: 'accepted' });
    expect(reviewers.find((row) => row.suggestionId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toMatchObject({ accepted: true, reviewStatus: 'accepted' });
    expect(fixture.state.candidateRows.find((row) => row.suggestionId === 'ffffffff-ffff-4fff-8fff-ffffffffffff')).toMatchObject({ invited: true, accepted: false });
  });

  test('campaign config persists in fixture memory and renderer retains edited copy with supported placeholders', async () => {
    const { invoke } = harness(SCENARIOS.BASELINE);
    expect(JSON.parse((await invoke(`/api/review-manager/campaign-config?requestId=${REQUEST_ID}`)).response.body).config.respondOffsetDays).toBe(7);
    const saved = await invoke('/api/review-manager/campaign-config', 'POST', {
      requestId: REQUEST_ID,
      config: { respondOffsetDays: 10, desiredCount: 4 },
    });
    expect(JSON.parse(saved.response.body).config).toMatchObject({ respondOffsetDays: 10, reviewDueDate: '2099-07-22', desiredCount: 4 });
    expect(JSON.parse((await invoke(`/api/review-manager/campaign-config?requestId=${REQUEST_ID}`)).response.body).config)
      .toMatchObject({ respondOffsetDays: 10, reviewDueDate: '2099-07-22', desiredCount: 4 });
    // D48: the review due date is read-only on this route, as on the real one.
    const dueDateEdit = await invoke('/api/review-manager/campaign-config', 'POST', {
      requestId: REQUEST_ID,
      config: { reviewDueDate: '2099-08-01' },
    });
    expect(dueDateEdit.response.status).toBe(400);
    expect(JSON.parse(dueDateEdit.response.body).error).toBe('Unknown or read-only config field: reviewDueDate');
    const invalid = await invoke('/api/review-manager/campaign-config', 'POST', {
      requestId: REQUEST_ID,
      config: { quotaNotifiedAt: '2099-07-22T00:00:00Z' },
    });
    expect(invalid.response.status).toBe(400);
    expect(JSON.parse(invalid.response.body).error).toContain('Unknown or read-only config field');

    const templates = JSON.parse((await invoke('/api/email-defaults/reviewer-templates')).response.body);
    expect(templates.templates.invitation.subject).toContain('{{proposalTitle}}');
    expect(templates.templates.materials.body).toContain('{{externalLink}}');
    const rendered = await invoke('/api/review-manager/render-emails', 'POST', {
      requestId: REQUEST_ID,
      templateType: 'materials',
      suggestionIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      template: {
        subject: 'Custom subject for {{recipientName}}',
        body: 'Edited materials for {{proposalTitle}} are due {{reviewDueDate}}. {{externalLink}} {{unknownField}}',
      },
      settings: { signature: 'Synthetic Team', reviewDueDate: '2099-08-15' },
    });
    const draft = JSON.parse(rendered.response.body).drafts[0];
    expect(draft.subject).toBe('Custom subject for Dr. Accepted Reviewer');
    // D48: the composer's reviewDueDate (2099-08-15) is ignored; the request's stored date renders.
    expect(draft.body).toContain('Edited materials for Synthetic reviewer rehearsal are due 2099-07-22.');
    expect(draft.body).toContain(`http://localhost:3110/external/review/${'pd-reviewer-rehearsal-token'}`);
    expect(draft.body).toContain('{{unknownField}}');
    expect(draft.candidateEmail).toBe('reviewer.capture@example.test');
    const unknownType = await invoke('/api/review-manager/render-emails', 'POST', {
      templateType: 'unexpected', suggestionIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      template: { subject: 'Subject', body: 'Body' },
    });
    expect(unknownType.response.status).toBe(400);
    expect(JSON.parse(unknownType.response.body)).toEqual({ error: 'Unknown templateType: unexpected' });
    const unknownRecipient = await invoke('/api/review-manager/render-emails', 'POST', {
      templateType: 'materials', suggestionIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
      template: { subject: 'Subject', body: 'Body' },
    });
    expect(unknownRecipient.response.status).toBe(404);
    expect(JSON.parse(unknownRecipient.response.body)).toEqual({ error: 'No reviewers found for the provided IDs' });
  });

  test('deliberate no-email withdrawal reports the source-defined reason outcome', async () => {
    const { fixture, invoke } = harness(SCENARIOS.BASELINE);
    const pending = fixture.state.reviewerRows.find((row) => row.name === 'Dr. Pending Reviewer');
    const withdrawn = await invoke('/api/review-manager/withdraw-sufficient', 'POST', {
      suggestionIds: [pending.suggestionId],
      sendEmail: false,
      reason: 'no_response',
    });
    expect(JSON.parse(withdrawn.response.body).results).toEqual([
      { suggestionId: pending.suggestionId, status: 'withdrawn_no_email_by_reason', reason: 'no_response' },
    ]);
    expect(fixture.state.withdrawCapturedEmails).toEqual([]);
  });

  test('withdrawal rejects accepted and unknown IDs without mutating rows or capturing email', async () => {
    const { fixture, invoke } = harness(SCENARIOS.BASELINE);
    const acceptedBefore = { ...fixture.state.reviewerRows.find((row) => row.suggestionId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') };
    const acceptedCandidateBefore = { ...fixture.state.candidateRows[0] };
    const result = await invoke('/api/review-manager/withdraw-sufficient', 'POST', {
      requestId: REQUEST_ID,
      suggestionIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
      reason: 'no_longer_needed',
      sendEmail: true,
    });
    expect(JSON.parse(result.response.body)).toEqual({
      ok: true,
      withdrawn: 0,
      results: [
        { suggestionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'not_pending' },
        { suggestionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'not_found' },
      ],
    });
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toEqual(acceptedBefore);
    expect(fixture.state.candidateRows[0]).toEqual(acceptedCandidateBefore);
    expect(fixture.state.withdrawCapturedEmails).toEqual([]);
    expect(fixture.state.candidateRows.find((row) => row.suggestionId === 'ffffffff-ffff-4fff-8fff-ffffffffffff').responseType).toBeUndefined();
  });

  test('stage2b authoring draft GET/PUT/submit stays in fixture memory with question-set version', async () => {
    const { fixture, invoke } = harness(SCENARIOS.REVIEWER_AUTHORING);
    expect(fixture.state.reviewerContext.engagementState.view).toBe('stage2b');
    expect(JSON.parse((await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/draft`)).response.body)).toEqual({ ok: true, draftJson: null, submitted: false });

    const draftJson = { foreseenImpacts: '<p>Example answer</p>', impactAreas: [1], overallAssessment: 4 };
    const saved = await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/draft`, 'PUT', { draftJson });
    expect(JSON.parse(saved.response.body)).toMatchObject({ ok: true, draftId: 1 });
    expect(JSON.parse((await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/draft`)).response.body)).toMatchObject({ ok: true, draftJson, submitted: false });

    const setVersion = fixture.state.reviewerContext.questionSetVersion;
    const submitted = await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/submit`, 'POST', {
      answers: draftJson,
      setVersion,
    });
    expect(JSON.parse(submitted.response.body)).toEqual({ ok: true, receivedAt: '2099-06-30T12:05:00Z' });
    expect(fixture.state.reviewSubmit).toEqual({ answers: draftJson, setVersion });
    expect(fixture.state.reviewReceivedAt).toBe('2099-06-30T12:05:00Z');
    expect(fixture.state.reviewerContext.engagementState.view).toBe('submitted');
    expect(fixture.state.reviewerContext.submission).toEqual({ receivedAt: '2099-06-30T12:05:00Z', filename: null });
    expect(fixture.state.reviewDraft).toBeNull();
    expect(fixture.state.transitions).toContainEqual({ type: 'review-submitted', setVersion });
    expect(JSON.parse((await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/draft`)).response.body)).toEqual({
      ok: true,
      draftJson: null,
      submitted: true,
    });
    const locked = await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/draft`, 'PUT', { draftJson });
    expect(locked.response.status).toBe(409);
    expect(JSON.parse(locked.response.body)).toMatchObject({ ok: false, reason: 'review_received_locked' });
    const committedSubmit = JSON.parse(JSON.stringify(fixture.state.reviewSubmit));
    const committedTransitions = JSON.parse(JSON.stringify(fixture.state.transitions));
    const replay = await invoke(`/api/external/review/${'pd-reviewer-rehearsal-token'}/submit`, 'POST', {
      answers: { foreseenImpacts: '<p>different replay</p>' },
      setVersion,
    });
    expect(replay.response.status).toBe(409);
    expect(JSON.parse(replay.response.body)).toEqual({
      ok: false,
      reason: 'review_received_locked',
      message: 'This review has already been submitted. To make a change, please contact your Program Director.',
    });
    expect(fixture.state.reviewSubmit).toEqual(committedSubmit);
    expect(fixture.state.transitions).toEqual(committedTransitions);
  });

  test('unmatched API routes notify the boundary guard and abort', async () => {
    const violations = [];
    let handler;
    const context = { route: (_matcher, callback) => { handler = callback; } };
    installMocks(context, { baseUrl: BASE_URL, onViolation: (message) => violations.push(message) });
    let aborted = false;
    await handler({
      request: () => request('/api/undocumented', 'GET'),
      abort: async () => { aborted = true; },
      fulfill: async () => { throw new Error('unexpected_fixture_fulfill'); },
    });
    expect(aborted).toBe(true);
    expect(violations).toEqual(['GET /api/undocumented is outside the rehearsal fixture boundary']);
  });
});

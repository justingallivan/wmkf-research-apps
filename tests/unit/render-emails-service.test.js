const getSender = jest.fn();
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getByIdWithSelect: (...args) => getSender(...args) }));
/**
 * Logic-level unit tests for lib/services/review-manager/render-emails-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapters + helpers mocked; covers the per-recipient skip semantics inside
 * one result ({ drafts[], stats } with skipped:'no_email' + emailConfidence
 * on every row), non-live send-time link placeholders without durable token
 * minting, and the 404 no-reviewers domain error.
 */

const findById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
}));
const getReviewerByIdWithSelect = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getReviewerByIdWithSelect(...a),
}));
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));
jest.mock('../../lib/services/grant-cycles-dataverse', () => ({
  findByShortCode: jest.fn(async () => null),
}));
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(async () => []),
}));
jest.mock('../../lib/services/honorarium-config', () => ({
  getHonorariumAmount: jest.fn(async () => 500),
}));
const mintAndStore = jest.fn();
const buildSendTimeExternalUrlPlaceholder = jest.fn(() => (
  'https://reviews.example.org/external/review/send_time_token.pending_authority.not_live'
));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
  buildSendTimeExternalUrlPlaceholder: (...a) => buildSendTimeExternalUrlPlaceholder(...a),
}));

// The calendar due-date read is stubbed to pass the request's own date
// through, so older tests keep their fixtures; the tests near the end of this
// file exercise the real invitation rules.
const resolveRequestReviewDueDate = jest.fn(async (req) => ({ ok: true, date: req?.wmkf_reviewduedate ?? null, source: 'request' }));
jest.mock('../../lib/services/review-due-date-service', () => ({
  ...jest.requireActual('../../lib/services/review-due-date-service'),
  resolveRequestReviewDueDate: (...a) => resolveRequestReviewDueDate(...a),
}));

const SUG1 = '22222222-2222-4222-8222-222222222222';
const SUG2 = '33333333-3333-4333-8333-333333333333';
const REQ = '11111111-1111-4111-8111-111111111111';

let renderEmails;
let RenderEmailsError;
let buildDraftFingerprintInputs;
let fingerprintDraft;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/render-emails-service');
  renderEmails = mod.renderEmails;
  RenderEmailsError = mod.RenderEmailsError;
  const fp = await import('../../lib/services/review-manager/draft-fingerprint');
  buildDraftFingerprintInputs = fp.buildDraftFingerprintInputs;
  fingerprintDraft = fp.fingerprintDraft;
});

function suggestion(over = {}) {
  return { _wmkf_potentialreviewer_value: 'person-1', _wmkf_request_value: REQ, wmkf_accepted: true, ...over };
}

function person(over = {}) {
  return {
    wmkf_name: 'Dr. Jane Roe',
    wmkf_emailaddress: 'jane@uni.edu',
    wmkf_emailsource: 'orcid',
    wmkf_identitystatus: null,
    ...over,
  };
}

const request = {
  akoya_requestid: REQ,
  akoya_requestnum: 'R-1001',
  akoya_title: 'Proposal T',
  wmkf_reviewduedate: null,
  wmkf_meetingdate: null,
};

const TEMPLATE = { subject: 'Review request', body: 'Hello reviewer' };

beforeEach(() => {
  jest.clearAllMocks();
  getRequestById.mockResolvedValue(request);
});

test('per-recipient skip: no-email recipient yields skipped:"no_email" row inside one result; stats split', async () => {
  findById.mockResolvedValueOnce(suggestion()).mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect
    .mockResolvedValueOnce(person())
    .mockResolvedValueOnce(person({ wmkf_emailaddress: null }));
  const out = await renderEmails({ suggestionIds: [SUG1, SUG2], template: TEMPLATE, settings: {}, actingUserSystemId: null });
  expect(out.stats).toEqual({ total: 2, ready: 1, skipped: 1 });
  const ready = out.drafts.find((d) => !d.skipped);
  const skipped = out.drafts.find((d) => d.skipped);
  expect(ready.candidateEmail).toBe('jane@uni.edu');
  expect(ready.subject).toBe('Review request');
  expect(ready.body).toBe('Hello reviewer');
  expect(skipped).toMatchObject({ skipped: 'no_email', candidateEmail: null, subject: '', body: '' });
  // Every row carries emailConfidence (Slice G server-side stamp).
  for (const d of out.drafts) expect(d.emailConfidence).toBeDefined();
});

test('invitation render refuses a research-only search address', async () => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
  const out = await renderEmails({
    suggestionIds: [SUG1],
    template: { subject: 'Review request', body: 'Respond: {{externalLink}}' },
    settings: {},
    templateType: 'invitation',
    actingUserSystemId: null,
  });
  expect(out.stats).toEqual({ total: 1, ready: 0, skipped: 1 });
  expect(out.drafts[0]).toMatchObject({
    skipped: 'email_research_only',
    emailConfidence: { action: 'research_only' },
    manualLink: null,
  });
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('post-engagement render does not re-gate a research-only source', async () => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
  const out = await renderEmails({
    suggestionIds: [SUG1],
    template: TEMPLATE,
    settings: {},
    templateType: 'materials',
    actingUserSystemId: null,
  });
  expect(out.stats.ready).toBe(1);
  expect(out.drafts[0].skipped).toBeUndefined();
});

test.each(['invitation', 'materials', 'followup', 'thankyou'])(
  'pending person-scoped address conflict blocks %s preview before draft creation',
  async (templateType) => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({
      wmkf_addresstruststatejson: JSON.stringify({
        version: 1,
        email: 'jane@uni.edu',
        status: 'conflict_pending',
        attestation: null,
        conflict: {
          reason: 'email_mismatch',
          storedEmail: 'jane@uni.edu',
          foundEmail: 'jane.roe@uni.edu',
          source: 'institution_page',
          requestId: REQ,
          candidateKey: `suggestion:${SUG1}`,
          detectedAt: '2026-07-31T12:00:00.000Z',
        },
        resolution: null,
      }),
    }));
    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Review request', body: 'Respond: {{externalLink}}' },
      settings: {},
      templateType,
      actingUserSystemId: null,
    });
    expect(out.drafts[0]).toMatchObject({
      skipped: 'address_conflict_pending',
      emailConfidence: { action: 'blocked' },
      addressConflict: {
        storedEmail: 'jane@uni.edu',
        foundEmail: 'jane.roe@uni.edu',
        reason: 'email_mismatch',
      },
    });
    expect(mintAndStore).not.toHaveBeenCalled();
  },
);

test('render never mints; a placeholder template receives the non-live send-time URL', async () => {
  // No placeholder → no URL placeholder and no mint.
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person());
  await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
  expect(mintAndStore).not.toHaveBeenCalled();
  expect(buildSendTimeExternalUrlPlaceholder).not.toHaveBeenCalled();

  // Placeholder present → one pure preview URL shared across recipient drafts;
  // durable minting remains send-owned.
  findById.mockResolvedValueOnce(suggestion()).mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person()).mockResolvedValueOnce(person({ wmkf_name: 'Dr. Bob' }));
  const out = await renderEmails({
    suggestionIds: [SUG1, SUG2],
    template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
    settings: {},
    actingUserSystemId: 'su-1',
  });
  expect(mintAndStore).not.toHaveBeenCalled();
  expect(buildSendTimeExternalUrlPlaceholder).toHaveBeenCalledTimes(1);
  for (const rendered of out.drafts) {
    expect(rendered.body).toContain('/external/review/send_time_token.pending_authority.not_live');
  }
  expect(out.stats.ready).toBe(2);
});

test('per-reviewer due-date override wins over the request date; a composer date is ignored', async () => {
  findById.mockResolvedValueOnce(suggestion({ wmkf_reviewduedateoverride: '2099-09-15' }));
  getReviewerByIdWithSelect.mockResolvedValueOnce(person());
  getRequestById.mockResolvedValueOnce({ ...request, wmkf_reviewduedate: '2099-09-01' });

  const out = await renderEmails({
    suggestionIds: [SUG1],
    template: { subject: 'Review due {{reviewDueDate}}', body: 'Due: {{reviewDueDate}}' },
    settings: { reviewDueDate: '2099-09-05' },
    actingUserSystemId: null,
  });

  expect(out.drafts[0]).toMatchObject({
    subject: 'Review due September 15, 2099',
    body: 'Due: September 15, 2099',
  });
});

test('no suggestion rows resolve → RenderEmailsError 404 with the pinned message', async () => {
  findById.mockResolvedValue(null);
  const err = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null })
    .catch((e) => e);
  expect(err).toBeInstanceOf(RenderEmailsError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe('No reviewers found for the provided IDs');
  expect(err.body).toBeUndefined(); // {error} route — shell default envelope
});

test('hydration failures are per-recipient best-effort (person lookup failure → skip row, render continues)', async () => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockRejectedValueOnce(new Error('person 404'));
  const out = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
  expect(out.drafts[0].skipped).toBe('no_email'); // null person → no email → skip
});

// S1 (Plan v4, S404): externalLinkExpected render-time metadata stamp — every
// draft (including skipped rows, for a uniform DTO) carries whether the
// SOURCE TEMPLATE requested {{externalLink}} in its subject or body. Preview
// substitution is non-live; send-time owns the authoritative mint.
describe('externalLinkExpected render-time stamp (S404 Plan v4)', () => {
  test('placeholder in body yields externalLinkExpected:true on the ready draft', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
      settings: {},
      actingUserSystemId: null,
    });
    expect(out.drafts[0].externalLinkExpected).toBe(true);
  });

  test('placeholder in SUBJECT ONLY also yields externalLinkExpected:true (extraction domain must match)', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Your link: {{externalLink}}', body: 'Hello' },
      settings: {},
      actingUserSystemId: null,
    });
    expect(out.drafts[0].externalLinkExpected).toBe(true);
  });

  test('no placeholder anywhere yields externalLinkExpected:false; no mint attempted', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
    expect(out.drafts[0].externalLinkExpected).toBe(false);
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  test('placeholder preview stamps true and carries only the non-live send-time URL', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
      settings: {},
      actingUserSystemId: null,
    });
    expect(out.drafts[0].externalLinkExpected).toBe(true);
    expect(out.drafts[0].body).toBe(
      'Link: https://reviews.example.org/external/review/send_time_token.pending_authority.not_live'
    );
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  test('follow-up rendering replaces a configured link paragraph with stable-link instructions and stamps no link expected', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: {
        subject: 'Reminder',
        body: 'Your review is due soon.\n\nUse this replacement link:\n{{externalLink}}\n\nThank you.',
      },
      settings: {},
      templateType: 'followup',
      actingUserSystemId: null,
    });

    expect(out.drafts[0].externalLinkExpected).toBe(false);
    expect(out.drafts[0].body).toContain('original review materials email');
    expect(out.drafts[0].body).not.toContain('{{externalLink}}');
    expect(out.drafts[0].body).not.toContain('/external/review/');
    expect(buildSendTimeExternalUrlPlaceholder).not.toHaveBeenCalled();
  });

  test('follow-up rendering removes a separate stale superseding-link direction', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: {
        subject: 'Reminder',
        body: 'Your review is due soon.\n\nUse the link in this email — it supersedes any earlier link:\n\n{{externalLink}}\n\nThank you.',
      },
      settings: {},
      templateType: 'followup',
      actingUserSystemId: null,
    });

    expect(out.drafts[0].body).toContain('original review materials email');
    expect(out.drafts[0].body).not.toContain('supersedes any earlier');
    expect(out.drafts[0].body).not.toContain('{{externalLink}}');
    expect(out.drafts[0].externalLinkExpected).toBe(false);
  });

  test('every skip shape (no_email, address_conflict_pending, email_research_only) also carries the stamp', async () => {
    // no_email
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailaddress: null }));
    const noEmail = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
      settings: {},
      actingUserSystemId: null,
    });
    expect(noEmail.drafts[0]).toMatchObject({ skipped: 'no_email', externalLinkExpected: true });

    // address_conflict_pending
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({
      wmkf_addresstruststatejson: JSON.stringify({
        version: 1,
        email: 'jane@uni.edu',
        status: 'conflict_pending',
        attestation: null,
        conflict: {
          reason: 'email_mismatch',
          storedEmail: 'jane@uni.edu',
          foundEmail: 'jane.roe@uni.edu',
          source: 'institution_page',
          requestId: REQ,
          candidateKey: `suggestion:${SUG1}`,
          detectedAt: '2026-07-31T12:00:00.000Z',
        },
        resolution: null,
      }),
    }));
    const blocked = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
      settings: {},
      actingUserSystemId: null,
    });
    expect(blocked.drafts[0]).toMatchObject({ skipped: 'address_conflict_pending', externalLinkExpected: true });

    // email_research_only (invitation only)
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
    const researchOnly = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invite', body: 'Link: {{externalLink}}' },
      settings: {},
      templateType: 'invitation',
      actingUserSystemId: null,
    });
    expect(researchOnly.drafts[0]).toMatchObject({ skipped: 'email_research_only', externalLinkExpected: true });
  });
});

// Stage 6D: every draft row carries a draftFingerprint (send-emails-service
// recomputes and refuses a stale one; see draft-fingerprint.js).
describe('draftFingerprint (Stage 6D)', () => {
  test('a ready draft carries a 64-hex draftFingerprint equal to fingerprintDraft(buildDraftFingerprintInputs(...))', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
    const row = out.drafts[0];
    expect(row.draftFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const expected = fingerprintDraft(buildDraftFingerprintInputs({
      templateType: 'invitation',
      suggestionId: SUG1,
      suggestion: suggestion(),
      person: person(),
      request,
      coPINames: [],
      cycle: {},
      honorariumAmount: 500,
    }));
    expect(row.draftFingerprint).toBe(expected);
  });

  test('skipped rows (no_email, address_conflict_pending, email_research_only) carry draftFingerprint: null', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailaddress: null }));
    const noEmail = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
    expect(noEmail.drafts[0]).toMatchObject({ skipped: 'no_email', draftFingerprint: null });

    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({
      wmkf_addresstruststatejson: JSON.stringify({
        version: 1,
        email: 'jane@uni.edu',
        status: 'conflict_pending',
        attestation: null,
        conflict: {
          reason: 'email_mismatch',
          storedEmail: 'jane@uni.edu',
          foundEmail: 'jane.roe@uni.edu',
          source: 'institution_page',
          requestId: REQ,
          candidateKey: `suggestion:${SUG1}`,
          detectedAt: '2026-07-31T12:00:00.000Z',
        },
        resolution: null,
      }),
    }));
    const blocked = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });
    expect(blocked.drafts[0]).toMatchObject({ skipped: 'address_conflict_pending', draftFingerprint: null });

    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
    const researchOnly = await renderEmails({
      suggestionIds: [SUG1],
      template: TEMPLATE,
      settings: {},
      templateType: 'invitation',
      actingUserSystemId: null,
    });
    expect(researchOnly.drafts[0]).toMatchObject({ skipped: 'email_research_only', draftFingerprint: null });
  });

  test('a co-PI added between two renders changes the fingerprint', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const { fetchCoPIs } = require('../../lib/services/proposal-participants');
    fetchCoPIs.mockResolvedValueOnce([]);
    const before = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });

    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    fetchCoPIs.mockResolvedValueOnce(['Dr. Alex Co-PI']);
    const after = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, settings: {}, actingUserSystemId: null });

    expect(after.drafts[0].draftFingerprint).not.toBe(before.drafts[0].draftFingerprint);
  });
});

describe('manual thank-you render strips the retired {{honorariumNote}} token', () => {
  const THANKYOU = { subject: 'Thanks', body: 'Hello.\n\n{{honorariumNote}}\n\nBye.' };

  test('opt-out true → token removed, no honorarium sentence', async () => {
    findById.mockResolvedValueOnce(suggestion({ wmkf_honorariumoptout: true }));
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({ suggestionIds: [SUG1], template: THANKYOU, settings: {}, templateType: 'thankyou', actingUserSystemId: null });
    expect(out.drafts[0].body).not.toContain('{{honorariumNote}}');
    expect(out.drafts[0].body).not.toContain('honorarium');
    expect(out.drafts[0].body).toContain('Bye.');
  });

  test.each([false, null, undefined])('opt-out %p → token removed without payment language', async (v) => {
    findById.mockResolvedValueOnce(suggestion(v === undefined ? {} : { wmkf_honorariumoptout: v }));
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    const out = await renderEmails({ suggestionIds: [SUG1], template: THANKYOU, settings: {}, templateType: 'thankyou', actingUserSystemId: null });
    expect(out.drafts[0].body).not.toContain('honorarium');
    expect(out.drafts[0].body).not.toContain('{{honorariumNote}}');
  });
});


test.each(['invitation', 'materials'])('%s exposes the mailbox used by that send path', async (templateType) => {
  findById.mockResolvedValueOnce(suggestion());
  getReviewerByIdWithSelect.mockResolvedValueOnce(person());
  getRequestById.mockResolvedValue({ ...request, _wmkf_programdirector_value: 'assigned-pd' });
  getSender.mockResolvedValue({ isdisabled: false, internalemailaddress: 'assigned-pd@example.org' });
  const out = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, templateType, settings: {}, fromEmail: 'acting-user@example.org' });
  expect(out.drafts[0].from).toBe(templateType === 'invitation' ? 'assigned-pd@example.org' : 'acting-user@example.org');
});
test('a disabled assigned PD never supplies an invitation From address', async () => {
  findById.mockResolvedValueOnce(suggestion()); getReviewerByIdWithSelect.mockResolvedValueOnce(person());
  getRequestById.mockResolvedValue({ ...request, _wmkf_programdirector_value: 'assigned-pd' });
  getSender.mockResolvedValue({ isdisabled: true, internalemailaddress: 'disabled@example.org' });
  const out = await renderEmails({ suggestionIds: [SUG1], template: TEMPLATE, templateType: 'invitation', settings: {}, fromEmail: 'actor@example.org' });
  expect(out.drafts[0].from).toBeNull();
});

describe('invitation review due date from the cycle calendar (D48)', () => {
  test('before the first invitation, the calendar date fills {{reviewDue}} and {{reviewDueDate}} and is returned', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    getRequestById.mockResolvedValueOnce({ ...request, wmkf_reviewduedate: null });
    resolveRequestReviewDueDate.mockResolvedValueOnce({ ok: true, date: '2027-03-10', source: 'calendar' });

    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invitation', body: 'Due by {{reviewDue}} ({{reviewDueDate}}, {{reviewDeadline}})' },
      settings: { reviewDueDate: '2099-01-01' },
      templateType: 'invitation',
      actingUserSystemId: null,
    });

    expect(out.drafts[0].body).toBe('Due by March 10, 2027 (March 10, 2027, March 10, 2027)');
    expect(out.drafts[0].reviewDueDate).toBe('2027-03-10');
    // The fingerprint is computed as if the date were already stored, which is
    // what the send service sees after storing it.
    expect(out.drafts[0].draftFingerprint).toBe(fingerprintDraft(buildDraftFingerprintInputs({
      templateType: 'invitation',
      suggestionId: SUG1,
      suggestion: suggestion(),
      person: person(),
      request: { ...request, wmkf_reviewduedate: '2027-03-10' },
      coPINames: [],
      cycle: {},
      honorariumAmount: 500,
    })));
  });

  test('a blank calendar date refuses the invitation preview with a staff-facing reason', async () => {
    findById.mockResolvedValueOnce(suggestion());
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    getRequestById.mockResolvedValueOnce({ ...request, wmkf_reviewduedate: null });
    resolveRequestReviewDueDate.mockResolvedValueOnce({ ok: false, reason: 'reviews_due_missing' });

    await expect(renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Invitation', body: 'Due by {{reviewDue}}' },
      templateType: 'invitation',
      actingUserSystemId: null,
    })).rejects.toMatchObject({
      name: 'RenderEmailsError',
      message: 'Set the Reviews Due Date on the cycle calendar first.',
    });
  });

  test('non-invitation renders never read the calendar', async () => {
    findById.mockResolvedValueOnce(suggestion({ wmkf_accepted: true }));
    getReviewerByIdWithSelect.mockResolvedValueOnce(person());
    getRequestById.mockResolvedValueOnce({ ...request, wmkf_reviewduedate: '2027-03-10' });

    const out = await renderEmails({
      suggestionIds: [SUG1],
      template: { subject: 'Materials', body: 'Due {{reviewDueDate}}' },
      settings: { reviewDueDate: '2099-01-01' },
      templateType: 'materials',
      actingUserSystemId: null,
    });

    expect(resolveRequestReviewDueDate).not.toHaveBeenCalled();
    expect(out.drafts[0].body).toBe('Due March 10, 2027');
  });
});

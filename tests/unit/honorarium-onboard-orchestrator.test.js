/**
 * Unit tests for lib/bill/honorarium-onboard-orchestrator.js (chunk-4).
 *
 * Drives the orchestrator with injected fakes for every collaborator. Focus:
 * promote-on-accept, deterministic-GUID create idempotency + duplicate-PK
 * recovery (Codex pre-impl P1 #1), junction provenance, address PATCH, and the
 * onboard hand-off.
 *
 * @jest-environment node
 */

// Discriminator GUIDs are read from env at module load.
process.env.HONORARIUM_PROGRAM_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.HONORARIUM_GRANTPROGRAM_ID = '00000000-0000-0000-0000-0000000000bb';
process.env.HONORARIUM_TYPE_ID = '00000000-0000-0000-0000-0000000000cc';

const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');

const SUGGESTION_ID = 'sug-1111';

function baseArgs(overrides = {}) {
  return {
    suggestion: { wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_honorariumrequest_value: null, ...overrides.suggestion },
    request: { akoya_requestid: 'req-1', akoya_requestnum: 'REQ-001', wmkf_meetingdate: '2026-06-04T00:00:00Z', ...overrides.request },
    reviewer: { wmkf_potentialreviewersid: 'pr-1', wmkf_name: 'Jane Q. Reviewer', wmkf_emailaddress: 'jane@uni.edu', _wmkf_contact_value: 'contact-1', ...overrides.reviewer },
    body: { address: { line1: '1 Lab Rd', city: 'Sci City', state: 'CA', postalCode: '90001', country: 'US' }, ...overrides.body },
  };
}

function makeDeps(overrides = {}) {
  return {
    dynamics: {
      createRecord: jest.fn().mockResolvedValue({ akoya_requestid: 'HON' }),
      getRecord: jest.fn().mockResolvedValue(null),
      updateRecord: jest.fn().mockResolvedValue(undefined),
      ...overrides.dynamics,
    },
    contacts: { findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 'contact-new', created: true }), ...overrides.contacts },
    potentialReviewers: { setContactLink: jest.fn().mockResolvedValue(undefined), ...overrides.potentialReviewers },
    suggestions: { setHonorariumRequest: jest.fn().mockResolvedValue(undefined), ...overrides.suggestions },
    onboard: overrides.onboard || jest.fn().mockResolvedValue({ status: 'alert_only' }),
    getAmount: overrides.getAmount || jest.fn().mockResolvedValue(250),
    deriveGuid: overrides.deriveGuid || jest.fn((name) => `det-${name}`),
  };
}

describe('ensureHonorariumOnboarding', () => {
  it('contact present → no promotion; creates honorarium with deterministic GUID + amount; PATCHes junction; calls onboard', async () => {
    const deps = makeDeps();
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);

    expect(deps.contacts.findOrCreateByEmail).not.toHaveBeenCalled();
    const createArg = deps.dynamics.createRecord.mock.calls[0][1];
    expect(createArg.akoya_requestid).toBe(`det-${SUGGESTION_ID}`);
    expect(createArg.akoya_recommendedamount).toBe(250);
    expect(createArg['akoya_PrimaryContactId@odata.bind']).toBe('/contacts(contact-1)');
    expect(createArg.wmkf_request_type).toBe(682090001);
    expect(createArg.wmkf_meetingdate).toBe('2026-06-04T00:00:00Z');
    expect(deps.suggestions.setHonorariumRequest).toHaveBeenCalledWith(SUGGESTION_ID, `det-${SUGGESTION_ID}`);
    expect(deps.onboard).toHaveBeenCalledWith(expect.objectContaining({
      honorariumRequestId: `det-${SUGGESTION_ID}`,
      reviewerContactId: 'contact-1',
      reviewerName: 'Jane Q. Reviewer',
      reviewerEmail: 'jane@uni.edu',
      address: expect.objectContaining({ line1: '1 Lab Rd', zipOrPostalCode: '90001', country: 'US', state: 'CA' }),
    }));
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
    expect(res.created).toBe(true);
  });

  it('contact absent → promotes (find-or-create + setContactLink) and uses the new id', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@uni.edu' }));
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-new');
    expect(deps.dynamics.createRecord.mock.calls[0][1]['akoya_PrimaryContactId@odata.bind']).toBe('/contacts(contact-new)');
  });

  it('no email anywhere → throws honorarium_no_email (caller alerts, accept survives)', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_emailaddress: null }, body: { contactEdits: {}, address: {} } });
    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({ code: 'honorarium_no_email' });
    expect(deps.dynamics.createRecord).not.toHaveBeenCalled();
  });

  it('junction already set → skip create + junction PATCH; still calls onboard with the existing id', async () => {
    const deps = makeDeps();
    const args = baseArgs({ suggestion: { _wmkf_honorariumrequest_value: 'existing-hon' } });
    const res = await ensureHonorariumOnboarding(args, deps);
    expect(deps.dynamics.createRecord).not.toHaveBeenCalled();
    expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalledWith(expect.objectContaining({ honorariumRequestId: 'existing-hon' }));
    expect(res.created).toBe(false);
  });

  it('duplicate-PK on create → confirm-by-read finds the row → no rethrow, proceeds to junction PATCH', async () => {
    const deps = makeDeps({
      dynamics: {
        createRecord: jest.fn().mockRejectedValue(new Error('duplicate key')),
        getRecord: jest.fn().mockResolvedValue({ akoya_requestid: `det-${SUGGESTION_ID}` }),
        updateRecord: jest.fn().mockResolvedValue(undefined),
      },
    });
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);
    expect(deps.dynamics.getRecord).toHaveBeenCalledWith('akoya_requests', `det-${SUGGESTION_ID}`, expect.anything());
    expect(deps.suggestions.setHonorariumRequest).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
  });

  it('create error AND row not found → rethrows (genuine failure)', async () => {
    const deps = makeDeps({
      dynamics: {
        createRecord: jest.fn().mockRejectedValue(new Error('dataverse 500')),
        getRecord: jest.fn().mockResolvedValue(null),
        updateRecord: jest.fn().mockResolvedValue(undefined),
      },
    });
    await expect(ensureHonorariumOnboarding(baseArgs(), deps)).rejects.toThrow('dataverse 500');
    expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();
  });

  it('PATCHes the address onto the contact (address1_*)', async () => {
    const deps = makeDeps();
    await ensureHonorariumOnboarding(baseArgs(), deps);
    const addrCall = deps.dynamics.updateRecord.mock.calls.find(c => c[0] === 'contacts');
    expect(addrCall[2]).toMatchObject({
      address1_line1: '1 Lab Rd', address1_city: 'Sci City',
      address1_stateorprovince: 'CA', address1_postalcode: '90001', address1_country: 'US',
    });
  });

  it('contact address PATCH failure is non-fatal — honorarium still created + onboarded (Codex post-impl)', async () => {
    const deps = makeDeps({
      dynamics: {
        createRecord: jest.fn().mockResolvedValue({ akoya_requestid: 'HON' }),
        getRecord: jest.fn().mockResolvedValue(null),
        updateRecord: jest.fn().mockImplementation(async (entitySet) => {
          if (entitySet === 'contacts') throw new Error('address PATCH 500');
        }),
      },
    });
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);
    expect(deps.dynamics.createRecord).toHaveBeenCalled();
    expect(deps.suggestions.setHonorariumRequest).toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
  });

  it('amount unavailable → propagates (caller treats as skip + alert)', async () => {
    const err = Object.assign(new Error('down'), { code: 'honorarium_amount_unavailable' });
    const deps = makeDeps({ getAmount: jest.fn().mockRejectedValue(err) });
    await expect(ensureHonorariumOnboarding(baseArgs(), deps)).rejects.toMatchObject({ code: 'honorarium_amount_unavailable' });
    expect(deps.dynamics.createRecord).not.toHaveBeenCalled();
  });
});

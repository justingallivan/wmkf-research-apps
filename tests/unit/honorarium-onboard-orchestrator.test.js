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

function restoreEnv(key, prev) {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

function baseArgs(overrides = {}) {
  return {
    suggestion: { wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_honorariumrequest_value: null, ...overrides.suggestion },
    request: { akoya_requestid: 'req-1', akoya_requestnum: 'REQ-001', wmkf_meetingdate: '2026-06-04T00:00:00Z', ...overrides.request },
    reviewer: { wmkf_potentialreviewersid: 'pr-1', wmkf_name: 'Jane Q. Reviewer', wmkf_emailaddress: 'jane@uni.edu', _wmkf_contact_value: 'contact-1', ...overrides.reviewer },
    body: { address: { line1: '1 Lab Rd', city: 'Sci City', state: 'CA', postalCode: '90001', country: 'US', phone: '+1 555 0100' }, ...overrides.body },
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
    backProp: overrides.backProp || jest.fn().mockResolvedValue({ action: 'noop' }),
    deriveGuid: overrides.deriveGuid || jest.fn((name) => `det-${name}`),
    ...(overrides.isDeferred ? { isDeferred: overrides.isDeferred } : {}),
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
      reviewerPhone: '+1 555 0100',
      address: expect.objectContaining({ line1: '1 Lab Rd', zipOrPostalCode: '90001', country: 'US', state: 'CA' }),
    }));
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
    expect(res.created).toBe(true);
  });

  it('contact absent → promotes (find-or-create + setContactLink) and uses the new id', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@uni.edu' }), { actingUserSystemId: undefined });
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-new', { actingUserSystemId: undefined });
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
      address1_telephone1: '+1 555 0100',
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

  it('back-propagates the reviewer ORCID onto the ensured contact (design §5)', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { wmkf_orcid: '0000-0002-1825-0097', wmkf_identitystatus: 'probable' } });
    await ensureHonorariumOnboarding({ ...args, actingUserSystemId: 'u9' }, deps);
    expect(deps.backProp).toHaveBeenCalledWith(expect.objectContaining({
      reviewer: expect.objectContaining({ wmkf_orcid: '0000-0002-1825-0097' }),
      contactId: 'contact-1',
      actingUserSystemId: 'u9',
    }));
  });

  it('ORCID back-prop failure is non-fatal — honorarium still created + onboarded', async () => {
    const deps = makeDeps({ backProp: jest.fn().mockRejectedValue(new Error('contact 403')) });
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);
    expect(deps.dynamics.createRecord).toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
  });

  describe('capture-only (deferred) mode', () => {
    it('isDeferred → captures contact + address, but skips create/getAmount/onboard and does NOT throw', async () => {
      const deps = makeDeps({ isDeferred: () => true });
      const res = await ensureHonorariumOnboarding(baseArgs(), deps);

      // Address still PATCHed onto the contact (the data we want to capture).
      const addrCall = deps.dynamics.updateRecord.mock.calls.find(c => c[0] === 'contacts');
      expect(addrCall[2]).toMatchObject({ address1_line1: '1 Lab Rd', address1_telephone1: '+1 555 0100' });

      // No payment record minted, no amount read, no BILL onboarding.
      expect(deps.dynamics.createRecord).not.toHaveBeenCalled();
      expect(deps.getAmount).not.toHaveBeenCalled();
      expect(deps.onboard).not.toHaveBeenCalled();
      expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();

      expect(res).toMatchObject({ status: 'deferred', contactId: 'contact-1', created: false, honorariumRequestId: null });
      expect(res.addressCaptureError).toBeNull();
    });

    it('deferred surfaces an address-capture failure instead of silently succeeding (P1)', async () => {
      const deps = makeDeps({
        isDeferred: () => true,
        dynamics: {
          createRecord: jest.fn(),
          getRecord: jest.fn(),
          updateRecord: jest.fn().mockRejectedValue(new Error('address PATCH 500')),
        },
      });
      const res = await ensureHonorariumOnboarding(baseArgs(), deps);
      expect(res.status).toBe('deferred');
      expect(res.addressCaptureError).toMatch(/address PATCH 500/);
      // Still no payment record minted on the failure path.
      expect(deps.dynamics.createRecord).not.toHaveBeenCalled();
    });

    it('deferred flags partial discriminator config (some-but-not-all GUIDs, no explicit flag) (P2)', async () => {
      const prevDefer = process.env.HONORARIUM_ONBOARDING_DEFERRED;
      const prevProg = process.env.HONORARIUM_PROGRAM_ID;
      const prevGrant = process.env.HONORARIUM_GRANTPROGRAM_ID;
      const prevType = process.env.HONORARIUM_TYPE_ID;
      delete process.env.HONORARIUM_ONBOARDING_DEFERRED;
      process.env.HONORARIUM_PROGRAM_ID = '00000000-0000-0000-0000-0000000000aa';
      process.env.HONORARIUM_GRANTPROGRAM_ID = ''; // only 1 of 3 set
      delete process.env.HONORARIUM_TYPE_ID;
      try {
        const deps = makeDeps({ isDeferred: () => true });
        const res = await ensureHonorariumOnboarding(baseArgs(), deps);
        expect(res.partialDiscriminatorConfig).toBe(true);
      } finally {
        restoreEnv('HONORARIUM_ONBOARDING_DEFERRED', prevDefer);
        restoreEnv('HONORARIUM_PROGRAM_ID', prevProg);
        restoreEnv('HONORARIUM_GRANTPROGRAM_ID', prevGrant);
        restoreEnv('HONORARIUM_TYPE_ID', prevType);
      }
    });

    it('deferred does NOT flag partial config when ALL GUIDs are set (intentional flag defer)', async () => {
      const prevDefer = process.env.HONORARIUM_ONBOARDING_DEFERRED;
      process.env.HONORARIUM_ONBOARDING_DEFERRED = 'true';
      try {
        // baseline test env already has all three GUIDs set (lines 13-15).
        const deps = makeDeps({ isDeferred: () => true });
        const res = await ensureHonorariumOnboarding(baseArgs(), deps);
        expect(res.partialDiscriminatorConfig).toBe(false);
      } finally {
        restoreEnv('HONORARIUM_ONBOARDING_DEFERRED', prevDefer);
      }
    });

    it('deferred promote-on-accept still creates the contact so the address has a home', async () => {
      const deps = makeDeps({ isDeferred: () => true });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);
      expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalled();
      expect(res.contactId).toBe('contact-new');
      expect(res.status).toBe('deferred');
    });

    it('deferred carries an already-linked honorarium id through (no re-create, no onboard)', async () => {
      const deps = makeDeps({ isDeferred: () => true });
      const args = baseArgs({ suggestion: { _wmkf_honorariumrequest_value: 'existing-hon' } });
      const res = await ensureHonorariumOnboarding(args, deps);
      expect(deps.onboard).not.toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'deferred', honorariumRequestId: 'existing-hon', created: false });
    });

    it('default gate defers when HONORARIUM_ONBOARDING_DEFERRED=true even with discriminators configured', async () => {
      const prev = process.env.HONORARIUM_ONBOARDING_DEFERRED;
      process.env.HONORARIUM_ONBOARDING_DEFERRED = 'true';
      try {
        // No isDeferred injected → exercises defaultHonorariumOnboardingDeferred().
        const deps = makeDeps();
        const res = await ensureHonorariumOnboarding(baseArgs(), deps);
        expect(deps.dynamics.createRecord).not.toHaveBeenCalled();
        expect(res.status).toBe('deferred');
      } finally {
        if (prev === undefined) delete process.env.HONORARIUM_ONBOARDING_DEFERRED;
        else process.env.HONORARIUM_ONBOARDING_DEFERRED = prev;
      }
    });
  });

  it('threads actingUserSystemId into the promote-on-accept contact helpers (Codex #13)', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding({ ...args, actingUserSystemId: 'u9' }, deps);
    expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalledWith(expect.any(Object), { actingUserSystemId: 'u9' });
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-new', { actingUserSystemId: 'u9' });
  });
});

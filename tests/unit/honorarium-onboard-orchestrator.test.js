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
    requests: {
      create: jest.fn().mockResolvedValue({ akoya_requestid: 'HON' }),
      getById: jest.fn().mockResolvedValue(null),
      ...overrides.requests,
    },
    contacts: {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
      findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 'contact-new', created: true }),
      updateFields: jest.fn().mockResolvedValue(undefined),
      ...overrides.contacts,
    },
    potentialReviewers: { setContactLink: jest.fn().mockResolvedValue(undefined), ...overrides.potentialReviewers },
    suggestions: { setHonorariumRequest: jest.fn().mockResolvedValue(undefined), ...overrides.suggestions },
    onboard: overrides.onboard || jest.fn().mockResolvedValue({ status: 'alert_only' }),
    getAmount: overrides.getAmount || jest.fn().mockResolvedValue(250),
    backProp: overrides.backProp || jest.fn().mockResolvedValue({ action: 'noop' }),
    deriveGuid: overrides.deriveGuid || jest.fn((name) => `det-${name}`),
    notify: overrides.notify || jest.fn().mockResolvedValue({ id: 'alert-1' }),
    ...(overrides.isDeferred ? { isDeferred: overrides.isDeferred } : {}),
  };
}

describe('ensureHonorariumOnboarding', () => {
  it('contact present → no promotion; creates honorarium with deterministic GUID + amount; PATCHes junction; calls onboard', async () => {
    const deps = makeDeps();
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);

    expect(deps.contacts.findOrCreateByEmail).not.toHaveBeenCalled();
    const createArg = deps.requests.create.mock.calls[0][0];
    expect(createArg.akoya_requestid).toBe(`det-${SUGGESTION_ID}`);
    // Amount stamped on all three money fields the GoApply cohort carries.
    expect(createArg.akoya_recommendedamount).toBe(250);
    expect(createArg.akoya_request).toBe(250);
    expect(createArg.wmkf_invitedamount).toBe(250);
    // Nav-property casing (lowercase) — the prior PascalCase was rejected 400.
    expect(createArg['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-1)');
    expect(createArg['akoya_programid@odata.bind']).toBe('/akoya_programs(00000000-0000-0000-0000-0000000000aa)');
    // Both request-type fields: native Akoya "Scholarship" + wmkf "Individual".
    expect(createArg.akoya_requesttype).toBe(100000001);
    expect(createArg.wmkf_request_type).toBe(682090001);
    expect(createArg.wmkf_meetingdate).toBe('2026-06-04T00:00:00Z');
    // Fiscal year derived from the parent proposal's meeting date (UTC).
    expect(createArg.akoya_fiscalyear).toBe('June 2026');
    // Reminder flags forced off (bare create would default them true).
    expect(createArg.wmkf_respondreminderenabled).toBe(false);
    expect(createArg.wmkf_reviewduereminderenabled).toBe(false);
    // Proposal-referencing title (Option C), not the plugin "Grant to <name>".
    expect(createArg.akoya_title).toBe('Reviewer honorarium — proposal (#REQ-001)');
    // Structured honorarium→proposal link (Option A): self-lookup wmkf_reviewedproposal
    // bound to the parent proposal via the metadata-confirmed nav property.
    expect(createArg['wmkf_ReviewedProposal@odata.bind']).toBe('/akoya_requests(req-1)');
    // Currency bind omitted when HONORARIUM_CURRENCY_ID is unset (org default applies).
    expect(createArg['transactioncurrencyid@odata.bind']).toBeUndefined();
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

  it('parent request has no meeting date → throws (no malformed row) and does NOT create', async () => {
    const deps = makeDeps();
    const args = baseArgs({ request: { wmkf_meetingdate: null } });
    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({ code: 'honorarium_no_meeting_date' });
    expect(deps.requests.create).not.toHaveBeenCalled();
    expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();
  });

  it('binds transactioncurrencyid when HONORARIUM_CURRENCY_ID is configured', async () => {
    const prev = process.env.HONORARIUM_CURRENCY_ID;
    process.env.HONORARIUM_CURRENCY_ID = '00000000-0000-0000-0000-0000000000dd';
    jest.resetModules();
    const { ensureHonorariumOnboarding: withCurrency } = require('../../lib/bill/honorarium-onboard-orchestrator');
    try {
      const deps = makeDeps();
      await withCurrency(baseArgs(), deps);
      expect(deps.requests.create.mock.calls[0][0]['transactioncurrencyid@odata.bind'])
        .toBe('/transactioncurrencies(00000000-0000-0000-0000-0000000000dd)');
    } finally {
      restoreEnv('HONORARIUM_CURRENCY_ID', prev);
      jest.resetModules();
    }
  });

  it('contact absent → promotes (find-or-create + setContactLink) and uses the new id', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@uni.edu' }), { actingUserSystemId: undefined });
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-new', { actingUserSystemId: undefined });
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-new)');
  });

  it('contact absent, email matches an existing contact → links it; no create, cross-checks ORCID when present', async () => {
    const deps = makeDeps({ contacts: { findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }) } });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findByEmail).toHaveBeenCalledWith('jane@uni.edu');
    expect(deps.contacts.findByOrcidCandidates).toHaveBeenCalledWith('0000-0002-1825-0097');
    expect(deps.contacts.findOrCreateByEmail).not.toHaveBeenCalled();
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-email', { actingUserSystemId: undefined });
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
  });

  it('email hit + ORCID uniquely matches a different contact → warns but links and binds the email contact', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ one: true, id: 'contact-orcid' }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);

    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'contact_orcid_email_split',
      severity: 'warning',
      category: 'reviewers',
      autoResolveKey: 'contact-orcid-email-split:pr-1',
      metadata: expect.objectContaining({
        orcid: '0000-0002-1825-0097',
        correctedEmail: 'jane@uni.edu',
        emailContactId: 'contact-email',
        orcidContactId: 'contact-orcid',
        potentialReviewerId: 'pr-1',
        reviewerName: 'Jane',
        decision: 'linked_email_contact',
      }),
    }));
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-email', { actingUserSystemId: undefined });
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
  });

  it('email hit + ORCID uniquely matches the same contact → no split warning', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ one: true, id: 'contact-email' }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);

    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
  });

  it('email hit + ORCID lookup throws → proceeds with the email contact', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }),
          findByOrcidCandidates: jest.fn().mockRejectedValue(new Error('dataverse 500')),
        },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);

      expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
      expect(deps.notify).not.toHaveBeenCalled();
      expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
    } finally {
      warn.mockRestore();
    }
  });

  it('email hit + split warning notify throws → honorarium still completes', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ one: true, id: 'contact-orcid' }),
        },
        notify: jest.fn().mockRejectedValue(new Error('postgres down')),
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);

      expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'contact_orcid_email_split' }));
      expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
      expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
    } finally {
      warn.mockRestore();
    }
  });

  it('payment email differs from reviewer snapshot → uses corrected email without overwriting contacts.emailaddress1', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
      },
    });
    const args = baseArgs({
      reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'old@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' },
      body: { contactEdits: { email: 'payee@new.edu' } },
    });
    const res = await ensureHonorariumOnboarding(args, deps);

    expect(res.created).toBe(true);
    expect(deps.contacts.findByEmail).toHaveBeenCalledWith('payee@new.edu');
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
    const contactUpdates = deps.contacts.updateFields.mock.calls;
    expect(contactUpdates.length).toBeGreaterThan(0);
    expect(contactUpdates.some((call) => Object.prototype.hasOwnProperty.call(call[1], 'emailaddress1'))).toBe(false);
  });

  it('email misses but reviewer ORCID uniquely matches a contact → links existing, NO duplicate created', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmail: jest.fn().mockResolvedValue(null),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ one: true, id: 'contact-orcid' }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findByOrcidCandidates).toHaveBeenCalledWith('0000-0002-1825-0097');
    expect(deps.contacts.findOrCreateByEmail).not.toHaveBeenCalled(); // the bug fix: no duplicate
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-orcid', { actingUserSystemId: undefined });
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-orcid)');
  });

  it('email misses and ORCID is ambiguous → creates a new contact + logs a server warning (durable staff-review surface deferred), never blocks', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmail: jest.fn().mockResolvedValue(null),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ ambiguous: true, count: 2 }),
        },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);
      expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'corrected@new.edu' }), { actingUserSystemId: undefined });
      expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-new', { actingUserSystemId: undefined });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('contactDuplicateRisk'));
      // Durable, staff-visible surface: a warning system_alerts row, deduped per reviewer.
      expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'contact_duplicate_risk',
        severity: 'warning',
        category: 'reviewers',
        autoResolveKey: 'contact-dup-risk:pr-1',
        metadata: expect.objectContaining({ orcid: '0000-0002-1825-0097', matchedContactCount: 2, potentialReviewerId: 'pr-1' }),
      }));
      expect(res.created).toBe(true); // honorarium proceeds; not blocked
    } finally {
      warn.mockRestore();
    }
  });

  it('ambiguous ORCID + duplicate-risk alert throws → non-fatal, honorarium still proceeds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmail: jest.fn().mockResolvedValue(null),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ ambiguous: true, count: 2 }),
        },
        notify: jest.fn().mockRejectedValue(new Error('postgres down')),
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);
      expect(deps.notify).toHaveBeenCalled();
      expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalled();
      expect(res.created).toBe(true); // alert failure swallowed; payment not blocked
    } finally {
      warn.mockRestore();
    }
  });

  it('ORCID lookup throws → fails open to create (honorarium never stalls on the lookup)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmail: jest.fn().mockResolvedValue(null),
          findByOrcidCandidates: jest.fn().mockRejectedValue(new Error('dataverse 500')),
        },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);
      expect(deps.contacts.findOrCreateByEmail).toHaveBeenCalled();
      expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
    } finally {
      warn.mockRestore();
    }
  });

  it('setContactLink reports reviewer already linked elsewhere → honorarium binds to the existing LIVE link (concurrency guard)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const linkErr = Object.assign(new Error('linked elsewhere'), {
        code: 'reviewer_linked_elsewhere',
        details: { existingContactId: 'contact-live' },
      });
      const deps = makeDeps({
        contacts: { findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }) },
        potentialReviewers: { setContactLink: jest.fn().mockRejectedValue(linkErr) },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
      await ensureHonorariumOnboarding(args, deps);
      // Authoritative live link wins over the contact we picked by email.
      expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-live)');
    } finally {
      warn.mockRestore();
    }
  });

  it('setContactLink fails for another reason → non-fatal; honorarium proceeds with the chosen contact', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: { findByEmail: jest.fn().mockResolvedValue({ contactid: 'contact-email' }) },
        potentialReviewers: { setContactLink: jest.fn().mockRejectedValue(new Error('dataverse 500')) },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
      const res = await ensureHonorariumOnboarding(args, deps);
      expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
      expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
    } finally {
      warn.mockRestore();
    }
  });

  it('no email anywhere → throws honorarium_no_email (caller alerts, accept survives)', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_emailaddress: null }, body: { contactEdits: {}, address: {} } });
    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({ code: 'honorarium_no_email' });
    expect(deps.requests.create).not.toHaveBeenCalled();
  });

  it('junction already set → skip create + junction PATCH; still calls onboard with the existing id', async () => {
    const deps = makeDeps();
    const args = baseArgs({ suggestion: { _wmkf_honorariumrequest_value: 'existing-hon' } });
    const res = await ensureHonorariumOnboarding(args, deps);
    expect(deps.requests.create).not.toHaveBeenCalled();
    expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalledWith(expect.objectContaining({ honorariumRequestId: 'existing-hon' }));
    expect(res.created).toBe(false);
  });

  it('duplicate-PK on create → confirm-by-read finds the row → no rethrow, proceeds to junction PATCH', async () => {
    const deps = makeDeps({
      requests: {
        create: jest.fn().mockRejectedValue(new Error('duplicate key')),
        getById: jest.fn().mockResolvedValue({ akoya_requestid: `det-${SUGGESTION_ID}` }),
      },
    });
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);
    expect(deps.requests.getById).toHaveBeenCalledWith(`det-${SUGGESTION_ID}`, expect.anything());
    expect(deps.suggestions.setHonorariumRequest).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
  });

  it('create error AND row not found → rethrows (genuine failure)', async () => {
    const deps = makeDeps({
      requests: {
        create: jest.fn().mockRejectedValue(new Error('dataverse 500')),
        getById: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(ensureHonorariumOnboarding(baseArgs(), deps)).rejects.toThrow('dataverse 500');
    expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();
  });

  it('PATCHes the address onto the contact (address1_*)', async () => {
    const deps = makeDeps();
    await ensureHonorariumOnboarding(baseArgs(), deps);
    const addrCall = deps.contacts.updateFields.mock.calls[0];
    expect(addrCall[1]).toMatchObject({
      address1_line1: '1 Lab Rd', address1_city: 'Sci City',
      address1_stateorprovince: 'CA', address1_postalcode: '90001', address1_country: 'US',
      address1_telephone1: '+1 555 0100',
    });
  });

  it('contact address PATCH failure is non-fatal — honorarium still created + onboarded (Codex post-impl)', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmail: jest.fn().mockResolvedValue(null),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
        findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 'contact-new', created: true }),
        updateFields: jest.fn().mockRejectedValue(new Error('address PATCH 500')),
      },
    });
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);
    expect(deps.requests.create).toHaveBeenCalled();
    expect(deps.suggestions.setHonorariumRequest).toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
  });

  it('amount unavailable → propagates (caller treats as skip + alert)', async () => {
    const err = Object.assign(new Error('down'), { code: 'honorarium_amount_unavailable' });
    const deps = makeDeps({ getAmount: jest.fn().mockRejectedValue(err) });
    await expect(ensureHonorariumOnboarding(baseArgs(), deps)).rejects.toMatchObject({ code: 'honorarium_amount_unavailable' });
    expect(deps.requests.create).not.toHaveBeenCalled();
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
    expect(deps.requests.create).toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
  });

  describe('capture-only (deferred) mode', () => {
    it('isDeferred → captures contact + address, but skips create/getAmount/onboard and does NOT throw', async () => {
      const deps = makeDeps({ isDeferred: () => true });
      const res = await ensureHonorariumOnboarding(baseArgs(), deps);

      // Address still PATCHed onto the contact (the data we want to capture).
      const addrCall = deps.contacts.updateFields.mock.calls[0];
      expect(addrCall[1]).toMatchObject({ address1_line1: '1 Lab Rd', address1_telephone1: '+1 555 0100' });

      // No payment record minted, no amount read, no BILL onboarding.
      expect(deps.requests.create).not.toHaveBeenCalled();
      expect(deps.getAmount).not.toHaveBeenCalled();
      expect(deps.onboard).not.toHaveBeenCalled();
      expect(deps.suggestions.setHonorariumRequest).not.toHaveBeenCalled();

      expect(res).toMatchObject({ status: 'deferred', contactId: 'contact-1', created: false, honorariumRequestId: null });
      expect(res.addressCaptureError).toBeNull();
    });

    it('deferred surfaces an address-capture failure instead of silently succeeding (P1)', async () => {
      const deps = makeDeps({
        isDeferred: () => true,
        contacts: {
          findByEmail: jest.fn().mockResolvedValue(null),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
          findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 'contact-new', created: true }),
          updateFields: jest.fn().mockRejectedValue(new Error('address PATCH 500')),
        },
      });
      const res = await ensureHonorariumOnboarding(baseArgs(), deps);
      expect(res.status).toBe('deferred');
      expect(res.addressCaptureError).toMatch(/address PATCH 500/);
      // Still no payment record minted on the failure path.
      expect(deps.requests.create).not.toHaveBeenCalled();
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
        expect(deps.requests.create).not.toHaveBeenCalled();
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

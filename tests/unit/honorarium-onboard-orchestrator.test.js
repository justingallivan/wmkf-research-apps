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

const {
  ensureHonorariumOnboarding,
  ensureAcceptedReviewerContact,
  claimNewAcceptedReviewerContact,
} = require('../../lib/bill/honorarium-onboard-orchestrator');

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
  const contacts = {
    findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
    findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
    getById: jest.fn(async (contactId) => ({
      contactid: contactId,
      fullname: 'Jane Q. Reviewer',
      emailaddress1: 'jane@uni.edu',
      statecode: 0,
    })),
    updateFields: jest.fn().mockResolvedValue(undefined),
    ...overrides.contacts,
  };
  const potentialReviewers = {
    getById: jest.fn().mockResolvedValue({
      wmkf_potentialreviewersid: 'pr-1',
      _wmkf_contact_value: null,
      _etag: 'W/"1"',
    }),
    setContactLink: jest.fn().mockResolvedValue(undefined),
    ...overrides.potentialReviewers,
  };
  const claimNewContact = overrides.claimNewContact || jest.fn(async (args) => args.contactId);
  return {
    requests: {
      create: jest.fn().mockResolvedValue({ akoya_requestid: 'HON' }),
      getById: jest.fn().mockResolvedValue(null),
      ...overrides.requests,
    },
    contacts,
    potentialReviewers,
    claimNewContact,
    suggestions: { setHonorariumRequest: jest.fn().mockResolvedValue(undefined), ...overrides.suggestions },
    onboard: overrides.onboard || jest.fn().mockResolvedValue({ status: 'alert_only' }),
    getAmount: overrides.getAmount || jest.fn().mockResolvedValue(250),
    backProp: overrides.backProp || jest.fn().mockResolvedValue({ action: 'noop' }),
    deriveGuid: overrides.deriveGuid || jest.fn((name) => `det-${name}`),
    deriveContactGuid: overrides.deriveContactGuid || jest.fn(() => 'contact-new'),
    notify: overrides.notify || jest.fn().mockResolvedValue({ id: 'alert-1' }),
    ...(overrides.isDeferred ? { isDeferred: overrides.isDeferred } : {}),
  };
}

describe('ensureHonorariumOnboarding', () => {
  it('contact present → no promotion; creates honorarium with deterministic GUID + amount; PATCHes junction; calls onboard', async () => {
    const deps = makeDeps();
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);

    expect(deps.claimNewContact).not.toHaveBeenCalled();
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

  it('rejects an unsafe pre-existing reviewer link before mutating the Contact', async () => {
    const deps = makeDeps({
      contacts: {
        getById: jest.fn().mockResolvedValue({
          contactid: 'contact-1',
          fullname: 'Different Person',
          emailaddress1: 'different@example.edu',
          statecode: 0,
        }),
      },
    });

    await expect(ensureHonorariumOnboarding(baseArgs(), deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      details: expect.objectContaining({ reason: 'contact_name_mismatch' }),
    });

    expect(deps.backProp).not.toHaveBeenCalled();
    expect(deps.contacts.updateFields).not.toHaveBeenCalled();
    expect(deps.requests.create).not.toHaveBeenCalled();
    expect(deps.onboard).not.toHaveBeenCalled();
  });

  it('accepts a validated existing link while preserving newer engagement corrections downstream', async () => {
    const deps = makeDeps({
      contacts: {
        getById: jest.fn().mockResolvedValue({
          contactid: 'contact-1',
          fullname: 'Jane Q. Reviewer',
          emailaddress1: 'jane@uni.edu',
          statecode: 0,
        }),
      },
    });
    const args = baseArgs({
      suggestion: {
        wmkf_reviewerfirstname: 'Janet',
        wmkf_reviewerlastname: 'Reviewer',
        wmkf_revieweremail: 'janet@current.edu',
      },
      body: { contactEdits: {} },
    });

    await ensureHonorariumOnboarding(args, deps);

    expect(deps.backProp).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-1',
    }));
    expect(deps.onboard).toHaveBeenCalledWith(expect.objectContaining({
      reviewerName: 'Janet Reviewer',
      reviewerEmail: 'janet@current.edu',
    }));
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

  it('contact absent → creates one deterministic accepted-reviewer contact and links it', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.claimNewContact).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-new',
      firstName: null,
      lastName: 'Jane',
      email: 'jane@uni.edu',
      actingUserSystemId: undefined,
    }));
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-new)');
  });

  it('uses the current engagement snapshot before stale global reviewer identity', async () => {
    const deps = makeDeps();
    const args = baseArgs({
      suggestion: {
        wmkf_reviewerfirstname: 'Corrected',
        wmkf_reviewerlastname: 'Scholar',
        wmkf_revieweremail: 'current@engagement.edu',
      },
      reviewer: {
        _wmkf_contact_value: null,
        wmkf_potentialreviewersid: 'pr-1',
        wmkf_firstname: 'Stale',
        wmkf_lastname: 'Name',
        wmkf_emailaddress: 'stale@former.edu',
        wmkf_name: 'Stale Name',
      },
      body: { contactEdits: {} },
    });

    await ensureHonorariumOnboarding(args, deps);

    expect(deps.contacts.findByEmailCandidates).toHaveBeenCalledWith('current@engagement.edu');
    expect(deps.claimNewContact).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Corrected',
      lastName: 'Scholar',
      email: 'current@engagement.edu',
      reviewerName: 'Corrected Scholar',
    }));
    expect(deps.onboard).toHaveBeenCalledWith(expect.objectContaining({
      reviewerName: 'Corrected Scholar',
      reviewerEmail: 'current@engagement.edu',
    }));
  });

  it('uses canonical ORCID as the deterministic identity key across duplicate reviewer rows', async () => {
    const deriveContactGuid = jest.fn(() => 'contact-shared');
    const commonDeps = {
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
        updateFields: jest.fn().mockResolvedValue(undefined),
      },
      potentialReviewers: {},
      backProp: jest.fn().mockResolvedValue({ action: 'noop' }),
      notify: jest.fn(),
      deriveContactGuid,
      claimNewContact: jest.fn(async ({ contactId }) => contactId),
    };

    for (const [reviewerId, email] of [['pr-one', 'one@example.edu'], ['pr-two', 'two@example.edu']]) {
      await ensureAcceptedReviewerContact({
        reviewer: {
          wmkf_potentialreviewersid: reviewerId,
          wmkf_name: 'Same Scholar',
          wmkf_emailaddress: email,
          wmkf_orcid: 'https://orcid.org/0000-0002-1825-0097',
          _wmkf_contact_value: null,
        },
        body: {},
      }, commonDeps);
    }

    expect(deriveContactGuid).toHaveBeenNthCalledWith(1, 'orcid:0000-0002-1825-0097');
    expect(deriveContactGuid).toHaveBeenNthCalledWith(2, 'orcid:0000-0002-1825-0097');
  });

  it('claims a new Contact and reviewer link in one ETag-guarded changeset', async () => {
    const runAtomic = jest.fn().mockResolvedValue({ ok: true });
    const contacts = {
      acceptedReviewerContactPayload: jest.fn((input) => ({
        contactid: input.contactId,
        firstname: input.firstName,
        lastname: input.lastName,
        emailaddress1: input.email,
      })),
      getById: jest.fn(),
    };
    const potentialReviewers = {
      getById: jest.fn().mockResolvedValue({
        wmkf_potentialreviewersid: 'pr-1',
        _wmkf_contact_value: null,
        _etag: 'W/"27"',
      }),
    };

    await expect(claimNewAcceptedReviewerContact({
      reviewer: { wmkf_potentialreviewersid: 'pr-1' },
      contactId: 'contact-new',
      firstName: 'Jane',
      lastName: 'Reviewer',
      email: 'jane@uni.edu',
      reviewerName: 'Jane Reviewer',
      contacts,
      potentialReviewers,
      actingUserSystemId: 'user-9',
      notify: jest.fn(),
    }, { runAtomic })).resolves.toBe('contact-new');

    expect(runAtomic).toHaveBeenCalledWith([
      {
        method: 'POST',
        entitySet: 'contacts',
        body: {
          contactid: 'contact-new',
          firstname: 'Jane',
          lastname: 'Reviewer',
          emailaddress1: 'jane@uni.edu',
        },
      },
      {
        method: 'PATCH',
        entitySet: 'wmkf_potentialreviewerses',
        key: 'pr-1',
        body: { 'wmkf_Contact@odata.bind': '/contacts(contact-new)' },
        ifMatch: 'W/"27"',
      },
    ], { actingUserSystemId: 'user-9' });
  });

  it('reconciles a committed atomic claim after a dropped response, then continues Contact capture', async () => {
    const runAtomic = jest.fn().mockRejectedValue(new Error('connection dropped after commit'));
    const contacts = {
      findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
      findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
      acceptedReviewerContactPayload: jest.fn((input) => ({
        contactid: input.contactId,
        firstname: input.firstName,
        lastname: input.lastName,
        emailaddress1: input.email,
      })),
      getById: jest.fn().mockResolvedValue({
        contactid: 'contact-new',
        fullname: 'Jane Reviewer',
        emailaddress1: 'jane@uni.edu',
        statecode: 0,
      }),
      updateFields: jest.fn().mockResolvedValue(undefined),
    };
    const potentialReviewers = {
      getById: jest.fn()
        .mockResolvedValueOnce({
          wmkf_potentialreviewersid: 'pr-1',
          _wmkf_contact_value: null,
          _etag: 'W/"31"',
        })
        .mockResolvedValue({
          wmkf_potentialreviewersid: 'pr-1',
          _wmkf_contact_value: 'contact-new',
          _etag: 'W/"32"',
        }),
      setContactLink: jest.fn(),
      findByContactId: jest.fn(),
    };
    const backProp = jest.fn().mockResolvedValue({ action: 'write' });

    await expect(ensureAcceptedReviewerContact({
      reviewer: {
        wmkf_potentialreviewersid: 'pr-1',
        wmkf_name: 'Jane Reviewer',
        wmkf_firstname: 'Jane',
        wmkf_lastname: 'Reviewer',
        wmkf_emailaddress: 'jane@uni.edu',
        _wmkf_contact_value: null,
      },
      body: {
        address: { line1: '1 Lab Road' },
      },
    }, {
      contacts,
      potentialReviewers,
      backProp,
      notify: jest.fn(),
      deriveContactGuid: jest.fn(() => 'contact-new'),
      claimNewContact: (args) => claimNewAcceptedReviewerContact(args, { runAtomic }),
    })).resolves.toEqual({
      contactId: 'contact-new',
      addressCaptureError: null,
    });

    expect(backProp).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-new',
    }));
    expect(contacts.updateFields).toHaveBeenCalledWith(
      'contact-new',
      expect.objectContaining({ address1_line1: '1 Lab Road' }),
    );
    expect(potentialReviewers.setContactLink).not.toHaveBeenCalled();
  });

  it('preserves the second reviewer as unlinked when an ORCID-scoped Contact is already owned', async () => {
    const linkConflict = Object.assign(new Error('owned'), {
      code: 'contact_linked_elsewhere',
      details: { existingReviewerId: 'pr-winner' },
    });
    const potentialReviewers = {
      getById: jest.fn()
        .mockResolvedValueOnce({
          wmkf_potentialreviewersid: 'pr-loser',
          _wmkf_contact_value: null,
          _etag: 'W/"3"',
        })
        .mockResolvedValueOnce({
          wmkf_potentialreviewersid: 'pr-loser',
          _wmkf_contact_value: null,
          _etag: 'W/"3"',
        }),
      setContactLink: jest.fn().mockRejectedValue(linkConflict),
    };
    const contacts = {
      acceptedReviewerContactPayload: jest.fn(() => ({
        contactid: 'contact-shared',
        lastname: 'Scholar',
        emailaddress1: 'loser@example.edu',
      })),
      getById: jest.fn().mockResolvedValue({
        contactid: 'contact-shared',
        fullname: 'Same Scholar',
        emailaddress1: 'winner@example.edu',
        statecode: 0,
      }),
    };
    const notify = jest.fn().mockResolvedValue({ id: 'alert-1' });

    await expect(claimNewAcceptedReviewerContact({
      reviewer: { wmkf_potentialreviewersid: 'pr-loser', wmkf_name: 'Same Scholar' },
      contactId: 'contact-shared',
      firstName: 'Same',
      lastName: 'Scholar',
      email: 'loser@example.edu',
      orcid: '0000-0002-1825-0097',
      reviewerName: 'Same Scholar',
      contacts,
      potentialReviewers,
      notify,
    }, {
      runAtomic: jest.fn().mockRejectedValue(new Error('duplicate contact primary key')),
    })).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      staffAlerted: true,
      details: expect.objectContaining({ reason: 'contact_linked_elsewhere' }),
    });

    expect(potentialReviewers.setContactLink).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('contact absent, email and ORCID match the same named contact → links it without creating', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: {
            contactid: 'contact-email',
            fullname: 'Jane',
            emailaddress1: 'jane@uni.edu',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: {
            contactid: 'contact-email',
            fullname: 'Jane',
            emailaddress1: 'jane@uni.edu',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findByEmailCandidates).toHaveBeenCalledWith('jane@uni.edu');
    expect(deps.contacts.findByOrcidCandidates).toHaveBeenCalledWith('0000-0002-1825-0097');
    expect(deps.claimNewContact).not.toHaveBeenCalled();
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-email', { actingUserSystemId: undefined });
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
  });

  it('email and ORCID matching different contacts → alerts and preserves the unlinked state', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: {
            contactid: 'contact-email',
            fullname: 'Jane',
            emailaddress1: 'jane@uni.edu',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-orcid',
          row: { contactid: 'contact-orcid', fullname: 'Jane', wmkf_orcid: '0000-0002-1825-0097' },
        }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      retryable: false,
    });

    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'accepted_reviewer_contact_identity_review',
      severity: 'warning',
      category: 'reviewers',
      metadata: expect.objectContaining({
        orcid: '0000-0002-1825-0097',
        potentialReviewerId: 'pr-1',
        reviewerName: 'Jane',
        reason: 'orcid_email_split',
        policyDecision: 'accept_unlinked_staff_review',
      }),
    }));
    expect(deps.potentialReviewers.setContactLink).not.toHaveBeenCalled();
    expect(deps.claimNewContact).not.toHaveBeenCalled();
    expect(deps.requests.create).not.toHaveBeenCalled();
  });

  it('email hit + ORCID uniquely matches the same contact → no split warning', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: {
            contactid: 'contact-email',
            fullname: 'Jane',
            emailaddress1: 'jane@uni.edu',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: {
            contactid: 'contact-email',
            fullname: 'Jane',
            emailaddress1: 'payee@new.edu',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);

    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
  });

  it('email matches a differently named contact → alerts and refuses the link', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-namesake',
          row: { contactid: 'contact-namesake', fullname: 'Another Person' },
        }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
      },
    });
    const args = baseArgs({
      reviewer: {
        _wmkf_contact_value: null,
        wmkf_potentialreviewersid: 'pr-1',
        wmkf_emailaddress: 'jane@uni.edu',
        wmkf_name: 'Jane Reviewer',
      },
    });

    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      details: expect.objectContaining({ reason: 'contact_name_mismatch' }),
    });
    expect(deps.potentialReviewers.setContactLink).not.toHaveBeenCalled();
    expect(deps.claimNewContact).not.toHaveBeenCalled();
  });

  it('email hit + ORCID lookup throws → fails closed before linking or creating', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({
            one: true,
            id: 'contact-email',
            row: { contactid: 'contact-email', fullname: 'Jane', emailaddress1: 'jane@uni.edu' },
          }),
          findByOrcidCandidates: jest.fn().mockRejectedValue(new Error('dataverse 500')),
        },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      await expect(ensureHonorariumOnboarding(args, deps)).rejects.toThrow('dataverse 500');

      expect(deps.potentialReviewers.setContactLink).not.toHaveBeenCalled();
      expect(deps.claimNewContact).not.toHaveBeenCalled();
      expect(deps.requests.create).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('identity-review alert failure remains non-fatal to the fail-closed identity decision', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({
            one: true,
            id: 'contact-email',
            row: { contactid: 'contact-email', fullname: 'Jane', emailaddress1: 'jane@uni.edu' },
          }),
          findByOrcidCandidates: jest.fn().mockResolvedValue({
            one: true,
            id: 'contact-orcid',
            row: { contactid: 'contact-orcid', fullname: 'Jane', wmkf_orcid: '0000-0002-1825-0097' },
          }),
        },
        notify: jest.fn().mockRejectedValue(new Error('postgres down')),
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
        code: 'accepted_reviewer_contact_identity_review_required',
      });

      expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'accepted_reviewer_contact_identity_review',
      }));
      expect(deps.potentialReviewers.setContactLink).not.toHaveBeenCalled();
      expect(deps.requests.create).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('payment email differs from reviewer snapshot → uses corrected email without overwriting contacts.emailaddress1', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: {
            contactid: 'contact-email',
            fullname: 'Jane',
            emailaddress1: 'payee@new.edu',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
      },
    });
    const args = baseArgs({
      reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'old@uni.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' },
      body: { contactEdits: { email: 'payee@new.edu' } },
    });
    const res = await ensureHonorariumOnboarding(args, deps);

    expect(res.created).toBe(true);
    expect(deps.contacts.findByEmailCandidates).toHaveBeenCalledWith('payee@new.edu');
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-email)');
    const contactUpdates = deps.contacts.updateFields.mock.calls;
    expect(contactUpdates.length).toBeGreaterThan(0);
    expect(contactUpdates.some((call) => Object.prototype.hasOwnProperty.call(call[1], 'emailaddress1'))).toBe(false);
  });

  it('email misses but reviewer ORCID uniquely matches a contact → links existing, NO duplicate created', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-orcid',
          row: {
            contactid: 'contact-orcid',
            fullname: 'Jane',
            wmkf_orcid: '0000-0002-1825-0097',
          },
        }),
      },
    });
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
    await ensureHonorariumOnboarding(args, deps);
    expect(deps.contacts.findByOrcidCandidates).toHaveBeenCalledWith('0000-0002-1825-0097');
    expect(deps.claimNewContact).not.toHaveBeenCalled();
    expect(deps.potentialReviewers.setContactLink).toHaveBeenCalledWith('pr-1', 'contact-orcid', { actingUserSystemId: undefined });
    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind']).toBe('/contacts(contact-orcid)');
  });

  it('email misses and ORCID is ambiguous → alerts and does not create a duplicate contact', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ ambiguous: true, count: 2 }),
        },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
        code: 'accepted_reviewer_contact_identity_review_required',
        retryable: false,
      });
      expect(deps.claimNewContact).not.toHaveBeenCalled();
      expect(deps.potentialReviewers.setContactLink).not.toHaveBeenCalled();
      expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'accepted_reviewer_contact_identity_review',
        severity: 'warning',
        category: 'reviewers',
        metadata: expect.objectContaining({
          orcid: '0000-0002-1825-0097',
          reason: 'ambiguous_contact_match',
          potentialReviewerId: 'pr-1',
        }),
      }));
      expect(deps.requests.create).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('inactive-only exact matches require staff review and are never linked', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          ambiguous: true,
          inactiveOnly: true,
          count: 1,
          rows: [{ contactid: 'inactive-contact', statecode: 1 }],
        }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
      },
    });
    const args = baseArgs({
      reviewer: {
        _wmkf_contact_value: null,
        wmkf_potentialreviewersid: 'pr-1',
        wmkf_emailaddress: 'jane@uni.edu',
        wmkf_name: 'Jane Q. Reviewer',
      },
    });

    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      details: expect.objectContaining({ reason: 'inactive_contact_match' }),
    });
    expect(deps.potentialReviewers.setContactLink).not.toHaveBeenCalled();
    expect(deps.claimNewContact).not.toHaveBeenCalled();
    expect(deps.requests.create).not.toHaveBeenCalled();
  });

  it('ambiguous ORCID + review alert failure → still preserves the unlinked state', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ ambiguous: true, count: 2 }),
        },
        notify: jest.fn().mockRejectedValue(new Error('postgres down')),
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
        code: 'accepted_reviewer_contact_identity_review_required',
      });
      expect(deps.notify).toHaveBeenCalled();
      expect(deps.claimNewContact).not.toHaveBeenCalled();
      expect(deps.requests.create).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('ORCID lookup throws → fails closed and retries instead of risking a duplicate', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
          findByOrcidCandidates: jest.fn().mockRejectedValue(new Error('dataverse 500')),
        },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'corrected@new.edu', wmkf_orcid: '0000-0002-1825-0097', wmkf_name: 'Jane' } });
      await expect(ensureHonorariumOnboarding(args, deps)).rejects.toThrow('dataverse 500');
      expect(deps.claimNewContact).not.toHaveBeenCalled();
      expect(deps.requests.create).not.toHaveBeenCalled();
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
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: { contactid: 'contact-email', fullname: 'Jane', emailaddress1: 'jane@uni.edu' },
        }),
        getById: jest.fn(async (contactId) => ({
          contactid: contactId,
          fullname: 'Jane',
          emailaddress1: 'jane@uni.edu',
          statecode: 0,
        })),
        },
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

  it('reconciles an ETag link race and adopts only a validated durable winner', async () => {
    const race = Object.assign(new Error('precondition failed'), { status: 412 });
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: { contactid: 'contact-email', fullname: 'Jane', emailaddress1: 'jane@uni.edu' },
        }),
        getById: jest.fn(async (contactId) => ({
          contactid: contactId,
          fullname: 'Jane',
          emailaddress1: 'jane@uni.edu',
          statecode: 0,
        })),
      },
      potentialReviewers: {
        setContactLink: jest.fn().mockRejectedValue(race),
        getById: jest.fn().mockResolvedValue({
          wmkf_potentialreviewersid: 'pr-1',
          _wmkf_contact_value: 'contact-live',
          _etag: 'W/"2"',
        }),
        findByContactId: jest.fn().mockResolvedValue(null),
      },
    });
    const args = baseArgs({
      reviewer: {
        _wmkf_contact_value: null,
        wmkf_potentialreviewersid: 'pr-1',
        wmkf_emailaddress: 'jane@uni.edu',
        wmkf_name: 'Jane',
      },
    });

    await ensureHonorariumOnboarding(args, deps);

    expect(deps.requests.create.mock.calls[0][0]['akoya_primarycontactid@odata.bind'])
      .toBe('/contacts(contact-live)');
  });

  it('classifies an untyped reverse-link race once as terminal staff review', async () => {
    const deps = makeDeps({
      contacts: {
        findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: { contactid: 'contact-email', fullname: 'Jane', emailaddress1: 'jane@uni.edu' },
        }),
      },
      potentialReviewers: {
        setContactLink: jest.fn().mockRejectedValue(new Error('duplicate lookup key')),
        getById: jest.fn().mockResolvedValue({
          wmkf_potentialreviewersid: 'pr-1',
          _wmkf_contact_value: null,
          _etag: 'W/"2"',
        }),
        findByContactId: jest.fn().mockResolvedValue({
          wmkf_potentialreviewersid: 'pr-other',
          _wmkf_contact_value: 'contact-email',
        }),
      },
    });
    const args = baseArgs({
      reviewer: {
        _wmkf_contact_value: null,
        wmkf_potentialreviewersid: 'pr-1',
        wmkf_emailaddress: 'jane@uni.edu',
        wmkf_name: 'Jane',
      },
    });

    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      staffAlerted: true,
      details: expect.objectContaining({ reason: 'contact_linked_elsewhere' }),
    });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.requests.create).not.toHaveBeenCalled();
  });

  it('setContactLink fails for another reason → aborts before creating an untraceable honorarium', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        contacts: {
          findByEmailCandidates: jest.fn().mockResolvedValue({
          one: true,
          id: 'contact-email',
          row: { contactid: 'contact-email', fullname: 'Jane', emailaddress1: 'jane@uni.edu' },
        }),
        },
        potentialReviewers: { setContactLink: jest.fn().mockRejectedValue(new Error('dataverse 500')) },
      });
      const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_potentialreviewersid: 'pr-1', wmkf_emailaddress: 'jane@uni.edu', wmkf_name: 'Jane' } });
      await expect(ensureHonorariumOnboarding(args, deps)).rejects.toThrow('dataverse 500');
      expect(deps.requests.create).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('no email anywhere → throws a terminal accepted-contact error', async () => {
    const deps = makeDeps();
    const args = baseArgs({ reviewer: { _wmkf_contact_value: null, wmkf_emailaddress: null }, body: { contactEdits: {}, address: {} } });
    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_no_email',
      retryable: false,
    });
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
        findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
        findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
        updateFields: jest.fn().mockRejectedValue(new Error('address PATCH 500')),
      },
    });
    const res = await ensureHonorariumOnboarding(baseArgs(), deps);
    expect(deps.requests.create).toHaveBeenCalled();
    expect(deps.suggestions.setHonorariumRequest).toHaveBeenCalled();
    expect(deps.onboard).toHaveBeenCalled();
    expect(res.honorariumRequestId).toBe(`det-${SUGGESTION_ID}`);
    expect(res.addressCaptureError).toMatch(/address PATCH 500/);
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

  it('ORCID back-prop operational failure retries before honorarium creation', async () => {
    const deps = makeDeps({ backProp: jest.fn().mockRejectedValue(new Error('contact 403')) });
    await expect(ensureHonorariumOnboarding(baseArgs(), deps)).rejects.toThrow('contact 403');
    expect(deps.requests.create).not.toHaveBeenCalled();
    expect(deps.onboard).not.toHaveBeenCalled();
  });

  it('ORCID back-prop conflicts alert once and stop before address or honorarium writes', async () => {
    const deps = makeDeps({
      backProp: jest.fn().mockResolvedValue({
        action: 'conflict',
        existing: '0000-0001-1111-1111',
        incoming: '0000-0002-1825-0097',
      }),
    });
    const args = baseArgs({
      reviewer: {
        wmkf_orcid: '0000-0002-1825-0097',
        wmkf_identitystatus: 'confirmed',
      },
    });

    await expect(ensureHonorariumOnboarding(args, deps)).rejects.toMatchObject({
      code: 'accepted_reviewer_contact_identity_review_required',
      staffAlerted: true,
      details: expect.objectContaining({ reason: 'contact_orcid_conflict' }),
    });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.contacts.updateFields).not.toHaveBeenCalled();
    expect(deps.requests.create).not.toHaveBeenCalled();
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
          findByEmailCandidates: jest.fn().mockResolvedValue({ none: true }),
          findByOrcidCandidates: jest.fn().mockResolvedValue({ none: true }),
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
      expect(deps.claimNewContact).toHaveBeenCalled();
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
    expect(deps.claimNewContact).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-new',
      actingUserSystemId: 'u9',
    }));
  });
});

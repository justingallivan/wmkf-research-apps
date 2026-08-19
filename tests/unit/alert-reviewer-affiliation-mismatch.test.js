/**
 * @jest-environment node
 */

import {
  alertReviewerAffiliationMismatch,
  resolveReviewerAffiliationMismatch,
  reviewerAffiliationMismatchAutoResolveKey,
} from '../../lib/services/alert-reviewer-affiliation-mismatch.js';

function makeDeps(overrides = {}) {
  return {
    contactsAdapter: {
      getInstitutionById: jest.fn().mockResolvedValue({
        contactid: 'contact-1',
        adx_organizationname: 'CRM Free Text Org',
        _parentcustomerid_value_formatted: 'CRM Account Org',
      }),
      ...overrides.contactsAdapter,
    },
    notify: overrides.notify || jest.fn().mockResolvedValue({ id: 'alert-1' }),
    institutionConsistency: overrides.institutionConsistency || {
      areConsistent: jest.fn().mockResolvedValue(false),
    },
    stage2Enabled: overrides.stage2Enabled ?? false,
    stage2Evaluator: overrides.stage2Evaluator || null,
    withDynamicsBypass: overrides.withDynamicsBypass || jest.fn((_label, fn) => fn()),
    warn: overrides.warn || jest.fn(),
  };
}

function baseArgs(overrides = {}) {
  return {
    reviewer: {
      wmkf_potentialreviewersid: 'pr-1',
      wmkf_name: 'Jane Reviewer',
      _wmkf_contact_value: 'contact-pointer',
      ...overrides.reviewer,
    },
    contactId: 'contact-1',
    reviewerAffiliation: 'Reviewer Reported Org',
    suggestionId: 'suggestion-1',
    ...overrides,
  };
}

describe('alertReviewerAffiliationMismatch', () => {
  test('differing reviewer affiliation and contact institution emits reviewer warning alert', async () => {
    const deps = makeDeps();

    const out = await alertReviewerAffiliationMismatch(baseArgs(), deps);

    expect(out).toEqual({ alerted: true });
    expect(deps.withDynamicsBypass).toHaveBeenCalledWith(
      'external-reviewer-affiliation-mismatch-contact-read',
      expect.any(Function),
    );
    expect(deps.contactsAdapter.getInstitutionById).toHaveBeenCalledWith('contact-1');
    expect(deps.notify).toHaveBeenCalledWith({
      type: 'reviewer_contact_affiliation_mismatch',
      severity: 'warning',
      title: 'Reviewer reported a different affiliation than their CRM contact',
      message: expect.stringContaining('Reviewer "Jane Reviewer" accepted reporting affiliation "Reviewer Reported Org"'),
      metadata: {
        potentialReviewerId: 'pr-1',
        contactId: 'contact-1',
        reviewerAffiliation: 'Reviewer Reported Org',
        contactInstitution: 'CRM Account Org',
        suggestionId: 'suggestion-1',
      },
      source: 'external-review-respond',
      category: 'reviewers',
      autoResolveKey: 'reviewer-affiliation-mismatch:pr-1',
    });
    const message = deps.notify.mock.calls[0][0].message;
    expect(message).toContain('The contact/account was not changed automatically');
    expect(message).toContain('NOTE: this may simply be a name variant');
  });

  test('contact with no institution alerts when reviewer reports an affiliation', async () => {
    const deps = makeDeps({
      contactsAdapter: {
        getInstitutionById: jest.fn().mockResolvedValue({
          contactid: 'contact-1',
          adx_organizationname: ' ',
          _parentcustomerid_value_formatted: null,
        }),
      },
    });

    const out = await alertReviewerAffiliationMismatch(baseArgs(), deps);

    expect(out).toEqual({ alerted: true });
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ contactInstitution: null }),
      message: expect.stringContaining('institution "(none)"'),
    }));
  });

  test('matching normalized affiliation and institution skip without alert', async () => {
    const deps = makeDeps({
      contactsAdapter: {
        getInstitutionById: jest.fn().mockResolvedValue({
          contactid: 'contact-1',
          _parentcustomerid_value_formatted: '  university of example. ',
        }),
      },
    });

    const out = await alertReviewerAffiliationMismatch(baseArgs({
      reviewerAffiliation: ' University of Example ',
    }), deps);

    expect(out).toEqual({ skipped: 'match' });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('one-hop associated affiliation is treated as consistent and skips the alert', async () => {
    const deps = makeDeps({
      institutionConsistency: {
        areConsistent: jest.fn().mockResolvedValue(true),
      },
    });

    const out = await alertReviewerAffiliationMismatch(baseArgs({
      reviewerAffiliation: 'Broad Institute',
    }), deps);

    expect(out).toEqual({ skipped: 'match' });
    expect(deps.institutionConsistency.areConsistent).toHaveBeenCalledWith(
      'Broad Institute',
      'CRM Account Org',
    );
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('Stage 2 suppresses a typed compatible pair without consulting the legacy checker', async () => {
    const stage2Evaluator = {
      evaluate: jest.fn().mockResolvedValue({
        presentation: { notify: false, kind: 'compatible' },
      }),
    };
    const deps = makeDeps({ stage2Enabled: true, stage2Evaluator });

    const out = await alertReviewerAffiliationMismatch(baseArgs(), deps);

    expect(out).toEqual({ skipped: 'match', comparison: 'stage2' });
    expect(stage2Evaluator.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      consumer: 'staff_notification',
      evidenceAssertion: expect.objectContaining({
        rawText: 'Reviewer Reported Org',
        sourceType: 'reviewer_self_report',
        currentness: 'current',
        authorSpecific: true,
      }),
      recordedAssertion: expect.objectContaining({
        rawText: 'CRM Account Org',
        sourceType: 'staff_record',
        currentness: 'current',
      }),
    }));
    expect(deps.institutionConsistency.areConsistent).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('Stage 2 sends source-aware current-conflict copy and metadata', async () => {
    const stage2Evaluator = {
      evaluate: jest.fn().mockResolvedValue({
        presentation: {
          notify: true,
          kind: 'current_conflict',
          severity: 'warning',
          title: 'Reviewer reported a current affiliation conflict',
          detail: 'Current evidence lists Reviewer Reported Org; the linked contact lists CRM Account Org.',
          version: 'institution-stage2-presentation/v1',
          relationship: 'distinct',
          evidenceContext: 'current_conflict',
        },
      }),
    };
    const deps = makeDeps({ stage2Enabled: true, stage2Evaluator });

    const out = await alertReviewerAffiliationMismatch(baseArgs(), deps);

    expect(out).toEqual({ alerted: true, comparison: 'stage2', kind: 'current_conflict' });
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reviewer_contact_affiliation_mismatch',
      severity: 'warning',
      title: 'Reviewer reported a current affiliation conflict',
      message: expect.stringContaining('The contact/account was not changed automatically.'),
      metadata: expect.objectContaining({
        presentationVersion: 'institution-stage2-presentation/v1',
        relationship: 'distinct',
        evidenceContext: 'current_conflict',
        stage2Kind: 'current_conflict',
      }),
    }));
  });

  test('Stage 2 failure falls back to the independently available legacy presentation', async () => {
    const stage2Evaluator = {
      evaluate: jest.fn().mockRejectedValue(new Error('Stage 2 unavailable')),
    };
    const deps = makeDeps({ stage2Enabled: true, stage2Evaluator });

    const out = await alertReviewerAffiliationMismatch(baseArgs(), deps);

    expect(out).toEqual({ alerted: true });
    expect(deps.institutionConsistency.areConsistent).toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(
      '[alert-reviewer-affiliation-mismatch] Stage 2 comparison failed; using legacy presentation:',
      'Stage 2 unavailable',
    );
  });

  test('no contact id skips without reading contact', async () => {
    const deps = makeDeps();

    const out = await alertReviewerAffiliationMismatch(baseArgs({
      contactId: null,
      reviewer: { _wmkf_contact_value: null },
    }), deps);

    expect(out).toEqual({ skipped: 'no_contact' });
    expect(deps.contactsAdapter.getInstitutionById).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('empty reviewer affiliation skips without reading contact', async () => {
    const deps = makeDeps();

    const out = await alertReviewerAffiliationMismatch(baseArgs({ reviewerAffiliation: '   ' }), deps);

    expect(out).toEqual({ skipped: 'no_affiliation' });
    expect(deps.contactsAdapter.getInstitutionById).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('notify failure is swallowed and returned as alert_failed', async () => {
    const error = new Error('system_alerts down');
    const deps = makeDeps({ notify: jest.fn().mockRejectedValue(error) });

    const out = await alertReviewerAffiliationMismatch(baseArgs(), deps);

    expect(out).toEqual({ skipped: 'alert_failed' });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.warn).toHaveBeenCalledWith(
      '[alert-reviewer-affiliation-mismatch] alert failed (non-fatal):',
      'system_alerts down',
    );
  });
});

describe('reviewer affiliation mismatch alert lifecycle', () => {
  test('builds the same stable key for alert creation and successful-link cleanup', () => {
    expect(reviewerAffiliationMismatchAutoResolveKey(baseArgs())).toBe(
      'reviewer-affiliation-mismatch:pr-1',
    );
    expect(reviewerAffiliationMismatchAutoResolveKey(baseArgs({
      reviewer: { wmkf_potentialreviewersid: null, _wmkf_contact_value: 'contact-pointer' },
    }))).toBe('reviewer-affiliation-mismatch:contact-1');
  });

  test('calls the stable key to auto-resolve warnings after a successful link', async () => {
    const autoResolve = jest.fn().mockResolvedValue(2);

    await expect(resolveReviewerAffiliationMismatch(baseArgs(), { autoResolve }))
      .resolves.toEqual({
        resolvedCount: 2,
        autoResolveKey: 'reviewer-affiliation-mismatch:pr-1',
      });
    expect(autoResolve).toHaveBeenCalledWith('reviewer-affiliation-mismatch:pr-1');
  });

  test('auto-resolve failure is best-effort and does not reopen the warning path', async () => {
    const warn = jest.fn();
    const autoResolve = jest.fn().mockRejectedValue(new Error('system_alerts unavailable'));

    await expect(resolveReviewerAffiliationMismatch(baseArgs(), { autoResolve, warn }))
      .resolves.toEqual({
        skipped: 'auto_resolve_failed',
        autoResolveKey: 'reviewer-affiliation-mismatch:pr-1',
      });
    expect(warn).toHaveBeenCalledWith(
      '[alert-reviewer-affiliation-mismatch] auto-resolve failed (non-fatal):',
      'system_alerts unavailable',
    );
  });
});

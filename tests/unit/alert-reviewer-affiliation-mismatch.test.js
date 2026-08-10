/**
 * @jest-environment node
 */

import { alertReviewerAffiliationMismatch } from '../../lib/services/alert-reviewer-affiliation-mismatch.js';

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

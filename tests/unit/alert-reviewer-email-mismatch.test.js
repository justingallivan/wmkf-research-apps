/**
 * @jest-environment node
 */

import { alertReviewerEmailMismatch } from '../../lib/services/alert-reviewer-email-mismatch.js';

function makeDeps(overrides = {}) {
  return {
    contactsAdapter: {
      getById: jest.fn().mockResolvedValue({ contactid: 'contact-1', emailaddress1: 'crm@example.edu' }),
      ...overrides.contactsAdapter,
    },
    notify: overrides.notify || jest.fn().mockResolvedValue({ id: 'alert-1' }),
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
    reviewerEmail: 'payee@example.edu',
    suggestionId: 'suggestion-1',
    ...overrides,
  };
}

describe('alertReviewerEmailMismatch', () => {
  test('differing reviewer and contact emails emits reviewer warning alert', async () => {
    const deps = makeDeps();

    const out = await alertReviewerEmailMismatch(baseArgs(), deps);

    expect(out).toEqual({ alerted: true });
    expect(deps.withDynamicsBypass).toHaveBeenCalledWith(
      'external-reviewer-email-mismatch-contact-read',
      expect.any(Function),
    );
    expect(deps.contactsAdapter.getById).toHaveBeenCalledWith('contact-1');
    expect(deps.notify).toHaveBeenCalledWith({
      type: 'reviewer_contact_email_mismatch',
      severity: 'warning',
      title: 'Reviewer used a different email than their CRM contact',
      message: expect.stringContaining('Reviewer "Jane Reviewer" accepted with email payee@example.edu'),
      metadata: {
        potentialReviewerId: 'pr-1',
        contactId: 'contact-1',
        reviewerEmail: 'payee@example.edu',
        contactEmail: 'crm@example.edu',
        suggestionId: 'suggestion-1',
      },
      source: 'external-review-respond',
      category: 'reviewers',
      autoResolveKey: 'reviewer-email-mismatch:pr-1',
    });
  });

  test('matching normalized emails skip without alert', async () => {
    const deps = makeDeps({
      contactsAdapter: {
        getById: jest.fn().mockResolvedValue({ contactid: 'contact-1', emailaddress1: 'CRM@Example.edu ' }),
      },
    });

    const out = await alertReviewerEmailMismatch(baseArgs({ reviewerEmail: ' crm@example.EDU' }), deps);

    expect(out).toEqual({ skipped: 'match' });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('no contact id skips without reading contact', async () => {
    const deps = makeDeps();

    const out = await alertReviewerEmailMismatch(baseArgs({
      contactId: null,
      reviewer: { _wmkf_contact_value: null },
    }), deps);

    expect(out).toEqual({ skipped: 'no_contact' });
    expect(deps.contactsAdapter.getById).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('empty corrected reviewer email skips without reading contact', async () => {
    const deps = makeDeps();

    const out = await alertReviewerEmailMismatch(baseArgs({ reviewerEmail: '   ' }), deps);

    expect(out).toEqual({ skipped: 'no_email' });
    expect(deps.contactsAdapter.getById).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('contact without emailaddress1 skips without alert', async () => {
    const deps = makeDeps({
      contactsAdapter: {
        getById: jest.fn().mockResolvedValue({ contactid: 'contact-1', emailaddress1: '  ' }),
      },
    });

    const out = await alertReviewerEmailMismatch(baseArgs(), deps);

    expect(out).toEqual({ skipped: 'no_contact_email' });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('notify failure is swallowed and returned as alert_failed', async () => {
    const error = new Error('system_alerts down');
    const deps = makeDeps({ notify: jest.fn().mockRejectedValue(error) });

    const out = await alertReviewerEmailMismatch(baseArgs(), deps);

    expect(out).toEqual({ skipped: 'alert_failed' });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.warn).toHaveBeenCalledWith(
      '[alert-reviewer-email-mismatch] alert failed (non-fatal):',
      'system_alerts down',
    );
  });
});

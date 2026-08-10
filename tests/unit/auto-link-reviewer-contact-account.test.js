/**
 * @jest-environment node
 */

import { autoLinkReviewerContactAccount } from '../../lib/services/auto-link-reviewer-contact-account.js';

function makeDeps({ contact = {}, accounts = [], currentAccount, capped = false, totalCount } = {}) {
  return {
    contactsAdapter: {
      getInstitutionById: jest.fn().mockResolvedValue({
        contactid: 'contact-1',
        _parentcustomerid_value: null,
        _etag: 'W/"1"',
        ...contact,
      }),
      setParentAccountIfEmpty: jest.fn().mockResolvedValue({
        action: 'write',
        accountId: 'account-1',
      }),
    },
    accountsAdapter: {
      queryAllAccounts: jest.fn().mockResolvedValue({ records: accounts, capped, totalCount }),
      getById: jest.fn().mockResolvedValue(currentAccount || accounts[0] || null),
    },
    withDalContext: jest.fn((_label, fn) => fn()),
  };
}

function args(overrides = {}) {
  return {
    reviewer: { _wmkf_contact_value: 'contact-pointer' },
    contactId: 'contact-1',
    reviewerAffiliation: 'Florida International University',
    trustedAcceptance: true,
    ...overrides,
  };
}

describe('autoLinkReviewerContactAccount', () => {
  test('requires the explicit acceptance trust boundary', async () => {
    await expect(autoLinkReviewerContactAccount(args({ trustedAcceptance: false }), makeDeps()))
      .rejects.toMatchObject({
        code: 'reviewer_contact_account_untrusted_caller',
        retryable: false,
      });
  });

  test('links an empty Contact when one active Account matches an AKA exactly', async () => {
    const account = {
      accountid: 'account-1',
      name: 'The Florida International University Board',
      akoya_aka: 'Florida International University',
      statecode: 0,
    };
    const deps = makeDeps({ accounts: [account], currentAccount: account });

    const out = await autoLinkReviewerContactAccount(args(), deps);

    expect(out).toMatchObject({
      linked: true,
      alreadyLinked: false,
      contactId: 'contact-1',
      accountId: 'account-1',
      accountName: 'The Florida International University Board',
    });
    expect(deps.accountsAdapter.queryAllAccounts).toHaveBeenCalledWith({
      select: 'accountid,name,akoya_aka,wmkf_legalname,wmkf_dc_aka,statecode',
      filter: 'statecode eq 0',
      orderby: 'name asc',
    });
    expect(deps.contactsAdapter.setParentAccountIfEmpty)
      .toHaveBeenCalledWith('contact-1', 'account-1', { actingUserSystemId: undefined });
  });

  test('abstains on duplicate exact targets', async () => {
    const deps = makeDeps({
      accounts: [
        { accountid: 'account-1', name: 'Florida International University', statecode: 0 },
        { accountid: 'account-2', akoya_aka: 'Florida International University', name: 'FIU Foundation', statecode: 0 },
      ],
    });

    const out = await autoLinkReviewerContactAccount(args(), deps);

    expect(out).toMatchObject({ skipped: 'ambiguous_exact_targets', targetCount: 2 });
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
    expect(deps.accountsAdapter.getById).not.toHaveBeenCalled();
  });

  test('abstains when no Account label matches', async () => {
    const deps = makeDeps({
      accounts: [{ accountid: 'account-1', name: 'Another University', statecode: 0 }],
    });

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toMatchObject({
      skipped: 'no_exact_target',
      targetCount: 0,
    });
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });

  test('does not scan Accounts when the Contact already has a parent', async () => {
    const deps = makeDeps({
      contact: { _parentcustomerid_value: 'existing-account' },
    });

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toEqual({
      skipped: 'parent_already_populated',
      parentAccountId: 'existing-account',
    });
    expect(deps.accountsAdapter.queryAllAccounts).not.toHaveBeenCalled();
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });

  test('preserves an existing parent Contact without treating it as an Account', async () => {
    const deps = makeDeps({
      contact: {
        _parentcustomerid_value: 'parent-contact',
        _parentcustomerid_value_entity: 'contact',
      },
    });

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toEqual({
      skipped: 'parent_already_populated',
      parentAccountId: 'parent-contact',
    });
    expect(deps.accountsAdapter.getById).not.toHaveBeenCalled();
    expect(deps.accountsAdapter.queryAllAccounts).not.toHaveBeenCalled();
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });

  test('preserves an untyped existing parent when it is not an Account row', async () => {
    const deps = makeDeps({
      contact: { _parentcustomerid_value: 'legacy-parent' },
    });
    deps.accountsAdapter.getById.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { status: 404 }),
    );

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toEqual({
      skipped: 'parent_already_populated',
      parentAccountId: 'legacy-parent',
    });
    expect(deps.accountsAdapter.queryAllAccounts).not.toHaveBeenCalled();
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });

  test('recognizes an existing parent through the same AKA rule on job retry', async () => {
    const parent = {
      accountid: 'existing-account',
      name: 'FIU Board of Trustees',
      akoya_aka: 'Florida International University',
      statecode: 0,
    };
    const deps = makeDeps({
      contact: { _parentcustomerid_value: 'existing-account' },
      currentAccount: parent,
    });

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toEqual({
      linked: false,
      alreadyLinked: true,
      contactId: 'contact-1',
      accountId: 'existing-account',
      accountName: 'FIU Board of Trustees',
    });
    expect(deps.accountsAdapter.queryAllAccounts).not.toHaveBeenCalled();
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });

  test('abstains rather than writing or retrying from a capped Account population', async () => {
    const deps = makeDeps({
      accounts: [{ accountid: 'account-1', name: 'Florida International University', statecode: 0 }],
      capped: true,
      totalCount: 5001,
    });

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toEqual({
      skipped: 'account_scan_capped',
      scannedCount: 1,
      totalCount: 5001,
    });
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });

  test('rechecks the selected Account immediately before the Contact write', async () => {
    const deps = makeDeps({
      accounts: [{ accountid: 'account-1', name: 'Florida International University', statecode: 0 }],
      currentAccount: { accountid: 'account-1', name: 'Renamed University', statecode: 0 },
    });

    await expect(autoLinkReviewerContactAccount(args(), deps)).resolves.toEqual({
      skipped: 'target_changed_before_write',
      accountId: 'account-1',
    });
    expect(deps.contactsAdapter.setParentAccountIfEmpty).not.toHaveBeenCalled();
  });
});

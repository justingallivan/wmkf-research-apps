/**
 * actingUserSystemId pass-through coverage for the Dataverse adapters and
 * token-lifecycle helpers. Each adapter write should forward the opt down to
 * `DynamicsService.updateRecord` / `createRecord` so MSCRMCallerID lands on
 * the audit trail when the feature flag is on.
 *
 * Reads (queryRecords, getRecord) intentionally don't carry the header —
 * impersonating reads breaks callers whose Dynamics role is narrower than the
 * service principal's.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as contactAdapter from '../../lib/dataverse/adapters/contact.js';
import * as potentialReviewerAdapter from '../../lib/dataverse/adapters/potential-reviewer.js';
import * as researcherAdapter from '../../lib/dataverse/adapters/researcher.js';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { mintAndStore, revoke, ensureToken, extendForPostSubmissionWindow } from '../../lib/external/token-lifecycle.js';

const ACTING = '00000000-0000-0000-0000-000000000abc';
const PR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RESEARCHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUGGESTION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CONTACT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

let original;

function lastCallOpts(mockFn) {
  const calls = mockFn.mock.calls;
  if (calls.length === 0) return undefined;
  const last = calls[calls.length - 1];
  return last[last.length - 1];
}

beforeEach(() => {
  original = {
    queryRecords: DynamicsService.queryRecords,
    getRecord: DynamicsService.getRecord,
    createRecord: DynamicsService.createRecord,
    updateRecord: DynamicsService.updateRecord,
  };
  DynamicsService.queryRecords = jest.fn().mockResolvedValue({ records: [] });
  DynamicsService.getRecord = jest.fn().mockResolvedValue(null);
  DynamicsService.createRecord = jest.fn().mockResolvedValue({});
  DynamicsService.updateRecord = jest.fn().mockResolvedValue({});

  process.env.EXTERNAL_LINK_SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
  process.env.NEXTAUTH_URL = 'https://reviewer.example.com';
});

afterEach(() => {
  DynamicsService.queryRecords = original.queryRecords;
  DynamicsService.getRecord = original.getRecord;
  DynamicsService.createRecord = original.createRecord;
  DynamicsService.updateRecord = original.updateRecord;
});

describe('contact adapter', () => {
  test('findOrCreateByEmail (create path) forwards actingUserSystemId', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    DynamicsService.createRecord.mockResolvedValue({ contactid: CONTACT_ID });

    await contactAdapter.findOrCreateByEmail(
      { firstName: 'A', lastName: 'B', email: 'a@b.org' },
      { actingUserSystemId: ACTING },
    );

    expect(lastCallOpts(DynamicsService.createRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('findOrCreateByEmail (existing path) does not call createRecord', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [{ contactid: CONTACT_ID }] });

    await contactAdapter.findOrCreateByEmail(
      { firstName: 'A', lastName: 'B', email: 'a@b.org' },
      { actingUserSystemId: ACTING },
    );

    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  });

  test('acceptedReviewerContactPayload requires a surname and preserves the deterministic id', () => {
    expect(contactAdapter.acceptedReviewerContactPayload({
      contactId: CONTACT_ID,
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.org',
    })).toEqual({
      contactid: CONTACT_ID,
      firstname: 'A',
      lastname: 'B',
      emailaddress1: 'a@b.org',
    });
    expect(() => contactAdapter.acceptedReviewerContactPayload({
      contactId: CONTACT_ID,
      firstName: 'Ada',
      lastName: null,
      email: 'ada@example.org',
    })).toThrow('lastName required');
  });
});

describe('potential-reviewer adapter', () => {
  test('upsertByEmail (existing path) forwards on update', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{ wmkf_potentialreviewersid: PR_ID, wmkf_name: null, wmkf_emailaddress: 'a@b.org', statecode: 0 }],
    });
    await potentialReviewerAdapter.upsertByEmail(
      { name: 'Alice', email: 'a@b.org' },
      { actingUserSystemId: ACTING },
    );
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('upsertByEmail (create path) forwards on create', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    DynamicsService.createRecord.mockResolvedValue({ wmkf_potentialreviewersid: PR_ID });
    await potentialReviewerAdapter.upsertByEmail(
      { name: 'Alice', email: 'a@b.org' },
      { actingUserSystemId: ACTING },
    );
    expect(lastCallOpts(DynamicsService.createRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('update forwards', async () => {
    await potentialReviewerAdapter.update(PR_ID, { name: 'Bob' }, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('setContactLink forwards', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_potentialreviewersid: PR_ID,
      _wmkf_contact_value: null,
      _etag: 'W/"17"',
    });
    await potentialReviewerAdapter.setContactLink(PR_ID, CONTACT_ID, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({
      actingUserSystemId: ACTING,
      ifMatch: 'W/"17"',
    });
  });

  test('omitting opts yields actingUserSystemId: undefined (header suppressed in DynamicsService)', async () => {
    await potentialReviewerAdapter.update(PR_ID, { name: 'Bob' });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: undefined });
  });
});

describe('researcher adapter', () => {
  test('upsertByPotentialReviewer (existing path) forwards on update', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{ wmkf_appresearcherid: RESEARCHER_ID }],
    });
    await researcherAdapter.upsertByPotentialReviewer(
      PR_ID,
      { name: 'Alice', hIndex: 10 },
      { actingUserSystemId: ACTING },
    );
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  // S213 collapse: upsertByPotentialReviewer no longer has a create path (it
  // writes bibliometrics onto the existing person via updateRecord). The
  // existing-path test above + updateById below cover caller-id forwarding.

  test('updateById forwards', async () => {
    await researcherAdapter.updateById(RESEARCHER_ID, { hIndex: 12 }, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });
});

describe('reviewer-suggestion adapter', () => {
  test('upsert (existing path) forwards on update', async () => {
    DynamicsService.queryRecords.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_selected: false,
        _etag: 'W/"upsert"',
      }],
    });
    await suggestionAdapter.upsert(
      { potentialReviewerId: PR_ID, requestId: REQUEST_ID, suggestionLabel: 'X' },
      { actingUserSystemId: ACTING },
    );
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({
      actingUserSystemId: ACTING,
      ifMatch: 'W/"upsert"',
    });
  });

  test('upsert (create path) forwards on create', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    DynamicsService.createRecord.mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    await suggestionAdapter.upsert(
      { potentialReviewerId: PR_ID, requestId: REQUEST_ID, suggestionLabel: 'X' },
      { actingUserSystemId: ACTING },
    );
    expect(lastCallOpts(DynamicsService.createRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('updateLifecycle forwards', async () => {
    await suggestionAdapter.updateLifecycle(SUGGESTION_ID, { notes: 'x' }, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('softDelete forwards', async () => {
    await suggestionAdapter.softDelete(SUGGESTION_ID, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('softDelete clears engagement flags and revokes token in one PATCH', async () => {
    await suggestionAdapter.softDelete(SUGGESTION_ID, { actingUserSystemId: ACTING, alsoRevokeToken: true });

    expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1);
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      {
        wmkf_selected: false,
        wmkf_accepted: false,
        wmkf_declined: false,
        wmkf_responsetype: null,
        wmkf_reviewstatus: null,
        wmkf_heldat: null,
        wmkf_externaltokenrevoked: true,
      },
      { actingUserSystemId: ACTING },
    );
  });

  test('setRequestMetadata forwards to every per-row update', async () => {
    // Stage 7 inlined the former bulkUpdateByRequest loop into
    // setRequestMetadata (docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md); this
    // pin moves onto the surviving whitelisted op with the same per-row
    // actingUserSystemId-forwarding assertion.
    DynamicsService.queryRecords.mockResolvedValue({
      records: [
        { wmkf_appreviewersuggestionid: 'row-1' },
        { wmkf_appreviewersuggestionid: 'row-2' },
      ],
    });
    const updated = await suggestionAdapter.setRequestMetadata(
      REQUEST_ID,
      { programArea: 'Health' },
      { actingUserSystemId: ACTING },
    );
    expect(updated).toBe(2);
    expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(2);
    for (const call of DynamicsService.updateRecord.mock.calls) {
      expect(call[3]).toEqual({ actingUserSystemId: ACTING });
    }
  });
});

describe('token-lifecycle', () => {
  test('mintAndStore forwards', async () => {
    await mintAndStore({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      expiresAt: new Date(Date.now() + 60_000),
      actingUserSystemId: ACTING,
    });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('revoke forwards', async () => {
    await revoke(SUGGESTION_ID, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('extendForPostSubmissionWindow forwards', async () => {
    await extendForPostSubmissionWindow(SUGGESTION_ID, { actingUserSystemId: ACTING });
    expect(lastCallOpts(DynamicsService.updateRecord)).toEqual({ actingUserSystemId: ACTING });
  });

  test('ensureToken (mints) forwards through to mintAndStore', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_externaltokenhash: null,
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: null,
      _wmkf_request_value: REQUEST_ID,
    });
    const result = await ensureToken(SUGGESTION_ID, { actingUserSystemId: ACTING });
    expect(result.minted).toBe(true);
    // First updateRecord call is the mint write — should carry the header opt.
    expect(DynamicsService.updateRecord.mock.calls[0][3]).toEqual({ actingUserSystemId: ACTING });
  });

  test('ensureToken (already active) writes nothing', async () => {
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_externaltokenhash: 'existing-hash',
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: new Date(Date.now() + 86_400_000).toISOString(),
      _wmkf_request_value: REQUEST_ID,
    });
    const result = await ensureToken(SUGGESTION_ID, { actingUserSystemId: ACTING });
    expect(result.minted).toBe(false);
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});

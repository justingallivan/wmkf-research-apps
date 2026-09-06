/**
 * @jest-environment node
 *
 * Stage 5A narrow document-pointer / thank-you claim operations.
 * Byte-identical transport call to patchReviewReceipt/patchFields (same
 * DynamicsService.updateRecord shape) so the 412 behavior their callers
 * depend on (commitPointers retry/readback; sweep claimFailed++) is
 * unchanged — see docs/REVIEWER_LIFECYCLE_STAGE5_BUILD_PLAN.md.
 *
 * Also covers Stage 7's `expireInvitationResponse` (7C,
 * docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md), a named op replacing the
 * expiry sweep's former inline `patchFields` call with the same transport.
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  attachReviewDocumentPointer,
  claimThankYou,
  expireInvitationResponse,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { RESPONSE_TYPE_MAP } from '../../shared/config/reviewerLifecycle.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('attachReviewDocumentPointer', () => {
  it('PATCHes exactly the pointer fields and forwards ifMatch + extra opts', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await attachReviewDocumentPointer(
      SUGGESTION_ID,
      { folder: '2026/D26', filename: 'review-1.docx' },
      { ifMatch: 'W/"1"', actingUserSystemId: 'user-1' },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      { wmkf_reviewsharepointfolder: '2026/D26', wmkf_reviewfilename: 'review-1.docx' },
      { ifMatch: 'W/"1"', actingUserSystemId: 'user-1' },
    );
  });

  it('ignores extra keys smuggled alongside folder/filename (signature only accepts the two)', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await attachReviewDocumentPointer(
      SUGGESTION_ID,
      { folder: 'f', filename: 'n', wmkf_notes: 'smuggled' },
      { ifMatch: 'W/"1"' },
    );
    const [, , payload] = spy.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['wmkf_reviewfilename', 'wmkf_reviewsharepointfolder']);
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
    ['non-string', 123],
    ['wildcard', '*'],
    ['empty weak quotes', 'W/""'],
    ['whitespace-padded', ' "1" '],
    ['unquoted', 'abc'],
  ])('throws missing_version (400) before any transport call when ifMatch is %s', async (_label, badIfMatch) => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await expect(
      attachReviewDocumentPointer(SUGGESTION_ID, { folder: 'f', filename: 'n' }, { ifMatch: badIfMatch }),
    ).rejects.toMatchObject({ status: 400, code: 'missing_version' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('claimThankYou', () => {
  it('PATCHes exactly wmkf_thankyousentat and forwards ifMatch + extra opts', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const sentAtIso = '2026-09-05T12:00:00.000Z';
    await claimThankYou(SUGGESTION_ID, sentAtIso, { ifMatch: 'W/"9"', actingUserSystemId: 'user-2' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      { wmkf_thankyousentat: sentAtIso },
      { ifMatch: 'W/"9"', actingUserSystemId: 'user-2' },
    );
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
    ['non-string', 123],
    ['wildcard', '*'],
    ['empty weak quotes', 'W/""'],
    ['whitespace-padded', ' "1" '],
    ['unquoted', 'abc'],
  ])('throws missing_version (400) before any transport call when ifMatch is %s', async (_label, badIfMatch) => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await expect(
      claimThankYou(SUGGESTION_ID, '2026-09-05T12:00:00.000Z', { ifMatch: badIfMatch }),
    ).rejects.toMatchObject({ status: 400, code: 'missing_version' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('expireInvitationResponse', () => {
  // Reviewer Lifecycle Stage 7 (7C): codifies the sweep's own concrete-ETag
  // guarantee as this op's contract (see expire-invitation.js's callers,
  // which never reach this op without a validated `_etag`). Transport call
  // is byte-identical to the sweep's former inline patchFields call.
  it('PATCHes exactly the no_response fields and forwards ifMatch + extra opts, matching the former patchFields transport', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const nowIso = '2026-09-05T12:00:00.000Z';
    await expireInvitationResponse(SUGGESTION_ID, nowIso, { ifMatch: 'W/"7"', actingUserSystemId: 'user-3' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      { wmkf_responsetype: RESPONSE_TYPE_MAP.no_response, wmkf_responsereceivedat: nowIso },
      { ifMatch: 'W/"7"', actingUserSystemId: 'user-3' },
    );
  });

  it('writes only the two response fields (no other field is ever included)', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await expireInvitationResponse(SUGGESTION_ID, '2026-09-05T12:00:00.000Z', { ifMatch: 'W/"7"' });
    const [, , payload] = spy.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['wmkf_responsereceivedat', 'wmkf_responsetype']);
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
    ['non-string', 123],
    ['wildcard', '*'],
    ['empty weak quotes', 'W/""'],
    ['whitespace-padded', ' "1" '],
    ['unquoted', 'abc'],
  ])('throws missing_version (400) before any transport call when ifMatch is %s', async (_label, badIfMatch) => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await expect(
      expireInvitationResponse(SUGGESTION_ID, '2026-09-05T12:00:00.000Z', { ifMatch: badIfMatch }),
    ).rejects.toMatchObject({ status: 400, code: 'missing_version' });
    expect(spy).not.toHaveBeenCalled();
  });
});

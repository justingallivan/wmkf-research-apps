/**
 * @jest-environment node
 *
 * Direct tests for lib/services/reviewer-engagement/record-invitation.js
 * (Reviewer Lifecycle Stage 3F). Each of the three exported functions is a
 * verbatim move of exactly one write call from its own caller; these tests
 * pin the exact updates object and options passed to the adapter, and that
 * errors propagate unchanged with no validation added.
 */

const updateLifecycle = jest.fn(async () => {});
const patchFields = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...a) => updateLifecycle(...a),
  patchFields: (...a) => patchFields(...a),
}));

const {
  recordDeliveredInvitation,
  recordManualInvitation,
  markInvitationGenerated,
} = require('../../lib/services/reviewer-engagement/record-invitation');

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recordDeliveredInvitation', () => {
  test('calls updateLifecycle with invited/emailSentAt/respondReminderSentAt and actingUserSystemId only, no ifMatch', async () => {
    await recordDeliveredInvitation({ suggestionId: SUGGESTION_ID, actingUserSystemId: 'u-1' });

    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    const [id, updates, options] = updateLifecycle.mock.calls[0];
    expect(id).toBe(SUGGESTION_ID);
    expect(updates).toEqual({
      invited: true,
      emailSentAt: expect.any(String),
      respondReminderSentAt: null,
    });
    expect(options).toEqual({ actingUserSystemId: 'u-1' });
    expect(Object.prototype.hasOwnProperty.call(options, 'ifMatch')).toBe(false);
  });

  test('a rejection propagates unchanged', async () => {
    const err = Object.assign(new Error('write failed'), { status: 500 });
    updateLifecycle.mockRejectedValueOnce(err);

    await expect(recordDeliveredInvitation({ suggestionId: SUGGESTION_ID, actingUserSystemId: 'u-1' }))
      .rejects.toBe(err);
  });
});

describe('recordManualInvitation', () => {
  test('calls updateLifecycle with invited/emailSentAt (as given)/respondReminderSentAt and actingUserSystemId+ifMatch', async () => {
    await recordManualInvitation({
      suggestionId: SUGGESTION_ID,
      emailSentAt: '2026-09-06T00:00:00.000Z',
      ifMatch: 'W/"7"',
      actingUserSystemId: 'u-1',
    });

    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    expect(updateLifecycle).toHaveBeenCalledWith(
      SUGGESTION_ID,
      { invited: true, emailSentAt: '2026-09-06T00:00:00.000Z', respondReminderSentAt: null },
      { actingUserSystemId: 'u-1', ifMatch: 'W/"7"' },
    );
  });

  test('a 412 rejection propagates unchanged (caller maps it to stale_manual_link)', async () => {
    const err = Object.assign(new Error('precondition failed'), { status: 412 });
    updateLifecycle.mockRejectedValueOnce(err);

    await expect(recordManualInvitation({
      suggestionId: SUGGESTION_ID,
      emailSentAt: '2026-09-06T00:00:00.000Z',
      ifMatch: 'W/"7"',
      actingUserSystemId: 'u-1',
    })).rejects.toBe(err);
  });
});

describe('markInvitationGenerated', () => {
  test('calls patchFields with exactly the raw fields and no options', async () => {
    await markInvitationGenerated({ suggestionId: SUGGESTION_ID, now: '2026-09-06T00:00:00.000Z' });

    expect(patchFields).toHaveBeenCalledTimes(1);
    expect(patchFields.mock.calls[0]).toEqual([
      SUGGESTION_ID,
      { wmkf_emailsentat: '2026-09-06T00:00:00.000Z', wmkf_invited: true },
    ]);
  });

  test('a rejection propagates unchanged', async () => {
    const err = new Error('dataverse down');
    patchFields.mockRejectedValueOnce(err);

    await expect(markInvitationGenerated({ suggestionId: SUGGESTION_ID, now: '2026-09-06T00:00:00.000Z' }))
      .rejects.toBe(err);
  });
});

describe('module surface', () => {
  test('exports exactly the three distinct functions', () => {
    const mod = require('../../lib/services/reviewer-engagement/record-invitation');
    expect(Object.keys(mod).sort()).toEqual([
      'markInvitationGenerated',
      'recordDeliveredInvitation',
      'recordManualInvitation',
    ]);
    expect(typeof mod.recordDeliveredInvitation).toBe('function');
    expect(typeof mod.recordManualInvitation).toBe('function');
    expect(typeof mod.markInvitationGenerated).toBe('function');
    expect(mod.recordDeliveredInvitation).not.toBe(mod.recordManualInvitation);
    expect(mod.recordDeliveredInvitation).not.toBe(mod.markInvitationGenerated);
    expect(mod.recordManualInvitation).not.toBe(mod.markInvitationGenerated);
  });
});

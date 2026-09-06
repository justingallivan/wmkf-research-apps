/** @jest-environment node */

/**
 * Direct tests for `reviewer-engagement/withdraw-pending-invitation.js`
 * (Stage 3 build plan, slice 3I). Pins the exact updates object and options
 * passed to the adapter's `updateLifecycle`, and that both a 412 and any
 * other thrown error propagate unchanged (mapping to `changed_skipped` /
 * `write_failed` is the caller's job, not this module's).
 */

const mockUpdateLifecycle = jest.fn();

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  updateLifecycle: (...args) => mockUpdateLifecycle(...args),
}));

const { withdrawPendingInvitation } = require('../../lib/services/reviewer-engagement/withdraw-pending-invitation');

describe('withdrawPendingInvitation', () => {
  beforeEach(() => {
    mockUpdateLifecycle.mockReset();
  });

  it('calls updateLifecycle with the exact updates object and options', async () => {
    mockUpdateLifecycle.mockResolvedValueOnce(undefined);

    await withdrawPendingInvitation({
      id: 'suggestion-1',
      nowIso: '2026-09-06T00:00:00.000Z',
      ifMatch: 'W/"etag-1"',
      actingUserSystemId: 'user-1',
    });

    expect(mockUpdateLifecycle).toHaveBeenCalledTimes(1);
    expect(mockUpdateLifecycle).toHaveBeenCalledWith(
      'suggestion-1',
      {
        responseType: 'withdrawn_sufficient',
        withdrawnSufficientAt: '2026-09-06T00:00:00.000Z',
        respondReminderSentAt: null,
      },
      { actingUserSystemId: 'user-1', ifMatch: 'W/"etag-1"' },
    );
  });

  it('propagates a 412 error unchanged (no mapping in this module)', async () => {
    const err = new Error('Precondition Failed: 412');
    err.status = 412;
    mockUpdateLifecycle.mockRejectedValueOnce(err);

    await expect(withdrawPendingInvitation({
      id: 'suggestion-2',
      nowIso: '2026-09-06T00:00:00.000Z',
      ifMatch: 'W/"etag-2"',
      actingUserSystemId: 'user-1',
    })).rejects.toBe(err);
  });

  it('propagates a non-412 error unchanged', async () => {
    const err = new Error('boom');
    mockUpdateLifecycle.mockRejectedValueOnce(err);

    await expect(withdrawPendingInvitation({
      id: 'suggestion-3',
      nowIso: '2026-09-06T00:00:00.000Z',
      ifMatch: 'W/"etag-3"',
      actingUserSystemId: 'user-1',
    })).rejects.toBe(err);
  });

  it('adds no validation beyond the adapter call (undefined ifMatch passes through)', async () => {
    mockUpdateLifecycle.mockResolvedValueOnce(undefined);

    await withdrawPendingInvitation({
      id: 'suggestion-4',
      nowIso: '2026-09-06T00:00:00.000Z',
      ifMatch: undefined,
      actingUserSystemId: null,
    });

    expect(mockUpdateLifecycle).toHaveBeenCalledWith(
      'suggestion-4',
      {
        responseType: 'withdrawn_sufficient',
        withdrawnSufficientAt: '2026-09-06T00:00:00.000Z',
        respondReminderSentAt: null,
      },
      { actingUserSystemId: null, ifMatch: undefined },
    );
  });
});

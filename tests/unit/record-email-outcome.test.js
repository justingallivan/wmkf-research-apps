/**
 * @jest-environment node
 *
 * Direct unit tests for lib/services/reviewer-engagement/record-email-outcome.js
 * (Reviewer Lifecycle Stage 3E). recordDeliveredEmail is exercised through its
 * exported contract with a mocked reviewer-suggestion adapter — this is the
 * new-path implementation test the plan requires ("do not progress on
 * wrapper-only passing tests").
 */

const findById = jest.fn();
const updateLifecycle = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));

const { recordDeliveredEmail } = require('../../lib/services/reviewer-engagement/record-email-outcome');

const SUGGESTION_ID = 'sug-1';
const REQUEST_ID = 'req-1';
const REVIEWER_ID = 'rev-1';
const ETAG = 'W/"fresh-1"';
const SENT_AT = '2026-09-05T12:00:00.000Z';

function original(overrides = {}) {
  return {
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: REVIEWER_ID,
    ...overrides,
  };
}

function fresh(overrides = {}) {
  return {
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: REVIEWER_ID,
    _etag: ETAG,
    wmkf_reviewstatus: null,
    wmkf_completedat: null,
    wmkf_reviewreceivedat: null,
    wmkf_remindercount: 0,
    wmkf_materialssentat: null,
    wmkf_remindersentat: null,
    wmkf_thankyousentat: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(fresh());
  updateLifecycle.mockResolvedValue(undefined);
});

describe('recordDeliveredEmail', () => {
  it('throws for an unsupported template type', async () => {
    await expect(recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'bogus',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    })).rejects.toThrow('Unsupported post-send template: bogus');
    expect(findById).not.toHaveBeenCalled();
  });

  it('throws when the suggestion is no longer available', async () => {
    findById.mockResolvedValue(null);
    await expect(recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    })).rejects.toThrow('Suggestion is no longer available');
  });

  it.each(['_wmkf_request_value', '_wmkf_potentialreviewer_value'])(
    'throws when %s changed (binding change)',
    async (lookup) => {
      findById.mockResolvedValue(fresh({ [lookup]: 'different-id' }));
      await expect(recordDeliveredEmail({
        suggestionId: SUGGESTION_ID,
        originalSuggestion: original(),
        templateType: 'materials',
        sentAt: SENT_AT,
        actingUserSystemId: 'staff-1',
      })).rejects.toThrow('Suggestion request or reviewer binding changed after delivery');
    },
  );

  it.each([undefined, null, '', '  ', 'no-quotes', '*'])(
    'throws for a missing or malformed _etag (%p)',
    async (etag) => {
      findById.mockResolvedValue(fresh({ _etag: etag }));
      await expect(recordDeliveredEmail({
        suggestionId: SUGGESTION_ID,
        originalSuggestion: original(),
        templateType: 'materials',
        sentAt: SENT_AT,
        actingUserSystemId: 'staff-1',
      })).rejects.toThrow('Suggestion version is unavailable for email bookkeeping');
    },
  );

  it.each(['materials', 'followup'])(
    'throws for a closed suggestion (%s)',
    async (templateType) => {
      findById.mockResolvedValue(fresh({ wmkf_completedat: '2026-01-01T00:00:00.000Z' }));
      await expect(recordDeliveredEmail({
        suggestionId: SUGGESTION_ID,
        originalSuggestion: original(),
        templateType,
        sentAt: SENT_AT,
        actingUserSystemId: 'staff-1',
      })).rejects.toThrow('Suggestion is closed or has an unknown review status');
    },
  );

  it.each(['materials', 'followup'])(
    'throws for an unknown/unmapped review status (%s)',
    async (templateType) => {
      findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 999999999 }));
      await expect(recordDeliveredEmail({
        suggestionId: SUGGESTION_ID,
        originalSuggestion: original(),
        templateType,
        sentAt: SENT_AT,
        actingUserSystemId: 'staff-1',
      })).rejects.toThrow('Suggestion is closed or has an unknown review status');
    },
  );

  it('does not throw for a closed/unknown-status thankyou (courtesy bookkeeping)', async () => {
    findById.mockResolvedValue(fresh({ wmkf_completedat: '2026-01-01T00:00:00.000Z', wmkf_reviewstatus: 999999999 }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'thankyou',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { thankYouSentAt: SENT_AT }, {
      actingUserSystemId: 'staff-1',
      ifMatch: ETAG,
    });
  });

  it('materials: bumps reviewStatus to materials_sent when status is null and not received', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: null }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, {
      materialsSentAt: SENT_AT,
      reviewStatus: 'materials_sent',
    }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
  });

  it('materials: bumps reviewStatus to materials_sent when status is accepted (100000000) and not received', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 100000000 }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, {
      materialsSentAt: SENT_AT,
      reviewStatus: 'materials_sent',
    }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
  });

  it('materials: does not bump status when already received', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 100000000, wmkf_reviewreceivedat: '2026-01-01T00:00:00.000Z' }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { materialsSentAt: SENT_AT }, {
      actingUserSystemId: 'staff-1',
      ifMatch: ETAG,
    });
  });

  it('materials: does not bump status when status is materials_sent already (not null/accepted)', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 100000001 }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { materialsSentAt: SENT_AT }, {
      actingUserSystemId: 'staff-1',
      ifMatch: ETAG,
    });
  });

  it('followup: increments reminderCount and bumps under_review when accepted and not received', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 100000000, wmkf_remindercount: 2 }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'followup',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, {
      reminderSentAt: SENT_AT,
      reminderCount: 3,
      reviewStatus: 'under_review',
    }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
  });

  it('followup: increments reminderCount and bumps under_review when materials_sent and not received', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 100000001, wmkf_remindercount: 0 }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'followup',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, {
      reminderSentAt: SENT_AT,
      reminderCount: 1,
      reviewStatus: 'under_review',
    }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
  });

  it('followup: does not bump status when already received', async () => {
    findById.mockResolvedValue(fresh({ wmkf_reviewstatus: 100000000, wmkf_reviewreceivedat: '2026-01-01T00:00:00.000Z', wmkf_remindercount: 0 }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'followup',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, {
      reminderSentAt: SENT_AT,
      reminderCount: 1,
    }, { actingUserSystemId: 'staff-1', ifMatch: ETAG });
  });

  it.each([-1, 1.5, 2147483647, '3'])(
    'followup: rejects an invalid reminder count (%p)',
    async (count) => {
      findById.mockResolvedValue(fresh({ wmkf_remindercount: count }));
      await expect(recordDeliveredEmail({
        suggestionId: SUGGESTION_ID,
        originalSuggestion: original(),
        templateType: 'followup',
        sentAt: SENT_AT,
        actingUserSystemId: 'staff-1',
      })).rejects.toThrow('Suggestion reminder count is invalid or exhausted');
    },
  );

  it('preserves a newer recorded timestamp over sentAt', async () => {
    const newer = '2026-09-06T00:00:00.000Z';
    findById.mockResolvedValue(fresh({ wmkf_materialssentat: newer }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, expect.objectContaining({
      materialsSentAt: newer,
    }), expect.anything());
  });

  it('retries a 412 up to three fresh reads then throws', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 412 });
    findById
      .mockResolvedValueOnce(fresh({ _etag: 'W/"1"' }))
      .mockResolvedValueOnce(fresh({ _etag: 'W/"2"' }))
      .mockResolvedValueOnce(fresh({ _etag: 'W/"3"' }));
    updateLifecycle.mockRejectedValue(conflict);

    await expect(recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    })).rejects.toBe(conflict);

    expect(findById).toHaveBeenCalledTimes(3);
    expect(updateLifecycle).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-412 error', async () => {
    const serverError = Object.assign(new Error('boom'), { status: 500 });
    updateLifecycle.mockRejectedValue(serverError);

    await expect(recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'materials',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-1',
    })).rejects.toBe(serverError);

    expect(findById).toHaveBeenCalledTimes(1);
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
  });

  it('updateLifecycle receives actingUserSystemId and the fresh _etag as ifMatch', async () => {
    findById.mockResolvedValue(fresh({ _etag: 'W/"specific-etag"' }));
    await recordDeliveredEmail({
      suggestionId: SUGGESTION_ID,
      originalSuggestion: original(),
      templateType: 'thankyou',
      sentAt: SENT_AT,
      actingUserSystemId: 'staff-42',
    });
    expect(updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, expect.any(Object), {
      actingUserSystemId: 'staff-42',
      ifMatch: 'W/"specific-etag"',
    });
  });
});

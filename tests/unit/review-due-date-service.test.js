/**
 * Review due date from the cycle calendar (D48): resolution and the
 * conditional first-invitation write.
 */

const {
  ensureRequestReviewDueDate,
  getCalendarReviewsDue,
  resolveRequestReviewDueDate,
  REVIEW_DUE_DATE_PROBLEMS,
} = require('../../lib/services/review-due-date-service');

const REQUEST = {
  akoya_requestid: '11111111-1111-4111-8111-111111111111',
  wmkf_meetingdate: '2027-06-10T00:00:00Z',
  wmkf_reviewduedate: null,
  _etag: 'W/"7"',
};

function deps(over = {}) {
  return {
    readCycleDates: jest.fn(async () => ({ wmkf_cyclecode: 'J27', wmkf_researchreviewsduedate: '2027-03-10T00:00:00Z' })),
    readRequest: jest.fn(async () => ({ ...REQUEST, wmkf_reviewduedate: '2027-03-03' })),
    writeRequest: jest.fn(async () => {}),
    ...over,
  };
}

test('every refusal reason has staff-facing copy', () => {
  for (const reason of ['no_meeting_date', 'cycle_missing', 'reviews_due_missing', 'calendar_unavailable', 'save_failed']) {
    expect(REVIEW_DUE_DATE_PROBLEMS[reason]).toEqual(expect.any(String));
  }
});

describe('getCalendarReviewsDue', () => {
  test('reads the Reviews Due Date as a calendar date', async () => {
    await expect(getCalendarReviewsDue('J27', deps())).resolves.toEqual({ ok: true, date: '2027-03-10' });
  });
  test('blank date, missing row and read failure are distinct refusals', async () => {
    await expect(getCalendarReviewsDue('J27', deps({ readCycleDates: jest.fn(async () => ({ wmkf_researchreviewsduedate: null })) })))
      .resolves.toEqual({ ok: false, reason: 'reviews_due_missing' });
    await expect(getCalendarReviewsDue('J27', deps({ readCycleDates: jest.fn(async () => null) })))
      .resolves.toEqual({ ok: false, reason: 'cycle_missing' });
    await expect(getCalendarReviewsDue('J27', deps({ readCycleDates: jest.fn(async () => { throw new Error('503'); }) })))
      .resolves.toEqual({ ok: false, reason: 'calendar_unavailable' });
  });
});

describe('resolveRequestReviewDueDate', () => {
  test('a stored request date wins and the calendar is not read', async () => {
    const d = deps();
    await expect(resolveRequestReviewDueDate({ ...REQUEST, wmkf_reviewduedate: '2027-02-01' }, d))
      .resolves.toEqual({ ok: true, date: '2027-02-01', source: 'request' });
    expect(d.readCycleDates).not.toHaveBeenCalled();
  });
  test('the cycle comes from the request meeting date', async () => {
    const d = deps();
    await expect(resolveRequestReviewDueDate(REQUEST, d)).resolves.toEqual({ ok: true, date: '2027-03-10', source: 'calendar' });
    expect(d.readCycleDates).toHaveBeenCalledWith('J27', expect.any(Object));
  });
  test('no meeting date refuses without reading the calendar', async () => {
    const d = deps();
    await expect(resolveRequestReviewDueDate({ ...REQUEST, wmkf_meetingdate: null }, d))
      .resolves.toEqual({ ok: false, reason: 'no_meeting_date' });
    expect(d.readCycleDates).not.toHaveBeenCalled();
  });
});

describe('ensureRequestReviewDueDate', () => {
  test('a stored date is returned with no write', async () => {
    const d = deps();
    await expect(ensureRequestReviewDueDate({ ...REQUEST, wmkf_reviewduedate: '2027-02-01' }, {}, d))
      .resolves.toMatchObject({ ok: true, date: '2027-02-01', source: 'request' });
    expect(d.writeRequest).not.toHaveBeenCalled();
  });
  test('a blank date is filled from the calendar with an ETag-conditional write', async () => {
    const d = deps();
    await expect(ensureRequestReviewDueDate(REQUEST, { actingUserSystemId: 'u-1' }, d))
      .resolves.toEqual({ ok: true, date: '2027-03-10', source: 'calendar', saved: true });
    expect(d.writeRequest).toHaveBeenCalledWith(REQUEST.akoya_requestid, { wmkf_reviewduedate: '2027-03-10' },
      { ifMatch: 'W/"7"', actingUserSystemId: 'u-1' });
  });
  test('a 412 re-reads and takes the date another send stored', async () => {
    const d = deps({ writeRequest: jest.fn(async () => { throw Object.assign(new Error('412'), { status: 412 }); }) });
    await expect(ensureRequestReviewDueDate(REQUEST, {}, d)).resolves.toEqual({ ok: true, date: '2027-03-03', source: 'request' });
  });
  test('a 412 whose re-read still has no date refuses', async () => {
    const d = deps({
      writeRequest: jest.fn(async () => { throw Object.assign(new Error('412'), { status: 412 }); }),
      readRequest: jest.fn(async () => ({ ...REQUEST, wmkf_reviewduedate: null })),
    });
    await expect(ensureRequestReviewDueDate(REQUEST, {}, d)).resolves.toEqual({ ok: false, reason: 'save_failed' });
  });
  test('any other write failure, or no ETag, refuses', async () => {
    const failing = deps({ writeRequest: jest.fn(async () => { throw Object.assign(new Error('500'), { status: 500 }); }) });
    await expect(ensureRequestReviewDueDate(REQUEST, {}, failing)).resolves.toEqual({ ok: false, reason: 'save_failed' });
    const noEtag = deps();
    await expect(ensureRequestReviewDueDate({ ...REQUEST, _etag: undefined }, {}, noEtag)).resolves.toEqual({ ok: false, reason: 'save_failed' });
    expect(noEtag.writeRequest).not.toHaveBeenCalled();
  });
  test('a blank calendar date refuses with no write', async () => {
    const d = deps({ readCycleDates: jest.fn(async () => ({ wmkf_researchreviewsduedate: null })) });
    await expect(ensureRequestReviewDueDate(REQUEST, {}, d)).resolves.toEqual({ ok: false, reason: 'reviews_due_missing' });
    expect(d.writeRequest).not.toHaveBeenCalled();
  });
});

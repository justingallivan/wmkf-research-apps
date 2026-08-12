/**
 * Unit tests for the Phase 1 reviewer activity-history derivation
 * (`shared/components/reviewers/reviewer-activity-history.js`).
 *
 * The load-bearing test is the recency/precedence discrimination: the fixture is
 * built so the OLD fixed-precedence expression and the NEW true-recency one return
 * DIFFERENT events. A fixture where both agree would leave the behavior change
 * unpinned and the test decorative.
 */

const fs = require('fs');
const path = require('path');

const {
  buildActivityHistory,
  latestActivity,
  EVENT_DESCRIPTORS,
  isSyntheticReceipt,
  SYNTHETIC_RECEIPT_NOTE,
  STAFF_RECEIPT_NOTE,
  currentTerminalStatus,
  latestActivitySummary,
} = require('../../shared/components/reviewers/reviewer-activity-history');

/** The expression Last Action used before the 2026-08-12 true-recency decision. */
const fixedPrecedence = (r) =>
  r.thankyouSentAt || r.reviewReceivedAt || r.reminderSentAt || r.materialsSentAt;

describe('buildActivityHistory', () => {
  it('orders newest-first and disagrees with fixed precedence on the discriminating fixture', () => {
    // Thank-you ranks highest but is the OLDEST stamp; the reminder is newest.
    const reviewer = {
      suggestionId: 's1',
      materialsSentAt: '2026-07-20T10:00:00Z',
      thankyouSentAt: '2026-07-25T10:00:00Z',
      reminderSentAt: '2026-08-08T10:00:00Z',
    };

    const latest = latestActivity(buildActivityHistory(reviewer));

    expect(latest.key).toBe('review_reminder');
    expect(latest.at).toBe('2026-08-08T10:00:00Z');
    // The mutation guard: the old expression would have returned the thank-you.
    expect(fixedPrecedence(reviewer)).toBe('2026-07-25T10:00:00Z');
    expect(latest.at).not.toBe(fixedPrecedence(reviewer));
  });

  it('returns every stamped event newest-first', () => {
    const events = buildActivityHistory({
      suggestionId: 's2',
      emailSentAt: '2026-07-01T00:00:00Z',
      responseReceivedAt: '2026-07-03T00:00:00Z',
      materialsSentAt: '2026-07-05T00:00:00Z',
      reviewReceivedAt: '2026-07-09T00:00:00Z',
    });

    expect(events.map(e => e.key)).toEqual([
      'review_received',
      'materials_sent',
      'response_received',
      'invited',
    ]);
  });

  it('marks claim-before-send stamps as delivery-unproven and reviewer actions as proven', () => {
    const events = buildActivityHistory({
      suggestionId: 's3',
      emailSentAt: '2026-07-01T00:00:00Z',
      respondReminderSentAt: '2026-07-02T00:00:00Z',
      materialsSentAt: '2026-07-03T00:00:00Z',
      reminderSentAt: '2026-07-04T00:00:00Z',
      thankyouSentAt: '2026-07-05T00:00:00Z',
      proposalFirstAccessedAt: '2026-07-06T00:00:00Z',
      responseReceivedAt: '2026-07-07T00:00:00Z',
      responseType: 'accepted',
      reviewReceivedAt: '2026-07-08T00:00:00Z',
    });
    const proven = Object.fromEntries(events.map(e => [e.key, e.deliveryProven]));

    // Staff-side sends: the stamp survives a failed dispatch, so it proves nothing.
    expect(proven.invited).toBe(false);
    expect(proven.respond_reminder).toBe(false);
    expect(proven.materials_sent).toBe(false);
    expect(proven.review_reminder).toBe(false);
    expect(proven.thankyou).toBe(false);
    // Reviewer-originated portal access/submission: the stamp exists because the reviewer did the thing.
    expect(proven.portal_first_accessed).toBe(true);
    expect(proven.response_received).toBe(true);
    expect(proven.review_received).toBe(true);
  });

  it('excludes acknowledgement stamps that survive a remove/re-add', () => {
    // wmkf_coiackedat / wmkf_aiuseackedat are NOT in ENGAGEMENT_STAMP_RESET_ENTRIES,
    // so a value here may belong to a PRIOR engagement. Admitting it to this
    // engagement's timeline would be false-confidence history (Opus finding 11).
    const events = buildActivityHistory({
      suggestionId: 's10',
      materialsSentAt: '2026-07-05T00:00:00Z',
      coiAckedAt: '2026-07-06T00:00:00Z',
      aiUseAckedAt: '2026-07-07T00:00:00Z',
      heldAt: '2026-07-08T00:00:00Z',
    });

    expect(events.map(e => e.key)).toEqual(['materials_sent']);
  });

  it('breaks identical-timestamp ties toward the later lifecycle stage', () => {
    // Bulk writes routinely stamp two fields in the same instant.
    const events = buildActivityHistory({
      suggestionId: 's4',
      materialsSentAt: '2026-07-05T00:00:00Z',
      reviewReceivedAt: '2026-07-05T00:00:00Z',
    });

    expect(events.map(e => e.key)).toEqual(['review_received', 'materials_sent']);
  });

  it('does not represent a deadline extension — the record has no granted-at stamp', () => {
    const events = buildActivityHistory({
      suggestionId: 's5',
      materialsSentAt: '2026-07-05T00:00:00Z',
      reviewDueDateOverride: '2026-09-01',
      effectiveReviewDeadline: '2026-09-01',
    });

    expect(events.map(e => e.key)).toEqual(['materials_sent']);
  });

  it('drops absent and unparseable stamps rather than inventing events', () => {
    const events = buildActivityHistory({
      suggestionId: 's6',
      materialsSentAt: '2026-07-05T00:00:00Z',
      reminderSentAt: 'not-a-date',
      thankyouSentAt: null,
    });

    expect(events.map(e => e.key)).toEqual(['materials_sent']);
  });

  it('adds the reminder count and response type as detail', () => {
    const events = buildActivityHistory({
      suggestionId: 's7',
      reminderSentAt: '2026-07-04T00:00:00Z',
      reminderCount: 3,
      responseReceivedAt: '2026-07-03T00:00:00Z',
      responseType: 'accepted',
    });
    const detail = Object.fromEntries(events.map(e => [e.key, e.detail]));

    expect(detail.review_reminder).toBe('3 reminders recorded in total');
    expect(detail.response_received).toBe('Response: accepted');
  });

  it('labels a staff-recorded withdrawal separately from a reviewer decline', () => {
    const events = buildActivityHistory({
      suggestionId: 's11',
      responseReceivedAt: '2026-08-02T12:00:00Z',
      responseType: 'declined',
      reviewStatus: 'withdrew',
    });
    const response = events.find(e => e.key === 'response_received');

    expect(response.label).toBe('Withdrawal recorded by staff');
    // The detail must not echo the raw `declined` enum: that value came from
    // applyStaffReviewerWithdrawal, not the reviewer, and reads as a reviewer act.
    expect(response.detail).toBe('Recorded as declined by a Program Director, not by the reviewer.');
    expect(response.detail).not.toMatch(/^Response: /);
    expect(response.label).not.toBe('Reviewer declined invitation');
  });

  it('labels cron no-response close-out without asserting a reviewer response', () => {
    const events = buildActivityHistory({
      suggestionId: 's12',
      responseReceivedAt: '2026-08-03T12:00:00Z',
      responseType: 'no_response',
    });
    const response = events.find(e => e.key === 'response_received');

    expect(response.label).toBe('No response recorded at cycle close');
    expect(response.deliveryProven).toBe(false);
    expect(response.unprovenNote).toMatch(/automated cycle close/);
    expect(response.label).not.toMatch(/received|accepted|declined/i);
  });

  it('singularizes a single reminder', () => {
    const [event] = buildActivityHistory({
      suggestionId: 's8',
      reminderSentAt: '2026-07-04T00:00:00Z',
      reminderCount: 1,
    });

    expect(event.detail).toBe('1 reminder recorded in total');
  });

  it('returns an empty history for an unstamped or missing reviewer', () => {
    expect(buildActivityHistory({ suggestionId: 's9' })).toEqual([]);
    expect(buildActivityHistory(null)).toEqual([]);
  });
});

describe('synthetic close-out receipt (Codex adversarial finding, 2026-08-12)', () => {
  // updateLifecycle stamps wmkf_reviewreceivedat with the SAME `now` as
  // wmkf_completedat on any transition to complete when the field is empty
  // (reviewer-suggestion.js:1662-1670). A PD closing out a reviewer who never
  // submitted therefore produces a receipt for a review that does not exist.
  const CLOSEOUT_INSTANT = '2026-08-12T15:04:05Z';

  it('demotes a close-out-fabricated receipt instead of asserting it', () => {
    const events = buildActivityHistory({
      suggestionId: 'c1',
      materialsSentAt: '2026-07-05T00:00:00Z',
      reviewReceivedAt: CLOSEOUT_INSTANT,
      completedAt: CLOSEOUT_INSTANT,
      answers: [],
      reviewFilename: null,
    });
    const receipt = events.find(e => e.key === 'review_received');

    expect(receipt.deliveryProven).toBe(false);
    expect(receipt.label).toBe('Review recorded at close-out');
    expect(receipt.unprovenNote).toBe(SYNTHETIC_RECEIPT_NOTE);
  });

  it('keeps a genuine portal submission proven when answers exist', () => {
    // Same instant, but the reviewer left narrative answers -- evidence beats the
    // timestamp test, so a submit-then-immediately-close-out row stays proven.
    const events = buildActivityHistory({
      suggestionId: 'c2',
      reviewReceivedAt: CLOSEOUT_INSTANT,
      completedAt: CLOSEOUT_INSTANT,
      answers: [{ questionKey: 'summary', value: 'Strong proposal' }],
    });
    const receipt = events.find(e => e.key === 'review_received');

    expect(receipt.deliveryProven).toBe(true);
    expect(receipt.label).toBe('Review submitted through portal');
  });

  it('keeps a genuine receipt proven when an uploaded review file exists', () => {
    const events = buildActivityHistory({
      suggestionId: 'c3',
      reviewReceivedAt: CLOSEOUT_INSTANT,
      completedAt: CLOSEOUT_INSTANT,
      answers: [],
      reviewFilename: 'review-lovelace.pdf',
    });

    expect(events.find(e => e.key === 'review_received').deliveryProven).toBe(true);
  });

  it('keeps a receipt proven when close-out happened later than the receipt', () => {
    const events = buildActivityHistory({
      suggestionId: 'c4',
      reviewReceivedAt: '2026-08-01T09:00:00Z',
      completedAt: '2026-08-12T15:04:05Z',
      answers: [],
    });

    expect(events.find(e => e.key === 'review_received').deliveryProven).toBe(true);
  });

  it('leaves a receipt with no close-out alone', () => {
    const events = buildActivityHistory({
      suggestionId: 'c5',
      reviewReceivedAt: '2026-08-01T09:00:00Z',
      answers: [],
    });

    expect(isSyntheticReceipt({ reviewReceivedAt: '2026-08-01T09:00:00Z' })).toBe(false);
    expect(events.find(e => e.key === 'review_received').deliveryProven).toBe(true);
  });

  it('labels the mark-received-no-file staff path as a staff attestation', () => {
    const events = buildActivityHistory({
      suggestionId: 'c7',
      reviewReceivedAt: '2026-08-04T09:00:00Z',
      reviewUploadedByStaff: true,
      reviewFilename: null,
      answers: [],
    });
    const receipt = events.find(e => e.key === 'review_received');

    expect(receipt.label).toBe('Review receipt attested by staff');
    expect(receipt.deliveryProven).toBe(false);
    expect(receipt.unprovenNote).toBe(STAFF_RECEIPT_NOTE);
    expect(receipt.label).not.toBe('Review submitted through portal');
  });

  it('labels the staff review-upload path as a staff attestation even with a file', () => {
    const events = buildActivityHistory({
      suggestionId: 'c8',
      reviewReceivedAt: '2026-08-04T09:00:00Z',
      reviewUploadedByStaff: true,
      reviewFilename: 'staff-upload.pdf',
      answers: [],
    });
    const receipt = events.find(e => e.key === 'review_received');

    expect(receipt.label).toBe('Review receipt attested by staff');
    expect(receipt.deliveryProven).toBe(false);
    expect(receipt.unprovenNote).toBe(STAFF_RECEIPT_NOTE);
  });

  it('does not demote any event other than the receipt', () => {
    const events = buildActivityHistory({
      suggestionId: 'c6',
      proposalFirstAccessedAt: CLOSEOUT_INSTANT,
      responseReceivedAt: CLOSEOUT_INSTANT,
      responseType: 'accepted',
      reviewReceivedAt: CLOSEOUT_INSTANT,
      completedAt: CLOSEOUT_INSTANT,
      answers: [],
    });
    const proven = Object.fromEntries(events.map(e => [e.key, e.deliveryProven]));

    expect(proven.review_received).toBe(false);
    expect(proven.portal_first_accessed).toBe(true);
    expect(proven.response_received).toBe(true);
    expect(proven.completed).toBe(true);
  });
});

describe('engagement-scope invariant', () => {
  /**
   * The drawer tells staff its history covers the CURRENT engagement only. That is
   * only true while every field it reads is cleared on remove/re-add. This re-derives
   * the reset set from the adapter source rather than trusting a copied list, so
   * adding an event backed by a non-reset stamp fails here instead of silently
   * shipping a timeline that can mix engagements.
   */
  it('sources every event from a stamp in ENGAGEMENT_STAMP_RESET_ENTRIES', () => {
    const adapterPath = path.join(__dirname, '../../lib/dataverse/adapters/reviewer-suggestion.js');
    const source = fs.readFileSync(adapterPath, 'utf8');

    const block = source.match(
      /const ENGAGEMENT_STAMP_RESET_ENTRIES = Object\.freeze\(\[([\s\S]*?)\]\);/
    );
    expect(block).not.toBeNull();

    const resetFields = new Set(
      [...block[1].matchAll(/\[\s*'([a-z_0-9]+)'/g)].map(m => m[1])
    );
    // Guard the guard: if the parse silently matched nothing, the assertion below
    // would pass vacuously.
    expect(resetFields.size).toBeGreaterThan(10);

    const offenders = EVENT_DESCRIPTORS
      .filter(d => !resetFields.has(d.rawField))
      .map(d => `${d.key} (${d.rawField})`);

    expect(offenders).toEqual([]);
  });

  it('names a raw Dataverse column for every event', () => {
    for (const descriptor of EVENT_DESCRIPTORS) {
      expect(typeof descriptor.rawField).toBe('string');
      expect(descriptor.rawField).toMatch(/^wmkf_/);
    }
  });
});

describe('latestActivity', () => {
  it('returns null when there is nothing to show', () => {
    expect(latestActivity([])).toBeNull();
    expect(latestActivity(null)).toBeNull();
  });
});


describe('undated terminal status summary', () => {
  it('surfaces released status without fabricating a dated release event', () => {
    const reviewer = {
      suggestionId: 't1',
      reviewStatus: 'released',
      reminderSentAt: '2026-08-08T10:00:00Z',
      materialsSentAt: '2026-08-01T10:00:00Z',
    };

    const events = buildActivityHistory(reviewer);
    const summary = latestActivitySummary(reviewer);

    expect(summary).toEqual(expect.objectContaining({
      key: 'terminal_released',
      label: 'Current status: Released',
      dated: false,
    }));
    expect(summary.at).toBeUndefined();
    expect(events.map(e => e.key)).toEqual(['review_reminder', 'materials_sent']);
    expect(events.some(e => e.key === 'terminal_released')).toBe(false);
    expect(currentTerminalStatus(reviewer).detail).toMatch(/No lifecycle timestamp/);
  });

  // Codex adversarial review round 4 (2026-08-12): deferring to the undated header for
  // EVERY terminal status hid the withdrawal date staff triage on. `withdrew` does have
  // a dated event -- applyStaffReviewerWithdrawal stamps responseReceivedAt in the same
  // write as the status -- so only `released` may fall back to the undated header.
  it('keeps the dated withdrawal in Last Action rather than an undated header', () => {
    const reviewer = {
      suggestionId: 't2',
      reviewStatus: 'withdrew',
      responseType: 'declined',
      responseReceivedAt: '2026-08-10T14:00:00Z',
      materialsSentAt: '2026-08-01T10:00:00Z',
    };

    const summary = latestActivitySummary(reviewer);

    expect(summary.key).toBe('response_received');
    expect(summary.label).toBe('Withdrawal recorded by staff');
    expect(summary.at).toBe('2026-08-10T14:00:00Z');
    expect(summary.dated).not.toBe(false);
  });

  it('does not let a dated-event preference regress released to a stale reminder', () => {
    // The rejected remedy -- "use the newest dated event whenever one exists" -- would
    // return the Aug 8 reminder here, which is the exact defect the header fixed.
    const reviewer = {
      suggestionId: 't3',
      reviewStatus: 'released',
      reminderSentAt: '2026-08-08T10:00:00Z',
    };

    const summary = latestActivitySummary(reviewer);

    expect(summary.key).toBe('terminal_released');
    expect(summary.key).not.toBe('review_reminder');
  });

  it('falls back to the header when a withdrawn row carries no dated activity', () => {
    const summary = latestActivitySummary({ suggestionId: 't4', reviewStatus: 'withdrew' });

    expect(summary.key).toBe('terminal_withdrew');
    expect(summary.dated).toBe(false);
  });

  it('leaves non-terminal rows on true recency', () => {
    const summary = latestActivitySummary({
      suggestionId: 't5',
      reviewStatus: 'accepted',
      materialsSentAt: '2026-08-01T10:00:00Z',
      reminderSentAt: '2026-08-08T10:00:00Z',
    });

    expect(summary.key).toBe('review_reminder');
  });
});

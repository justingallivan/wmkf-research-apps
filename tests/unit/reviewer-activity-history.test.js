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
      reviewReceivedAt: '2026-07-08T00:00:00Z',
    });
    const proven = Object.fromEntries(events.map(e => [e.key, e.deliveryProven]));

    // Staff-side sends: the stamp survives a failed dispatch, so it proves nothing.
    expect(proven.invited).toBe(false);
    expect(proven.respond_reminder).toBe(false);
    expect(proven.materials_sent).toBe(false);
    expect(proven.review_reminder).toBe(false);
    expect(proven.thankyou).toBe(false);
    // Reviewer-originated: the stamp exists because the reviewer did the thing.
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

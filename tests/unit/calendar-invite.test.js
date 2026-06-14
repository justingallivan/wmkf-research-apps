/**
 * Reviewer "hold step" chunk 5 — the .ics save-the-date builder.
 */
const { buildReviewHoldIcs, toIcsDate } = require('../../lib/external/calendar-invite');

describe('toIcsDate', () => {
  test('YYYY-MM-DD → YYYYMMDD', () => {
    expect(toIcsDate('2026-07-01')).toBe('20260701');
    expect(toIcsDate('2026-07-01T12:00:00Z')).toBe('20260701');
  });
  test('missing/malformed → null', () => {
    expect(toIcsDate(null)).toBeNull();
    expect(toIcsDate('')).toBeNull();
    expect(toIcsDate('not-a-date')).toBeNull();
    expect(toIcsDate(20260701)).toBeNull();
  });
});

describe('buildReviewHoldIcs', () => {
  test('returns null (degrade) when there is no usable meeting date', () => {
    expect(buildReviewHoldIcs({ meetingDate: null, requestNumber: 'R-1' })).toBeNull();
    expect(buildReviewHoldIcs({ meetingDate: 'garbage' })).toBeNull();
    expect(buildReviewHoldIcs({})).toBeNull();
  });

  test('builds a PUBLISH all-day VEVENT attachment from the meeting date', () => {
    const att = buildReviewHoldIcs({ meetingDate: '2026-07-01', requestNumber: 'REQ-001', nowIso: '2026-06-14T17:00:00Z' });
    expect(att).not.toBeNull();
    expect(att.filename).toBe('keck-review-hold.ics');
    expect(att.contentType).toMatch(/^text\/calendar/);
    expect(Buffer.isBuffer(att.content)).toBe(true);

    const ics = att.content.toString('utf-8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
    expect(ics).toContain('DTEND;VALUE=DATE:20260702'); // exclusive next day
    expect(ics).toContain('DTSTAMP:20260614T170000Z');
    expect(ics).toContain('UID:wmkf-reviewer-hold-REQ-001@wmkf');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    // CRLF line endings (RFC 5545).
    expect(ics).toContain('\r\n');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  test('UID falls back to the date when no request number', () => {
    const att = buildReviewHoldIcs({ meetingDate: '2026-07-01' });
    expect(att.content.toString('utf-8')).toContain('UID:wmkf-reviewer-hold-20260701@wmkf');
  });
});

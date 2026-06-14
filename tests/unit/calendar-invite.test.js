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
  test('impossible-but-well-formed dates → null (round-trip validation, Codex chunk-5)', () => {
    expect(toIcsDate('2026-02-31')).toBeNull(); // JS would normalize to Mar 3
    expect(toIcsDate('2026-13-40')).toBeNull();
    expect(toIcsDate('2026-00-10')).toBeNull();
  });
});

describe('buildReviewHoldIcs', () => {
  test('returns null (degrade) when there is no usable meeting date', () => {
    expect(buildReviewHoldIcs({ meetingDate: null, requestNumber: 'R-1' })).toBeNull();
    expect(buildReviewHoldIcs({ meetingDate: 'garbage' })).toBeNull();
    expect(buildReviewHoldIcs({ meetingDate: '2026-02-31' })).toBeNull(); // impossible date degrades too
    expect(buildReviewHoldIcs({})).toBeNull();
  });

  test('every physical line is ≤75 octets (RFC 5545 folding) and continuations start with a space', () => {
    // A long request number forces the UID + description well past 75 octets.
    const att = buildReviewHoldIcs({ meetingDate: '2026-07-01', requestNumber: 'REQ-0000000001-LONG-CYCLE-2026', nowIso: '2026-06-14T17:00:00Z' });
    const lines = att.content.toString('utf-8').split('\r\n');
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf-8')).toBeLessThanOrEqual(75);
    }
    // A folded continuation line is introduced by exactly one leading space.
    const folded = lines.filter((l) => l.startsWith(' '));
    expect(folded.length).toBeGreaterThan(0);
  });

  test('UID sanitizes unsafe request-number characters (no injection / line break)', () => {
    const att = buildReviewHoldIcs({ meetingDate: '2026-07-01', requestNumber: 'R 1;\r\nDTSTART:evil' });
    const ics = att.content.toString('utf-8');
    // The unsafe chars are stripped — UID is a single safe token.
    expect(ics).toContain('UID:wmkf-reviewer-hold-R1DTSTARTevil@wmkf');
    // No injected DTSTART line from the malicious request number (only the real one).
    expect(ics.match(/^DTSTART/gm) || []).toHaveLength(1);
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

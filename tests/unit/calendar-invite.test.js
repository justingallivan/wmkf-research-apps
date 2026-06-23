/**
 * Reviewer review-due .ics save-the-date builder.
 */
const { buildReviewDueIcs, toIcsDate } = require('../../lib/external/calendar-invite');

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

describe('buildReviewDueIcs', () => {
  test('returns null (degrade) when there is no usable review due date or stable suggestion id', () => {
    expect(buildReviewDueIcs({ reviewDueDate: null, suggestionId: 's-1', requestNumber: 'R-1' })).toBeNull();
    expect(buildReviewDueIcs({ reviewDueDate: 'garbage', suggestionId: 's-1' })).toBeNull();
    expect(buildReviewDueIcs({ reviewDueDate: '2026-02-31', suggestionId: 's-1' })).toBeNull(); // impossible date degrades too
    expect(buildReviewDueIcs({ reviewDueDate: '2026-07-01' })).toBeNull();
    expect(buildReviewDueIcs({})).toBeNull();
  });

  test('every physical line is ≤75 octets (RFC 5545 folding) and continuations start with a space', () => {
    // A long request number forces the description well past 75 octets.
    const att = buildReviewDueIcs({ reviewDueDate: '2026-07-01', suggestionId: '11111111-1111-4111-8111-111111111111', requestNumber: 'REQ-0000000001-LONG-CYCLE-2026', nowIso: '2026-06-14T17:00:00Z' });
    const lines = att.content.toString('utf-8').split('\r\n');
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf-8')).toBeLessThanOrEqual(75);
    }
    // A folded continuation line is introduced by exactly one leading space.
    const folded = lines.filter((l) => l.startsWith(' '));
    expect(folded.length).toBeGreaterThan(0);
  });

  test('UID sanitizes unsafe suggestion-id characters (no injection / line break)', () => {
    const att = buildReviewDueIcs({ reviewDueDate: '2026-07-01', suggestionId: 'S 1;\r\nDTSTART:evil', requestNumber: 'REQ-001' });
    const ics = att.content.toString('utf-8');
    // The unsafe chars are stripped — UID is a single safe token.
    expect(ics).toContain('UID:wmkf-review-due-S1DTSTARTevil@wmkf');
    // No injected DTSTART line from the malicious suggestion id (only the real one).
    expect(ics.match(/^DTSTART/gm) || []).toHaveLength(1);
  });

  test('builds a PUBLISH all-day VEVENT attachment from the review due date', () => {
    const att = buildReviewDueIcs({ reviewDueDate: '2026-07-01', suggestionId: '11111111-1111-4111-8111-111111111111', requestNumber: 'REQ-001', nowIso: '2026-06-14T17:00:00Z' });
    expect(att).not.toBeNull();
    expect(att.filename).toBe('keck-review-due.ics');
    expect(att.contentType).toMatch(/^text\/calendar/);
    expect(Buffer.isBuffer(att.content)).toBe(true);

    const ics = att.content.toString('utf-8');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
    expect(ics).toContain('DTEND;VALUE=DATE:20260702'); // exclusive next day
    expect(ics).toContain('DTSTAMP:20260614T170000Z');
    expect(ics).toContain('UID:wmkf-review-due-11111111-1111-4111-8111-111111111111@wmkf');
    expect(ics).toContain('SUMMARY:W. M. Keck Foundation review due');
    expect(unfolded).toContain('Please submit your review by this date.');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    // CRLF line endings (RFC 5545).
    expect(ics).toContain('\r\n');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  test('UID remains stable when the request number changes', () => {
    const first = buildReviewDueIcs({ reviewDueDate: '2026-07-01', suggestionId: 'suggestion-1', requestNumber: 'REQ-001' });
    const second = buildReviewDueIcs({ reviewDueDate: '2026-07-01', suggestionId: 'suggestion-1', requestNumber: 'REQ-999' });
    expect(first.content.toString('utf-8')).toContain('UID:wmkf-review-due-suggestion-1@wmkf');
    expect(second.content.toString('utf-8')).toContain('UID:wmkf-review-due-suggestion-1@wmkf');
  });
});

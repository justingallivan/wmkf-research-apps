/**
 * Minimal RFC 5545 .ics builder for the reviewer review-due save-the-date.
 *
 * METHOD:PUBLISH (an informational add-to-calendar event, NOT an RSVP meeting
 * request): the Dynamics SendEmail activity can't carry a multipart/alternative
 * method=REQUEST part, and reviewer acceptance happens in the portal, so no RSVP
 * is needed. Most clients (Outlook / Apple Mail / Gmail) recognize a PUBLISH .ics
 * attachment and offer "add to calendar."
 *
 * Returns an attachment `{ filename, contentType, content: Buffer }` matching
 * DynamicsService.addEmailAttachment, or `null` when there's no usable review due
 * date or suggestion id — the caller degrades to a body-text date so a calendar glitch never blocks
 * the email (build plan chunk 5, "degrade, don't fail").
 *
 * The .ics is built ONLY from trusted server-side request/suggestion fields
 * (review due date, request number, suggestion id) — never reviewer/caller input — so it can ride a separate
 * always-allowed `calendarAttachments` lane without touching the proposal-materials
 * gate (`recipientMayReceiveAttachments`).
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD...' → 'YYYYMMDD' for an all-day DTSTART;VALUE=DATE. Returns null on a
// missing/malformed date AND on an impossible-but-well-formed one (e.g. 2026-02-31,
// 2026-13-40) — verified by round-tripping the parsed UTC date, so the degrade contract
// holds instead of emitting a bogus/NaN event (Codex chunk-5).
function toIcsDate(reviewDueDate) {
  if (!reviewDueDate || typeof reviewDueDate !== 'string') return null;
  const m = reviewDueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // Round-trip: reject values JS silently normalized (Feb 31 → Mar 3, etc.).
  if (
    dt.getUTCFullYear() !== Number(y)
    || dt.getUTCMonth() + 1 !== Number(mo)
    || dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}${mo}${d}`;
}

// RFC 5545 §3.1 content-line folding: physical lines MUST be ≤75 octets; longer
// logical lines are split with CRLF + a single leading space. Fold on UTF-8 byte
// boundaries so multi-byte chars are never split.
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75; // first physical line: 75 octets
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 sequence: back off while the next byte is a
    // continuation byte (10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push(bytes.slice(start, end).toString('utf-8'));
    start = end;
    limit = 74; // continuation lines: 1 leading space + 74 octets = 75
  }
  return out.join('\r\n ');
}

// RFC 5545 §3.3.11 TEXT escaping for SUMMARY/DESCRIPTION values.
function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * @param {object} p
 * @param {string} [p.reviewDueDate] - 'YYYY-MM-DD' review due date (akoya_request.wmkf_reviewduedate)
 * @param {string} [p.suggestionId]  - wmkf_appreviewersuggestionid, for the stable UID
 * @param {string} [p.requestNumber] - akoya_requestnum, for the description
 * @param {string} [p.nowIso]        - override "now" for a deterministic DTSTAMP (tests)
 * @returns {{filename:string, contentType:string, content:Buffer}|null}
 */
function buildReviewDueIcs({ reviewDueDate, suggestionId, requestNumber, nowIso } = {}) {
  const dtStartDate = toIcsDate(reviewDueDate);
  if (!dtStartDate) return null; // degrade: no usable date → no .ics
  const uidToken = String(suggestionId || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  if (!uidToken) return null; // degrade: no stable per-reviewer UID → no .ics

  // All-day VEVENT: DTEND is the exclusive next day (RFC 5545).
  const start = new Date(`${dtStartDate.slice(0, 4)}-${dtStartDate.slice(4, 6)}-${dtStartDate.slice(6, 8)}T00:00:00Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const dtEndDate = `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}`;

  const now = nowIso ? new Date(nowIso) : new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
    + `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const reqLabel = requestNumber ? ` (${requestNumber})` : '';
  // UID must be a single safe token — sanitize suggestionId (strip CRLF/separators,
  // cap length) so it can never inject a line or break the UID property.
  const uid = `wmkf-review-due-${uidToken}@wmkf`;
  const summary = escapeText('W. M. Keck Foundation review due');
  const description = escapeText(
    `Review due date for the Keck Foundation proposal${reqLabel}. Please submit your review by this date.`,
  );

  // Stable per reviewer/request UID: re-sends update the same review-due event
  // instead of creating duplicates.
  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//W. M. Keck Foundation//Reviewer Review Due//EN',
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtStartDate}`,
    `DTEND;VALUE=DATE:${dtEndDate}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldLine).join('\r\n') + '\r\n';

  return {
    filename: 'keck-review-due.ics',
    contentType: 'text/calendar; method=PUBLISH; charset=utf-8',
    content: Buffer.from(content, 'utf-8'),
  };
}

module.exports = { buildReviewDueIcs, toIcsDate };

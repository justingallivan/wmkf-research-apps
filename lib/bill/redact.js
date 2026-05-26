/**
 * Strip BILL.com secrets from error messages + log lines before they bubble.
 *
 * Targets:
 *   - devKey value (header `devKey: <key>` or body field `"devKey":"<key>"`)
 *   - password (body field `"password":"<value>"`)
 *   - sessionId value (header `sessionId: <id>`)
 *   - any long token-shaped string (defensive sweep: >= 32 chars, [A-Za-z0-9_-])
 */

// Note: ordering matters — specific patterns first, then the defensive sweep.
const PATTERNS = [
  // JSON field values
  { rx: /"devKey"\s*:\s*"[^"]*"/g, replace: '"devKey":"[redacted]"' },
  { rx: /"password"\s*:\s*"[^"]*"/g, replace: '"password":"[redacted]"' },
  { rx: /"sessionId"\s*:\s*"[^"]*"/g, replace: '"sessionId":"[redacted]"' },
  // Header forms ("devKey: foo", "sessionId: foo")
  { rx: /(\b(?:devKey|sessionId)\s*[:=]\s*)([A-Za-z0-9_\-]+)/gi, replace: '$1[redacted]' },
  // URL query forms (?devKey=foo, &sessionId=foo)
  { rx: /([?&](?:devKey|sessionId)=)([^&\s"]+)/gi, replace: '$1[redacted]' },
];

// Defensive sweep — matches token-shaped strings (≥ 32 chars, base64/hex/url-safe alphabet).
// Includes `.` (JWT segments), `+`/`/`/`=` (standard base64 padding/chars). UUIDs
// (36 chars w/ dashes) and other long identifiers will be caught; that's accepted
// noise per the comment in redactError below — better noisy than leaky.
//
// Note: we don't use \b word boundaries because `+/=` aren't word chars, which
// would prevent matching JWTs / standard-base64 secrets entirely. We use
// surrounding-non-token-char anchors instead via a lookaround-free pattern.
const TOKEN_SWEEP = /([A-Za-z0-9_\-+/.=]{32,})/g;

export function redactString(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const { rx, replace } of PATTERNS) {
    out = out.replace(rx, replace);
  }
  // Defensive sweep: replace long token-looking sequences. UUIDs (36 chars w/ dashes),
  // long IDs, and JWT/base64 secrets all get redacted. Acknowledged noise: harmless
  // identifiers will also be redacted; that's the deliberate tradeoff over leaking
  // real secrets in logs.
  out = out.replace(TOKEN_SWEEP, '[redacted-token]');
  return out;
}

export function redactError(err) {
  if (err && typeof err.message === 'string') {
    err.message = redactString(err.message);
  }
  if (err && typeof err.response === 'string') {
    err.response = redactString(err.response);
  }
  return err;
}

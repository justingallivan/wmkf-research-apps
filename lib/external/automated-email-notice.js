/**
 * Recipient-facing disclosure for automatically dispatched personalized mail.
 *
 * The notice stays separate from the PD-authored body/signature so a stored
 * closing cannot be split by an injected "on behalf of" marker. It identifies
 * the message as automated, names the represented PD, and states the reply
 * destination. The legacy marker stripper removes only an exact standalone
 * line; it does not rewrite arbitrary staff-authored prose.
 */

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function stripLegacyAutomationMarker(bodyText) {
  return String(bodyText || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*automatically sent on behalf of\s*:?\s*$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildAutomatedEmailNotice({ senderName, senderEmail, kind = 'message' }) {
  const name = String(senderName || 'your W. M. Keck Foundation program director').trim();
  const email = String(senderEmail || '').trim();
  const first = `This automated ${kind} was sent by the W. M. Keck Foundation on behalf of ${name}.`;
  const reply = email
    ? `Replies to this email will go directly to ${name} at ${email}.`
    : `Replies to this email will go directly to ${name}.`;
  return `${first} ${reply}`;
}

export function renderAutomatedEmailNoticeHtml(args) {
  const notice = escapeHtml(buildAutomatedEmailNotice(args));
  return `<div style="margin:0 0 18px;padding:10px 12px;border-left:4px solid #1a4a7a;background:#f2f6fa;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#344054;">${notice}</div>`;
}

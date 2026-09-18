/** Pre-Site distribution recipient, body, and session composition helpers. */
import {
  DELIBERATION_SHARE_SEED_BRIEFING_COPY,
} from '../../../../shared/config/deliberationShareEmail.js';
import { isGuid } from '../../../utils/guid.js';
import {
  DEFAULT_ATTACHMENT_MODE, MAX_MATERIAL_LINKS, MODES, PREPARE_MODES,
  distributionError,
} from './model.js';
function normalizeDistributionRecipients(toInput, ccInput) {
  const split = (input) => (Array.isArray(input) ? input : String(input || '').split(/[;,\n]/))
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const to = [...new Set(split(toInput))];
  const ccRaw = [...new Set(split(ccInput))];
  if (to.length === 0) {
    throw distributionError('At least one To recipient is required.', 'distribution_to_required', 400);
  }
  const invalid = [...to, ...ccRaw].filter((email) => !emailPattern.test(email));
  if (invalid.length) {
    throw distributionError('Every recipient must be a valid email address.', 'distribution_recipient_invalid', 400);
  }
  const toSet = new Set(to);
  const conflict = ccRaw.find((email) => toSet.has(email));
  if (conflict) {
    throw distributionError(
      `${conflict} cannot appear in both To and Cc.`,
      'distribution_recipient_conflict',
      400,
    );
  }
  return { to, cc: ccRaw };
}

function includeCalendarOrganizer(recipients, organizerEmail) {
  const normalizedOrganizer = String(organizerEmail || '').trim().toLowerCase();
  return {
    to: [...new Set([...recipients.to, normalizedOrganizer])],
    cc: recipients.cc.filter((email) => email !== normalizedOrganizer),
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function reviewBundleDocumentUrl(briefingUrl) {
  if (!briefingUrl) return null;
  let url;
  try {
    url = new URL(briefingUrl);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^(.*)\/external\/briefing\/([^/]+)\/?$/);
  if (!match) return null;
  url.pathname = `${match[1]}/api/external/briefing/${match[2]}/document`;
  url.search = '?member=review-bundle';
  return url.toString();
}

function renderBriefingBody(bodyHtml, briefingUrl) {
  if (!briefingUrl) return bodyHtml;
  let rendered = String(bodyHtml || '').replaceAll(BRIEFING_LINK_PLACEHOLDER, escapeHtml(briefingUrl));
  const reviewBundleUrl = reviewBundleDocumentUrl(briefingUrl);
  if (reviewBundleUrl) {
    rendered = rendered.replaceAll(REVIEW_BUNDLE_LINK_PLACEHOLDER, escapeHtml(reviewBundleUrl));
  }
  return rendered;
}

function sessionSnapshotOf(session) {
  if (!session?.scheduledStartIso) return null;
  let meetingLink = '';
  try {
    const url = new URL(session.meetingLink || '');
    if (url.protocol === 'https:') meetingLink = url.toString();
  } catch {}
  return {
    sessionId: session.sessionId || null,
    scheduledStartIso: session.scheduledStartIso,
    scheduledEndIso: session.scheduledEndIso || null,
    ianaTimeZone: session.ianaTimeZone || null,
    meetingLink,
    location: session.location || '',
  };
}

function sessionSnapshotsMatch(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return ['sessionId', 'scheduledStartIso', 'scheduledEndIso', 'ianaTimeZone', 'meetingLink']
    .every((key) => String(left[key] || '') === String(right[key] || ''));
}

function sessionLineText(snapshot) {
  if (!snapshot?.scheduledStartIso) return 'Pre-discussion: not yet scheduled.';
  const start = new Date(snapshot.scheduledStartIso);
  if (Number.isNaN(start.getTime())) return 'Pre-discussion: not yet scheduled.';
  let when;
  try {
    when = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      ...(snapshot.ianaTimeZone ? { timeZone: snapshot.ianaTimeZone } : {}),
    }).format(start);
  } catch {
    when = start.toISOString();
  }
  return `Pre-discussion: ${when}.`;
}

function sessionHtml(snapshot) {
  const text = sessionLineText(snapshot);
  const line = `<strong>Pre-discussion:</strong>${escapeHtml(text.slice('Pre-discussion:'.length))}`;
  const where = snapshot?.location ? ` ${escapeHtml(snapshot.location)}.` : '';
  const join = snapshot?.meetingLink ? ` <a href="${escapeHtml(snapshot.meetingLink)}">Join meeting</a>` : '';
  return `<p>${line}${where}${join}</p>`;
}

function briefingLinkHtml(briefingLink, briefingCopy = DELIBERATION_SHARE_SEED_BRIEFING_COPY) {
  if (!briefingLink?.id) return '';
  const copy = { ...DELIBERATION_SHARE_SEED_BRIEFING_COPY, ...briefingCopy };
  const expires = briefingLink.expiresAt ? new Date(briefingLink.expiresAt) : null;
  const expiresText = expires && !Number.isNaN(expires.getTime())
    ? ` ${escapeHtml(copy.expiryLeadIn)} ${escapeHtml(expires.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' }))}.`
    : '';
  return `<p><strong>${escapeHtml(copy.heading)}</strong> <a href="${BRIEFING_LINK_PLACEHOLDER}">${escapeHtml(copy.linkText)}</a>`
    + ` — ${escapeHtml(copy.description)}${expiresText}</p>`
    // Plan §11 (Step C2): a second line for the review bundle, present
    // whenever the briefing link itself is (every new attempt has a bundle
    // since Step C1's fail-closed assembly).
    + `<p><a href="${REVIEW_BUNDLE_LINK_PLACEHOLDER}">${escapeHtml(copy.reviewBundleLinkText)}</a></p>`;
}

function distributionBodyHtml(
  bodyText,
  operationId,
  materialLinks = [],
  briefingLink = null,
  sessionSnapshot = null,
  briefingCopy = DELIBERATION_SHARE_SEED_BRIEFING_COPY,
) {
  const paragraphs = String(bodyText || '').trim().split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
  const links = materialLinks.length
    ? '<h3>Site Visit materials</h3><ul>'
      + materialLinks.map((material) => (
        `<li><a href="${escapeHtml(material.webUrl)}">${escapeHtml(material.filename)}</a>`
          + ` — ${escapeHtml(material.artifactTypeLabel)}</li>`
      )).join('')
      + '</ul>'
    : '';
  return `${paragraphs}${sessionHtml(sessionSnapshot)}${briefingLinkHtml(briefingLink, briefingCopy)}${links}<!-- wmkf-pre-site-distribution:${operationId} -->`;
}

function normalizeComposeInput(input) {
  const attachmentMode = String(input.attachmentMode ?? DEFAULT_ATTACHMENT_MODE).trim().toLowerCase()
    || DEFAULT_ATTACHMENT_MODE;
  if (!PREPARE_MODES.has(attachmentMode)) {
    throw distributionError(
      MODES.has(attachmentMode)
        ? 'Attachments are no longer sent; the briefing page carries the writeup. Reload and prepare the preview again.'
        : 'The attachment mode is not recognized.',
      'distribution_attachment_mode_invalid',
      400,
    );
  }
  const recipients = normalizeDistributionRecipients(input.to, input.cc);
  const subject = String(input.subject || '').trim();
  const bodyText = String(input.bodyText || '').trim();
  if (!subject || subject.length > 500) {
    throw distributionError('A subject of at most 500 characters is required.', 'distribution_subject_invalid', 400);
  }
  if (bodyText.length < 1 || bodyText.length > 20_000) {
    throw distributionError('An email body of at most 20,000 characters is required.', 'distribution_body_invalid', 400);
  }
  if (input.includeCalendar !== undefined && typeof input.includeCalendar !== 'boolean') {
    throw distributionError('includeCalendar must be true or false.', 'distribution_calendar_invalid', 400);
  }
  const selectedMaterialIds = input.selectedMaterialIds ?? [];
  // Retired 2026-09-10 (owner): the briefing page carries the site-visit
  // materials, so a new email never links them. Fail closed for a stale
  // bundle that still posts a selection; rows already sent keep theirs.
  if (Array.isArray(selectedMaterialIds) && selectedMaterialIds.length > 0) {
    throw distributionError(
      'Material links are no longer sent by email; the briefing page carries the site visit materials. Reload and prepare the preview again.',
      'distribution_material_links_retired',
      400,
    );
  }
  if (!Array.isArray(selectedMaterialIds)
    || selectedMaterialIds.length > MAX_MATERIAL_LINKS
    || selectedMaterialIds.some((id) => !isGuid(id))) {
    throw distributionError(
      `Choose at most ${MAX_MATERIAL_LINKS} valid material links.`,
      'distribution_material_selection_invalid',
      400,
    );
  }
  const uniqueMaterialIds = [...new Set(selectedMaterialIds.map((id) => id.toLowerCase()))];
  if (uniqueMaterialIds.length !== selectedMaterialIds.length) {
    throw distributionError('A material can be selected only once.', 'distribution_material_selection_invalid', 400);
  }
  if (input.includeCalendar === true && !isGuid(input.siteVisitId)) {
    throw distributionError(
      'Save the Site Visit logistics before including its calendar attachment.',
      'distribution_site_visit_required',
      400,
    );
  }
  return {
    attachmentMode,
    recipients,
    subject,
    bodyText,
    includeCalendar: input.includeCalendar === true,
    siteVisitId: input.includeCalendar === true ? input.siteVisitId.toLowerCase() : null,
    selectedMaterialIds: uniqueMaterialIds,
  };
}

const BRIEFING_LINK_PLACEHOLDER = 'wmkf-briefing-link://pending';

const REVIEW_BUNDLE_LINK_PLACEHOLDER = 'wmkf-briefing-link://review-bundle';
export {
  normalizeDistributionRecipients, includeCalendarOrganizer, escapeHtml,
  BRIEFING_LINK_PLACEHOLDER, REVIEW_BUNDLE_LINK_PLACEHOLDER, reviewBundleDocumentUrl,
  renderBriefingBody, sessionSnapshotOf, sessionSnapshotsMatch, sessionLineText,
  sessionHtml, briefingLinkHtml, distributionBodyHtml, normalizeComposeInput,
};

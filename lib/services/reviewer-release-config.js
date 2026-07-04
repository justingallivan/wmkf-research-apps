/**
 * Reviewer release-materials attachment setting — single Dataverse
 * ground-truth boolean (`wmkf_appsystemsettings`, key
 * `reviewer.release.attach_proposal_email`).
 *
 * Default OFF (portal-link-only delivery): the materials/release email relies
 * on the reviewer's tokenized `{{externalLink}}` portal link (already present
 * in the seeded materials template — lib/seed/email-defaults/reviewer-templates.js)
 * rather than emailing the proposal/attachments directly. An admin can flip
 * this ON to restore the legacy behavior (proposal auto-attach from SharePoint
 * + manual file uploads to Vercel Blob, both included as `attachmentUrls`).
 *
 * Read fresh wherever it matters — no build-time constant, no caching layer.
 */

const { getSetting, setSetting } = require('./settings-service');

const ATTACH_PROPOSAL_EMAIL_KEY = 'reviewer.release.attach_proposal_email';
const DEFAULT_ATTACH_PROPOSAL_EMAIL = false;

function parseAttachProposalEmail(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_ATTACH_PROPOSAL_EMAIL;
  return String(raw).trim() === 'true';
}

async function getAttachProposalEmailSetting() {
  const raw = await getSetting(ATTACH_PROPOSAL_EMAIL_KEY);
  return parseAttachProposalEmail(raw);
}

async function setAttachProposalEmailSetting(value, updatedByProfileId = null) {
  return setSetting(ATTACH_PROPOSAL_EMAIL_KEY, value ? 'true' : 'false', updatedByProfileId);
}

module.exports = {
  ATTACH_PROPOSAL_EMAIL_KEY,
  DEFAULT_ATTACH_PROPOSAL_EMAIL,
  parseAttachProposalEmail,
  getAttachProposalEmailSetting,
  setAttachProposalEmailSetting,
};

#!/usr/bin/env node
/**
 * preview-emails.mjs — Read-only preview of all six workbench email templates,
 * filled with real seed templates + real render logic, using proxy sample data.
 *
 * Usage:
 *   node scripts/preview-emails.mjs
 *   node scripts/preview-emails.mjs --request 2024-001 --pd "Sarah Chen" --due 2026-09-15
 *   node scripts/preview-emails.mjs --reviewer-name "Dr. John Doe" --reviewer-email "j.doe@example.org"
 *
 * Flags (all optional — sensible proxy defaults apply when absent):
 *   --request <akoya_requestnum>   Resolve real title + PD name from Dataverse
 *   --pd <name>                    Override PD name (skips Dataverse lookup)
 *   --reviewer-name <name>         Proxy reviewer name  (default: Dr. Jane Reviewer)
 *   --reviewer-email <email>       Proxy reviewer email (default: jane.reviewer@example.org)
 *   --due <YYYY-MM-DD>             Proxy review due date (default: 2026-09-15)
 *
 * Read-only: no writes to Dataverse or any other store.
 */

import fs from 'fs';
import { pathToFileURL } from 'url';

// ---------------------------------------------------------------------------
// 1. Load .env.local (same pattern as seed-email-defaults.mjs)
// ---------------------------------------------------------------------------
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  // .env.local may not exist in all environments; continue without it.
}

// ---------------------------------------------------------------------------
// 2. Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const requestNum    = flag('--request');
const pdOverride    = flag('--pd');
const reviewerName  = flag('--reviewer-name')  || 'Dr. Jane Reviewer';
const reviewerEmail = flag('--reviewer-email') || 'jane.reviewer@example.org';
const dueDate       = flag('--due')             || '2026-09-15';

// ---------------------------------------------------------------------------
// 3. Import real seed constants
// ---------------------------------------------------------------------------
const {
  REVIEWER_ACCEPTANCE_SEED_SUBJECT,
  REVIEWER_ACCEPTANCE_SEED_BODY,
  REVIEWER_WITHDRAW_SEED_SUBJECT,
  REVIEWER_WITHDRAW_SEED_BODY,
} = await import('../lib/seed/email-defaults/reviewer-actions.js');

const {
  REVIEWER_REMINDER_RESPOND_BY_SEED_SUBJECT,
  REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
  REVIEWER_REMINDER_REVIEW_DUE_SEED_SUBJECT,
  REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
} = await import('../lib/seed/email-defaults/reviewer-reminders.js');

const {
  GRANTEE_INVITE_SEED_SUBJECT,
  GRANTEE_INVITE_SEED_BODY,
} = await import('../lib/seed/email-defaults/grantee-invite.js');

const {
  GRANTEE_REMINDER_SEED_SUBJECT,
  GRANTEE_REMINDER_SEED_BODY,
} = await import('../lib/seed/email-defaults/grantee-reminder.js');

// ---------------------------------------------------------------------------
// 4. Import real render functions
// ---------------------------------------------------------------------------
const {
  buildRespondReminderBodyText,
  buildReviewDueReminderBodyText,
  formatReminderDate,
} = await import('../lib/external/reviewer-reminder-email.js');

const {
  fillInviteBody,
  formatCobDate,
} = await import('../shared/config/granteeInviteEmail.js');

const {
  buildGranteeReminderBodyText,
} = await import('../lib/external/grantee-invite-email.js');

// ---------------------------------------------------------------------------
// Inlined from lib/external/reviewer-withdraw-email.js
// (that module bare-imports './plain-text-email-html' without .js extension,
//  which Node ESM cannot resolve outside the Next.js bundler context)
// ---------------------------------------------------------------------------
function _normalizeSignatureText(signatureBlock) {
  return String(signatureBlock?.signature || signatureBlock?.name || 'W. M. Keck Foundation').trim();
}
function _applyPlaceholders(template, replacements) {
  let text = String(template || '');
  for (const [placeholder, value] of Object.entries(replacements)) {
    text = text.split(placeholder).join(String(value ?? ''));
  }
  return text;
}
function _titleClause(title) {
  return title ? `the proposal "${title}"` : 'a proposal we recently invited you to review';
}
function buildWithdrawSufficientBodyText({ bodyTemplate, reviewerName, title, signatureBlock }) {
  const greeting = reviewerName ? `Dear ${reviewerName}:` : 'Dear Reviewer:';
  return _applyPlaceholders(bodyTemplate, {
    '[Reviewer Name]':              reviewerName || 'Reviewer',
    '[reviewerName]':               reviewerName || 'Reviewer',
    '[greeting]':                   greeting,
    '[proposal]':                   _titleClause(title),
    '[proposal title clause]':      _titleClause(title),
    '[title]':                      _titleClause(title),
    '[Program Director signature]': _normalizeSignatureText(signatureBlock),
    '[signature]':                  _normalizeSignatureText(signatureBlock),
  });
}

// ---------------------------------------------------------------------------
// Inlined from lib/services/email-signature.js
// (that module bare-imports './database-service', './dynamics-service', etc.
//  which Node ESM cannot resolve outside the Next.js bundler context)
// ---------------------------------------------------------------------------
function appendSignatureBlock(bodyText, signatureBlock) {
  const body      = String(bodyText || '').trimEnd();
  const signature = String(signatureBlock?.signature || signatureBlock?.name || '').trim();
  return `${body}\n\n${signature}`.trim();
}

// ---------------------------------------------------------------------------
// 5. Optionally resolve real proposal title + PD name from Dataverse
// ---------------------------------------------------------------------------
let proposalTitle = 'Quantum Sensing in Living Cells';  // proxy default
let pdName        = pdOverride || 'Margaret Sullivan';   // proxy default

if (requestNum) {
  console.error(`[preview-emails] Resolving request ${requestNum} from Dataverse…`);
  try {
    const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
    enterDynamicsBypassForScript('preview-emails');

    const { DynamicsService } = await import('../lib/services/dynamics-service.js');

    // Query akoya_requests by akoya_requestnum
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_title,akoya_requestnum,_wmkf_programdirector_value',
      filter: `akoya_requestnum eq '${requestNum.replace(/'/g, "''")}'`,
      top: 1,
    });

    const req = records?.[0];
    if (req) {
      if (req.akoya_title) {
        proposalTitle = req.akoya_title;
        console.error(`[preview-emails] Resolved title: ${proposalTitle}`);
      } else {
        console.error('[preview-emails] Request found but akoya_title is empty; using proxy title.');
      }

      // Resolve PD name if not overridden
      if (!pdOverride && req._wmkf_programdirector_value) {
        const pd = await DynamicsService.getRecord(
          'systemusers',
          req._wmkf_programdirector_value,
          { select: 'fullname' }
        ).catch(() => null);
        if (pd?.fullname) {
          pdName = pd.fullname;
          console.error(`[preview-emails] Resolved PD: ${pdName}`);
        }
      }
    } else {
      console.error(`[preview-emails] No request found for requestnum="${requestNum}"; using proxy data.`);
    }
  } catch (err) {
    console.error(`[preview-emails] Dataverse lookup failed (${err.message}); using proxy data.`);
  }
} else {
  // No Dataverse needed — use in-process bypass stub so downstream imports that
  // conditionally check bypass mode do not throw.
  try {
    const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
    enterDynamicsBypassForScript('preview-emails');
  } catch {
    // Optional; ignore if the module can't be loaded standalone.
  }
}

// ---------------------------------------------------------------------------
// 6. Build shared sample values
// ---------------------------------------------------------------------------

// Signature block (mirrors what appendSignatureBlock / normalizeSignatureText uses)
const signatureBlock = {
  name:      pdName,
  signature: `${pdName}\nProgram Director\nW. M. Keck Foundation`,
};

// Acceptance confirmation: render exactly as renderAcceptanceConfirmationEmail in respond.js
function applyTemplatePlaceholders(template, replacements) {
  let text = String(template || '');
  for (const [placeholder, value] of Object.entries(replacements)) {
    text = text.split(placeholder).join(String(value ?? ''));
  }
  return text;
}

function formatReviewDueDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, mo, d] = match;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(dt);
}

// ---------------------------------------------------------------------------
// 7. Output helpers (must be declared before first use)
// ---------------------------------------------------------------------------
const _rendered = [];

function printEmail(name, subject, body) {
  _rendered.push({ name, subject, body });
  console.log('\n' + '='.repeat(72));
  console.log(`=== ${name} ===`);
  console.log('='.repeat(72));
  console.log(`SUBJECT: ${subject}`);
  console.log('BODY:');
  console.log(body);
}

// ---------------------------------------------------------------------------
// 8. Render all six emails
// ---------------------------------------------------------------------------

// --- Email 1: Reviewer acceptance confirmation ---
// Fill exactly as renderAcceptanceConfirmationEmail in respond.js does
{
  const due = formatReviewDueDate(dueDate);
  const dueSentence = due
    ? `Your review is due on ${due}.`
    : 'We will follow up with the review due date.';
  const replacements = {
    '[reviewerName]':  reviewerName,
    '[title]':         proposalTitle,
    '[reviewDueDate]': dueSentence,
    '[requestNumber]': '',           // always stripped — never surfaced to reviewers
  };
  const subject = applyTemplatePlaceholders(REVIEWER_ACCEPTANCE_SEED_SUBJECT, replacements);
  const body    = applyTemplatePlaceholders(REVIEWER_ACCEPTANCE_SEED_BODY,    replacements);

  printEmail('Reviewer acceptance confirmation', subject, body);
}

// --- Email 2: Reviewer respond-by reminder ---
{
  const subject = REVIEWER_REMINDER_RESPOND_BY_SEED_SUBJECT; // no tokens in subject
  const body    = buildRespondReminderBodyText({
    bodyTemplate:   REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
    reviewerName,
    title:          proposalTitle,
    signatureBlock,
  });
  printEmail('Reviewer respond-by reminder', subject, body);
}

// --- Email 3: Reviewer review-due reminder ---
{
  const subject = REVIEWER_REMINDER_REVIEW_DUE_SEED_SUBJECT;
  const body    = buildReviewDueReminderBodyText({
    bodyTemplate:   REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
    reviewerName,
    title:          proposalTitle,
    reviewDueDate:  dueDate,
    signatureBlock,
  });
  printEmail('Reviewer review-due reminder', subject, body);
}

// --- Email 4: Reviewer withdraw-sufficient ---
{
  const subject = REVIEWER_WITHDRAW_SEED_SUBJECT;
  const body    = buildWithdrawSufficientBodyText({
    bodyTemplate:   REVIEWER_WITHDRAW_SEED_BODY,
    reviewerName,
    title:          proposalTitle,
    signatureBlock,
  });
  printEmail('Reviewer withdraw-sufficient', subject, body);
}

// --- Email 5: Grantee invite ---
// fillInviteBody fills [Name] (surname), [title], COB [date]; server appends PD signature.
{
  const subject = GRANTEE_INVITE_SEED_SUBJECT;
  const filledBody = fillInviteBody(GRANTEE_INVITE_SEED_BODY, {
    piName:   reviewerName,   // proxy PI name (same reviewer-name proxy)
    title:    proposalTitle,
    baseDate: new Date('2026-08-04T00:00:00Z'), // proxy base date → +14 days = 2026-08-18
  });
  // Server-side appends PD signature via appendSignatureBlock
  const body = appendSignatureBlock(filledBody, signatureBlock);
  printEmail('Grantee invite', subject, body);
}

// --- Email 6: Grantee deliverable reminder ---
// buildGranteeReminderBodyText fills [Name], [title], COB [date], [Program Director signature]
{
  const subject = GRANTEE_REMINDER_SEED_SUBJECT;
  const body    = buildGranteeReminderBodyText({
    bodyTemplate:  GRANTEE_REMINDER_SEED_BODY,
    piName:        reviewerName,
    title:         proposalTitle,
    signatureBlock,
    invitedDate:   new Date('2026-08-04T00:00:00Z'), // proxy invited date → +14 days = COB August 18, 2026
  });
  printEmail('Grantee deliverable reminder', subject, body);
}

// ---------------------------------------------------------------------------
// 9. Verification
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(72));
console.log('VERIFICATION');
console.log('='.repeat(72));

const allRendered = _rendered;
const requestNumFound = allRendered.some((e) =>
  requestNum && (e.subject.includes(requestNum) || e.body.includes(requestNum))
);
if (requestNum) {
  console.log(requestNumFound
    ? `FAIL: request number "${requestNum}" found in at least one rendered email.`
    : `PASS: request number "${requestNum}" does NOT appear in any rendered email.`);
} else {
  console.log('INFO: No --request flag given; request-number-strip check skipped (proxy run).');
}

// Check [proposal] token renders as 'the proposal "<title>"' in reminders + withdraw
const expectedClause = `the proposal "${proposalTitle}"`;
const emailsWithProposalToken = [
  { name: 'Reviewer respond-by reminder',  rendered: allRendered[1] },
  { name: 'Reviewer review-due reminder',  rendered: allRendered[2] },
  { name: 'Reviewer withdraw-sufficient',  rendered: allRendered[3] },
];
for (const { name, rendered } of emailsWithProposalToken) {
  if (rendered.body.includes(expectedClause)) {
    console.log(`PASS: "${name}" — [proposal] rendered as: ${expectedClause}`);
  } else {
    console.log(`FAIL: "${name}" — expected clause not found. Body excerpt: ${rendered.body.slice(0, 200)}`);
  }
}


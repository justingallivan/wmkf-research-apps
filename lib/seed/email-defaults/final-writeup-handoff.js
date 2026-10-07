/**
 * Seed copy for the group-review handoff email's admin-editable subject and
 * message (Final Writeup group-review handoff Stage 4). Sent from the system
 * mailbox to the request's Program Directors when the lead PD presses
 * "Ready for group review".
 *
 * This file is the SINGLE source of the shipped default text. It is written
 * into Dataverse `wmkf_appsystemsetting` once by `scripts/seed-email-defaults.mjs`
 * — it is init data, NOT a runtime fallback. A blank or unavailable admin
 * value leaves the email unsent and retryable
 * (lib/services/final-writeup/handoff-email-service.js).
 *
 * Tokens resolved by the service: {{requestNumber}}, {{requestTitle}},
 * {{institution}}, {{leadProgramDirector}}. The "Open the writeup" link is
 * rendered by the service and is not part of this text.
 */

export const FINAL_WRITEUP_HANDOFF_SEED_SUBJECT = 'Ready for group review: {{requestNumber}} {{institution}}';

export const FINAL_WRITEUP_HANDOFF_SEED_BODY = '{{leadProgramDirector}} has marked the writeup for {{requestNumber}}, "{{requestTitle}}" ({{institution}}), ready for group review.\n\nPlease read it, comment or edit in Word, and sign off when you are satisfied. Sign-off is not required before it goes to leadership.';

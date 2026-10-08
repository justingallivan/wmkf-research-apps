/**
 * Seed copy for the leadership daily digest's admin-editable subject and
 * opening message (Final Writeup group-review handoff Stage 5). Sent once a
 * day from the system mailbox to each Leadership-persona staff member,
 * listing the Research writeups newly sent to leadership review.
 *
 * This file is the SINGLE source of the shipped default text. It is written
 * into Dataverse `wmkf_appsystemsetting` once by `scripts/seed-email-defaults.mjs`
 * — it is init data, NOT a runtime fallback. A blank or unavailable admin
 * value sends no digest and raises an ops alert
 * (lib/services/final-writeup/leadership-digest-service.js).
 *
 * Tokens resolved by the service: {{count}}, {{writeupWord}} ("writeup" or
 * "writeups"). The list of writeups, with links, is rendered by the service
 * and is not part of this text.
 */

export const FINAL_WRITEUP_LEADERSHIP_DIGEST_SEED_SUBJECT = 'Sent to leadership: {{count}} {{writeupWord}}';

export const FINAL_WRITEUP_LEADERSHIP_DIGEST_SEED_BODY = 'These Research {{writeupWord}} were sent to leadership review since your last summary. Each link opens the request\'s Final writeup tab, where you can read the writeup and see who has signed off.';

/**
 * @jest-environment node
 *
 * D49: preparation of the one acceptance email that carries the materials,
 * and the strict cycle attachment loader the automatic release uses.
 */
jest.mock('../../lib/services/email-defaults.js', () => ({ readRequiredEmailDefaults: jest.fn() }));
jest.mock('../../lib/services/email-signature.js', () => ({ resolveSignatureForRequest: jest.fn() }));
jest.mock('../../lib/external/calendar-invite.js', () => ({ buildReviewDueIcs: jest.fn(() => ({ filename: 'keck-review-due.ics' })) }));
jest.mock('../../lib/services/reviewer-acceptance-personalization', () => ({ ownReviewerAcceptanceTemplate: jest.fn() }));

import { readRequiredEmailDefaults } from '../../lib/services/email-defaults.js';
import { resolveSignatureForRequest } from '../../lib/services/email-signature.js';
import { ownReviewerAcceptanceTemplate } from '../../lib/services/reviewer-acceptance-personalization';
import { prepareMaterialsAcceptanceEmail, finalizeMaterialsAcceptanceMessage, materialsAttachmentsNote, MATERIALS_ACCEPTANCE_SUBJECT_KEY, MATERIALS_ACCEPTANCE_BODY_KEY } from '../../lib/services/reviewer-acceptance-email.js';
import { buildReviewDueIcs } from '../../lib/external/calendar-invite.js';
import { REVIEWER_MATERIALS_ACCEPTANCE_SEED_BODY } from '../../lib/seed/email-defaults/reviewer-actions.js';
import { loadCycleMaterialsAttachments } from '../../lib/services/review-manager/cycle-materials-attachments.js';

const PLACEHOLDER = 'send_time_token.pending_authority.not_live';
const REQUEST = { akoya_requestid: '22222222-2222-4222-8222-222222222222', akoya_title: 'Proposal', wmkf_reviewduedate: '2027-03-10' };
const input = (attachments = []) => ({ suggestion: { wmkf_revieweremail: 'reviewer@example.org' }, request: REQUEST, reviewer: { wmkf_name: 'Dr. Reviewer' }, attachments,
  placeholderUrl: `https://review.example.org/external/review/${PLACEHOLDER}`, placeholderToken: PLACEHOLDER });
const defaults = body => ({ ok: true, failures: [], values: { [MATERIALS_ACCEPTANCE_SUBJECT_KEY]: 'Review materials: {{proposalTitle}}', [MATERIALS_ACCEPTANCE_BODY_KEY]: body } });

beforeEach(() => {
  process.env.NOTIFICATION_EMAIL_FROM = 'system@wmkeck.org';
  process.env.REVIEWER_PORTAL_BASE_URL = 'https://review.example.org';
  resolveSignatureForRequest.mockResolvedValue({ signature: 'PD' });
  ownReviewerAcceptanceTemplate.mockReset();
});

test('renders the placeholder link where {{reviewUrl}} sits, the due date, and the attachments after the calendar file', async () => {
  readRequiredEmailDefaults.mockResolvedValue(defaults('Thanks. Your materials: {{reviewUrl}}\n\n{{reviewDueDate}}'));
  const prepared = await prepareMaterialsAcceptanceEmail(input([{ filename: 'template.docx' }]));
  expect(prepared.ok).toBe(true);
  expect(prepared.message.body).toContain(`https://review.example.org/external/review/${PLACEHOLDER}`);
  expect(prepared.message.body).toContain('Your review is due on March 10, 2027.');
  expect(prepared.message.subject).toBe('Review materials: Proposal');
  expect(prepared.message.attachments.map(a => a.filename)).toEqual(['keck-review-due.ics', 'template.docx']);
  expect(readRequiredEmailDefaults).toHaveBeenCalledWith([MATERIALS_ACCEPTANCE_SUBJECT_KEY, MATERIALS_ACCEPTANCE_BODY_KEY], expect.anything());
  expect(ownReviewerAcceptanceTemplate).not.toHaveBeenCalled();
  const final = finalizeMaterialsAcceptanceMessage(prepared, 'minted.jwt');
  expect(final.message.body).toContain('/external/review/minted.jwt'); expect(final.message.body).not.toContain(PLACEHOLDER);
});

test('the attachments sentence names only what is attached', () => {
  expect(materialsAttachmentsNote({ hasCalendar: true, hasReviewTemplate: true })).toBe('A calendar reminder is attached, along with the review template.');
  expect(materialsAttachmentsNote({ hasCalendar: true, hasReviewTemplate: false })).toBe('A calendar reminder is attached.');
  expect(materialsAttachmentsNote({ hasCalendar: false, hasReviewTemplate: true })).toBe('The review template is attached.');
  expect(materialsAttachmentsNote({ hasCalendar: false, hasReviewTemplate: false })).toBe('');
});

test('seeded body: no due date and no template claims no attachment and leaves no dangling space', async () => {
  readRequiredEmailDefaults.mockResolvedValue(defaults(REVIEWER_MATERIALS_ACCEPTANCE_SEED_BODY));
  buildReviewDueIcs.mockReturnValueOnce(null);
  const prepared = await prepareMaterialsAcceptanceEmail({ ...input(), request: { ...REQUEST, wmkf_reviewduedate: null } });
  expect(prepared.ok).toBe(true);
  expect(prepared.message.body).toContain('We will follow up with the review due date.');
  expect(prepared.message.body).not.toMatch(/attached/);
  expect(prepared.message.body).not.toContain('{{attachmentsNote}}');
  expect(prepared.message.body).not.toMatch(/due date\. </);
  expect(prepared.message.attachments).toEqual([]);
});

test('seeded body: calendar plus template names both; calendar alone names only the calendar', async () => {
  readRequiredEmailDefaults.mockResolvedValue(defaults(REVIEWER_MATERIALS_ACCEPTANCE_SEED_BODY));
  const both = await prepareMaterialsAcceptanceEmail({ ...input([{ filename: 'template.docx' }]), hasReviewTemplate: true });
  expect(both.message.body).toContain('Your review is due on March 10, 2027. A calendar reminder is attached, along with the review template.');
  const calendarOnly = await prepareMaterialsAcceptanceEmail(input([{ filename: 'extra.pdf' }]));
  expect(calendarOnly.message.body).toContain('A calendar reminder is attached.');
  expect(calendarOnly.message.body).not.toContain('review template');
});

test('a body without {{reviewUrl}} still carries the link', async () => {
  readRequiredEmailDefaults.mockResolvedValue(defaults('Thanks for agreeing to review.'));
  const prepared = await prepareMaterialsAcceptanceEmail(input());
  expect(prepared.message.body).toContain(PLACEHOLDER);
});

test('unseeded keys are distinguished from an unreadable store', async () => {
  readRequiredEmailDefaults.mockResolvedValue({ ok: false, values: {}, failures: [{ reason: 'blank' }, { reason: 'blank' }] });
  expect(await prepareMaterialsAcceptanceEmail(input())).toEqual({ ok: false, reason: 'materials_defaults_blank' });
  readRequiredEmailDefaults.mockResolvedValue({ ok: false, values: {}, failures: [{ reason: 'blank' }, { reason: 'unavailable' }] });
  expect(await prepareMaterialsAcceptanceEmail(input())).toEqual({ ok: false, reason: 'defaults_unavailable' });
});

test('finalize refuses a missing or placeholder link', async () => {
  readRequiredEmailDefaults.mockResolvedValue(defaults('{{reviewUrl}}'));
  const prepared = await prepareMaterialsAcceptanceEmail(input());
  expect(() => finalizeMaterialsAcceptanceMessage(prepared, '')).toThrow();
  expect(() => finalizeMaterialsAcceptanceMessage(prepared, PLACEHOLDER)).toThrow();
});

describe('loadCycleMaterialsAttachments (strict)', () => {
  const fetch = jest.fn(async (ref, cache, filename) => { const a = { filename: filename || ref }; cache.set(ref, a); return a; });
  test('review template then additional attachments, each once', async () => {
    const out = await loadCycleMaterialsAttachments({ review_template_blob_url: 'https://blob/t.docx',
      additional_attachments: [{ blobUrl: 'https://blob/a.pdf', filename: 'A.pdf' }, { blobUrl: 'https://blob/t.docx' }] }, { fetch });
    expect(out.map(a => a.filename)).toEqual(['https://blob/t.docx', 'A.pdf']);
  });
  test('any attachment that cannot be fetched throws; nothing is silently dropped', async () => {
    await expect(loadCycleMaterialsAttachments({ review_template_blob_url: 'x' }, { fetch: async () => null })).rejects.toThrow('cycle_attachment_unavailable');
    await expect(loadCycleMaterialsAttachments({ additional_attachments: [{ filename: 'no-ref' }] }, { fetch })).rejects.toThrow('cycle_attachment_reference_missing');
  });
  test('no configured materials is an empty list', async () => {
    expect(await loadCycleMaterialsAttachments({}, { fetch })).toEqual([]);
  });
});

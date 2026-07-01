/**
 * fillInviteBody placeholder substitution (shared/config/granteeInviteEmail.js).
 * Distinct from grantee-invite-email.test.js, which covers the separate
 * lib/external/grantee-invite-email.js HTML renderer.
 *
 * #6 (S272): every occurrence of a token must fill, not just the first — a PD's
 * custom body may repeat [Name]/[title]/COB [date].
 */
import { fillInviteBody, fillInviteSubject } from '../../shared/config/granteeInviteEmail';
import { GRANTEE_INVITE_SEED_BODY } from '../../lib/seed/email-defaults/grantee-invite';

test('fills the default template placeholders', () => {
  const out = fillInviteBody(GRANTEE_INVITE_SEED_BODY, {
    piName: 'Monika Raj',
    title: 'Quantum Widgets',
    baseDate: new Date('2026-06-20T12:00:00Z'),
  });
  expect(out).toMatch(/^Dear Professor Raj,/);
  expect(out).toContain('“Quantum Widgets”');
  expect(out).toContain('COB July 4, 2026'); // 2026-06-20 + 14 days
  expect(out).not.toContain('[Name]');
  expect(out).not.toContain('[title]');
});

test('fills EVERY occurrence of a repeated placeholder (#6)', () => {
  const tmpl = 'Dear [Name], your award “[title]” — [Name], reply by COB [date]. Re: [title].';
  const out = fillInviteBody(tmpl, {
    piName: 'Ada Lovelace',
    title: 'Analytical Engine',
    baseDate: new Date('2026-06-20T12:00:00Z'),
  });
  expect(out).toBe(
    'Dear Lovelace, your award “Analytical Engine” — Lovelace, reply by COB July 4, 2026. Re: Analytical Engine.',
  );
  expect(out).not.toContain('[Name]');
  expect(out).not.toContain('[title]');
});

test('fills mustache placeholders with the same values as legacy placeholders', () => {
  const legacy = 'Dear [Name], your award “[title]” is due by COB [date].';
  const mustache = 'Dear {{granteeName}}, your award “{{proposalTitle}}” is due by COB {{dueDate}}.';
  const args = {
    piName: 'Ada Lovelace',
    title: 'Analytical Engine',
    baseDate: new Date('2026-06-20T12:00:00Z'),
  };
  expect(fillInviteBody(mustache, args)).toBe(fillInviteBody(legacy, args));
});

test('leaves legacy and mustache tokens in place when their value is missing (no throw)', () => {
  const out = fillInviteBody('Hi [Name], re [title].', { baseDate: new Date('2026-06-20T12:00:00Z') });
  expect(out).toBe('Hi [Name], re [title].');
  const mustache = fillInviteBody('Hi {{granteeName}}, re {{proposalTitle}}.', { baseDate: new Date('2026-06-20T12:00:00Z') });
  expect(mustache).toBe('Hi {{granteeName}}, re {{proposalTitle}}.');
});

test('fills grantee invite subject placeholders in both syntaxes', () => {
  expect(fillInviteSubject('Abstract for [title]', { title: 'Quantum Widgets' }))
    .toBe('Abstract for Quantum Widgets');
  expect(fillInviteSubject('Abstract for {{proposalTitle}}', { title: 'Quantum Widgets' }))
    .toBe('Abstract for Quantum Widgets');
  expect(fillInviteSubject('Abstract for {{proposalTitle}}', {}))
    .toBe('Abstract for {{proposalTitle}}');
});

test('tolerates an empty/undefined template', () => {
  expect(fillInviteBody(undefined, {})).toBe('');
  expect(fillInviteBody('', {})).toBe('');
});

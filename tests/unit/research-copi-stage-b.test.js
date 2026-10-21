/**
 * @jest-environment node
 */
import {
  selectApprovedCopis, domainOf, institutionalDomain, domainsRelated, domainCandidates, domainWinner,
  sameName, matchContact, resolveExtractedIaa, resolveRecordedIaa, classifyWebEvidence, isNonInstitutionHost,
  webQuery, classifyRow,
} from '../../scripts/lib/research-copi-stage-b.mjs';

const cand = (o) => ({ year: '2019', requestNum: '1', name: 'Ann Lee', email: '', institution: '', institutionSource: '', decision: 'co-PI', rule: 'c: named in documents', ...o });
const role = (o) => ({ year: '2019', requestNum: '2', name: 'Bo Kim', email: '', institution: '', institutionSource: '', decision: 'co-PI', ...o });

describe('selectApprovedCopis', () => {
  const csv = {
    candidates: [
      cand({ name: 'Ann Lee' }),
      cand({ name: 'Cy Ray', decision: 'other' }),
      cand({ name: 'Di Fox', rule: 'a: faculty-level' }),
      cand({ name: 'Ed Poe', decision: 'PI', rule: '' }),
    ],
    roles: [
      role({ name: 'Bo Kim' }),
      role({ name: 'Fay Wu', decision: 'budget-only', requestNum: '3' }),
      role({ name: 'Gus Orr', decision: 'budget-only', requestNum: '4' }),
      role({ name: 'Hal Day', decision: 'not co-PI' }),
      role({ name: 'Ivy Ng', decision: 'unassessed', requestNum: '5' }),
    ],
    recheck: [
      role({ name: 'Jo Bay', requestNum: '6' }),
      role({ name: 'Kit Sun', decision: 'unassessed', requestNum: '7' }),
      role({ name: 'Lu Hart', decision: 'unassessed', requestNum: '8' }),
      role({ name: 'Mo Tate', decision: 'unassessed', requestNum: '8' }),
    ],
  };

  test('takes rule-c, role-check co-PIs, re-check co-PIs and only the named budget-only/unassessed grants', () => {
    const { people } = selectApprovedCopis(csv, { budgetOnly: ['3'], unassessed: ['7'] });
    expect(people.map((p) => `${p.name}:${p.source}`)).toEqual([
      'Ann Lee:named-in-documents', 'Bo Kim:role-check', 'Fay Wu:budget-only-approved', 'Jo Bay:re-check', 'Kit Sun:owner-approved',
    ]);
  });

  test('refuses an unassessed approval that does not name exactly one person', () => {
    expect(() => selectApprovedCopis(csv, { budgetOnly: [], unassessed: ['8'] })).toThrow(/exactly one/);
    expect(() => selectApprovedCopis(csv, { budgetOnly: [], unassessed: ['99'] })).toThrow(/found 0/);
  });

  test('people carry a name-free ref, stable across honorifics', () => {
    const a = selectApprovedCopis(csv, { budgetOnly: [], unassessed: [] }).people[0];
    const b = selectApprovedCopis({ ...csv, candidates: [cand({ name: 'Dr. Ann Lee' })] }, { budgetOnly: [], unassessed: [] }).people[0];
    expect(a.ref).toMatch(/^[0-9a-f]{16}$/);
    expect(a.ref).toBe(b.ref);
    expect(JSON.stringify(a.ref)).not.toMatch(/ann|lee/i);
    expect(a).not.toHaveProperty('key');
  });

  test('collapses the same person on the same grant across sources', () => {
    const dup = { ...csv, recheck: [role({ name: 'Dr. Bo Kim, PhD', requestNum: '2' })] };
    const { people, duplicates } = selectApprovedCopis(dup, { budgetOnly: [], unassessed: [] });
    expect(people.filter((p) => p.requestNum === '2')).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe('domains', () => {
  test('domainOf / institutionalDomain drop free mail', () => {
    expect(domainOf(' A@Med.X.EDU ')).toBe('med.x.edu');
    expect(institutionalDomain('a@gmail.com')).toBe('');
    expect(institutionalDomain('nope')).toBe('');
  });
  test.each([
    ['x.edu', 'x.edu', true], ['med.x.edu', 'x.edu', true], ['x.edu', 'med.x.edu', true],
    ['ox.ac.uk', 'cam.ac.uk', false], ['notx.edu', 'x.edu', false], ['', 'x.edu', false],
  ])('domainsRelated(%s, %s) = %s', (a, b, want) => expect(domainsRelated(a, b)).toBe(want));
  test('domainCandidates stops at the registrable domain', () => {
    expect(domainCandidates('www.profiles.med.x.edu')).toEqual(['profiles.med.x.edu', 'med.x.edu', 'x.edu']);
    expect(domainCandidates('www.chem.ox.ac.uk')).toEqual(['chem.ox.ac.uk', 'ox.ac.uk']);
    expect(domainCandidates('localhost')).toEqual([]);
  });
  test('domainWinner needs enough linked contacts and a clear share', () => {
    const rule = { min: 3, share: 0.9 };
    expect(domainWinner({ accountIds: ['A', 'a', 'A'], capped: false }, rule)).toMatchObject({ status: 'winner', accountId: 'a' });
    expect(domainWinner({ accountIds: ['a', 'a'], capped: false }, rule).status).toBe('too-few');
    expect(domainWinner({ accountIds: Array(9).fill('a').concat(['b', 'b']), capped: false }, rule).status).toBe('split');
    expect(domainWinner({ accountIds: Array(10).fill('a'), capped: true }, rule)).toMatchObject({ status: 'winner', sampled: true });
    expect(domainWinner({ accountIds: Array(5).fill('a').concat(Array(5).fill('b')), capped: true }, rule).status).toBe('split');
  });
});

describe('names and contact match', () => {
  const c = (id, first, last, o = {}) => ({ contactid: id, firstname: first, lastname: last, fullname: `${first} ${last}`, ...o });
  test.each([
    ['Jane Q. Doe', c('1', 'Jane', 'Doe'), true],
    ['J. Doe', c('1', 'Jane', 'Doe'), true],
    ['Jane Doe', c('1', 'John', 'Doe'), false],
    ['Dr. José Núñez, MD', c('1', 'Jose', 'Nunez'), true],
    ['Maria de la Cruz', c('1', 'Maria', 'de la Cruz'), true],
    ['Jane Smith Jones', c('1', 'Jane', 'Smith-Jones'), true],
    ['Jane Smith-Jones', c('1', 'Jane', 'Smith-Jones'), true],
  ])('sameName(%s)', (name, contact, want) => expect(sameName(name, contact)).toBe(want));

  const p = { name: 'Jane Doe', email: 'jdoe@med.x.edu' };
  test('one email hit wins; several are ambiguous', () => {
    expect(matchContact(p, [c('A', 'J', 'Doe')], [], null)).toEqual({ status: 'email', contactId: 'a' });
    expect(matchContact(p, [c('A', 'J', 'Doe'), c('B', 'J', 'Doe')], [], null).status).toBe('ambiguous-email');
  });
  test('name + related email domain', () => {
    const hit = c('A', 'Jane', 'Doe', { emailaddress2: 'jane@x.edu' });
    expect(matchContact(p, [], [hit, c('B', 'Jane', 'Doe', { emailaddress1: 'j@y.edu' })], null)).toEqual({ status: 'name-domain', contactId: 'a' });
  });
  test('a same-name contact elsewhere is a possible existing contact, never a new one', () => {
    expect(matchContact(p, [], [c('B', 'Jane', 'Doe', { emailaddress1: 'j@y.edu' })], null).status).toBe('possible-existing-contact');
  });
  test('a nickname at the same institution is caught by last name + domain or account', () => {
    expect(matchContact(p, [], [c('B', 'Janie', 'Doe', { emailaddress1: 'jd@x.edu' })], null).status).toBe('possible-existing-contact');
    expect(matchContact(p, [], [c('B', 'Janie', 'Doe', { _parentcustomerid_value: 'ACC' })], 'acc').status).toBe('possible-existing-contact');
  });
  test('free-mail domains never count as a name + domain match', () => {
    const gm = { name: 'Jane Doe', email: 'jane@gmail.com' };
    expect(matchContact(gm, [], [c('B', 'Jane', 'Doe', { emailaddress1: 'other@gmail.com' })], null).status).toBe('possible-existing-contact');
  });
  test('a name without first and last parts is never a new contact', () => {
    expect(matchContact({ name: 'Smith', email: '' }, [], [], null).status).toBe('name-unparseable');
    expect(matchContact({ name: 'Smith', email: 'jdoe@med.x.edu' }, [c('A', 'J', 'Smith')], [], null).status).toBe('email');
  });
  test('new contact only when no one shares the name or last name at the place', () => {
    expect(matchContact(p, [], [c('B', 'Rob', 'Doe', { emailaddress1: 'r@y.edu' })], null)).toEqual({ status: 'new-contact' });
  });
});

describe('Institution at Award', () => {
  const ctx = (o = {}) => ({ piDomains: ['x.edu'], applicantId: 'APP', domainMap: () => null, accounts: [], ...o });
  test('applicant when the proposal email matches the PI domain', () => {
    expect(resolveExtractedIaa({ email: 'a@med.x.edu' }, ctx())).toMatchObject({ status: 'resolved', accountId: 'app' });
  });
  test('no applicant gives no PI-domain signal', () => {
    expect(resolveExtractedIaa({ email: 'a@x.edu' }, ctx({ applicantId: null })).status).toBe('no-account-match');
    expect(resolveRecordedIaa({ emailaddress1: 'a@x.edu' }, ctx({ applicantId: null })).status).toBe('no-account-match');
  });
  test('free mail is not a PI-domain match', () => {
    expect(resolveExtractedIaa({ email: 'a@gmail.com' }, ctx({ piDomains: ['gmail.com'] })).status).toBe('no-account-match');
  });
  test('domain map and account name agree → resolved; disagree → conflict', () => {
    const accounts = [{ accountid: 'Y1', name: 'Y University', statecode: 0 }];
    const map = (w) => () => ({ status: 'winner', accountId: w });
    expect(resolveExtractedIaa({ email: 'a@y.edu', institution: 'Y University' }, ctx({ domainMap: map('y1'), accounts })))
      .toMatchObject({ status: 'resolved', accountId: 'y1' });
    expect(resolveExtractedIaa({ email: 'a@x.edu', institution: 'Y University' }, ctx({ accounts })).status).toBe('conflicting-evidence');
  });
  test('assumed institution never resolves by name', () => {
    const accounts = [{ accountid: 'Y1', name: 'Y University', statecode: 0 }];
    expect(resolveExtractedIaa({ email: '', institution: 'Y University', institutionSource: 'assumed' }, ctx({ accounts })).status).toBe('assumed-institution');
  });
  test('recorded co-PI: contact account, then PI domain, then domain map', () => {
    expect(resolveRecordedIaa({ _parentcustomerid_value: 'C1', _parentcustomerid_value_entity: 'account' }, ctx())).toMatchObject({ accountId: 'c1', via: 'contact-account' });
    expect(resolveRecordedIaa({ emailaddress1: 'a@sub.x.edu' }, ctx())).toMatchObject({ accountId: 'app', via: 'pi-email-domain' });
    expect(resolveRecordedIaa({ emailaddress1: 'a@y.edu' }, ctx({ domainMap: () => ({ status: 'winner', accountId: 'Y1' }) }))).toMatchObject({ accountId: 'y1', via: 'domain-map' });
    expect(resolveRecordedIaa({ emailaddress1: 'a@y.edu' }, ctx()).status).toBe('no-account-match');
    expect(resolveRecordedIaa({ _parentcustomerid_value: 'C1', _parentcustomerid_value_entity: 'contact' }, ctx()).status).toBe('no-account-match');
  });
});

describe('web evidence', () => {
  const r = (title, link) => ({ title, link });
  const hostAccount = (h) => (h.endsWith('y.edu') ? 'Y1' : h.endsWith('z.edu') ? 'Z1' : null);
  test('counts only named results on institution hosts that map to an account', () => {
    const out = classifyWebEvidence('Jane Doe', [
      r('Jane Doe | LinkedIn', 'https://www.linkedin.com/in/jd'),
      r('Jane Doe, PhD - Faculty', 'https://profiles.y.edu/jdoe'),
      r('Lab of John Smith', 'https://z.edu/smith'),
      r('J. Doe Lab', 'https://www.y.edu/doe'),
    ], hostAccount);
    expect(out).toMatchObject({ status: 'current-account', accountId: 'y1' });
    expect(out.hits).toHaveLength(2);
  });
  test('two institutions → ambiguous; nothing → no evidence', () => {
    expect(classifyWebEvidence('Jane Doe', [r('Jane Doe', 'https://y.edu/a'), r('Jane Doe', 'https://z.edu/b')], hostAccount).status).toBe('ambiguous');
    expect(classifyWebEvidence('Jane Doe', [r('Jane Doe', 'not a url')], hostAccount).status).toBe('no-evidence');
  });
  test('non-institution hosts match whole labels only', () => {
    expect(isNonInstitutionHost('ncbi.nlm.nih.gov')).toBe(true);
    expect(isNonInstitutionHost('www.nimh.nih.gov')).toBe(false);
    expect(isNonInstitutionHost('notlinkedin.com')).toBe(false);
  });
  test('a hyphenated surname in the title still names the person', () => {
    expect(classifyWebEvidence('Jane Jones', [r('Jane Smith-Jones Lab', 'https://y.edu/a')], hostAccount).status).toBe('current-account');
  });
  test('query quotes the name and adds the department', () => {
    expect(webQuery({ name: 'Jane "J" Doe', department: 'Chemistry' })).toBe('"Jane J Doe" Chemistry');
  });
});

describe('classifyRow', () => {
  const base = (o = {}) => ({
    inScope: true, keckApplicant: false, applicantEntity: 'account', contact: { status: 'email' }, contactId: 'c1',
    projectLeaderId: 'pl', piRowForContact: false, contactInactive: false, existingIaa: null,
    iaa: { status: 'resolved', accountId: 'a' }, junctionRowId: null, duplicateContact: false,
    contactAccountEmpty: false, contactAccountSelected: false, newContactAccount: null, ...o,
  });
  test.each([
    ['out of scope', { inScope: false }, 'out-of-scope'],
    ['Keck applicant', { keckApplicant: true }, 'keck-applicant'],
    ['ambiguous contact', { contact: { status: 'ambiguous-email' } }, 'ambiguous-contact'],
    ['possible existing', { contact: { status: 'possible-existing-contact' }, contactId: null }, 'possible-existing-contact'],
    ['contact is the PI', { contactId: 'pl' }, 'is-pi'],
    ['contact has a PI row', { piRowForContact: true }, 'is-pi'],
    ['already set', { existingIaa: 'x', junctionRowId: 'j' }, 'already-set'],
    ['no account', { iaa: { status: 'no-account-match' } }, 'no-account-match'],
    ['duplicate contact needing a new row', { duplicateContact: true }, 'duplicate-contact'],
    ['unparseable name', { contact: { status: 'name-unparseable' }, contactId: null }, 'name-unparseable'],
    ['resolved without an account id', { iaa: { status: 'resolved', accountId: '' } }, 'no-account-match'],
  ])('%s', (_, o, cls) => expect(classifyRow(base(o)).cls).toBe(cls));

  test('existing contact without a row: create row, set IAA, link empty account', () => {
    expect(classifyRow(base({ contactAccountEmpty: true, contactAccountSelected: true })).actions)
      .toEqual(['create-junction-row', 'set-iaa', 'set-contact-account']);
  });
  test('existing junction row only needs IAA, even for a duplicate contact', () => {
    expect(classifyRow(base({ junctionRowId: 'j', duplicateContact: true, contactAccountEmpty: true, contactAccountSelected: true })))
      .toEqual({ cls: 'ready', actions: ['set-iaa'] });
  });
  test('new contact: create contact (+ current account when found), row, IAA', () => {
    expect(classifyRow(base({ contact: { status: 'new-contact' }, contactId: null, newContactAccount: 'y' })).actions)
      .toEqual(['create-contact', 'set-contact-account', 'create-junction-row', 'set-iaa']);
    expect(classifyRow(base({ contact: { status: 'new-contact' }, contactId: null })).actions)
      .toEqual(['create-contact', 'create-junction-row', 'set-iaa']);
  });
});

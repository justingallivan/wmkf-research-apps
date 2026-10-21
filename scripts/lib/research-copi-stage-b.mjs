/**
 * Pure decision logic for scripts/resolve-research-copi-institution-at-award.mjs,
 * Stage B of the Research Institution at Award backfill
 * (plan docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2).
 * No Dataverse or network access here, so every rule is unit-tested
 * (tests/unit/research-copi-stage-b.test.js).
 *
 * Owner rules (2026-10-20): Institution at Award comes from our own data —
 * the proposal's email domain or stated institution for 2017–2023, the
 * contact's account for recorded (2024-on) co-PIs. Web search (SerpAPI) is
 * evidence only for the current account of a contact that must be created.
 */

import crypto from 'crypto';
import { nameTokens } from './research-copi-roles.mjs';
import { classifyReviewerAffiliationAccount } from '../../lib/utils/reviewer-institution-account-match.js';

export const lc = (v) => (v ? String(v).trim().toLowerCase() : '');

// ── Approved people from the owner's CSVs ──

/**
 * The approved 2017–2023 co-PIs: rule-c co-PIs from the extraction, `co-PI`
 * rows from the role check and its re-check, and — only on the grants the
 * owner names — `budget-only` rows and the single `unassessed` re-check row.
 * @param {{candidates: object[], roles: object[], recheck: object[]}} csv parsed CSV rows
 * @param {{budgetOnly: string[], unassessed: string[]}} approve request numbers
 * @returns {{people: object[], duplicates: number}} each person carries `ref`, a
 *   hash of request number + normalized name, so logs can name the row without the name.
 */
export function selectApprovedCopis({ candidates, roles, recheck }, approve) {
  const picked = [];
  const add = (x, source) => picked.push({
    source, year: x.year, requestNum: String(x.requestNum).trim(), name: x.name.trim(),
    email: lc(x.email), institution: (x.institution || '').trim(), institutionSource: x.institutionSource || '',
    department: (x.department || '').trim(), title: (x.title || '').trim(),
  });
  for (const x of candidates) if (x.decision === 'co-PI' && /^c\b/.test(x.rule)) add(x, 'named-in-documents');
  for (const x of roles) {
    if (x.decision === 'co-PI') add(x, 'role-check');
    else if (x.decision === 'budget-only' && approve.budgetOnly.includes(String(x.requestNum))) add(x, 'budget-only-approved');
  }
  for (const x of recheck) if (x.decision === 'co-PI') add(x, 're-check');
  for (const num of approve.unassessed) {
    const rows = recheck.filter((x) => String(x.requestNum) === num && x.decision === 'unassessed');
    if (rows.length !== 1) throw new Error(`--approve-unassessed=${num}: expected exactly one unassessed re-check row, found ${rows.length}`);
    add(rows[0], 'owner-approved');
  }
  const seen = new Set();
  const people = [];
  for (const p of picked) {
    const key = `${p.requestNum}|${nameTokens(p.name).join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ ...p, ref: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) });
  }
  return { people, duplicates: picked.length - people.length };
}

// ── Email domains ──

/** Free-mail providers: never evidence of an institution. */
export const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'gmx.de', 'mail.com', 'qq.com',
  '163.com', '126.com', 'yandex.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]);
export const domainOf = (email) => {
  const e = lc(email);
  const at = e.lastIndexOf('@');
  return at > 0 ? e.slice(at + 1) : '';
};
export const institutionalDomain = (email) => {
  const d = domainOf(email);
  return d && !FREEMAIL.has(d) ? d : '';
};
/** Same domain, or one is a subdomain of the other (`med.x.edu` ~ `x.edu`). Never "last two labels". */
export const domainsRelated = (a, b) => Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));

// Second-level labels that sit under a country code (`ox.ac.uk`): a registrable
// domain there needs three labels, so `ac.uk` itself is never a candidate.
const SHARED_SECOND_LEVEL = new Set(['ac', 'edu', 'co', 'org', 'gov', 'com', 'net', 'res', 'med']);
/**
 * Domains to look up for a web host, most specific first: `profiles.med.x.edu`
 * → [`profiles.med.x.edu`, `med.x.edu`, `x.edu`].
 */
export function domainCandidates(host) {
  const labels = lc(host).replace(/^www\./, '').split('.').filter(Boolean);
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const rest = labels.slice(i);
    if (rest.length < 2) break;
    if (rest.length === 2 && rest[1].length === 2 && SHARED_SECOND_LEVEL.has(rest[0])) break;
    out.push(rest.join('.'));
  }
  return out;
}

// ── Domain → account map from contacts staff already linked ──

/**
 * Clear winner among the accounts of contacts whose primary email has this domain.
 * A read over the 5,000-row cap is the first 5,000 rows, not a sample, so it
 * never yields a winner (`capped`, review only).
 * @param {{accountIds: string[], capped: boolean}} linked accounts of linked contacts
 * @param {{min: number, share: number}} rule
 * @returns {{status: 'winner'|'too-few'|'split'|'capped', accountId?: string, n: number, top: number}}
 */
export function domainWinner(linked, rule) {
  const counts = new Map();
  for (const id of linked.accountIds.map(lc)) counts.set(id, (counts.get(id) || 0) + 1);
  const n = linked.accountIds.length;
  const [accountId, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  if (linked.capped) return { status: 'capped', n, top };
  if (n < rule.min) return { status: 'too-few', n, top };
  if (top / n < rule.share) return { status: 'split', n, top };
  return { status: 'winner', accountId, n, top };
}

// ── Names ──

// Last name compared on its final word and final hyphen segment, so
// "Jane Smith Jones", "Jane Smith-Jones" and a contact "Smith-Jones" all compare on "jones".
const lastKey = (t) => (t || '').split('-').filter(Boolean).at(-1) || '';
/** {first, last} tokens of a person's name, honorifics and degrees removed. */
export function nameParts(name) {
  const t = nameTokens(name);
  return { first: t[0] || '', last: t.length > 1 ? lastKey(t.at(-1)) : '' };
}
function contactParts(c) {
  const first = nameTokens(c.firstname)[0];
  const last = lastKey(nameTokens(c.lastname).at(-1));
  return first && last ? { first, last } : nameParts(c.fullname);
}
/** Same last name, and the same first name (or matching initial when either is an initial). */
export function sameName(personName, contact) {
  const p = nameParts(personName);
  const c = contactParts(contact);
  if (!p.last || p.last !== c.last || !p.first || !c.first) return false;
  if (p.first === c.first) return true;
  return (p.first.length === 1 || c.first.length === 1) && p.first[0] === c.first[0];
}
export const contactEmails = (c) => [c.emailaddress1, c.emailaddress2, c.emailaddress3].map(lc).filter(Boolean);

// ── Contact match for an extracted person ──

/**
 * Match one extracted person to an existing contact.
 * @param {{name: string, email: string}} person
 * @param {object[]} emailHits contacts holding the person's email in any of the three fields
 * @param {object[]} lastNameHits contacts sharing the person's last name
 * @param {string|null} awardAccountId the resolved Institution at Award, if any
 * @returns {{status: string, contactId?: string, candidateIds?: string[]}}
 *   status: email | name-domain | ambiguous-email | ambiguous-name-domain |
 *   name-unparseable | possible-existing-contact | new-contact
 */
export function matchContact(person, emailHits, lastNameHits, awardAccountId) {
  const byEmail = [...new Set(emailHits.map((c) => lc(c.contactid)))];
  if (byEmail.length === 1) return { status: 'email', contactId: byEmail[0] };
  if (byEmail.length > 1) return { status: 'ambiguous-email', candidateIds: byEmail };
  if (!nameParts(person.name).last || !nameParts(person.name).first) return { status: 'name-unparseable' };
  const domain = institutionalDomain(person.email);
  const named = lastNameHits.filter((c) => sameName(person.name, c));
  const byNameDomain = domain ? named.filter((c) => contactEmails(c).some((e) => domainsRelated(institutionalDomain(e), domain))) : [];
  const ids = (list) => [...new Set(list.map((c) => lc(c.contactid)))];
  if (ids(byNameDomain).length === 1) return { status: 'name-domain', contactId: ids(byNameDomain)[0] };
  if (ids(byNameDomain).length > 1) return { status: 'ambiguous-name-domain', candidateIds: ids(byNameDomain) };
  // Before proposing a new contact: anyone with this name, or anyone with this
  // last name at the same institution (nicknames: "Bill" vs "William"), goes to review.
  const sameLastSamePlace = lastNameHits.filter((c) => nameParts(person.name).last === contactParts(c).last && (
    (domain && contactEmails(c).some((e) => domainsRelated(institutionalDomain(e), domain)))
    || (awardAccountId && lc(c._parentcustomerid_value) === lc(awardAccountId))));
  const possible = ids([...named, ...sameLastSamePlace]);
  if (possible.length) return { status: 'possible-existing-contact', candidateIds: possible };
  return { status: 'new-contact' };
}

// ── Current account for an existing empty-account contact ──

/**
 * The account of each contact's latest in-scope award, across every award the
 * contact is on (co-PI rows whether or not their Institution at Award needs
 * writing, and PI rows). `accountId` is null when that award's institution is
 * unresolved; a latest award with no account, or latest awards on one date
 * with different accounts, selects nothing.
 * @param {{contactId: string, meetingDate: string, accountId: string|null, requestId: string}[]} evidence
 * @returns {Map<string, {status: 'selected'|'tie'|'unresolved', requestId?: string, accountId?: string}>}
 */
export function pickLatestAccount(evidence) {
  const byContact = new Map();
  for (const e of evidence) byContact.set(e.contactId, [...(byContact.get(e.contactId) || []), e]);
  const out = new Map();
  for (const [contactId, items] of byContact) {
    const latest = items.reduce((m, e) => (e.meetingDate > m ? e.meetingDate : m), '');
    const top = items.filter((e) => e.meetingDate === latest);
    const accounts = new Set(top.map((e) => e.accountId && lc(e.accountId)));
    if (accounts.has(null) || accounts.has('')) out.set(contactId, { status: 'unresolved' });
    else if (accounts.size > 1) out.set(contactId, { status: 'tie' });
    else out.set(contactId, { status: 'selected', requestId: top[0].requestId, accountId: lc(top[0].accountId) });
  }
  return out;
}

// ── Institution at Award ──

/**
 * Award-era institution for an extracted 2017–2023 co-PI, from our own data.
 * Signals: the applicant when the proposal email's domain matches the PI's;
 * the domain map's clear winner for that domain; a unique exact Account name
 * match on the stated institution. All signals that fire must agree.
 * @param {object} p {email, institution, institutionSource}
 * @param {{piDomains: string[], applicantId: string, domainMap: (d: string) => object|null, accounts: object[]}} ctx
 * @returns {{status: 'resolved'|'conflicting-evidence'|'no-account-match'|'assumed-institution', accountId?: string, signals: object[]}}
 */
export function resolveExtractedIaa(p, ctx) {
  const signals = [];
  const domain = institutionalDomain(p.email);
  if (ctx.applicantId && domain && ctx.piDomains.some((d) => domainsRelated(d, domain))) signals.push({ via: 'pi-email-domain', accountId: lc(ctx.applicantId) });
  if (domain) {
    const w = ctx.domainMap(domain);
    if (w?.status === 'winner') signals.push({ via: 'domain-map', accountId: lc(w.accountId) });
  }
  if (p.institution && p.institutionSource !== 'assumed') {
    const m = classifyReviewerAffiliationAccount(p.institution, ctx.accounts);
    if (m.status === 'unique_exact_target') signals.push({ via: 'account-name', accountId: lc(m.targets[0].accountId) });
  }
  const ids = [...new Set(signals.map((s) => s.accountId))];
  if (ids.length > 1) return { status: 'conflicting-evidence', signals };
  if (ids.length === 1) return { status: 'resolved', accountId: ids[0], signals };
  if (p.institutionSource === 'assumed') return { status: 'assumed-institution', signals };
  return { status: 'no-account-match', signals };
}

/**
 * Institution for a co-PI already recorded on a (2024-on) award, per plan §3.2:
 * the contact's account; else the applicant when the contact's email domain
 * matches the PI's; else the domain map's clear winner; else review.
 * @param {object} contact the recorded co-PI contact
 * @returns {{status: 'resolved'|'no-account-match', accountId?: string, via?: string}}
 */
export function resolveRecordedIaa(contact, ctx) {
  const parent = lc(contact?._parentcustomerid_value);
  if (parent && contact._parentcustomerid_value_entity === 'account') return { status: 'resolved', accountId: parent, via: 'contact-account' };
  const domains = contactEmails(contact || {}).map(institutionalDomain).filter(Boolean);
  if (ctx.applicantId && domains.some((d) => ctx.piDomains.some((pd) => domainsRelated(pd, d)))) return { status: 'resolved', accountId: lc(ctx.applicantId), via: 'pi-email-domain' };
  const winners = [...new Set(domains.map((d) => ctx.domainMap(d)).filter((w) => w?.status === 'winner').map((w) => lc(w.accountId)))];
  if (winners.length === 1) return { status: 'resolved', accountId: winners[0], via: 'domain-map' };
  return { status: 'no-account-match' };
}

// ── Web search evidence for a new contact's current account ──

/** Hosts that never identify an employer. */
export const NON_INSTITUTION_HOSTS = [
  'linkedin.com', 'researchgate.net', 'scholar.google.com', 'google.com', 'wikipedia.org', 'ncbi.nlm.nih.gov',
  'pubmed.gov', 'nsf.gov', 'orcid.org', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'zoominfo.com', 'rocketreach.co', 'doximity.com', 'healthgrades.com', 'vitals.com', 'webmd.com',
  'ratemyprofessors.com', 'academia.edu', 'semanticscholar.org', 'openalex.org', 'crunchbase.com', 'amazon.com',
  'nature.com', 'science.org', 'sciencedirect.com', 'springer.com', 'wiley.com', 'cell.com', 'pnas.org',
  'biorxiv.org', 'arxiv.org', 'medrxiv.org', 'grantome.com', 'reporter.nih.gov', 'wmkeck.org',
];
export const isNonInstitutionHost = (host) => NON_INSTITUTION_HOSTS.some((h) => lc(host) === h || lc(host).endsWith(`.${h}`));

// Titles that mention a person without showing where they work now.
const NOT_EMPLOYMENT = /\b(visiting|visit|seminar|seminars|speaker|speakers|lecture|lectures|talk|talks|colloquium|symposium|workshop|webinar|keynote|conference|former|emeritus|emerita|alumni|alumnus|alumna|news|award|awards|prize|obituary|memoriam|interview|podcast|event|events)\b/;

/**
 * Suggested current institution from web search results for a person who
 * needs a new contact. A result counts only when its title names the person
 * (first + last, or initial + last), does not read as an event, news item or
 * former role, and its host maps to an account; all counted results must
 * agree. This is a suggestion the owner confirms separately, never proof of
 * employment (Codex review 2026-10-20).
 * @param {string} name
 * @param {{title: string, link: string}[]} results
 * @param {(host: string) => string|null} hostAccount account id for a host, or null
 * @returns {{status: 'suggested-account'|'ambiguous'|'no-evidence', accountId?: string, hits: object[]}}
 */
export function classifyWebEvidence(name, results, hostAccount) {
  const p = nameParts(name);
  const hits = [];
  for (const r of results || []) {
    let host = '';
    try { host = new URL(r.link).hostname; } catch { continue; }
    if (!host || isNonInstitutionHost(host)) continue;
    const t = nameTokens(r.title).flatMap((x) => [x, ...x.split('-')]);
    const named = t.includes(p.last) && t.some((x) => x === p.first || (p.first.length > 0 && x.length === 1 && x === p.first[0]));
    if (!named || NOT_EMPLOYMENT.test(nameTokens(r.title).join(' '))) continue;
    const accountId = hostAccount(host);
    hits.push({ host, link: r.link, title: r.title, accountId: accountId ? lc(accountId) : null });
  }
  const accounts = [...new Set(hits.map((h) => h.accountId).filter(Boolean))];
  if (accounts.length === 1) return { status: 'suggested-account', accountId: accounts[0], hits };
  if (accounts.length > 1) return { status: 'ambiguous', hits };
  return { status: 'no-evidence', hits };
}

/** Search query for a person's current page: quoted name plus department, else the award institution. */
export function webQuery(p) {
  const n = nameParts(p.name);
  const quoted = `"${p.name.replace(/"/g, '').replace(/\s+/g, ' ').trim()}"`;
  return n.last ? `${quoted} ${p.department || p.institution || ''}`.trim() : '';
}

// ── New contacts across the batch ──

/**
 * Group the people who would each get a new contact, so one person on two
 * awards gets one contact. The same email (exact) joins a group. People who
 * share no email but have the same name (first or initial + last), or the same
 * last name at a related institutional email domain or the same resolved
 * account (nicknames: "Bill" vs "William"), are uncertain: every group they
 * touch goes to review. Mirrors matchContact's guard for existing contacts.
 * @param {{idx: number, ref: string, name: string, email: string, accountId?: string}[]} people in row order
 * @returns {Map<number, {status: 'single'|'shared'|'uncertain', groupRef: string, primary: boolean}>}
 */
export function groupNewContacts(people) {
  const parent = people.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(b)] = find(a); };
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) if (people[i].email && people[i].email === people[j].email) union(i, j);
  }
  const uncertain = new Set();
  const sameNameParts = (a, b) => {
    const x = nameParts(a); const y = nameParts(b);
    if (!x.last || x.last !== y.last || !x.first || !y.first) return false;
    return x.first === y.first || ((x.first.length === 1 || y.first.length === 1) && x.first[0] === y.first[0]);
  };
  const samePlace = (a, b) => {
    const da = institutionalDomain(a.email); const db = institutionalDomain(b.email);
    return domainsRelated(da, db) || Boolean(a.accountId && lc(a.accountId) === lc(b.accountId));
  };
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (find(i) === find(j)) continue;
      const a = people[i]; const b = people[j];
      const lastA = nameParts(a.name).last;
      if (sameNameParts(a.name, b.name) || (lastA && lastA === nameParts(b.name).last && samePlace(a, b))) {
        uncertain.add(find(i)); uncertain.add(find(j));
      }
    }
  }
  const members = new Map();
  people.forEach((_, i) => members.set(find(i), [...(members.get(find(i)) || []), i]));
  const out = new Map();
  for (const [root, list] of members) {
    const status = uncertain.has(root) ? 'uncertain' : list.length > 1 ? 'shared' : 'single';
    for (const i of list) out.set(people[i].idx, { status, groupRef: people[list[0]].ref, primary: i === list[0] });
  }
  return out;
}

// ── Row classification ──

/**
 * Class and planned actions for one person-on-award row. The class is the
 * first blocking issue in a fixed order; only `ready` rows carry actions.
 * @param {object} x facts gathered by resolve (see the script)
 * @returns {{cls: string, actions: string[]}}
 */
export function classifyRow(x) {
  const block = (cls) => ({ cls, actions: [] });
  if (!x.inScope) return block('out-of-scope');
  if (x.keckApplicant) return block('keck-applicant');
  if (x.applicantEntity && x.applicantEntity !== 'account') return block('applicant-not-account');
  if (x.contact.status === 'ambiguous-email' || x.contact.status === 'ambiguous-name-domain') return block('ambiguous-contact');
  if (x.contact.status === 'possible-existing-contact') return block('possible-existing-contact');
  if (x.contact.status === 'name-unparseable') return block('name-unparseable');
  if (x.contactId && x.contactId === x.projectLeaderId) return block('is-pi');
  if (x.piRowForContact) return block('is-pi');
  if (x.contactInactive) return block('inactive-contact');
  if (x.existingIaa) return block('already-set');
  if (x.iaa.status !== 'resolved') return block(x.iaa.status);
  if (!x.iaa.accountId) return block('no-account-match');
  const actions = [];
  if (x.contact.status === 'new-contact') {
    const g = x.newContactGroup;
    if (g?.status === 'uncertain') return block('possible-same-new-person');
    if (g && !g.primary) actions.push('link-proposed-contact');
    else {
      actions.push('create-contact');
      // Web evidence only suggests; the workbook asks for its own confirmation.
      if (x.newContactAccount) actions.push('suggest-contact-account');
    }
  } else if (x.duplicateContact && !x.junctionRowId) {
    return block('duplicate-contact');
  }
  if (!x.junctionRowId) actions.push('create-junction-row');
  actions.push('set-iaa');
  // An existing contact's empty account is a separate contact-level row (see the script).
  return { cls: 'ready', actions };
}

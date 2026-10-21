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
 * @returns {{people: object[], duplicates: number}}
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
    people.push({ ...p, key });
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
 * A large institution can exceed the 5,000-row read cap; the share rule is then
 * judged on that 5,000-row sample and the result is marked `sampled`.
 * @param {{accountIds: string[], capped: boolean}} linked accounts of linked contacts
 * @param {{min: number, share: number}} rule
 * @returns {{status: 'winner'|'too-few'|'split', accountId?: string, n: number, top: number, sampled: boolean}}
 */
export function domainWinner(linked, rule) {
  const sampled = Boolean(linked.capped);
  const counts = new Map();
  for (const id of linked.accountIds.map(lc)) counts.set(id, (counts.get(id) || 0) + 1);
  const n = linked.accountIds.length;
  const [accountId, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  if (n < rule.min) return { status: 'too-few', n, top, sampled };
  if (top / n < rule.share) return { status: 'split', n, top, sampled };
  return { status: 'winner', accountId, n, top, sampled };
}

// ── Names ──

/** {first, last} tokens of a person's name, honorifics and degrees removed. */
export function nameParts(name) {
  const t = nameTokens(name);
  return { first: t[0] || '', last: t.at(-1) || '' };
}
function contactParts(c) {
  const first = nameTokens(c.firstname)[0];
  const last = nameTokens(c.lastname).at(-1);
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
 *   possible-existing-contact | new-contact
 */
export function matchContact(person, emailHits, lastNameHits, awardAccountId) {
  const byEmail = [...new Set(emailHits.map((c) => lc(c.contactid)))];
  if (byEmail.length === 1) return { status: 'email', contactId: byEmail[0] };
  if (byEmail.length > 1) return { status: 'ambiguous-email', candidateIds: byEmail };
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
  if (domain && ctx.piDomains.some((d) => domainsRelated(d, domain))) signals.push({ via: 'pi-email-domain', accountId: lc(ctx.applicantId) });
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
  if (domains.some((d) => ctx.piDomains.some((pd) => domainsRelated(pd, d)))) return { status: 'resolved', accountId: lc(ctx.applicantId), via: 'pi-email-domain' };
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

/**
 * Current institution from web search results for a person who needs a new
 * contact. A result counts only when its title names the person (first + last,
 * or initial + last) and its host maps to an account; all counted results must
 * agree.
 * @param {string} name
 * @param {{title: string, link: string}[]} results
 * @param {(host: string) => string|null} hostAccount account id for a host, or null
 * @returns {{status: 'current-account'|'ambiguous'|'no-evidence', accountId?: string, hits: object[]}}
 */
export function classifyWebEvidence(name, results, hostAccount) {
  const p = nameParts(name);
  const hits = [];
  for (const r of results || []) {
    let host = '';
    try { host = new URL(r.link).hostname; } catch { continue; }
    if (!host || isNonInstitutionHost(host)) continue;
    const t = nameTokens(r.title);
    const named = t.includes(p.last) && t.some((x) => x === p.first || (p.first.length > 0 && x.length === 1 && x === p.first[0]));
    if (!named) continue;
    const accountId = hostAccount(host);
    hits.push({ host, link: r.link, title: r.title, accountId: accountId ? lc(accountId) : null });
  }
  const accounts = [...new Set(hits.map((h) => h.accountId).filter(Boolean))];
  if (accounts.length === 1) return { status: 'current-account', accountId: accounts[0], hits };
  if (accounts.length > 1) return { status: 'ambiguous', hits };
  return { status: 'no-evidence', hits };
}

/** Search query for a person's current page: quoted name plus department, else the award institution. */
export function webQuery(p) {
  const n = nameParts(p.name);
  const quoted = `"${p.name.replace(/"/g, '').replace(/\s+/g, ' ').trim()}"`;
  return n.last ? `${quoted} ${p.department || p.institution || ''}`.trim() : '';
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
  if (x.contactId && x.contactId === x.projectLeaderId) return block('is-pi');
  if (x.piRowForContact) return block('is-pi');
  if (x.contactInactive) return block('inactive-contact');
  if (x.existingIaa) return block('already-set');
  if (x.iaa.status !== 'resolved') return block(x.iaa.status);
  const actions = [];
  if (x.contact.status === 'new-contact') {
    actions.push('create-contact');
    if (x.newContactAccount) actions.push('set-contact-account');
  } else if (x.duplicateContact && !x.junctionRowId) {
    return block('duplicate-contact');
  }
  if (!x.junctionRowId) actions.push('create-junction-row');
  actions.push('set-iaa');
  if (x.contact.status !== 'new-contact' && x.contactAccountEmpty && x.contactAccountSelected && !x.duplicateContact) actions.push('set-contact-account');
  return { cls: 'ready', actions };
}

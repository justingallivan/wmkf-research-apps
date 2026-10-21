/**
 * resolve-research-copi-institution-at-award.mjs — Stage B resolve (READ-ONLY
 * in Dataverse) of the Research Institution at Award backfill: co-PI rows on
 * awarded Research requests.
 * Plan: docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2.
 * Owner-run only. Decision rules live in scripts/lib/research-copi-stage-b.mjs
 * (unit-tested); scope matches backfill-research-pi-institution-at-award.mjs.
 *
 * Two cohorts:
 *   extracted  The owner-approved 2017–2023 co-PIs from the CSVs (rule-c
 *              co-PIs, role-check co-PIs, re-check co-PIs, plus the grants named
 *              in --approve-budget-only / --approve-unassessed). Institution at
 *              Award comes from the proposal: PI email domain → applicant,
 *              domain → account map, or exact Account name. Matched to a
 *              contact by email (any of three fields), then name + email domain.
 *   recorded   Every co-PI already on an in-scope award (Co-PI junction row or
 *              legacy wmkf_copi1..5 slot), read live. Institution: the
 *              contact's account, else the applicant on a PI email-domain
 *              match, else the domain map.
 * Rows needing a new contact get a capped Google search (SerpAPI) for the
 * person's current page; its host can propose the new contact's account.
 * That is the only use of web evidence (owner, 2026-10-20).
 *
 *   node scripts/resolve-research-copi-institution-at-award.mjs \
 *     --inputs-dir=<folder with the CSVs> --out-dir=<dir outside the repo> \
 *     --approve-budget-only=992950 --approve-unassessed=991649,994865 \
 *     [--since=2017-01-01] [--map-min=3] [--map-share=0.9] [--max-searches=400] [--no-web]
 *
 * Writes research-copi-iaa-resolve.jsonl (ids only; a meta line first with
 * input file hashes) and research-copi-iaa-review.xlsx (names; the owner marks
 * Confirm? = Yes/No/Unsure), plus research-copi-web-cache.json so a rerun does
 * not repeat searches (the cache holds query strings, which contain names; keep
 * it with the workbook). Extracted rows are keyed by a hash of request number +
 * normalized name, recomputable from the CSVs whose hashes the meta line
 * records. Prints counts and the 8-char resolve hash. Writes
 * nothing to Dataverse; an apply step is a separate, reviewed build.
 *
 * Acts against whatever .env.local points at.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { AWARDED, pickContactAccounts } from './lib/research-iaa-backfill.mjs';
import {
  lc, nameParts, selectApprovedCopis, institutionalDomain, domainCandidates, domainWinner, contactEmails,
  matchContact, resolveExtractedIaa, resolveRecordedIaa, classifyWebEvidence, webQuery, classifyRow,
} from './lib/research-copi-stage-b.mjs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name) => process.argv.includes(`--${name}`);
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const OUT_DIR = arg('out-dir');
const INPUTS = arg('inputs-dir');
const SINCE = arg('since') || '2017-01-01';
const MAP_RULE = { min: Number(arg('map-min') || 3), share: Number(arg('map-share') || 0.9) };
const MAX_SEARCHES = Number(arg('max-searches') || 400);
const WEB = !flag('no-web');
const APPROVE = { budgetOnly: list(arg('approve-budget-only')), unassessed: list(arg('approve-unassessed')) };
if (!OUT_DIR || !INPUTS) { console.error('--out-dir=<dir outside the repo> and --inputs-dir=<folder with the CSVs> are required'); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) { console.error('--since must be YYYY-MM-DD'); process.exit(2); }
if (!(MAP_RULE.min >= 1) || !(MAP_RULE.share > 0.5 && MAP_RULE.share <= 1)) { console.error('--map-min must be >= 1 and --map-share in (0.5, 1]'); process.exit(2); }
if (!(MAX_SEARCHES >= 0)) { console.error('--max-searches must be >= 0'); process.exit(2); }
const outAbs = path.resolve(OUT_DIR);
const repoAbs = path.resolve('.');
if (outAbs === repoAbs || outAbs.startsWith(`${repoAbs}${path.sep}`)) {
  console.error('--out-dir must be outside the repository (the workbook holds names).');
  process.exit(2);
}
fs.mkdirSync(outAbs, { recursive: true });
const RESOLVE_LOG = path.join(outAbs, 'research-copi-iaa-resolve.jsonl');
const REVIEW_XLSX = path.join(outAbs, 'research-copi-iaa-review.xlsx');
const WEB_CACHE = path.join(outAbs, 'research-copi-web-cache.json');
const INPUT_FILES = { candidates: 'research-copi-candidates.csv', roles: 'research-copi-roles-v3.csv', recheck: 'research-copi-roles-recheck.csv' };

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { escape } = await import('../lib/dataverse/core/odata.js');
const { SerpContactService } = await import('../lib/services/serp-contact-service.js');

const ROLE_PI = 100000000;
const ROLE_COPI = 100000001;
const SLOTS = [1, 2, 3, 4, 5].map((n) => `_wmkf_copi${n}_value`);
const KECK = /\bkeck foundation\b/i;
const CONTACT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1,emailaddress2,emailaddress3,_parentcustomerid_value,statecode';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const host = (() => { try { return new URL(process.env.DYNAMICS_URL).host; } catch { return ''; } })();

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])));
}

// queryAllRecords stops at 5,000; a truncated read would misclassify.
async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap.`); process.exit(1); }
  return result.records;
}
async function inBatches(ids, size, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

await bypassDynamicsRestrictions('resolve-research-copi-institution-at-award', async () => {
  // ── Inputs ──
  const inputs = {};
  const inputHashes = {};
  for (const [k, f] of Object.entries(INPUT_FILES)) {
    const text = fs.readFileSync(path.join(INPUTS, f), 'utf8');
    inputs[k] = parseCsv(text);
    inputHashes[f] = sha(text);
  }
  const { people, duplicates } = selectApprovedCopis(inputs, APPROVE);
  console.log(`Approved extracted co-PIs: ${people.length} (${duplicates} duplicate rows collapsed)`);

  // ── Scope (same as Stage A, plus statecode = Active) ──
  const programs = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
  const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
    ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '';
  const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
  if (!research.length) { console.error('No Research programs matched.'); process.exit(1); }
  const scopeProgramIds = research.map((p) => lc(p.akoya_programid)).sort();
  const requests = await readAll('akoya_requests', {
    select: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate', 'akoya_requeststatus', 'statecode', '_akoya_programid_value', '_akoya_applicantid_value', '_wmkf_projectleader_value', ...SLOTS].join(','),
    filter: `(${research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ')}) and (${AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ')}) and wmkf_meetingdate ge ${SINCE} and statecode eq 0`,
  });
  const byNum = new Map(requests.map((r) => [String(r.akoya_requestnum), r]));
  const byId = new Map(requests.map((r) => [lc(r.akoya_requestid), r]));

  const junction = await inBatches([...byId.keys()], 50, (ids) => readAll('wmkf_apprequestpersons', {
    select: 'wmkf_apprequestpersonid,wmkf_role,_wmkf_request_value,_wmkf_contact_value,_wmkf_institutionataward_value',
    filter: `(${ids.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')}) and (wmkf_role eq ${ROLE_PI} or wmkf_role eq ${ROLE_COPI})`,
  }));
  const rowFor = (requestId, contactId, role) => junction.filter((j) => lc(j._wmkf_request_value) === requestId && lc(j._wmkf_contact_value) === contactId && j.wmkf_role === role);

  const accounts = await readAll('accounts', { select: 'accountid,name,akoya_aka,wmkf_legalname,wmkf_dc_aka,statecode', filter: 'statecode eq 0' });
  const accountName = new Map(accounts.map((a) => [lc(a.accountid), a.name || '']));
  const keckAccounts = new Set(accounts.filter((a) => KECK.test(a.name || '')).map((a) => lc(a.accountid)));
  const nameableAccounts = accounts.filter((a) => !keckAccounts.has(lc(a.accountid)));

  const contacts = new Map();
  const loadContacts = async (ids) => {
    const need = [...new Set(ids.filter((id) => id && !contacts.has(id)))];
    for (const c of await inBatches(need, 50, (b) => readAll('contacts', { select: CONTACT_SELECT, filter: b.map((id) => `contactid eq ${id}`).join(' or ') }))) contacts.set(lc(c.contactid), c);
  };
  await loadContacts([...requests.map((r) => lc(r._wmkf_projectleader_value)), ...junction.map((j) => lc(j._wmkf_contact_value)), ...requests.flatMap((r) => SLOTS.map((s) => lc(r[s])))]);
  const piDomainsOf = (r) => contactEmails(contacts.get(lc(r._wmkf_projectleader_value)) || {}).map(institutionalDomain).filter(Boolean);

  // ── Domain → account map from contacts staff already linked (primary email) ──
  const mapCache = new Map();
  const domainMapAsync = async (domain) => {
    if (!mapCache.has(domain)) {
      const res = await DynamicsService.queryAllRecords('contacts', {
        select: '_parentcustomerid_value',
        filter: `endswith(emailaddress1,'@${escape(domain)}') and _parentcustomerid_value ne null and statecode eq 0`,
      });
      const ids = res.records.filter((c) => c._parentcustomerid_value_entity === 'account').map((c) => lc(c._parentcustomerid_value))
        .filter((id) => accountName.has(id) && !keckAccounts.has(id));
      mapCache.set(domain, domainWinner({ accountIds: ids, capped: Boolean(res.capped) }, MAP_RULE));
    }
    return mapCache.get(domain);
  };
  const warmMap = async (domains) => { for (const d of new Set(domains.filter(Boolean))) await domainMapAsync(d); };
  const domainMap = (d) => mapCache.get(d) || null;

  // ── Contact searches ──
  const emailHitsOf = async (email) => {
    if (!email) return [];
    const e = escape(email);
    return readAll('contacts', { select: CONTACT_SELECT, filter: `emailaddress1 eq '${e}' or emailaddress2 eq '${e}' or emailaddress3 eq '${e}'` });
  };
  // Last name equal, or the final word of a compound one ("de la Cruz", "Smith-Jones").
  // A capped search returns null: the person goes to review, never to a new contact.
  const lastNameHitsOf = async (name) => {
    const last = escape(nameParts(name).last);
    if (!last) return [];
    const res = await DynamicsService.queryAllRecords('contacts', {
      select: CONTACT_SELECT, filter: `lastname eq '${last}' or endswith(lastname,' ${last}') or endswith(lastname,'-${last}')`,
    });
    return res.capped ? null : res.records;
  };
  // Stage A duplicate search: another contact sharing any email or first + last name.
  const dupCache = new Map();
  const hasDuplicate = async (c) => {
    const id = lc(c.contactid);
    if (!dupCache.has(id)) {
      const clauses = [];
      for (const e of contactEmails(c)) for (const f of ['emailaddress1', 'emailaddress2', 'emailaddress3']) clauses.push(`${f} eq '${escape(e)}'`);
      if (c.firstname && c.lastname) clauses.push(`(firstname eq '${escape(c.firstname.trim())}' and lastname eq '${escape(c.lastname.trim())}')`);
      dupCache.set(id, clauses.length ? (await readAll('contacts', { select: 'contactid', filter: `(${clauses.join(' or ')}) and contactid ne ${c.contactid}` })).length > 0 : false);
    }
    return dupCache.get(id);
  };

  const requestFacts = (r) => ({
    inScope: Boolean(r),
    keckApplicant: Boolean(r && (KECK.test(r._akoya_applicantid_value_formatted || '') || keckAccounts.has(lc(r._akoya_applicantid_value)))),
    applicantEntity: r?._akoya_applicantid_value_entity || null,
    projectLeaderId: r ? lc(r._wmkf_projectleader_value) : null,
  });
  const contactFacts = async (r, contactId) => {
    const c = contacts.get(contactId);
    const requestId = lc(r?.akoya_requestid);
    const copiRows = r ? rowFor(requestId, contactId, ROLE_COPI) : [];
    return {
      contactId,
      contactInactive: c ? c.statecode !== 0 : false,
      piRowForContact: r ? rowFor(requestId, contactId, ROLE_PI).length > 0 : false,
      junctionRowId: copiRows[0] ? lc(copiRows[0].wmkf_apprequestpersonid) : null,
      existingIaa: copiRows[0] ? lc(copiRows[0]._wmkf_institutionataward_value) || null : null,
      inSlot: Boolean(r && SLOTS.some((s) => lc(r[s]) === contactId)),
      duplicateContact: c ? await hasDuplicate(c) : false,
      contactAccountEmpty: Boolean(c && !c._parentcustomerid_value),
    };
  };

  // ── Extracted cohort ──
  const rows = [];
  const pairKeys = new Set();
  for (const p of people) {
    const r = byNum.get(p.requestNum) || null;
    const facts = { cohort: 'extracted', person: p, r, ...requestFacts(r) };
    if (r) {
      await warmMap([institutionalDomain(p.email)]);
      facts.iaa = resolveExtractedIaa(p, { piDomains: piDomainsOf(r), applicantId: r._akoya_applicantid_value, domainMap, accounts: nameableAccounts });
      const emailHits = await emailHitsOf(p.email);
      const lastNameHits = (await lastNameHitsOf(p.name)) ?? null;
      facts.contact = lastNameHits === null && !emailHits.length
        ? { status: 'possible-existing-contact', candidateIds: [], reason: 'name search capped' }
        : matchContact(p, emailHits, lastNameHits || [], facts.iaa.accountId || null);
      facts.candidateNames = (facts.contact.candidateIds || []).map((id) => {
        const c = [...emailHits, ...(lastNameHits || [])].find((x) => lc(x.contactid) === id);
        return c ? `${c.fullname} <${contactEmails(c)[0] || 'no email'}>` : id;
      });
      for (const c of [...emailHits, ...(lastNameHits || [])]) contacts.set(lc(c.contactid), c);
      if (facts.contact.contactId) {
        Object.assign(facts, await contactFacts(r, facts.contact.contactId));
        pairKeys.add(`${lc(r.akoya_requestid)}|${facts.contact.contactId}`);
      }
    } else {
      facts.iaa = { status: 'out-of-scope', signals: [] };
      facts.contact = { status: 'not-checked' };
    }
    rows.push(facts);
  }

  // ── Recorded cohort (junction Co-PI rows and legacy slots, read live) ──
  const recorded = new Map();
  for (const j of junction.filter((x) => x.wmkf_role === ROLE_COPI)) recorded.set(`${lc(j._wmkf_request_value)}|${lc(j._wmkf_contact_value)}`, true);
  for (const r of requests) for (const s of SLOTS) if (r[s]) recorded.set(`${lc(r.akoya_requestid)}|${lc(r[s])}`, true);
  for (const k of recorded.keys()) {
    if (pairKeys.has(k)) continue; // an approved extracted person already covers this pair
    const [requestId, contactId] = k.split('|');
    const r = byId.get(requestId);
    const c = contacts.get(contactId);
    await warmMap(contactEmails(c || {}).map(institutionalDomain));
    const facts = {
      cohort: 'recorded', r, ...requestFacts(r), contact: { status: c ? 'recorded' : 'contact-missing', contactId },
      iaa: c ? resolveRecordedIaa(c, { piDomains: piDomainsOf(r), applicantId: r._akoya_applicantid_value, domainMap }) : { status: 'no-account-match' },
      ...(await contactFacts(r, contactId)),
    };
    rows.push(facts);
  }

  // ── Contact accounts for existing empty-account contacts: latest award evidence ──
  const fill = (x, extra = {}) => ({ ...x, contactAccountSelected: false, newContactAccount: null, ...extra });
  const prelim = rows.map((x) => classifyRow(fill(x)));
  const picks = pickContactAccounts(rows
    .filter((x, i) => prelim[i].cls === 'ready' && x.contactId && x.contactAccountEmpty && !x.duplicateContact)
    .map((x) => ({ contactId: x.contactId, meetingDate: (x.r.wmkf_meetingdate || '').slice(0, 10), applicantAccountId: x.iaa.accountId, requestId: lc(x.r.akoya_requestid) })));

  // ── Web search for new contacts (current account only) ──
  const cache = fs.existsSync(WEB_CACHE) ? JSON.parse(fs.readFileSync(WEB_CACHE, 'utf8')) : {};
  let searches = 0;
  const hostAccountCache = new Map();
  for (const [i, x] of rows.entries()) {
    if (x.contact.status !== 'new-contact' || prelim[i].cls !== 'ready') continue;
    const q = webQuery(x.person);
    x.webQuery = q;
    if (!WEB || !q) { x.web = { status: WEB ? 'no-query' : 'web-off', hits: [] }; continue; }
    if (!cache[q]) {
      if (searches >= MAX_SEARCHES) { x.web = { status: 'search-cap-reached', hits: [] }; continue; }
      searches++;
      try {
        cache[q] = await SerpContactService.searchOrganicResults(q, process.env.SERP_API_KEY, { limit: 10 });
      } catch (err) {
        x.web = { status: 'search-error', hits: [] };
        console.error(`Web search failed: ${String(err.message).slice(0, 120)}`);
        continue;
      }
      fs.writeFileSync(WEB_CACHE, JSON.stringify(cache));
    }
    const hosts = [...new Set(cache[q].map((r) => { try { return new URL(r.link).hostname; } catch { return ''; } }).filter(Boolean))];
    for (const h of hosts) {
      if (hostAccountCache.has(h)) continue;
      let id = null;
      for (const d of domainCandidates(h)) { const w = await domainMapAsync(d); if (w.status === 'winner') { id = w.accountId; break; } }
      hostAccountCache.set(h, id);
    }
    x.web = classifyWebEvidence(x.person.name, cache[q], (h) => hostAccountCache.get(h) || null);
  }

  // ── Final classification ──
  const results = rows.map((x, i) => {
    const pick = x.contactId ? picks.get(x.contactId) : null;
    const selected = Boolean(pick?.status === 'selected' && pick.requestId === lc(x.r?.akoya_requestid));
    const newContactAccount = x.web?.status === 'current-account' ? x.web.accountId : null;
    const { cls, actions } = classifyRow(fill(x, { contactAccountSelected: selected, newContactAccount }));
    const contactAccountTarget = actions.includes('set-contact-account') ? (newContactAccount || x.iaa.accountId) : null;
    const c = x.contactId ? contacts.get(x.contactId) : null;
    const r = x.r;
    const key = x.cohort === 'extracted' ? `ext|${x.person.ref}` : `rec|${lc(r.akoya_requestid)}|${x.contactId}`;
    return {
      ids: {
        key, cohort: x.cohort, class: cls, actions, host, since: SINCE, scopeProgramIds,
        source: x.person?.source || null,
        requestId: r ? lc(r.akoya_requestid) : null, requestNum: r?.akoya_requestnum || x.person?.requestNum || null,
        meetingDate: r ? (r.wmkf_meetingdate || '').slice(0, 10) : null, programId: r ? lc(r._akoya_programid_value) : null,
        applicantId: r ? lc(r._akoya_applicantid_value) : null, projectLeaderId: x.projectLeaderId || null,
        contactMatch: x.contact.status, contactId: x.contactId || null, junctionRowId: x.junctionRowId || null, inSlot: Boolean(x.inSlot),
        existingIaa: x.existingIaa || null, iaaAccountId: x.iaa.accountId || null,
        iaaVia: x.iaa.via || (x.iaa.signals || []).map((s) => s.via).join('+') || null,
        contactAccountTarget, contactAccountVia: contactAccountTarget ? (newContactAccount ? 'web-search' : 'latest-award') : null,
        duplicateContact: Boolean(x.duplicateContact),
      },
      review: {
        cls, actions: actions.join(', '),
        year: r ? (r.wmkf_meetingdate || '').slice(0, 4) : x.person?.year || '',
        request: r?.akoya_requestnum || x.person?.requestNum || '',
        person: x.person?.name || c?.fullname || '',
        source: x.cohort === 'extracted' ? x.person.source : `recorded (${x.junctionRowId ? 'junction' : ''}${x.junctionRowId && x.inSlot ? ' + ' : ''}${x.inSlot ? 'slot' : ''})`,
        proposalEmail: x.person?.email || '',
        statedInstitution: x.person ? `${x.person.institution}${x.person.institutionSource ? ` (${x.person.institutionSource})` : ''}` : '',
        applicant: r?._akoya_applicantid_value_formatted || '',
        iaa: accountName.get(x.iaa.accountId) || '',
        iaaEvidence: x.iaa.via || (x.iaa.signals || []).map((s) => `${s.via}: ${accountName.get(s.accountId) || s.accountId}`).join('; ') || x.iaa.status,
        contactMatch: x.contact.status,
        contact: c ? `${c.fullname} <${contactEmails(c).join(', ') || 'no email'}>` : '',
        contactCurrentAccount: c?._parentcustomerid_value_formatted || '',
        proposedContactAccount: accountName.get(contactAccountTarget) || '',
        contactAccountEvidence: contactAccountTarget ? (newContactAccount ? 'web search' : 'latest award') : '',
        web: (x.web?.hits || []).slice(0, 3).map((h) => `${h.title} — ${h.link}`).join('\n') || (x.web ? x.web.status : ''),
        candidates: (x.candidateNames || []).join('\n'),
        key,
      },
    };
  });

  // ── Write outputs ──
  const meta = { meta: true, host, since: SINCE, scopeProgramIds, inputHashes, approve: APPROVE, mapRule: MAP_RULE, web: WEB };
  const jsonl = `${[meta, ...results.map((x) => x.ids)].map((x) => JSON.stringify(x)).join('\n')}\n`;
  fs.writeFileSync(RESOLVE_LOG, jsonl);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Confirm co-PIs');
  const cols = [
    ['Confirm?', 'confirm', 10], ['Class', 'cls', 22], ['Actions', 'actions', 34], ['Year', 'year', 6], ['Request', 'request', 10],
    ['Person', 'person', 24], ['Source', 'source', 20], ['Proposal email', 'proposalEmail', 28], ['Stated institution', 'statedInstitution', 30],
    ['Applicant', 'applicant', 30], ['Proposed Institution at Award', 'iaa', 30], ['Why', 'iaaEvidence', 34], ['Contact match', 'contactMatch', 18],
    ['Contact', 'contact', 34], ['Contact current account', 'contactCurrentAccount', 30], ['Proposed contact account', 'proposedContactAccount', 30],
    ['Contact account from', 'contactAccountEvidence', 14], ['Web results (current page)', 'web', 50], ['Possible existing contacts', 'candidates', 40],
    ['Notes', 'notes', 30], ['key', 'key', 10],
  ];
  ws.columns = cols.map(([header, k, width]) => ({ header, key: k, width }));
  for (const x of results) ws.addRow({ ...x.review, confirm: '' });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + cols.length - 1)}1` };
  ws.getColumn(cols.length).hidden = true;
  for (let i = 2; i <= results.length + 1; i++) {
    ws.getCell(`A${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No,Unsure"'], showErrorMessage: true, errorTitle: 'Choose one', error: 'Pick Yes, No or Unsure.' };
    ws.getRow(i).alignment = { vertical: 'top', wrapText: true };
  }
  await wb.xlsx.writeFile(REVIEW_XLSX);

  // ── Counts (no names) ──
  const tally = (f, subset = results) => { const t = {}; for (const x of subset) { const k = f(x); t[k] = (t[k] || 0) + 1; } return t; };
  for (const cohort of ['extracted', 'recorded']) {
    const sub = results.filter((x) => x.ids.cohort === cohort);
    console.log(`\n${cohort}: ${sub.length} rows on ${new Set(sub.map((x) => x.ids.requestNum)).size} requests`);
    console.log(`  class: ${JSON.stringify(tally((x) => x.ids.class, sub))}`);
    console.log(`  contact match: ${JSON.stringify(tally((x) => x.ids.contactMatch, sub))}`);
    console.log(`  IAA evidence (ready): ${JSON.stringify(tally((x) => x.ids.iaaVia, sub.filter((x) => x.ids.class === 'ready')))}`);
    const acts = {}; for (const x of sub) for (const a of x.ids.actions) acts[a] = (acts[a] || 0) + 1;
    console.log(`  planned actions: ${JSON.stringify(acts)}`);
  }
  console.log(`\nDomain map lookups: ${mapCache.size} (${JSON.stringify(tally((w) => w.status, [...mapCache.values()]))})`);
  console.log(`Web searches this run: ${searches} of ${MAX_SEARCHES} allowed (${Object.keys(cache).length} cached in total)`);
  console.log(`\nWrote ${RESOLVE_LOG}\nWrote ${REVIEW_XLSX}`);
  console.log(`Resolve hash: ${sha(jsonl).slice(0, 8)}`);
});

/**
 * Read-only exposure scan for the two decline-referral / manual-add hazards
 * found in the Session 393 Fable assessment
 * (`outputs/reviewer-workflow-stabilization-fable-assessment.md`, Findings A and C).
 *
 * READ-ONLY. Issues only Dataverse GETs; performs no create/update/delete and
 * writes nothing to Postgres. Safe to run against Production.
 *
 * Section 1 — Finding C (malformed referral name → duplicate person).
 *   The decline-referral one-click sends the reviewer's ENTIRE free-text answer
 *   as `name` (ReviewersTab.js). `splitName` makes token 0 the forename and the
 *   whole remainder the surname, so a multi-name/prose string matches nothing,
 *   the lookup returns `outcome:'none'`, and `addManualReviewer` auto-creates a
 *   NEW person plus a `selected=true` suggestion. This section lists person rows
 *   whose NAME CANNOT BE ONE PERSON, which is the fingerprint of that path.
 *
 * Section 2 — Finding A (referral/manual add promotes an applicant row ungated).
 *   `ensureStaffManualCandidate` patches an EXISTING junction row to
 *   `selected=true` (and resets engagement stamps when it was `selected=false`),
 *   bypassing every `promoteApplicantReviewer` gate. An applicant-recommended
 *   row that is `selected=true` AND carries a `staff_manual`/`referred` source
 *   token is a candidate for an ungated promotion.
 *
 * Section 3 — the same rows, checked for a silently-cleared decline: a row that
 *   was invited but now carries no response/decline state at all.
 *
 * Neither section is a verdict. A hit is a row to inspect by hand, not proof of
 * damage — a genuinely-new reviewer with a hyphenated or multi-part surname can
 * land in section 1, and a legitimately staff-added reviewer can land in
 * section 2. Denominators are printed so a clean result is legible as coverage
 * rather than as silence.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
 *     scripts/probe-referral-path-exposure.mjs [--limit 5000] [--show-names]
 *
 *   --show-names  print matched person names (off by default: this is PII, and
 *                 the counts alone answer "is there exposure?")
 *   --include-test  keep AkoyaGO test records (applicant = the Foundation
 *                 itself). Excluded by default — their fixture people carry
 *                 deliberately silly names that section 1 would otherwise flag.
 */
import { readFileSync } from 'node:fs';

try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {}

const args = process.argv.slice(2);
const showNames = args.includes('--show-names');
const includeTest = args.includes('--include-test');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.min(Math.max(Number(args[limitIdx + 1]) || 5000, 1), 20000) : 5000;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-referral-path-exposure');

// ── Test-record exclusion ────────────────────────────────────────────────────
// AkoyaGO staff mark test rows by making the Foundation its own applicant
// (scripts/probe-akoya-test-record-predicate.js:6-15). Synthetic requests carry
// synthetic people with deliberately silly names — exactly the shape section 1
// hunts for — so without this the malformed-name count is inflated by fixtures.
// Learned the hard way: the sibling exclusion probe reported a "genuine" finding
// that turned out to be test request 1001931.
const TEST_ORG_NAME = 'W. M. Keck Foundation';
const testRequestIds = new Set();
const testPersonIds = new Set();
if (!includeTest) {
  const { records: testAccounts } = await DynamicsService.queryRecords('accounts', {
    select: 'accountid,name',
    filter: `name eq '${TEST_ORG_NAME.replace(/'/g, "''")}'`,
    top: 10,
  });
  if (testAccounts.length) {
    const orChain = testAccounts
      .map((a) => `_akoya_applicantid_value eq ${a.accountid}`)
      .join(' or ');
    const { records: testRequests } = await DynamicsService.queryAllRecords('akoya_requests', {
      select: [
        'akoya_requestid',
        '_wmkf_potentialreviewer1_value', '_wmkf_potentialreviewer2_value',
        '_wmkf_potentialreviewer3_value', '_wmkf_potentialreviewer4_value',
        '_wmkf_potentialreviewer5_value',
      ].join(','),
      filter: `(${orChain})`,
    });
    for (const r of testRequests) {
      testRequestIds.add(String(r.akoya_requestid).toLowerCase());
      for (const n of ['1', '2', '3', '4', '5']) {
        const pid = r[`_wmkf_potentialreviewer${n}_value`];
        if (pid) testPersonIds.add(String(pid).toLowerCase());
      }
    }
    // People reached only through suggestions on a test request. Bounded: skip
    // the join rather than issue an unbounded OR-chain if there are many.
    if (testRequestIds.size > 0 && testRequestIds.size <= 50) {
      const reqChain = [...testRequestIds].map((id) => `_wmkf_request_value eq ${id}`).join(' or ');
      const { records: testSuggestions } = await DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
        select: '_wmkf_potentialreviewer_value',
        filter: `(${reqChain})`,
      });
      for (const s of testSuggestions) {
        const pid = s._wmkf_potentialreviewer_value;
        if (pid) testPersonIds.add(String(pid).toLowerCase());
      }
    }
  }
}
const isTestPerson = (id) => testPersonIds.has(String(id || '').toLowerCase());
const isTestRequest = (id) => testRequestIds.has(String(id || '').toLowerCase());

const APPLICANT_DISPOSITION_RECOMMENDED = 100000000;

// A name that cannot denote a single person. Deliberately conservative: these
// are shapes a human name does not take, not merely unusual ones. Particles
// (van, de, del) and hyphenated surnames must NOT match, so the token test is
// generous and the connector test requires whitespace-delimited " and "/" & ".
const MULTI_PERSON_PATTERNS = [
  { key: 'connector_and', test: (n) => /\s(and|&)\s/i.test(n) },
  { key: 'comma', test: (n) => /,/.test(n) },
  { key: 'slash_or_semicolon', test: (n) => /[;/]/.test(n) },
  { key: 'prose_marker', test: (n) => /\b(works? on|would be|at the|is a|suggest|recommend|professor of|who)\b/i.test(n) },
  { key: 'very_long', test: (n) => n.trim().split(/\s+/).length > 5 },
  { key: 'has_email', test: (n) => /@/.test(n) },
];

function classifyName(name) {
  return MULTI_PERSON_PATTERNS.filter((p) => p.test(name)).map((p) => p.key);
}

function redact(name) {
  if (showNames) return name;
  const parts = String(name).trim().split(/\s+/);
  return parts.map((p) => (p.length > 2 ? `${p[0]}${'·'.repeat(Math.min(p.length - 1, 6))}` : p)).join(' ');
}

console.log('READ-ONLY referral-path exposure scan');
console.log(`limit=${limit} showNames=${showNames} includeTest=${includeTest}\n`);
if (!includeTest) {
  console.log(`Test-record exclusion: ${testRequestIds.size} test request(s), ${testPersonIds.size} test person row(s) will be filtered out.`);
  console.log('  (applicant = "W. M. Keck Foundation"; pass --include-test to keep them)\n');
}

// ── Section 1 ────────────────────────────────────────────────────────────────
// Name shape cannot be filtered server-side in OData without contains() over a
// large set, so page the active roster of people and classify client-side.
const { records: people, capped: peopleCapped } = await DynamicsService.queryAllRecords(
  'wmkf_potentialreviewerses',
  {
    select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_firstname,wmkf_lastname,wmkf_emailaddress,wmkf_organizationname,createdon',
    filter: 'statecode eq 0',
    orderby: 'createdon desc',
    top: limit,
  },
);

const flagged = [];
let testPeopleSkipped = 0;
for (const p of people) {
  if (isTestPerson(p.wmkf_potentialreviewersid)) { testPeopleSkipped += 1; continue; }
  const name = p.wmkf_name || [p.wmkf_firstname, p.wmkf_lastname].filter(Boolean).join(' ');
  if (!name) continue;
  const reasons = classifyName(name);
  if (reasons.length) flagged.push({ id: p.wmkf_potentialreviewersid, name, reasons, created: p.createdon, email: p.wmkf_emailaddress });
}

console.log('─'.repeat(78));
console.log(`SECTION 1 — person names that cannot denote one person (Finding C)`);
console.log(`  scanned: ${people.length} active person row(s)${peopleCapped ? ' [CAPPED — rerun with a higher --limit]' : ''}`);
if (testPeopleSkipped) console.log(`  skipped: ${testPeopleSkipped} known test-record person row(s)`);
console.log(`  flagged: ${flagged.length}`);
if (flagged.length) {
  const byReason = {};
  for (const f of flagged) for (const r of f.reasons) byReason[r] = (byReason[r] || 0) + 1;
  console.log(`  by pattern: ${JSON.stringify(byReason)}`);
  console.log('');
  for (const f of flagged) {
    console.log(`  ${f.id}  [${f.reasons.join(',')}]  created=${(f.created || '').slice(0, 10)}`);
    console.log(`      name=${redact(f.name)}${f.email ? `  email=${redact(f.email)}` : '  email=—'}`);
  }
} else {
  console.log('  → no malformed person names found; Finding C has not produced a duplicate in this window.');
}
console.log('');

// ── Sections 2 & 3 ───────────────────────────────────────────────────────────
const { records: promotedAll, capped: promotedCapped } = await DynamicsService.queryAllRecords(
  'wmkf_appreviewersuggestions',
  {
    select: [
      'wmkf_appreviewersuggestionid', 'wmkf_sources', 'wmkf_selected', 'wmkf_invited',
      'wmkf_accepted', 'wmkf_declined', 'wmkf_emailsentat', 'wmkf_responsereceivedat',
      'wmkf_responsetype', 'wmkf_reviewreceivedat', 'wmkf_applicantdisposition',
      '_wmkf_request_value', '_wmkf_potentialreviewer_value',
    ].join(','),
    filter: `wmkf_applicantdisposition eq ${APPLICANT_DISPOSITION_RECOMMENDED} and wmkf_selected eq true`,
    orderby: 'createdon desc',
  },
);

const promoted = promotedAll.filter((r) => !isTestRequest(r._wmkf_request_value));
const promotedTestSkipped = promotedAll.length - promoted.length;
const manualTokened = promoted.filter((r) => /staff_manual|referred/i.test(r.wmkf_sources || ''));

console.log('─'.repeat(78));
console.log('SECTION 2 — applicant-recommended rows that are selected=true (Finding A)');
console.log(`  applicant-recommended AND selected: ${promoted.length}${promotedCapped ? ' [CAPPED]' : ''}`);
if (promotedTestSkipped) console.log(`  (excluded ${promotedTestSkipped} row(s) on known test requests)`);
console.log(`  ...of those, carrying a staff_manual/referred source token: ${manualTokened.length}`);
console.log('    (these are the ones a manual/referral add could have promoted without the');
console.log('     applicant promotion gates; the remainder were promoted by other paths)');
if (manualTokened.length) {
  console.log('');
  for (const r of manualTokened) {
    console.log(`  suggestion=${r.wmkf_appreviewersuggestionid} request=${r._wmkf_request_value}`);
    console.log(`      sources=${r.wmkf_sources} invited=${r.wmkf_invited} accepted=${r.wmkf_accepted} declined=${r.wmkf_declined}`);
  }
}
console.log('');

// A row that was emailed/invited but now carries no response state at all is the
// fingerprint of ENGAGEMENT_STAMP_RESET having been applied outside the explicit
// Restore workflow. Invited-with-no-response is ALSO the normal state of a
// pending invitee, so this is a lead, never a finding.
const resetSuspects = promoted.filter((r) => (
  (r.wmkf_invited === true || r.wmkf_emailsentat)
  && !r.wmkf_declined && !r.wmkf_accepted
  && !r.wmkf_responsereceivedat && !r.wmkf_responsetype && !r.wmkf_reviewreceivedat
));

console.log('─'.repeat(78));
console.log('SECTION 3 — possible silently-cleared engagement (Finding A, reset branch)');
console.log(`  invited/emailed but holding NO response state: ${resetSuspects.length} of ${promoted.length}`);
console.log('  NOTE: a pending invitee looks identical. Treat each as a lead and compare');
console.log('  against the invitation email history before concluding anything.');
if (resetSuspects.length) {
  console.log('');
  for (const r of resetSuspects) {
    console.log(`  suggestion=${r.wmkf_appreviewersuggestionid} request=${r._wmkf_request_value} sources=${r.wmkf_sources || '—'} emailSentAt=${r.wmkf_emailsentat || '—'}`);
  }
}
console.log('');
console.log('─'.repeat(78));
console.log('Scan complete. No records were modified.');

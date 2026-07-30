/**
 * Read-only: dump reviewer_find_roster candidate blobs for one request, with the
 * identity/provenance/contact fields needed to diagnose a wrong-person surfacing.
 * `--include-dataverse` also compares matching person and request-suggestion rows.
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-roster-dump.mjs --guid <request_guid> [--grep fazakerley]
 *   DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/probe-roster-dump.mjs --request <request_number> [--grep fazakerley] [--include-dataverse]
 */
import { readFileSync } from 'node:fs';
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch {}
const args = process.argv.slice(2);
// Dataverse record IDs use the GUID shape but are not guaranteed to carry an
// RFC 4122 version/variant nibble (for example, request 1002912 contains `f111`).
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let guid = args.includes('--guid') ? args[args.indexOf('--guid') + 1] : null;
const requestNumber = args.includes('--request') ? args[args.indexOf('--request') + 1] : null;
const grepIdx = args.indexOf('--grep');
const grep = grepIdx >= 0 ? args[grepIdx + 1].toLowerCase() : null;
const includeDataverse = args.includes('--include-dataverse');
function promotionDecisionInputs(candidate) {
  const enrichment = candidate?.contactEnrichment || {};
  return {
    topLevelIdentity: candidate?.identityStatus || candidate?.verificationStatus || null,
    nestedIdentity: enrichment.identity?.status || null,
    hasEffectiveEmail: Boolean(candidate?.email || enrichment.email),
    effectiveEmailSource: candidate?.emailSource || enrichment.emailSource || null,
    emailPersistAllowed: candidate?.emailPersistAllowed ?? enrichment.emailPersistAllowed ?? null,
    websitePersistAllowed: candidate?.websitePersistAllowed ?? enrichment.websitePersistAllowed ?? null,
    affiliationPersistAllowed: candidate?.affiliationPersistAllowed ?? enrichment.affiliationPersistAllowed ?? null,
    contactStatus: candidate?.contactStatus || enrichment.contactStatus || null,
    staffConfirmed: candidate?.pdIdentityConfirmed === true,
    receiptPresent: typeof candidate?.automatedIdentityAttestation === 'string',
  };
}
if (!guid && !requestNumber) {
  console.error('--guid <request_guid> or --request <request_number> required');
  process.exit(2);
}
if (guid && !GUID_RE.test(guid)) {
  console.error('--guid must be a valid request GUID');
  process.exit(2);
}

let DynamicsService;
let potentialReviewerAdapter;
if (requestNumber || includeDataverse) {
  ({ DynamicsService } = await import('../lib/services/dynamics-service.js'));
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('probe-roster-dump');
}

if (!guid) {
  const { records } = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum',
    filter: `akoya_requestnum eq '${String(requestNumber).replace(/'/g, "''")}'`,
    top: 2,
  });
  if (records.length !== 1) {
    console.error(`Expected one request for ${requestNumber}; found ${records.length}`);
    process.exit(2);
  }
  guid = records[0].akoya_requestid;
  if (!GUID_RE.test(guid)) {
    console.error(`Request ${requestNumber} returned an invalid GUID`);
    process.exit(2);
  }
  console.log(`Resolved request ${records[0].akoya_requestnum} → ${guid}\n`);
}

const pg = await import('@vercel/postgres');
const { rows } = await pg.sql`SELECT status, display_name, source_kind, candidate FROM reviewer_find_roster WHERE request_id = ${guid} ORDER BY display_name`;
console.log(`${rows.length} roster row(s) for ${guid}\n`);
const matchingRows = rows.filter((r) => {
  if (!grep) return true;
  return JSON.stringify(r.candidate || {}).toLowerCase().includes(grep);
});
for (const r of matchingRows) {
  const c = r.candidate || {};
  const e = c.contactEnrichment || {};
  const blob = JSON.stringify(c).toLowerCase();
  const links = [c.website, c.orcidUrl, c.googleScholarUrl, e.website, e.orcidUrl, e.googleScholarUrl].filter(Boolean);
  const linkedin = (blob.match(/https?:\/\/[^"]*linkedin[^"]*/g) || []);
  console.log('─'.repeat(80));
  console.log(`NAME        ${c.name}   [${r.status} / source_kind=${r.source_kind}]`);
  console.log(`provenance  kind=${c.provenance?.kind} sources=${JSON.stringify(c.provenance?.sources)} seedRole=${c.provenance?.seedRole}`);
  console.log(`identity    verificationStatus=${c.verificationStatus} identityStatus=${c.identityStatus} isClaudeSuggestion=${c.isClaudeSuggestion} source=${c.source}`);
  console.log(`area        affiliation=${c.affiliation || e.affiliation || '—'}  expertise=${JSON.stringify(c.expertiseAreas || c.keywords)}`);
  console.log(`contact     email=${c.email || e.email || '—'} (src=${e.emailSource || '—'})  orcid=${c.orcid || e.orcid || '—'}`);
  console.log(`persist     emailAllowed=${c.emailPersistAllowed ?? e.emailPersistAllowed ?? '—'} contactStatus=${c.contactStatus || e.contactStatus || '—'} resolverIdentity=${e.identity?.status || '—'}`);
  console.log(`promotion   ${JSON.stringify(promotionDecisionInputs(c))}`);
  console.log(`links       ${links.join('  |  ') || '—'}`);
  if (linkedin.length) console.log(`LINKEDIN    ${linkedin.join('  ')}`);
  if (c.reasoning) console.log(`reasoning   ${String(c.reasoning).slice(0, 200)}`);
}

if (includeDataverse) {
  potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
  const { records: suggestions } = await DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
    select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,wmkf_suggestionlabel,wmkf_selected,wmkf_invited,wmkf_sources,createdon,modifiedon',
    filter: `_wmkf_request_value eq ${guid}`,
  });
  const requestSuggestionByPerson = new Map(
    suggestions
      .filter((row) => row._wmkf_potentialreviewer_value)
      .map((row) => [String(row._wmkf_potentialreviewer_value).toLowerCase(), row])
  );
  const names = [...new Set(matchingRows.map((row) => row.display_name).filter(Boolean))];
  console.log('\nDataverse person rows matching the roster name(s):');
  for (const name of names) {
    const people = await potentialReviewerAdapter.searchByName(name, { top: 10 });
    console.log(`\n${name}: ${people.length} active/name-matching person row(s)`);
    for (const person of people) {
      const id = person.wmkf_potentialreviewersid;
      const suggestion = requestSuggestionByPerson.get(String(id).toLowerCase());
      console.log(`  person=${id} email=${person.wmkf_emailaddress || '—'} source=${person.wmkf_emailsource || '—'} identity=${person.wmkf_identitystatus || '—'} created=${person.createdon || '—'}`);
      console.log(`    request suggestion=${suggestion?.wmkf_appreviewersuggestionid || '—'} selected=${suggestion?.wmkf_selected ?? '—'} invited=${suggestion?.wmkf_invited ?? '—'} sources=${suggestion?.wmkf_sources || '—'} created=${suggestion?.createdon || '—'}`);
    }
  }
}

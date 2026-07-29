#!/usr/bin/env node
/**
 * PR4 headless e2e runner for reviewer self-reported ORCID capture.
 *
 * This is intentionally a manual, gated rehearsal script: local dev points at
 * production Dataverse for this app, so the script creates real test rows,
 * drives the public magic-link API contract, verifies the writeback, then
 * best-effort cleans up the rows it can delete/deactivate.
 *
 * Example:
 *   AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 npm run dev
 *   node scripts/pr4-e2e.js --request REQ-123 --case typed-accept --confirm-prod-dataverse
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const CASES = new Set(['typed-accept', 'prefill-accept', 'decline', 'all']);
const HELP = hasFlag('help') || hasFlag('h');
const REQUEST = arg('request');
const CASE = arg('case', 'typed-accept');
const BASE_URL = (arg('base-url', process.env.NEXTAUTH_URL || 'http://localhost:3000')).replace(/\/$/, '');
const ORCID = arg('orcid', '0000-0002-1825-0097');
const EMAIL = arg('email');
const NAME = arg('name');
const KEEP = hasFlag('keep');
const CONFIRMED = hasFlag('confirm-prod-dataverse') || process.env.PR4_E2E_CONFIRM_PROD_DATAVERSE === 'true';

if (HELP) {
  console.log('Usage: npm run e2e:pr4 -- --request <GUID|requestNum> [--case typed-accept|prefill-accept|decline|all] [--base-url http://localhost:3000] [--orcid 0000-0002-1825-0097] [--email proxy@example.org] [--name "..."] [--keep] --confirm-prod-dataverse');
  process.exit(0);
}
if (!REQUEST || !CASES.has(CASE)) {
  console.error('Usage: node scripts/pr4-e2e.js --request <GUID|requestNum> [--case typed-accept|prefill-accept|decline|all] [--base-url http://localhost:3000] [--orcid 0000-0002-1825-0097] [--email proxy@example.org] [--name "..."] [--keep] --confirm-prod-dataverse');
  process.exit(1);
}
if (!CONFIRMED) {
  console.error('Refusing to run: this e2e creates real PROD Dataverse rows. Re-run with --confirm-prod-dataverse when you are ready.');
  process.exit(1);
}
if (!process.env.EXTERNAL_LINK_SECRET || process.env.EXTERNAL_LINK_SECRET.length < 32) {
  console.error('EXTERNAL_LINK_SECRET must be set to any 32+ character local throwaway secret before minting/verifying test tokens.');
  process.exit(1);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const potentialReviewer = await import('../lib/dataverse/adapters/potential-reviewer.js');
const contactAdapter = await import('../lib/dataverse/adapters/contact.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const { mintAndStore, revoke } = await import('../lib/external/token-lifecycle.js');
const { normalizeOrcid } = await import('../lib/utils/orcid-normalize.js');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s).replace(/'/g, "''");

const wanted = normalizeOrcid(ORCID);
if (wanted.state !== 'valid') {
  console.error(`--orcid is not valid (${wanted.state})`);
  process.exit(1);
}

async function resolveRequestId(request) {
  if (GUID_RE.test(request)) return request;
  const { records } = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,akoya_title',
    filter: `akoya_requestnum eq '${esc(request)}'`,
    top: 1,
  });
  const row = records[0];
  if (!row) throw new Error(`No akoya_request with requestnum '${request}'`);
  console.log(`request: #${row.akoya_requestnum} - ${row.akoya_title || '(no title)'} ${row.akoya_requestid}`);
  return row.akoya_requestid;
}

function uniqueRunLabel(caseName) {
  return `pr4-${caseName}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 1) return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  return { firstName: '', lastName: fullName };
}

async function setupCase({ caseName, requestId, prefillOrcid }) {
  const runLabel = uniqueRunLabel(caseName);
  const email = EMAIL || `${runLabel}@example.org`;
  const name = NAME || `PR4 ${caseName} Reviewer`;
  const { firstName, lastName } = splitName(name);

  const { id: personId } = await potentialReviewer.upsertByEmail({
    name,
    email,
    emailSource: 'manual', // S387: fixture addresses carry provenance like real ones
    affiliation: 'PR4 E2E Test Institution',
    expertise: 'e2e testing',
  });
  const contact = await contactAdapter.findOrCreateByEmail({ firstName, lastName, email });
  await potentialReviewer.setContactLink(personId, contact.id);

  const { id: suggestionId } = await suggestionAdapter.upsert({
    potentialReviewerId: personId,
    requestId,
    suggestionLabel: `PR4 e2e ${caseName} ${new Date().toISOString().slice(0, 16)}`,
    sources: 'pr4-e2e-test',
    selected: true,
  });

  if (prefillOrcid) {
    await DynamicsService.updateRecord('wmkf_appreviewersuggestions', suggestionId, {
      wmkf_reviewerorcid: prefillOrcid,
    });
  }

  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const { jwt } = await mintAndStore({ suggestionId, requestId, expiresAt });

  return {
    caseName,
    runLabel,
    jwt,
    personId,
    contactId: contact.id,
    suggestionId,
    email,
    name,
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const reason = data?.reason ? ` (${data.reason})` : '';
    throw new Error(`${options.method || 'GET'} ${url} failed with ${res.status}${reason}: ${text.slice(0, 400)}`);
  }
  return { res, data };
}

async function driveApi(run, { action, sendOrcid }) {
  const contextUrl = `${BASE_URL}/api/external/review/${encodeURIComponent(run.jwt)}/context`;
  const respondUrl = `${BASE_URL}/api/external/review/${encodeURIComponent(run.jwt)}/respond`;
  const { data: context } = await fetchJson(contextUrl);
  if (!context.ok) throw new Error(`Context returned ok=false: ${JSON.stringify(context)}`);
  if (context.engagementState?.view !== 'stage2a') {
    throw new Error(`Expected stage2a context, got ${context.engagementState?.view || '(missing)'}`);
  }

  const body = action === 'accept'
    ? {
        action: 'accept',
        honorariumOptOut: true,
        ...(sendOrcid ? { contactEdits: { orcid: wanted.id } } : {}),
        policyAcks: Object.fromEntries(Object.keys(context.policies || {}).map((slot) => [slot, true])),
      }
    : {
        action: 'decline',
        ...(sendOrcid ? { contactEdits: { orcid: wanted.id } } : {}),
        decline: { reasonText: 'PR4 e2e decline path' },
      };

  if (action === 'accept' && Object.keys(body.policyAcks).length === 0) {
    throw new Error('Context did not include active policies to acknowledge.');
  }

  const { data: response } = await fetchJson(respondUrl, {
    method: 'POST',
    headers: context.etag ? { 'if-match': context.etag } : {},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Respond returned ok=false: ${JSON.stringify(response)}`);
  return { context, response };
}

const orcidEq = (raw) => {
  const normalized = normalizeOrcid(raw);
  return normalized.state === 'valid' && normalized.id === wanted.id;
};
const mark = (ok) => (ok ? 'ok' : 'BAD');

async function verifyCase(run) {
  const person = await DynamicsService.getRecord('wmkf_potentialreviewerses', run.personId, {
    select: 'wmkf_potentialreviewersid,wmkf_orcid,wmkf_orcidurl,wmkf_identitystatus,_wmkf_contact_value',
  });
  const suggestion = await DynamicsService.getRecord('wmkf_appreviewersuggestions', run.suggestionId, {
    select: 'wmkf_appreviewersuggestionid,wmkf_reviewerorcid,wmkf_accepted,wmkf_declined,wmkf_responsetype',
  });
  const contact = await DynamicsService.getRecord('contacts', run.contactId, {
    select: 'contactid,wmkf_orcid',
  }).catch(() => null);

  const checks = {
    personOrcid: orcidEq(person.wmkf_orcid),
    personUrl: orcidEq(person.wmkf_orcidurl),
    personConfirmed: person.wmkf_identitystatus === 'confirmed',
    contactOrcid: orcidEq(contact?.wmkf_orcid),
    suggestionOrcid: orcidEq(suggestion.wmkf_reviewerorcid),
  };
  const pass = Object.values(checks).every(Boolean);

  console.log(`verify ${run.caseName}: ${pass ? 'PASS' : 'FAIL'}`);
  console.log(`  person: ${mark(checks.personOrcid)} orcid=${JSON.stringify(person.wmkf_orcid)} ${mark(checks.personConfirmed)} status=${JSON.stringify(person.wmkf_identitystatus)}`);
  console.log(`  contact: ${mark(checks.contactOrcid)} orcid=${JSON.stringify(contact?.wmkf_orcid)}`);
  console.log(`  suggestion: ${mark(checks.suggestionOrcid)} orcid=${JSON.stringify(suggestion.wmkf_reviewerorcid)} accepted=${suggestion.wmkf_accepted} declined=${suggestion.wmkf_declined}`);

  if (!pass) throw new Error(`${run.caseName} verification failed`);
}

async function deleteOrDeactivate(entitySet, id, label) {
  if (!id) return;
  try {
    await DynamicsService.deleteRecord(entitySet, id);
    console.log(`  deleted ${label} ${id}`);
  } catch (delErr) {
    try {
      await DynamicsService.updateRecord(entitySet, id, { statecode: 1, statuscode: 2 });
      console.log(`  deactivated ${label} ${id} (delete failed: ${delErr.message?.slice(0, 80)})`);
    } catch (deactErr) {
      console.log(`  could not delete/deactivate ${label} ${id}: ${deactErr.message?.slice(0, 120)}`);
    }
  }
}

async function cleanupCase(run) {
  if (KEEP) {
    console.log(`keeping ${run.caseName} rows: person=${run.personId} suggestion=${run.suggestionId} contact=${run.contactId}`);
    return;
  }
  console.log(`cleanup ${run.caseName}:`);
  try {
    await revoke(run.suggestionId);
    console.log(`  revoked token on suggestion ${run.suggestionId}`);
  } catch (e) {
    console.log(`  token revoke skipped: ${e.message?.slice(0, 80)}`);
  }
  await deleteOrDeactivate('wmkf_appreviewersuggestions', run.suggestionId, 'suggestion');
  await deleteOrDeactivate('wmkf_potentialreviewerses', run.personId, 'person');
  console.log(`  contact left in place by design: ${run.contactId}`);
}

const casePlans = {
  'typed-accept': { action: 'accept', sendOrcid: true, prefillOrcid: null },
  'prefill-accept': { action: 'accept', sendOrcid: false, prefillOrcid: wanted.id },
  decline: { action: 'decline', sendOrcid: true, prefillOrcid: null },
};

await bypassDynamicsRestrictions('pr4-e2e-headless', async () => {
  const requestId = await resolveRequestId(REQUEST);
  const selectedCases = CASE === 'all' ? ['typed-accept', 'prefill-accept', 'decline'] : [CASE];
  const completed = [];

  for (const caseName of selectedCases) {
    const plan = casePlans[caseName];
    let run = null;
    try {
      console.log(`\n=== ${caseName} ===`);
      run = await setupCase({ caseName, requestId, prefillOrcid: plan.prefillOrcid });
      console.log(`setup: person=${run.personId} contact=${run.contactId} suggestion=${run.suggestionId} email=${run.email}`);
      await driveApi(run, plan);
      await verifyCase(run);
      completed.push({ caseName, ok: true });
    } catch (e) {
      completed.push({ caseName, ok: false, error: e.message });
      console.error(`${caseName} failed: ${e.message}`);
      process.exitCode = 1;
    } finally {
      if (run) await cleanupCase(run);
    }
  }

  console.log('\nSummary:');
  for (const result of completed) {
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${result.caseName}${result.error ? ` - ${result.error}` : ''}`);
  }
});

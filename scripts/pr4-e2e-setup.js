#!/usr/bin/env node
/**
 * PR4 e2e SETUP — manufacture a real reviewer engagement + magic-link token so
 * the reviewer self-reported-ORCID capture can be tested through the ACTUAL
 * Stage 2a form (docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md §14).
 *
 * Creates (in PROD Dataverse — local-dev hits prod): a test wmkf_potentialreviewers
 * person (proxy email), a CRM contact pre-linked to it (so the contact-write path
 * is exercised without honorarium), and a wmkf_appreviewersuggestion row on the
 * given request, then mints + stores a token via the app's own mintAndStore.
 *
 *   node scripts/pr4-e2e-setup.js --request <GUID|requestNum> --email <proxy@x> \
 *        --name "Test Reviewer" [--prefill-orcid 0000-0002-1825-0097] [--no-promote]
 *
 * --prefill-orcid: pre-seed wmkf_reviewerorcid on the engagement row so you can test
 *   the CONFIRM-WITHOUT-EDIT path (the form sends only changed fields; PR4 falls back
 *   to the persisted value). Omit to test the TYPED path (enter the iD in the form).
 *
 * Prereqs in .env.local (local-only throwaway values are fine — the token is minted
 * AND verified by the same local env, so it need NOT match prod):
 *   EXTERNAL_LINK_SECRET=<any 32+ chars>   NEXTAUTH_URL=http://localhost:3000
 * Plus the usual DYNAMICS_* creds.
 *
 * Prints the magic link + the ids to feed to pr4-e2e-verify.js / pr4-e2e-cleanup.js.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}
const REQUEST = arg('request');
const EMAIL = arg('email');
const NAME = arg('name') || 'PR4 Test Reviewer';
const PREFILL_ORCID = arg('prefill-orcid');
const PROMOTE = !process.argv.includes('--no-promote');
if (!REQUEST || !EMAIL) {
  console.error('Usage: --request <GUID|requestNum> --email <proxy@x> [--name "..."] [--prefill-orcid <id>] [--no-promote]');
  process.exit(1);
}
if (!process.env.EXTERNAL_LINK_SECRET) {
  console.error('✗ EXTERNAL_LINK_SECRET is not set in .env.local (use any 32+ char throwaway for local e2e).');
  process.exit(1);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const potentialReviewer = await import('../lib/dataverse/adapters/potential-reviewer.js');
const contact = await import('../lib/dataverse/adapters/contact.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const { mintAndStore } = await import('../lib/external/token-lifecycle.js');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s).replace(/'/g, "''");

await bypassDynamicsRestrictions('pr4-e2e-setup', async () => {
  // 1. Resolve request id (accept a GUID or an akoya_requestnum).
  let requestId = REQUEST;
  if (!GUID_RE.test(REQUEST)) {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum,akoya_title',
      filter: `akoya_requestnum eq '${esc(REQUEST)}'`,
      top: 1,
    });
    if (!records[0]) { console.error(`✗ No akoya_request with requestnum '${REQUEST}'`); process.exit(1); }
    requestId = records[0].akoya_requestid;
    console.log(`request: #${records[0].akoya_requestnum} — ${records[0].akoya_title || '(no title)'}  ${requestId}`);
  } else {
    console.log(`request: ${requestId}`);
  }

  // 2. Person (proxy email).
  const { id: personId } = await potentialReviewer.upsertByEmail({
    name: NAME, email: EMAIL, affiliation: 'PR4 E2E Test Institution', expertise: 'e2e testing',
  });
  console.log(`person : ${personId}  (${NAME} <${EMAIL}>)`);

  // 3. Pre-promote: contact + person→contact link, so the accept exercises the
  //    contact-write path WITHOUT needing honorarium to create the contact.
  let contactId = null;
  if (PROMOTE) {
    const { firstName, lastName } = (() => {
      const parts = NAME.trim().split(/\s+/);
      return parts.length > 1 ? { firstName: parts[0], lastName: parts.slice(1).join(' ') } : { firstName: '', lastName: NAME };
    })();
    const c = await contact.findOrCreateByEmail({ firstName, lastName, email: EMAIL });
    contactId = c.id;
    await potentialReviewer.setContactLink(personId, contactId);
    console.log(`contact: ${contactId}  (created=${c.created}, linked → person)`);
  } else {
    console.log('contact: (skipped — accept will create one via honorarium if not opted out)');
  }

  // 4. Suggestion row (person → request), fresh/non-excluded.
  const { id: suggestionId } = await suggestionAdapter.upsert({
    potentialReviewerId: personId,
    requestId,
    suggestionLabel: `PR4 e2e ${new Date().toISOString().slice(0, 16)}`,
    sources: 'pr4-e2e-test',
    selected: true,
  });
  console.log(`suggestion: ${suggestionId}`);

  // 5. Optional prefill of the engagement self-report field (confirm-without-edit test).
  if (PREFILL_ORCID) {
    await DynamicsService.updateRecord('wmkf_appreviewersuggestions', suggestionId, { wmkf_reviewerorcid: PREFILL_ORCID });
    console.log(`prefilled wmkf_reviewerorcid = ${PREFILL_ORCID}  (test confirm-WITHOUT-edit)`);
  }

  // 6. Mint + store the token exactly as the app does.
  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const { jwt } = await mintAndStore({ suggestionId, requestId, expiresAt });

  const base = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
  console.log('\n────────────────────────────────────────────────────────');
  console.log('MAGIC LINK (open in a browser with the dev server running on the PR4 branch):');
  console.log(`  ${base}/external/review/${jwt}`);
  console.log('\nAfter you Accept/Decline in the form, verify with:');
  console.log(`  node scripts/pr4-e2e-verify.js --person ${personId}${contactId ? ` --contact ${contactId}` : ''} --suggestion ${suggestionId} --expect-orcid <iD-you-entered>`);
  console.log('Clean up with:');
  console.log(`  node scripts/pr4-e2e-cleanup.js --person ${personId} --suggestion ${suggestionId}`);
  console.log('────────────────────────────────────────────────────────');
});

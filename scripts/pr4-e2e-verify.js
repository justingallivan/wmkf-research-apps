#!/usr/bin/env node
/**
 * PR4 e2e VERIFY — after a reviewer Accept/Decline through the Stage 2a form,
 * confirm the self-reported ORCID propagated to the person + contact and that the
 * identity status is the sticky 'confirmed' sentinel.
 *
 *   node scripts/pr4-e2e-verify.js --person <GUID> [--contact <GUID>] \
 *        --suggestion <GUID> --expect-orcid 0000-0002-1825-0097
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
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : d; };
const PERSON = arg('person'), CONTACT = arg('contact'), SUGGESTION = arg('suggestion'), EXPECT = arg('expect-orcid');
if (!PERSON || !SUGGESTION || !EXPECT) {
  console.error('Usage: --person <GUID> [--contact <GUID>] --suggestion <GUID> --expect-orcid <iD>');
  process.exit(1);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { normalizeOrcid } = await import('../lib/utils/orcid-normalize.js');

const want = normalizeOrcid(EXPECT);
if (want.state !== 'valid') { console.error(`✗ --expect-orcid is not a valid ORCID (${want.state})`); process.exit(1); }
const eq = (raw) => normalizeOrcid(raw).state === 'valid' && normalizeOrcid(raw).id === want.id;
const mark = (ok) => (ok ? '✓' : '✗');

await bypassDynamicsRestrictions('pr4-e2e-verify', async () => {
  const person = await DynamicsService.getRecord('wmkf_potentialreviewerses', PERSON, {
    select: 'wmkf_potentialreviewersid,wmkf_orcid,wmkf_orcidurl,wmkf_identitystatus,_wmkf_contact_value',
  });
  const sug = await DynamicsService.getRecord('wmkf_appreviewersuggestions', SUGGESTION, {
    select: 'wmkf_appreviewersuggestionid,wmkf_reviewerorcid,wmkf_accepted,wmkf_declined,wmkf_responsetype',
  });
  const contactId = CONTACT || person?._wmkf_contact_value || null;
  const contact = contactId
    ? await DynamicsService.getRecord('contacts', contactId, { select: 'contactid,wmkf_orcid' }).catch(() => null)
    : null;

  console.log('\nExpected ORCID:', want.id);
  console.log('Engagement (suggestion):');
  console.log(`  accepted=${sug.wmkf_accepted}  declined=${sug.wmkf_declined}  responsetype=${sug.wmkf_responsetype ?? null}`);
  console.log(`  ${mark(eq(sug.wmkf_reviewerorcid))} wmkf_reviewerorcid = ${JSON.stringify(sug.wmkf_reviewerorcid)}`);
  console.log('Person (wmkf_potentialreviewers):');
  console.log(`  ${mark(eq(person.wmkf_orcid))} wmkf_orcid          = ${JSON.stringify(person.wmkf_orcid)}`);
  console.log(`  ${mark(eq(person.wmkf_orcidurl))} wmkf_orcidurl       = ${JSON.stringify(person.wmkf_orcidurl)}`);
  console.log(`  ${mark(person.wmkf_identitystatus === 'confirmed')} wmkf_identitystatus = ${JSON.stringify(person.wmkf_identitystatus)}  (expect 'confirmed')`);
  console.log('Contact:');
  if (!contactId) {
    console.log('  ✗ no contact — every accepted reviewer should be promoted, including honorarium opt-outs');
  } else {
    console.log(`  contactid=${contactId}`);
    console.log(`  ${mark(eq(contact?.wmkf_orcid))} wmkf_orcid          = ${JSON.stringify(contact?.wmkf_orcid)}`);
  }

  const personOk = eq(person.wmkf_orcid) && person.wmkf_identitystatus === 'confirmed';
  const contactOk = !!contactId && eq(contact?.wmkf_orcid);
  const engagementOk = eq(sug.wmkf_reviewerorcid);
  const pass = personOk && contactOk && engagementOk;
  console.log(`\n${pass ? '✓ PASS' : '✗ FAIL'} — person ${personOk ? 'ok' : 'BAD'}, contact ${contactOk ? 'ok' : 'BAD'}, engagement ${engagementOk ? 'ok' : 'BAD'}`);
  if (!pass) process.exitCode = 1;
});

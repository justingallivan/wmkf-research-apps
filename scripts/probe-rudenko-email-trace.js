#!/usr/bin/env node
/**
 * S265 first-task probe: trace the email-enrichment tiers for the concrete
 * miss case — Prof. Artem Rudenko / Kansas State (request 1002794,
 * ORCID 0000-0002-9154-8463, email came back null).
 *
 * Read-only diagnostic: runs ContactEnrichmentService.enrichCandidate with
 * persist:false and logs every tier's progress + the raw tierResults, so we can
 * see WHICH tier failed to surface an email and whether the name-consistency
 * guard dropped a real one. No writeback.
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=');
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  });
}

const { ContactEnrichmentService } = require('../lib/services/contact-enrichment-service');
const { ContactParser } = require('../lib/utils/contact-parser');

async function main() {
  const candidate = {
    name: process.env.PROBE_NAME || 'Prof. Artem Rudenko',
    affiliation: process.env.PROBE_AFFIL || 'Kansas State University',
    orcid: process.env.PROBE_ORCID || '0000-0002-9154-8463',
    publications: [], // discovery sometimes carries none; PubMed tier needs them
  };

  console.log('=== CANDIDATE ===');
  console.log(JSON.stringify(candidate, null, 2));
  console.log('stripHonorifics(name) =>', JSON.stringify(ContactParser.stripHonorifics(candidate.name)));
  console.log('\n=== CREDENTIALS PRESENT ===');
  console.log('CLAUDE_API_KEY:', !!process.env.CLAUDE_API_KEY);
  console.log('SERP_API_KEY:', !!process.env.SERP_API_KEY);
  console.log('ORCID_CLIENT_ID/SECRET:', !!process.env.ORCID_CLIENT_ID, !!process.env.ORCID_CLIENT_SECRET);

  // Warm model overrides so getModelForApp('contact-enrichment') resolves the
  // real Anthropic id (the route does this; a bare script otherwise gets the
  // literal tier key 'haiku' and Anthropic 404s).
  try {
    const { loadModelOverrides } = require('../lib/services/model-override-loader');
    await loadModelOverrides();
    console.log('loadModelOverrides: OK');
  } catch (e) {
    console.log('loadModelOverrides failed (Tier 3 may 404):', e.message);
  }

  console.log('\n=== TIER PROGRESS ===');
  const result = await ContactEnrichmentService.enrichCandidate(candidate, {
    credentials: {
      claudeApiKey: process.env.CLAUDE_API_KEY,
      orcidClientId: process.env.ORCID_CLIENT_ID,
      orcidClientSecret: process.env.ORCID_CLIENT_SECRET,
      serpApiKey: process.env.SERP_API_KEY,
    },
    usePubmed: true,
    useOrcid: true,
    useSerpSearch: true,
    useClaudeSearch: true,
    persist: false,
    onProgress: (p) => {
      if (p.tier !== undefined) {
        console.log(`  [tier ${p.tier}] ${p.status}: ${p.message}`);
      }
    },
  });

  const ce = result.contactEnrichment;
  console.log('\n=== FINAL EMAIL OUTCOME ===');
  console.log('email:', ce.email);
  console.log('emailSource:', ce.emailSource);
  console.log('emailPersistAllowed:', ce.emailPersistAllowed);
  console.log('contactStatus:', ce.contactStatus, '/', ce.contactStatusReason);
  console.log('tiersUsed:', ce.tiersUsed);
  console.log('verifiedInstitutionDomain:', ce.verifiedInstitutionDomain);
  console.log('identity.status:', ce.identity?.status);

  console.log('\n=== RAW TIER RESULTS ===');
  console.log(JSON.stringify(ce.tierResults, null, 2));

  // If SerpAPI / Claude returned an email that got dropped, re-test the guard
  // explicitly so we can see WHY.
  for (const [tier, r] of Object.entries(ce.tierResults || {})) {
    const candEmail = r?.email || r?.rejectedEmail;
    if (candEmail) {
      console.log(`\n[guard] ${tier} email "${candEmail}" => isNameConsistentEmail(${JSON.stringify(candidate.name)}):`,
        ContactParser.isNameConsistentEmail(candEmail, candidate.name));
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });

#!/usr/bin/env node
/** Read-only Pre-Site Visit source probe. Never calls a model or writes Dataverse/SharePoint. */

import fs from 'fs';
import './lib/use-extensionless.mjs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repository root.');
  process.exit(2);
}

const args = process.argv.slice(2);
const requestIndex = args.indexOf('--request');
const requestNumber = requestIndex >= 0 ? args[requestIndex + 1] : null;
if (!requestNumber) {
  console.error('Usage: node scripts/probe-pre-site-visit-source.mjs --request <request number>');
  process.exit(2);
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const grantRequestAdapter = await import('../lib/dataverse/adapters/grant-request.js');
const { loadPreSiteVisitInputs } = await import('../lib/services/pre-site-visit/proposal-core-service.js');

enterDynamicsBypassForScript('probe-pre-site-visit-source');
const { records } = await grantRequestAdapter.findByRequestNumber(requestNumber, {
  select: 'akoya_requestid,akoya_requestnum',
  top: 2,
});
if (records.length !== 1) {
  console.error(`Expected one request numbered ${requestNumber}; found ${records.length}.`);
  process.exit(1);
}

const { context, proposalNarrative } = await loadPreSiteVisitInputs({
  requestId: records[0].akoya_requestid,
});
console.log(JSON.stringify({
  requestId: context.requestId,
  requestNumber: context.requestNumber,
  proposalFilename: proposalNarrative.filename,
  proposalTextChars: proposalNarrative.text.length,
  projectTitlePresent: Boolean(context.projectTitle),
  applicantInstitutionPresent: Boolean(context.applicantInstitution),
  cityState: context.documentFields.cityState,
  personnel: context.personnel,
  populatedDocumentFields: Object.fromEntries(
    Object.entries(context.documentFields).map(([key, value]) => [key, Boolean(value)]),
  ),
}, null, 2));

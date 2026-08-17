#!/usr/bin/env node
/**
 * Create a clearly labeled layout fixture from live read-only request metadata.
 * It verifies the SharePoint narrative source but deliberately never calls Claude.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
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
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const requestNumber = valueAfter('--request');
const outputArg = valueAfter('--output');
if (!requestNumber || !outputArg) {
  console.error('Usage: node scripts/render-pre-site-visit-fixture.mjs --request <number> --output <TEST.docx>');
  process.exit(2);
}
if (!/test/i.test(path.basename(outputArg))) {
  console.error('Fixture output filename must contain TEST.');
  process.exit(2);
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const grantRequestAdapter = await import('../lib/dataverse/adapters/grant-request.js');
const { loadPreSiteVisitInputs } = await import('../lib/services/pre-site-visit/proposal-core-service.js');
const { renderPreSiteVisitDocx } = await import('../lib/services/pre-site-visit/docx-renderer.js');

enterDynamicsBypassForScript('render-pre-site-visit-fixture');
const { records } = await grantRequestAdapter.findByRequestNumber(requestNumber, {
  select: 'akoya_requestid,akoya_requestnum',
  top: 2,
});
if (records.length !== 1) {
  console.error(`Expected one request numbered ${requestNumber}; found ${records.length}.`);
  process.exit(1);
}

const { context } = await loadPreSiteVisitInputs({ requestId: records[0].akoya_requestid });
const marker = '[TEST LAYOUT ONLY — CLAUDE WAS NOT RUN]';
const proposalCore = {
  executiveSummary: `${marker} This draft verifies the summary-page text flow using deterministic fixture content.`,
  impactOverview: 'Fixture text verifies wrapping and spacing for the impact bullet.',
  methodologyOverview: 'Fixture text verifies wrapping and spacing for the methodology bullet.',
  personnelOverview: `Fixture text verifies one-paragraph personnel formatting for ${context.personnel.map((person) => person.name).join(', ')}.`,
  keckFundingRationale: 'Fixture text verifies wrapping and spacing for the rationale bullet.',
  backgroundAndImpact: `${marker} This paragraph verifies the first long-form section.\n\nA second fixture paragraph verifies template-preserving paragraph expansion.`,
  detailedMethodology: `${marker} This paragraph verifies the detailed-methodology section.\n\nA second fixture paragraph verifies long-form text flow without a live model call.`,
  personnelDetails: `Fixture text keeps the full Dataverse roster in one paragraph: ${context.personnel.map((person) => `${person.name} (${person.role})`).join('; ')}.`,
};

const output = await renderPreSiteVisitDocx({
  documentFields: context.documentFields,
  proposalCore,
});
await fsPromises.mkdir(path.dirname(outputArg), { recursive: true });
await fsPromises.writeFile(outputArg, output);
console.log(JSON.stringify({
  output: path.resolve(outputArg),
  requestNumber: context.requestNumber,
  modelCalled: false,
}, null, 2));

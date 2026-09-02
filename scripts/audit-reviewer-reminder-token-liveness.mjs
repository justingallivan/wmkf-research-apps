#!/usr/bin/env node
/**
 * READ-ONLY audit of review-due reminder token liveness for one explicit cycle.
 *
 * Dataverse operations are GET-only. The OAuth token exchange is the only POST.
 * This script does not import the reminder sender, token lifecycle, lifecycle
 * update adapter, or maintenance service.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/audit-reviewer-reminder-token-liveness.mjs \
 *     --target=prod --cycle=D26 --output=outputs/reviewer-reminder-token-liveness-D26.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { reviewDueCandidateFilter } from '../lib/services/reviewer-reminder-candidate.js';
import { buildReviewerReminderLivenessReport } from '../lib/services/reviewer-reminder-liveness-audit.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

function arg(name) {
  const flag = `--${name}`;
  const exactIndex = process.argv.indexOf(flag);
  if (exactIndex >= 0) return process.argv[exactIndex + 1] || null;
  const prefix = `${flag}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

async function queryAll(client, initialPath) {
  const rows = [];
  let next = initialPath;
  while (next) {
    const response = await client.get(next);
    if (!response.ok) {
      throw new Error(`Dataverse GET failed (${response.status}): ${response.text.slice(0, 400)}`);
    }
    rows.push(...(response.body?.value || []));
    next = response.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

async function main() {
  loadEnvLocal();
  const target = arg('target');
  const cycleCode = arg('cycle');
  const outputPath = arg('output');
  if (target !== 'prod' && target !== 'sandbox') {
    throw new Error('--target=prod or --target=sandbox is required');
  }
  if (!/^[DJ]\d{2}$/.test(cycleCode || '')) {
    throw new Error('--cycle must be an explicit cycle code such as D26 or J27');
  }
  if (!outputPath) throw new Error('--output is required');
  if (target === 'prod' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes');
  }

  const resourceUrl = target === 'prod'
    ? process.env.DYNAMICS_URL || process.env.DATAVERSE_URL
    : process.env.DYNAMICS_SANDBOX_URL;
  if (!resourceUrl) throw new Error(`Missing Dataverse URL for target=${target}`);

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const suggestionSelect = [
    'wmkf_appreviewersuggestionid',
    '_wmkf_request_value',
    'wmkf_reviewduedateoverride',
    'wmkf_externaltokenhash',
    'wmkf_externaltokenexpires',
    'wmkf_externaltokenrevoked',
  ].join(',');
  const rows = await queryAll(
    client,
    `/wmkf_appreviewersuggestions?$select=${suggestionSelect}&$filter=${encodeURIComponent(reviewDueCandidateFilter())}`,
  );

  const requestIds = [...new Set(rows.map((row) => row._wmkf_request_value).filter(Boolean))];
  const requestById = {};
  for (const requestId of requestIds) {
    const response = await client.get(
      `/akoya_requests(${requestId})?$select=akoya_requestid,akoya_requestnum,wmkf_meetingdate,wmkf_reviewduedate`,
    );
    if (response.ok && response.body?.akoya_requestid) {
      requestById[requestId] = response.body;
    }
  }

  const report = buildReviewerReminderLivenessReport({
    rows,
    requestById,
    cycleCode,
    nowMs: Date.now(),
  });
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`READ-ONLY audit complete: ${report.totalRowsExamined} ${cycleCode} rows examined.`);
  console.log(`Blocked: ${report.blockedRows.length}. Eligible: ${report.reminderEligibility.eligible}.`);
  console.log(`Wrote ${resolvedOutput}`);
}

main().catch((error) => {
  console.error(`audit failed: ${error.message}`);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Read-only inventory of sandbox test Requests and current Pre-Site artifacts
 * for the post-presentation writeup-regeneration rehearsal.
 *
 * Pins both runtime Dynamics URLs to the tracked sandbox host after loading
 * local credentials, enables the target interlock and DAL enforcement, and
 * removes any production-read opt-in. It issues GET requests only and prints
 * request numbers plus lifecycle/readiness booleans; never prints names,
 * addresses, GUIDs, narrative/review content, file identities, or credentials.
 *
 * Run: node scripts/probe-writeup-regeneration-sandbox-fixture.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const { SANDBOX_HOSTS } = require('../lib/dataverse/core/target-registry.js');
const { classifyTarget } = require('../lib/dataverse/core/interlock.js');

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

async function main() {
  loadEnvLocal();

  // The request URL is pinned from the reviewed registry, never inherited
  // from DYNAMICS_URL or a caller-supplied target.
  const resourceUrl = `https://${SANDBOX_HOSTS[0]}`;
  process.env.DYNAMICS_URL = resourceUrl;
  process.env.DYNAMICS_SANDBOX_URL = resourceUrl;
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
  delete process.env.DATAVERSE_ALLOW_PROD_READS;

  if (classifyTarget(resourceUrl) !== 'sandbox') {
    throw new Error('Refusing to run: registry target did not classify as sandbox.');
  }

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const requestsResponse = await client.get(
    '/akoya_requests?$select=akoya_requestid,akoya_requestnum,_wmkf_projectleader_value,'
      + '_wmkf_currentpresitevisit_value,_wmkf_currentfinalwriteup_value,wmkf_istestrequest,wmkf_testcreationrunid'
      + '&$filter=wmkf_istestrequest eq true&$orderby=akoya_requestnum asc&$top=1000',
  );
  if (!requestsResponse.ok) throw new Error(`Sandbox test-Request GET failed (${requestsResponse.status}).`);
  const requests = requestsResponse.body?.value || [];

  const artifactsResponse = await client.get(
    '/wmkf_requestdocuments?$select=wmkf_requestdocumentid,_wmkf_request_value,wmkf_artifacttype,'
      + 'wmkf_lifecyclestate,wmkf_operationstatus,wmkf_sharepointdriveid,wmkf_sharepointitemid,wmkf_sharepointversionid'
      + '&$filter=wmkf_artifacttype eq 100000001&$top=1000',
  );
  if (!artifactsResponse.ok) throw new Error(`Sandbox Pre-Site artifact GET failed (${artifactsResponse.status}).`);

  const requestById = new Map(requests.map((row) => [String(row.akoya_requestid).toLowerCase(), row]));
  const artifacts = (artifactsResponse.body?.value || [])
    .filter((row) => requestById.has(String(row._wmkf_request_value || '').toLowerCase()))
    .map((row) => {
      const request = requestById.get(String(row._wmkf_request_value).toLowerCase());
      return {
        requestNumber: request.akoya_requestnum || null,
        lifecycle: row.wmkf_lifecyclestate ?? null,
        operation: row.wmkf_operationstatus ?? null,
        currentPointer: sameId(request._wmkf_currentpresitevisit_value, row.wmkf_requestdocumentid),
        linkedProjectLeader: Boolean(request._wmkf_projectleader_value),
        currentFinalPresent: Boolean(request._wmkf_currentfinalwriteup_value),
        fileIdentityPresent: Boolean(
          row.wmkf_sharepointdriveid && row.wmkf_sharepointitemid && row.wmkf_sharepointversionid,
        ),
      };
    });

  const markedWithProjectLeader = requests.filter((row) => Boolean(row._wmkf_projectleader_value)).length;
  console.log(JSON.stringify({
    target: classifyTarget(resourceUrl),
    testRequestCount: requests.length,
    testRequestsWithProjectLeader: markedWithProjectLeader,
    preSiteArtifactsOnTestRequests: artifacts.length,
    artifacts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || 'Sandbox fixture probe failed.');
  process.exitCode = 1;
});

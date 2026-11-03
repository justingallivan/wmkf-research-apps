#!/usr/bin/env node
/** Read one marked test request's existing materials email; never mint or send.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/read-test-materials-email-link.mjs requestGuid suggestionGuid recipient privateOutputPath
 * The bearer link is written mode 0600, never printed. No file/PDF contents read.
 */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isGuid } from '../lib/utils/guid.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
loadEnvLocal();
const [requestId, suggestionId, recipient, outputPath, ...extra] = process.argv.slice(2);
if (!isGuid(requestId) || !isGuid(suggestionId) || !recipient || !isAbsolute(outputPath || '') || extra.length) throw new Error('Exact request/suggestion GUIDs, recipient and private output path required.');
const resourceUrl = process.env.DYNAMICS_URL;
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes' || !PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase())) throw new Error('Production read acknowledgment required.');
const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
const request = await client.get(`/akoya_requests(${requestId})?$select=wmkf_istestrequest`);
if (!request.ok || request.body.wmkf_istestrequest !== true) throw new Error('Marked test request required.');
const query = new URLSearchParams({
  $select: 'activityid,subject,description,statecode,statuscode,senton,createdon',
  $filter: `_regardingobjectid_value eq ${requestId} and startswith(subject,'TEST ONLY — Review materials:')`,
  $expand: 'email_activity_parties($select=participationtypemask,addressused)',
  $orderby: 'createdon desc', $top: '2',
});
const response = await client.get(`/emails?${query}`);
if (!response.ok || response.body?.value?.length !== 1 || response.body['@odata.nextLink']) throw new Error('Exactly one recorded test materials email required.');
const row = response.body.value[0];
const targets = row.email_activity_parties.filter(p => [2,3,4].includes(p.participationtypemask));
if (targets.length !== 1 || String(targets[0].addressused || '').toLowerCase() !== recipient.toLowerCase()) throw new Error('Email recipient does not match the authorized test inbox.');
const links = [...new Set((row.description || '').match(/https:\/\/reviews\.wmkeck\.org\/external\/review\/[A-Za-z0-9._-]+/g) || [])];
if (links.length !== 1) throw new Error('Exactly one existing reviewer portal link required.');
const token = new URL(links[0]).pathname.split('/').pop();
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
if (String(claims.req).toLowerCase() !== requestId.toLowerCase() || String(claims.sub).toLowerCase() !== suggestionId.toLowerCase()) throw new Error('Recorded link identity mismatch.');
await writeFile(outputPath, links[0] + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ readOnly: true, exactTestRecipient: true, emailState: row.statecode, emailStatus: row.statuscode, sentAt: row.senton, linkIssuedAt: new Date(claims.iat * 1000).toISOString(), linkSavedPrivately: true }));

#!/usr/bin/env node
/** Read-only receipt for one marked Factory reviewer rehearsal. No tokens/body text printed.
 * DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/probe-factory-reviewer-rehearsal.mjs requestGuid suggestionGuid
 */
import { createRequire } from 'node:module';
import { isGuid } from '../lib/utils/guid.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
loadEnvLocal();
const [requestId, suggestionId, ...extra] = process.argv.slice(2);
if (!isGuid(requestId) || !isGuid(suggestionId) || extra.length) throw new Error('Exactly one request and suggestion GUID required.');
const resourceUrl = process.env.DYNAMICS_URL;
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes' || !PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase())) throw new Error('Production read acknowledgment required.');
const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
async function read(path) {
  const result = await client.get(path);
  if (!result.ok || result.body['@odata.nextLink']) throw new Error('Bounded complete read unavailable.');
  return result.body;
}
const request = await read(`/akoya_requests(${requestId})?$select=akoya_requestnum,wmkf_istestrequest,wmkf_readyforreview,wmkf_phaseistatus,wmkf_phaseiistatus,akoya_requeststatus`);
if (request.wmkf_istestrequest !== true) throw new Error('Marked test request required.');
const suggestion = await read(`/wmkf_appreviewersuggestions(${suggestionId})?$select=_wmkf_request_value,wmkf_invited,wmkf_accepted,wmkf_reviewreceivedat,wmkf_honorariumoptout,_wmkf_honorariumrequest_value`);
if (String(suggestion._wmkf_request_value).toLowerCase() !== requestId.toLowerCase()) throw new Error('Exact request/suggestion pairing required.');
const query = (select, filter) => new URLSearchParams({ $select: select, $filter: filter, $top: '100' });
const [answers, payments, emails] = await Promise.all([
  read('/wmkf_appreviewanswers?' + query('wmkf_questionkey', `_wmkf_appreviewersuggestion_value eq ${suggestionId}`)),
  read('/akoya_requestpayments?' + query('akoya_requestpaymentid', `_akoya_requestlookup_value eq ${requestId}`)),
  read('/emails?' + query('activityid,statecode,statuscode', `_regardingobjectid_value eq ${requestId}`)),
]);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), readOnly: true, requestNumber: request.akoya_requestnum,
  ready: request.wmkf_readyforreview, phase1: request.wmkf_phaseistatus, phase2: request.wmkf_phaseiistatus, requestStatus: request.akoya_requeststatus,
  invited: suggestion.wmkf_invited, accepted: suggestion.wmkf_accepted, reviewReceivedAt: suggestion.wmkf_reviewreceivedat,
  answerCount: answers.value.length, distinctAnswerKeys: new Set(answers.value.map(a => a.wmkf_questionkey)).size,
  honorariumDeclined: suggestion.wmkf_honorariumoptout === true, honorariumRequestLinked: Boolean(suggestion._wmkf_honorariumrequest_value),
  requestPaymentCount: payments.value.length, emailCount: emails.value.length, sentEmailCount: emails.value.filter(e => e.statuscode === 3).length }, null, 2));

#!/usr/bin/env node
/** Read-only exact-fixture safety check for the owner-authorized controlled production release. */
import {loadEnvLocal,getAccessToken,createClient} from '../lib/dataverse/client.js';
loadEnvLocal();process.env.DATAVERSE_ALLOW_PROD_READS='yes';process.env.DATAVERSE_TARGET_INTERLOCK='on';
const requestId='185415ef-3750-4806-84c7-fb6dd032af31',origin='https://wmkf.crm.dynamics.com';
const c=createClient({resourceUrl:origin,token:await getAccessToken(origin)});
const fields=['_akoya_applicantid_value','_akoya_payee_value','_akoya_primarycontactid_value','_akoya_gofundrecommender_value','_wmkf_paymentcontact_value'];
const r=await c.get(`/akoya_requests(${requestId})?$select=wmkf_istestrequest,wmkf_testcreationrunid,wmkf_respondreminderenabled,wmkf_reviewduereminderenabled,${fields.join(',')}`);
if(!r.ok||r.body.wmkf_istestrequest!==true||r.body.wmkf_testcreationrunid!=='0615eece-39d1-4028-bbe7-6384cd58b356'||fields.some(f=>r.body[f]))throw Error('fixture_safety_mismatch');
const mail=await c.get(`/emails?$filter=_regardingobjectid_value eq ${requestId}&$select=activityid,senton,statecode,statuscode`);
if(!mail.ok||mail.body.value.length||mail.body['@odata.nextLink'])throw Error('fixture_email_check_failed');
console.log(JSON.stringify({verified:true,requestId,nullBusinessBindings:true,regardingEmails:0,respondReminderEnabled:r.body.wmkf_respondreminderenabled,reviewDueReminderEnabled:r.body.wmkf_reviewduereminderenabled}));

/** Uncached, pinned-origin metadata reads only. Caller supplies trusted server policy. */
import { createClient, getAccessToken } from '../../dataverse/client.js';
import { classifyTarget } from '../../dataverse/core/interlock.js';
import { MACHINE_SUMMARY_FIELD } from './machine-summary-contract.js';
export async function checkSummaryDestinationMetadata(policy) {
  const grant = {field:MACHINE_SUMMARY_FIELD, type:'Memo'};
  const origin = `https://${policy.targetHost}`;
  if (classifyTarget(origin) !== 'sandbox' || process.env.DYNAMICS_URL?.replace(/\/$/, '') !== origin
    || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('Machine destination target unavailable');
  const client = createClient({ resourceUrl: origin, token: await getAccessToken(origin) });
  const base = `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${grant.field}')`;
  const common = await client.get(`${base}?$select=LogicalName,AttributeType,IsValidForRead,IsValidForUpdate,IsSecured,RequiredLevel,AttributeOf,SourceType`);
  if (!common.ok) throw new Error('Machine destination metadata unavailable');
  const typed = await client.get(`${base}/Microsoft.Dynamics.CRM.${grant.type}AttributeMetadata?$select=MaxLength,Format`);
  if (!typed.ok) throw new Error('Machine destination metadata unavailable');
  const m = common.body;
  if (m.LogicalName !== MACHINE_SUMMARY_FIELD || m.AttributeType !== 'Memo' || m.IsValidForRead !== true
    || m.IsValidForUpdate !== true || m.IsSecured !== false || m.RequiredLevel?.Value !== 'None'
    || m.AttributeOf !== null || m.SourceType !== 0 || typed.body.Format !== 'Text' || typed.body.MaxLength !== 100000) {
    throw new Error('Summary destination metadata is incompatible');
  }
}

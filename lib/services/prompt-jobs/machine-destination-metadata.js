/** Uncached, pinned-origin metadata reads only. Caller supplies trusted server policy. */
import { createClient, getAccessToken } from '../../dataverse/client.js';
import { classifyTarget } from '../../dataverse/core/interlock.js';
import { validateDestinationGrant, validateDestinationMetadata } from './machine-destination.js';
export async function checkMachineDestinationMetadata(policy) {
  if (!Object.hasOwn(policy, 'destinationGrant')) return; // Preserve legacy pilot behavior.
  const grant = validateDestinationGrant(policy.destinationGrant);
  const origin = `https://${policy.targetHost}`;
  if (classifyTarget(origin) !== 'sandbox' || process.env.DYNAMICS_URL?.replace(/\/$/, '') !== origin
    || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw new Error('Machine destination target unavailable');
  const client = createClient({ resourceUrl: origin, token: await getAccessToken(origin) });
  const base = `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${grant.field}')`;
  const common = await client.get(`${base}?$select=LogicalName,AttributeType,IsValidForRead,IsValidForUpdate,IsSecured,RequiredLevel,AttributeOf,SourceType`);
  if (!common.ok) throw new Error('Machine destination metadata unavailable');
  const typed = await client.get(`${base}/Microsoft.Dynamics.CRM.${grant.type}AttributeMetadata?$select=MaxLength,Format`);
  if (!typed.ok) throw new Error('Machine destination metadata unavailable');
  validateDestinationMetadata({ ...common.body, MaxLength: typed.body.MaxLength, Format: typed.body.Format }, grant);
}

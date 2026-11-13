/**
 * Request initialization delivery for the server-authorized, frozen Short Title destination.
 * The default-off machine worker binds readTarget/writer to the approved title capability.
 * Caller owns durable initialization/publication fences and current app grants.
 * destinationField is server-composed from the exact grant and frozen task, never request input.
 * worker.advanceJob records any writer throw after dispatch as unknown via
 * finishPublication; preserve that catch/checkpoint when composing a machine worker.
 * Never invoke this writer before durable dispatch intent.
 * readRequest returns the DAL-normalized {_etag, ...selectedFields} shape.
 * Bind readRequest/patchRequest to the grant-request DAL adapter only inside a
 * reviewed post-auth DAL context; this module creates no bypass or impersonation.
 */
import { LEGACY_TITLE_FIELD, validMachineDestination } from './machine-destination.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { canonical, sha256 } from './profile.js';

export const TITLE_DESTINATION = LEGACY_TITLE_FIELD;
const ETAG = /^(?:W\/)?"[^"\r\n]+"$/;
function fail(code, httpStatus = 400) { throw new ServiceHttpError(code, { code, httpStatus, body: { error: code } }); }
function guid(value) {
  if (typeof value !== 'string' || value !== value.trim() || !isGuid(value)) fail('invalid_field_delivery');
  return value.toLowerCase();
}
function etag(value) {
  if (typeof value !== 'string' || value.length > 200 || !ETAG.test(value)) fail('invalid_field_delivery');
  return value;
}
function jobIdentity(job) {
  if (!job || job.operation !== 'initialize') fail('invalid_field_delivery');
  for (const name of ['environment', 'principal_key', 'authorization_scope']) {
    if (typeof job[name] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(job[name])) fail('invalid_field_delivery');
  }
  return { jobId: guid(job.id), requestId: guid(job.request_id), environment: job.environment,
    principalKey: job.principal_key, authorizationScope: job.authorization_scope };
}
function command(job, operationId, destinationField) {
  return Object.freeze({ ...jobIdentity(job), operationId,
    fields: Object.freeze([destinationField]) });
}

/** No default dependencies: explicit server composition is required before use. */
export function createRequestFieldDelivery({ authorize, readRequest, patchRequest, destinationField = TITLE_DESTINATION }) {
  if (!validMachineDestination(destinationField)) throw new TypeError('Invalid field destination');
  if (![authorize, readRequest, patchRequest].every(fn => typeof fn === 'function')) throw new TypeError('Field delivery dependencies required');
  async function allowed(phase, snapshot) {
    let permitted;
    try { permitted = await authorize(phase, snapshot); }
    catch { fail('field_delivery_unavailable', 503); }
    if (permitted !== true) fail('field_delivery_denied', 403);
  }
  return {
    async readTarget({ job, tasks }) {
      if (!Array.isArray(tasks) || tasks.length !== 1 || tasks[0]?.task_key !== 'preflight.short-title'
        || tasks[0].destination_field !== destinationField) fail('invalid_field_delivery');
      const snapshot = command(job, null, destinationField);
      await allowed('preGET', snapshot);
      let row;
      try { row = await readRequest(snapshot.requestId, { select: destinationField }); }
      catch { fail('field_delivery_unavailable', 503); }
      // Copy the observation before the asynchronous grant recheck. Preserve the
      // distinction between null, empty, whitespace and real staff content.
      if (!row || !Object.hasOwn(row, destinationField)
        || !(row[destinationField] === null || typeof row[destinationField] === 'string')) fail('field_delivery_unavailable', 503);
      const value = row[destinationField];
      const version = etag(row._etag);
      await allowed('postGET', snapshot);
      return { etag: version, fields: { [destinationField]: { blank: value === null || value === '', sha256: sha256(canonical(value)) } } };
    },
    async writer({ job, operationId, expectedEtag, fields }) {
      const snapshot = command(job, guid(operationId), destinationField);
      const version = etag(expectedEtag);
      if (etag(job.target_etag) !== version || !fields || typeof fields !== 'object' || Array.isArray(fields)
        || Object.keys(fields).length !== 1 || !Object.hasOwn(fields, destinationField)) fail('invalid_field_delivery');
      const value = fields[destinationField];
      if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail('invalid_field_delivery');
      const payload = Object.freeze({ [destinationField]: value });
      await allowed('prePATCH', snapshot);
      try {
        // Exactly the original version and payload: no read, ETag refresh,
        // transport retry or human-actor fallback occurs in this adapter.
        await patchRequest(snapshot.requestId, payload, { ifMatch: version, noFallback: true });
        return 'applied';
      } catch (error) {
        return error?.status === 412 ? 'conflict' : 'unknown';
      }
    },
  };
}

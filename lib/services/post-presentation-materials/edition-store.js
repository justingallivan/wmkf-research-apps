/** Operational Board edition receipts and sticky enrollment. All pointer mutations serialize on the request row. */
import { db } from '@vercel/postgres';
import { isGuid } from '../../utils/guid.js';
import { validateEditionMembers } from './edition-model.js';
import { ServiceHttpError } from '../service-http-error.js';

const conflict = () => new ServiceHttpError('Board approval changed. Refresh before continuing.', { httpStatus: 409, code: 'presentation_edition_changed' });
function identity(requestId, profileId) {
  if (!isGuid(requestId) || !Number.isSafeInteger(profileId) || profileId < 1) throw new TypeError('invalid_edition_actor');
}
const READ = `SELECT v.*, e.id AS edition_id, e.request_id AS edition_request_id, e.members, e.approved_at,
  e.source_revision_id, e.presentation_end_ms
  FROM meeting_presentation_visibility v LEFT JOIN meeting_presentation_editions e
  ON e.id = v.active_edition_id AND e.request_id = v.request_id WHERE v.request_id = $1`;

export function createEditionStore(database) {
  async function read(requestId) {
    if (!isGuid(requestId)) throw new TypeError('invalid_request_id');
    return (await database.query(READ, [requestId])).rows[0] || null;
  }
  async function transaction(fn) {
    const client = await database.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function enroll({ requestId, profileId }) {
    identity(requestId, profileId);
    await database.query(`INSERT INTO meeting_presentation_visibility (request_id, enrolled_by, changed_by)
      VALUES ($1,$2,$2) ON CONFLICT (request_id) DO NOTHING`, [requestId, profileId]);
    return read(requestId);
  }
  async function approve({ requestId, profileId, expectedVersion, commandId, revisionId, endMs, members, fingerprint }) {
    identity(requestId, profileId); validateEditionMembers(members, { requestId });
    if (!isGuid(commandId) || !isGuid(revisionId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
      || !Number.isSafeInteger(endMs) || endMs < 0 || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new TypeError('invalid_edition_approval');
    return transaction(async client => {
      const row = (await client.query('SELECT * FROM meeting_presentation_visibility WHERE request_id=$1 FOR UPDATE', [requestId])).rows[0];
      if (!row) throw conflict();
      const prior = (await client.query('SELECT id, fingerprint FROM meeting_presentation_editions WHERE request_id=$1 AND command_id=$2', [requestId, commandId])).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.id !== row.active_edition_id) throw conflict();
        return { version: Number(row.version), activeEditionId: prior.id, reused: true };
      }
      if (Number(row.version) !== expectedVersion) throw conflict();
      const edition = (await client.query(`INSERT INTO meeting_presentation_editions
        (request_id,command_id,source_revision_id,presentation_end_ms,members,fingerprint,approved_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
      [requestId,commandId,revisionId,endMs,JSON.stringify(members),fingerprint,profileId])).rows[0];
      const updated = (await client.query(`UPDATE meeting_presentation_visibility SET active_edition_id=$2,
        version=version+1, changed_by=$3, changed_at=NOW(), withdrawn_at=NULL WHERE request_id=$1 RETURNING version`,
      [requestId,edition.id,profileId])).rows[0];
      return { version: Number(updated.version), activeEditionId: edition.id, reused: false };
    });
  }
  async function withdraw({ requestId, profileId, expectedVersion, expectedEditionId }) {
    identity(requestId, profileId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !isGuid(expectedEditionId)) throw new TypeError('invalid_edition_withdrawal');
    return transaction(async client => {
      const row = (await client.query(`UPDATE meeting_presentation_visibility SET active_edition_id=NULL,
        version=version+1, changed_by=$4, changed_at=NOW(), withdrawn_at=NOW()
        WHERE request_id=$1 AND version=$2 AND active_edition_id=$3 RETURNING version`,
      [requestId,expectedVersion,expectedEditionId,profileId])).rows[0];
      if (!row) throw conflict();
      return { version: Number(row.version), activeEditionId: null };
    });
  }
  return { read, enroll, approve, withdraw };
}
const store = createEditionStore(db);
export const readPresentationVisibility = (...args) => store.read(...args);
export const enrollPresentationApproval = (...args) => store.enroll(...args);
export const approvePresentationEdition = (...args) => store.approve(...args);
export const withdrawPresentationEdition = (...args) => store.withdraw(...args);

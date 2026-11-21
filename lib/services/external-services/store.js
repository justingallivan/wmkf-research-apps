/**
 * Private operational register in external_services and external_service_reviews (Postgres).
 * Callers requireSuperuser and supply authenticated actor IDs. No provider calls or credentials.
 * A service version guards every edit; review and service changes commit in one transaction.
 * UI/API support 500 services and 200 retained reviews per service; no automatic deletion.
 */
import crypto from 'node:crypto';
import { db, sql } from '@vercel/postgres';
import { invalid, validateService, validateReview } from './model';
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
function assertId(id) { if (typeof id !== 'string' || !ID.test(id)) throw invalid('Invalid service.'); }
function dto(row) { return { id: row.id, data: row.data, version: row.version, lastReviewedOn: row.last_reviewed_on || null }; }
export async function listServices() {
  const result = await sql.query(`SELECT s.*, (SELECT max(r.data->>'reviewedOn') FROM external_service_reviews r WHERE r.service_id=s.id) AS last_reviewed_on FROM external_services s ORDER BY s.data->>'provider', s.data->>'name' LIMIT 501`);
  if (result.rows.length > 500) throw invalid('The service register exceeds its supported size.', 503);
  return result.rows.map(dto);
}
export async function listReviews(id) {
  assertId(id);
  const result = await sql.query('SELECT id, data, created_at FROM external_service_reviews WHERE service_id=$1 ORDER BY data->>\'reviewedOn\' DESC, created_at DESC LIMIT 200', [id]);
  return result.rows;
}
export async function saveService({ id, data, expectedVersion, review, reviewId }, actorId) {
  assertId(id);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion > 2147483647) throw invalid('Reload this service before saving.');
  const clean = validateService(data, id);
  const cleanReview = review == null ? null : validateReview(review);
  if (reviewId != null && (typeof reviewId !== 'string' || !cleanReview || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId))) throw invalid('Invalid review.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let changed;
    if (expectedVersion === 0) {
      await client.query('LOCK TABLE external_services IN SHARE ROW EXCLUSIVE MODE');
      const count = await client.query('SELECT count(*)::int AS count FROM external_services');
      if (count.rows[0].count >= 500) throw invalid('The register supports up to 500 services.');
      changed = await client.query('INSERT INTO external_services (id,data,updated_by) VALUES ($1,$2::jsonb,$3) ON CONFLICT DO NOTHING RETURNING id', [id, JSON.stringify(clean), actorId]);
    } else {
      changed = await client.query('UPDATE external_services SET data=$1::jsonb, version=version+1, updated_at=now(), updated_by=$2 WHERE id=$3 AND version=$4 RETURNING id', [JSON.stringify(clean), actorId, id, expectedVersion]);
    }
    if (!changed.rows.length) throw invalid('This service changed since you opened it. Reload before saving.', 409);
    if (cleanReview) {
      if (reviewId) {
        const result = await client.query('UPDATE external_service_reviews SET data=$1::jsonb, updated_by=$2, updated_at=now() WHERE id=$3 AND service_id=$4 RETURNING id', [JSON.stringify(cleanReview), actorId, reviewId, id]);
        if (!result.rows.length) throw invalid('Review not found. Reload this service.', 404);
      } else {
        const count = await client.query('SELECT count(*)::int AS count FROM external_service_reviews WHERE service_id=$1', [id]);
        if (count.rows[0].count >= 200) throw invalid('This service has reached the 200-review limit. Contact the administrator to extend retention.');
        await client.query('INSERT INTO external_service_reviews (id,service_id,data,created_by,updated_by) VALUES ($1,$2,$3::jsonb,$4,$4)', [crypto.randomUUID(), id, JSON.stringify(cleanReview), actorId]);
      }
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

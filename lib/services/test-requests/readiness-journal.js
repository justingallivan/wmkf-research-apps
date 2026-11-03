/** Typed readiness attempts for completed prepared Factory runs. Operational ledger
 * only. One open attempt per run; attempt-bound CAS selects one sender. Owner
 * recovery abandons (never erases) an attempt; a later finalization plans afresh
 * after verifying the copied package and reading the current ETag.
 */
import { assertLedgerReceipt, sanitizeErrorMessage } from './run-ledger.js';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createReadinessJournal(db) {
  const one = async (sql, args) => (await db.query(sql, args)).rows[0] || null;
  const check = (runId, attempt = 1) => { if (!GUID.test(runId || '') || !Number.isInteger(attempt) || attempt < 1) throw new Error('Invalid readiness attempt identity.'); };
  const precondition = (etag, before) => { if (!/^W\/"\d{1,20}"$/.test(etag || '') || ![false, null].includes(before)) throw new Error('Invalid readiness precondition.'); };
  return {
    async get(runId) { check(runId); return one('SELECT * FROM test_request_readiness_finalizations WHERE run_id = $1::uuid ORDER BY attempt DESC LIMIT 1', [runId]); },
    async plan(runId, etag, before) {
      check(runId); precondition(etag, before);
      return db.transaction(async tx => {
        const run = (await tx.query("SELECT run_id FROM test_request_runs WHERE run_id=$1::uuid AND status='ready' AND destination_environment='production' FOR UPDATE", [runId])).rows[0];
        if (!run) return null;
        const latest = (await tx.query('SELECT * FROM test_request_readiness_finalizations WHERE run_id=$1::uuid ORDER BY attempt DESC LIMIT 1', [runId])).rows[0];
        if (latest && latest.status !== 'abandoned') return latest;
        return (await tx.query(`INSERT INTO test_request_readiness_finalizations (run_id,attempt,etag_before,ready_before) VALUES ($1::uuid,$2,$3,$4) RETURNING *`, [runId, (latest?.attempt ?? 0) + 1, etag, before])).rows[0];
      });
    },
    async dispatch(runId, attempt = 1) { check(runId, attempt); return one(`UPDATE test_request_readiness_finalizations SET status='dispatched', dispatched_at=NOW(), updated_at=NOW() WHERE run_id=$1::uuid AND attempt=$2 AND status='planned' RETURNING *`, [runId, attempt]); },
    async applied(runId, attempt = 1) { check(runId, attempt); return one(`UPDATE test_request_readiness_finalizations SET status='applied', ready_after=TRUE, updated_at=NOW() WHERE run_id=$1::uuid AND attempt=$2 AND status='dispatched' RETURNING *`, [runId, attempt]); },
    async complete(runId, effects, attempt = 1) {
      check(runId, attempt); assertLedgerReceipt(effects, 'readiness effects');
      return one(`UPDATE test_request_readiness_finalizations SET status='complete', completed_at=NOW(), effects=$2::jsonb, updated_at=NOW() WHERE run_id=$1::uuid AND attempt=$3 AND status='applied' AND ready_after IS TRUE RETURNING *`, [runId, JSON.stringify(effects), attempt]);
    },
    async attention(runId, error, attempt = 1, effects = null) {
      check(runId, attempt); if (effects) assertLedgerReceipt(effects, 'readiness effects');
      return one(`UPDATE test_request_readiness_finalizations SET status='needs_attention', error=$2, effects=COALESCE($4::jsonb,effects), updated_at=NOW() WHERE run_id=$1::uuid AND attempt=$3 AND status IN ('dispatched','applied') RETURNING *`, [runId, sanitizeErrorMessage(error), attempt, effects ? JSON.stringify(effects) : null]);
    },
    async recover(runId, previous) {
      check(runId, previous.attempt);
      if (!['planned','dispatched','needs_attention'].includes(previous.status)) throw new Error('Attempt cannot recover.');
      return db.transaction(async tx => {
        const run = (await tx.query("SELECT run_id FROM test_request_runs WHERE run_id=$1::uuid AND status='ready' AND destination_environment='production' FOR UPDATE", [runId])).rows[0];
        if (!run) return null;
        const abandoned = (await tx.query(`UPDATE test_request_readiness_finalizations SET status='abandoned', updated_at=NOW()
          WHERE run_id=$1::uuid AND attempt=$2 AND status=$3 AND etag_before=$4
          AND NOT EXISTS (SELECT 1 FROM test_request_readiness_finalizations WHERE run_id=$1::uuid AND attempt>$2) RETURNING *`, [runId, previous.attempt, previous.status, previous.etag_before])).rows[0];
        if (!abandoned) return null;
        return abandoned;
      });
    },
  };
}

/** Preview-only SQL for simulated screens. This connection has no app data. */
import { classifyLedgerUrl, SHARED_DATABASE_URL_VARS } from '../../db/ledger-registry';
import { pgLedgerDb } from '../test-requests/run-ledger-db';
import { j27IntegritySimulationRequestIds } from '../../utils/j27-integrity-readiness';

let database;

export function getJ27IntegritySimulationSql() {
  if (!j27IntegritySimulationRequestIds().length) return null;
  if (!database) {
    const url = process.env.INTEGRITY_SIMULATION_DB_URL;
    const sharedUrls = SHARED_DATABASE_URL_VARS.map(name => process.env[name]).filter(Boolean);
    const target = classifyLedgerUrl(url, { target: 'sandbox', sharedUrls });
    if (!target.ok || target.label !== 'managed-ledger'
      || !/^j27_integrity_sim_[a-f0-9]{8}$/.test(new URL(url).username)) {
      throw new Error('The isolated Preview screening database is unavailable');
    }
    database = pgLedgerDb(url, { pool: { max: 2, connectionTimeoutMillis: 5000 } });
  }

  return (strings, ...values) => database.transaction(async tx => {
    // The scoped role can read/write only this rehearsal schema.
    await tx.query('SET LOCAL search_path TO j27_integrity_simulation, pg_catalog');
    const query = strings.reduce((sql, chunk, i) => sql + chunk + (i < values.length ? `$${i + 1}` : ''), '');
    return tx.query(query, values);
  });
}

export const simulatedIntegrityEngine = {
  async *screenApplicants(applicants) {
    const { manualPubPeerSource } = await import('../../../shared/utils/integrity-evidence');
    yield {
      type: 'complete',
      results: applicants.map(({ name, institution }) => ({
        name, institution, matchingVersion: 2, sourceCoverageVersion: 3,
        hasConcerns: true, matchCount: 1,
        sources: {
          retraction_watch: { searched: true, matches: [], error: null, dataset: { status: 'unrecorded', state: 'unmanaged' } },
          pubpeer: manualPubPeerSource(name),
          news: { searched: true, analysisOutcome: 'flag_for_review', hasConcerns: true, resultCount: 1, error: null,
            summary: 'SIMULATED FINDING FOR REHEARSAL. A fictional inquiry matched a synthetic applicant by name and affiliation.',
            rawResults: [{ title: 'Simulated inquiry evidence', link: 'https://example.org/j27-integrity-simulation' }] },
        },
      })),
    };
  },
};

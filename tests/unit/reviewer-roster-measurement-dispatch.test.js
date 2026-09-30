/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/reviewer-institution-measurement', () => ({
  recordInstitutionMeasurement: jest.fn(() => { throw new Error('sync telemetry dispatch failure'); }),
}));

import { sql } from '@vercel/postgres';
import { recordInstitutionMeasurement } from '../../lib/services/reviewer-institution-measurement';

const store = require('../../lib/services/reviewer-roster-store');

test('synchronous best-effort measurement dispatch failure cannot duplicate a successful roster outcome', async () => {
  sql.mockReset();
  sql.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // roster INSERT committed
  sql.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // cap enforcement
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await store.recordSurfacedDetailed('request-1', [{
      name: 'Ada Lovelace',
      candidateKey: 'candidate:ada',
      provenance: { kind: 'literature_retrieved', sources: ['openalex'] },
    }]);

    expect(result).toEqual({ recorded: 1, results: [
      { inputIndex: 0, candidateKey: 'candidate:ada', outcome: 'written' },
    ] });
    expect(recordInstitutionMeasurement).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[reviewer-roster] institution measurement dispatch failed:', 'Error');
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
});

/** @jest-environment node */

jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../../lib/services/cycle-dossier-worker', () => ({
  drainCycleDossiers: jest.fn(async () => ({ claimed: 1 })),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import { drainCycleDossiers } from '../../lib/services/cycle-dossier-worker';
import handler from '../../pages/api/cron/drain-cycle-dossiers';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CYCLE_DOSSIER_CRON_SECRET = 'dossier-secret';
  process.env.CYCLE_DOSSIER_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.CYCLE_DOSSIER_CRON_SECRET;
  delete process.env.CYCLE_DOSSIER_ENABLED;
});

test('requires the dedicated dossier secret even in development', async () => {
  process.env.NODE_ENV = 'development';
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(drainCycleDossiers).not.toHaveBeenCalled();
});

test('missing dedicated secret fails closed', async () => {
  delete process.env.CYCLE_DOSSIER_CRON_SECRET;
  const res = response();
  await handler({ method: 'POST', headers: {} }, res);
  expect(res.statusCode).toBe(500);
  expect(drainCycleDossiers).not.toHaveBeenCalled();
});

test('valid dedicated secret reaches the worker only when enabled', async () => {
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer dossier-secret' } }, res);
  expect(withDalContext).toHaveBeenCalledWith('cron-drain-cycle-dossiers', expect.any(Function));
  expect(drainCycleDossiers).toHaveBeenCalledTimes(1);
  expect(res.body).toEqual({ claimed: 1 });

  process.env.CYCLE_DOSSIER_ENABLED = 'false';
  const disabled = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer dossier-secret' } }, disabled);
  expect(disabled.body).toEqual({ enabled: false });
  expect(drainCycleDossiers).toHaveBeenCalledTimes(1);
});

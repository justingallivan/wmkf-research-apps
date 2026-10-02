/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(), getSession: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/test-requests/admin-run-service', () => ({ createAdminRunService: jest.fn() }));

import { requireSuperuser, getSession } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { createAdminRunService } from '../../lib/services/test-requests/admin-run-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import sourceHandler, { config as sourceConfig } from '../../pages/api/admin/test-requests/runs/source';
import runsHandler, { config as runsConfig } from '../../pages/api/admin/test-requests/runs/index';
import runHandler, { config as runConfig } from '../../pages/api/admin/test-requests/runs/[runId]/index';
import advanceHandler, { config as advanceConfig } from '../../pages/api/admin/test-requests/runs/[runId]/advance';
import recheckHandler, { config as recheckConfig } from '../../pages/api/admin/test-requests/runs/[runId]/recheck';
import statusHandler, { config as statusConfig } from '../../pages/api/admin/test-requests/runs/[runId]/status/index';
import statusRecheckHandler, { config as statusRecheckConfig } from '../../pages/api/admin/test-requests/runs/[runId]/status/recheck';
import artifactsHandler, { config as artifactsConfig } from '../../pages/api/admin/test-requests/runs/[runId]/artifacts';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE = 7;
const CONFIRM_BODY = {
  draftId: DRAFT_ID, idempotencyKey: 'key-1', confirmSourceRequestNumber: '9000001', testLabel: 'Factory proof',
};

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

const service = {
  exportSource: jest.fn(),
  confirmRun: jest.fn(),
  listRuns: jest.fn(),
  inspectRun: jest.fn(),
  advance: jest.fn(),
  recheck: jest.fn(),
  statusOptions: jest.fn(),
  changeStatus: jest.fn(),
  statusRecheck: jest.fn(),
  readArtifacts: jest.fn(),
};

// Every route and method: the handler, its service method, a valid request, and the Allow header.
const CASES = [
  {
    name: 'source POST', handler: sourceHandler, method: 'POST', allow: 'POST', fn: 'exportSource', wrong: 'GET',
    req: () => ({ method: 'POST', query: {}, body: { sourceRequestNumber: '9000001' } }),
  },
  {
    name: 'runs GET', handler: runsHandler, method: 'GET', allow: 'GET, POST', fn: 'listRuns', wrong: 'DELETE',
    req: () => ({ method: 'GET', query: {} }),
  },
  {
    name: 'runs POST', handler: runsHandler, method: 'POST', allow: 'GET, POST', fn: 'confirmRun', wrong: 'DELETE',
    req: () => ({ method: 'POST', query: {}, body: { ...CONFIRM_BODY } }),
  },
  {
    name: 'run GET', handler: runHandler, method: 'GET', allow: 'GET', fn: 'inspectRun', wrong: 'POST', perRun: true,
    req: () => ({ method: 'GET', query: { runId: RUN_ID } }),
  },
  {
    name: 'advance POST', handler: advanceHandler, method: 'POST', allow: 'POST', fn: 'advance', wrong: 'GET', perRun: true,
    req: () => ({ method: 'POST', query: { runId: RUN_ID }, body: {} }),
  },
  {
    name: 'recheck POST', handler: recheckHandler, method: 'POST', allow: 'POST', fn: 'recheck', wrong: 'GET', perRun: true,
    req: () => ({ method: 'POST', query: { runId: RUN_ID }, body: {} }),
  },
  {
    name: 'status GET', handler: statusHandler, method: 'GET', allow: 'GET, POST', fn: 'statusOptions', wrong: 'DELETE', perRun: true,
    req: () => ({ method: 'GET', query: { runId: RUN_ID } }),
  },
  {
    name: 'status POST', handler: statusHandler, method: 'POST', allow: 'GET, POST', fn: 'changeStatus', wrong: 'DELETE', perRun: true,
    req: () => ({ method: 'POST', query: { runId: RUN_ID }, body: { field: 'phase2', optionLabel: 'Recommended' } }),
  },
  {
    name: 'status recheck POST', handler: statusRecheckHandler, method: 'POST', allow: 'POST', fn: 'statusRecheck', wrong: 'GET', perRun: true,
    req: () => ({ method: 'POST', query: { runId: RUN_ID }, body: {} }),
  },
  {
    name: 'artifacts GET', handler: artifactsHandler, method: 'GET', allow: 'GET', fn: 'readArtifacts', wrong: 'POST', perRun: true,
    req: () => ({ method: 'GET', query: { runId: RUN_ID } }),
  },
];

let errorSpy;
beforeEach(() => {
  jest.clearAllMocks();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  requireSuperuser.mockResolvedValue({ profileId: PROFILE });
  getSession.mockResolvedValue({ user: { azureEmail: 'staff@wmkeck.org' } });
  createAdminRunService.mockReturnValue(service);
  service.exportSource.mockResolvedValue({ draftId: DRAFT_ID, summary: {}, defaults: {} });
  service.confirmRun.mockResolvedValue({ run: { runId: RUN_ID }, created: true });
  service.listRuns.mockResolvedValue([{ runId: RUN_ID }]);
  service.inspectRun.mockResolvedValue({ run: { runId: RUN_ID }, resources: [] });
  service.advance.mockResolvedValue({ step: 'x', outcome: 'advanced' });
  service.recheck.mockResolvedValue({ runId: RUN_ID, ok: true });
  service.readArtifacts.mockResolvedValue({ runId: RUN_ID, cleanedUp: false });
  service.statusOptions.mockResolvedValue({ runId: RUN_ID, runStatus: 'ready', options: { phase1: [], phase2: [] }, changes: [] });
  service.changeStatus.mockResolvedValue({ outcome: 'complete', sequence: 1 });
  service.statusRecheck.mockResolvedValue({ sequence: 1, ok: true });
});
afterEach(() => errorSpy.mockRestore());

describe.each(CASES)('$name', (c) => {
  test('a wrong method is 405 with the right Allow header, before the gate', async () => {
    const res = mockRes();
    await c.handler({ ...c.req(), method: c.wrong }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe(c.allow);
    expect(requireSuperuser).not.toHaveBeenCalled();
  });

  test('a failed superuser gate never reaches the service', async () => {
    requireSuperuser.mockResolvedValueOnce(null);
    await c.handler(c.req(), mockRes());
    expect(service[c.fn]).not.toHaveBeenCalled();
  });

  test('the service receives the gate profileId, and success is 200 with the service value', async () => {
    const res = mockRes();
    await c.handler(c.req(), res);
    expect(service[c.fn]).toHaveBeenCalledTimes(1);
    expect(service[c.fn].mock.calls[0][0].profileId).toBe(PROFILE);
    expect(res.statusCode).toBe(c.name === 'runs POST' ? 201 : 200);
    expect(withDalContext).toHaveBeenCalledTimes(1);
    expect(withDalContext).toHaveBeenCalledWith(expect.stringMatching(/^admin-test-request-runs-[a-z-]+$/), expect.any(Function));
  });

  test.each([
    [403, 'factory_profile_required'],
    [503, 'factory_form_disabled'],
    [503, 'factory_isolation_off'],
    [404, 'factory_run_not_found'],
  ])('a ServiceHttpError %i %s passes through with its status and code', async (status, errCode) => {
    service[c.fn].mockRejectedValueOnce(new ServiceHttpError('refused', { httpStatus: status, code: errCode }));
    const res = mockRes();
    await c.handler(c.req(), res);
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error: 'refused', code: errCode });
  });

  test('any other error is a generic 500 that leaks no error text', async () => {
    service[c.fn].mockRejectedValueOnce(new Error('connection string postgres://secret@host'));
    const res = mockRes();
    await c.handler(c.req(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|secret/);
    expect(res.body.code).toBeUndefined();
  });

  if (c.perRun) {
    test.each([['not-a-guid'], [undefined], [['a', 'b']], [`${RUN_ID} `.repeat(2)], [` ${RUN_ID}`], [`${RUN_ID}\n`]])('a malformed runId (%p) is 400 and the service is not called', async (bad) => {
      const res = mockRes();
      await c.handler({ ...c.req(), query: { runId: bad } }, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('factory_invalid_input');
      expect(service[c.fn]).not.toHaveBeenCalled();
    });

    test('a profileId in the query never reaches the service', async () => {
      await c.handler({ ...c.req(), query: { runId: RUN_ID, profileId: '99' } }, mockRes());
      expect(service[c.fn].mock.calls[0][0].profileId).toBe(PROFILE);
    });
  }
});

describe('body-less POST routes (advance, recheck)', () => {
  test.each([
    ['advance', advanceHandler], ['recheck', recheckHandler],
  ])('%s accepts an absent or empty body and refuses any field, including profileId', async (_name, handler) => {
    for (const body of [undefined, {}]) {
      const res = mockRes();
      await handler({ method: 'POST', query: { runId: RUN_ID }, body }, res);
      expect(res.statusCode).toBe(200);
    }
    service.advance.mockClear();
    service.recheck.mockClear();
    for (const body of [{ profileId: 99 }, { x: 1 }, 'text', [1]]) {
      const res = mockRes();
      await handler({ method: 'POST', query: { runId: RUN_ID }, body }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(service.advance).not.toHaveBeenCalled();
    expect(service.recheck).not.toHaveBeenCalled();
  });
});

describe('source POST body', () => {
  const run = async (body) => {
    const res = mockRes();
    await sourceHandler({ method: 'POST', query: {}, body }, res);
    return res;
  };

  test.each([
    ['unknown key (profileId)', { sourceRequestNumber: '9000001', profileId: 99 }],
    ['missing field', {}],
    ['wrong type', { sourceRequestNumber: 9000001 }],
    ['non-digits', { sourceRequestNumber: '90a' }],
    ['over-length', { sourceRequestNumber: '12345678901' }],
    ['array body', ['9000001']],
    ['absent body', undefined],
  ])('%s is 400 and the service is not called', async (_label, body) => {
    const res = await run(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('factory_invalid_input');
    expect(service.exportSource).not.toHaveBeenCalled();
  });
});

describe('runs POST (Confirm)', () => {
  const run = async (body) => {
    const res = mockRes();
    await runsHandler({ method: 'POST', query: {}, body }, res);
    return res;
  };

  test.each([
    ['unknown key (profileId)', { ...CONFIRM_BODY, profileId: 99 }],
    ['draftId padded with whitespace', { ...CONFIRM_BODY, draftId: ` ${DRAFT_ID}` }],
    ['an actorEmail key', { ...CONFIRM_BODY, actorEmail: 'evil@example.com' }],
    ['an email key', { ...CONFIRM_BODY, email: 'evil@example.com' }],
    ...Object.keys(CONFIRM_BODY).map((key) => [`missing ${key}`, Object.fromEntries(Object.entries(CONFIRM_BODY).filter(([k]) => k !== key))]),
    ['draftId not a GUID', { ...CONFIRM_BODY, draftId: 'nope' }],
    ['draftId wrong type', { ...CONFIRM_BODY, draftId: 5 }],
    ['idempotencyKey with a space', { ...CONFIRM_BODY, idempotencyKey: 'a b' }],
    ['idempotencyKey over 200', { ...CONFIRM_BODY, idempotencyKey: 'k'.repeat(201) }],
    ['idempotencyKey empty', { ...CONFIRM_BODY, idempotencyKey: '' }],
    ['confirmSourceRequestNumber non-digits', { ...CONFIRM_BODY, confirmSourceRequestNumber: '90x' }],
    ['confirmSourceRequestNumber a number', { ...CONFIRM_BODY, confirmSourceRequestNumber: 9000001 }],
    ['testLabel blank', { ...CONFIRM_BODY, testLabel: '   ' }],
    ['testLabel over 120', { ...CONFIRM_BODY, testLabel: 'x'.repeat(121) }],
    ['testLabel wrong type', { ...CONFIRM_BODY, testLabel: 5 }],
    ['fiscalYear over 32', { ...CONFIRM_BODY, fiscalYear: 'y'.repeat(33) }],
    ['meetingDate wrong type', { ...CONFIRM_BODY, meetingDate: 20261201 }],
    ['array body', [CONFIRM_BODY]],
    ['absent body', undefined],
  ])('%s is 400 and the service is not called', async (_label, body) => {
    const res = await run(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('factory_invalid_input');
    expect(service.confirmRun).not.toHaveBeenCalled();
  });

  test('actorEmail comes from the session, never the body; fields are picked by name', async () => {
    await run({ ...CONFIRM_BODY, fiscalYear: 'December 2026', meetingDate: '2026-12-01' });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(service.confirmRun).toHaveBeenCalledWith({
      profileId: PROFILE,
      actorEmail: 'staff@wmkeck.org',
      ...CONFIRM_BODY,
      fiscalYear: 'December 2026',
      meetingDate: '2026-12-01',
    });
  });

  test('no session email passes null so the service decides', async () => {
    getSession.mockResolvedValueOnce(null);
    await run({ ...CONFIRM_BODY });
    expect(service.confirmRun.mock.calls[0][0].actorEmail).toBeNull();
  });

  test('201 when created, 200 for a same-key retry', async () => {
    expect((await run({ ...CONFIRM_BODY })).statusCode).toBe(201);
    service.confirmRun.mockResolvedValueOnce({ run: { runId: RUN_ID }, created: false });
    expect((await run({ ...CONFIRM_BODY })).statusCode).toBe(200);
  });

  test('passes no deadline', async () => {
    await run({ ...CONFIRM_BODY });
    expect(Object.keys(service.confirmRun.mock.calls[0][0])).not.toContain('deadlineAt');
  });
});

describe('runs GET', () => {
  test('wraps the list as { runs }', async () => {
    const res = mockRes();
    await runsHandler({ method: 'GET', query: {} }, res);
    expect(res.body).toEqual({ runs: [{ runId: RUN_ID }] });
  });
});

describe('deadlines and limits', () => {
  // Next extracts `config` statically at build time and rejects anything but
  // literals (Codex slice 2 review: an identifier here failed `next build`
  // while the evaluated-object assertions below still passed).
  test('every route file exports a config made only of literals', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../pages/api/admin/test-requests/runs');
    const files = ['source.js', 'index.js', '[runId]/index.js', '[runId]/advance.js', '[runId]/recheck.js', '[runId]/status/index.js', '[runId]/status/recheck.js', '[runId]/artifacts.js'];
    for (const file of files) {
      const line = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').find((text) => text.startsWith('export const config'));
      expect(line).toMatch(/^export const config = \{ api: \{ bodyParser: \{ sizeLimit: '32kb' \} \}(, maxDuration: 300)? \};$/);
    }
  });

  test.each([
    ['source', sourceHandler, () => ({ method: 'POST', query: {}, body: { sourceRequestNumber: '9000001' } }), 'exportSource'],
    ['advance', advanceHandler, () => ({ method: 'POST', query: { runId: RUN_ID }, body: {} }), 'advance'],
    ['status', statusHandler, () => ({ method: 'POST', query: { runId: RUN_ID }, body: { field: 'phase1', optionLabel: 'Invited' } }), 'changeStatus'],
  ])('%s passes a numeric deadlineAt about 280 s out', async (_name, handler, req, fn) => {
    const before = Date.now();
    await handler(req(), mockRes());
    const { deadlineAt } = service[fn].mock.calls[0][0];
    expect(typeof deadlineAt).toBe('number');
    expect(deadlineAt - before).toBeGreaterThanOrEqual(280_000 - 50);
    expect(deadlineAt - before).toBeLessThanOrEqual(280_000 + 1_000);
  });

  test.each([
    ['source', sourceHandler, () => ({ method: 'POST', query: {}, body: { sourceRequestNumber: '9000001' } }), 'exportSource'],
    ['advance', advanceHandler, () => ({ method: 'POST', query: { runId: RUN_ID }, body: {} }), 'advance'],
    ['status', statusHandler, () => ({ method: 'POST', query: { runId: RUN_ID }, body: { field: 'phase1', optionLabel: 'Invited' } }), 'changeStatus'],
  ])('%s anchors the deadline at entry: time spent in the gate reduces the budget', async (_name, handler, req, fn) => {
    const entry = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(entry);
    requireSuperuser.mockImplementationOnce(async () => {
      clock.mockReturnValue(entry + 140_000); // a slow gate
      return { profileId: PROFILE };
    });
    try {
      await handler(req(), mockRes());
      expect(service[fn].mock.calls[0][0].deadlineAt).toBe(entry + 280_000);
    } finally {
      clock.mockRestore();
    }
  });

  test('config: 32kb body limit everywhere; maxDuration 300 only on source, advance and status', () => {
    for (const config of [sourceConfig, runsConfig, runConfig, advanceConfig, recheckConfig, statusConfig, statusRecheckConfig, artifactsConfig]) {
      expect(config.api.bodyParser.sizeLimit).toBe('32kb');
    }
    expect(sourceConfig.maxDuration).toBe(300);
    expect(advanceConfig.maxDuration).toBe(300);
    expect(statusConfig.maxDuration).toBe(300);
    for (const config of [runsConfig, runConfig, recheckConfig, statusRecheckConfig, artifactsConfig]) {
      expect(config.maxDuration).toBeUndefined();
    }
  });
});

describe('advance', () => {
  test('sends Cache-Control: no-store (the body can carry a failed step\'s error text)', async () => {
    const res = mockRes();
    await advanceHandler({ method: 'POST', query: { runId: RUN_ID } }, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

describe('status', () => {
  const post = (body) => ({ method: 'POST', query: { runId: RUN_ID }, body });

  test.each([
    ['status POST', statusHandler, post({ field: 'phase1', optionLabel: 'Invited' })],
    ['status recheck POST', statusRecheckHandler, post({})],
    ['status GET', statusHandler, { method: 'GET', query: { runId: RUN_ID } }],
  ])('%s sends Cache-Control: no-store', async (_name, handler, req) => {
    const res = mockRes();
    await handler(req, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  test.each([
    ['an unknown field', { field: 'phase3', optionLabel: 'Invited' }],
    ['a missing optionLabel', { field: 'phase1' }],
    ['a missing field', { optionLabel: 'Invited' }],
    ['an over-length optionLabel', { field: 'phase1', optionLabel: 'x'.repeat(201) }],
    ['a blank optionLabel', { field: 'phase1', optionLabel: '   ' }],
    ['a non-string optionLabel', { field: 'phase1', optionLabel: 5 }],
    ['a rerun key', { field: 'phase1', optionLabel: 'Invited', rerun: true }],
    ['a profileId key', { field: 'phase1', optionLabel: 'Invited', profileId: 99 }],
    ['an empty body', {}],
    ['an absent body', undefined],
    ['a string body', 'text'],
  ])('POST with %s is 400 and the service is not called', async (_name, body) => {
    const res = mockRes();
    await statusHandler(post(body), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('factory_invalid_input');
    expect(service.changeStatus).not.toHaveBeenCalled();
  });

  test('POST passes exactly field, a trimmed optionLabel and deadlineAt, never rerun', async () => {
    await statusHandler(post({ field: 'phase2', optionLabel: '  Recommended ' }), mockRes());
    expect(service.changeStatus.mock.calls[0][0]).toEqual({
      profileId: PROFILE, runId: RUN_ID, field: 'phase2', optionLabel: 'Recommended', deadlineAt: expect.any(Number),
    });
  });

  test('a 200 is only for outcome complete; every other outcome is 202', async () => {
    for (const [outcome, code] of [['complete', 200], ['jobs_open', 202], ['in_progress', 202], ['unconfirmed', 202]]) {
      service.changeStatus.mockResolvedValueOnce({ outcome });
      const res = mockRes();
      await statusHandler(post({ field: 'phase1', optionLabel: 'Invited' }), res);
      expect(res.statusCode).toBe(code);
      expect(res.body.outcome).toBe(outcome);
    }
  });

  test('status recheck refuses any body field', async () => {
    for (const body of [{ profileId: 99 }, { x: 1 }, 'text', [1]]) {
      const res = mockRes();
      await statusRecheckHandler(post(body), res);
      expect(res.statusCode).toBe(400);
    }
    expect(service.statusRecheck).not.toHaveBeenCalled();
  });
});

describe('artifacts', () => {
  test('sends Cache-Control: no-store', async () => {
    const res = mockRes();
    await artifactsHandler({ method: 'GET', query: { runId: RUN_ID } }, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

/**
 * Test Request Factory --status-abandon (slice 2b): the owner closes a status
 * change left `dispatched` as needs_attention once no sender remains. Ledger
 * only: the fake client throws on any Dataverse write, and the mode never
 * reads DATAVERSE_PROD_WRITE_ACK.
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { parseArgs, runStatusAbandonMode } from '../../scripts/rehearse-test-request-sandbox.mjs';

const RUN = '11111111-1111-4111-8111-111111111111';
const CHANGE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const FIELD = 'wmkf_phaseiistatus';
const argv = (...args) => ['node', 'rehearse-test-request-sandbox.mjs', ...args];
const abandonArgs = (...extra) => argv('--target=production', `--status-abandon=${RUN}`, `--change-id=${CHANGE}`, ...extra);

describe('--status-abandon parsing', () => {
  test('accepts the mode with --change-id, with and without --confirm, on production', () => {
    expect(parseArgs(abandonArgs())).toMatchObject({ statusAbandon: RUN, changeId: CHANGE, confirm: false, target: 'production' });
    expect(parseArgs(abandonArgs('--confirm'))).toMatchObject({ statusAbandon: RUN, changeId: CHANGE, confirm: true });
  });

  test.each([
    ['a sandbox target', [`--status-abandon=${RUN}`, `--change-id=${CHANGE}`]],
    ['no --change-id', ['--target=production', `--status-abandon=${RUN}`]],
    ['--change-id without the mode', ['--target=production', `--change-id=${CHANGE}`]],
    ['--change-id with another mode', ['--target=production', `--status-recheck=${RUN}`, `--change-id=${CHANGE}`]],
    ['a non-GUID run', ['--target=production', '--status-abandon=nope', `--change-id=${CHANGE}`]],
    ['a non-GUID change', ['--target=production', `--status-abandon=${RUN}`, '--change-id=nope']],
    ['another run mode alongside', ['--target=production', `--status-abandon=${RUN}`, `--change-id=${CHANGE}`, `--status-recheck=${RUN}`]],
    ['--confirm with a status recheck', ['--target=production', `--status-recheck=${RUN}`, '--confirm']],
    ['--rerun with the mode', ['--target=production', `--status-abandon=${RUN}`, `--change-id=${CHANGE}`, '--rerun']],
  ])('refuses %s', (_label, args) => {
    expect(() => parseArgs(argv(...args))).toThrow();
  });
});

describe('runStatusAbandonMode', () => {
  const change = (overrides = {}) => ({ changeId: CHANGE, sequence: 1, field: FIELD, optionBefore: null, optionAfter: 100000002, status: 'dispatched', ...overrides });
  const makeLedger = ({ changes = [change()], run = { runId: RUN, destinationEnvironment: 'production', destinationRequestId: REQUEST }, closed = undefined } = {}) => ({
    getRun: jest.fn(async () => run),
    listStatusChanges: jest.fn(async () => changes),
    markStatusChangeNeedsAttention: jest.fn(async () => (closed === undefined ? { ...changes[0], status: 'needs_attention' } : closed)),
  });
  const makeClient = (value = null) => {
    const refuseWrite = (name) => jest.fn(() => { throw new Error(`Dataverse write attempted: ${name}`); });
    return {
      get: jest.fn(async () => ({ ok: true, status: 200, body: { akoya_requestid: REQUEST, [FIELD]: value } })),
      patch: refuseWrite('patch'), patchWithOptions: refuseWrite('patchWithOptions'), post: refuseWrite('post'), delete: refuseWrite('delete'),
    };
  };
  const args = (extra = {}) => ({ statusAbandon: RUN, changeId: CHANGE, confirm: false, ...extra });
  let log;
  beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());
  const noWrites = (client) => {
    for (const name of ['patch', 'patchWithOptions', 'post', 'delete']) expect(client[name]).not.toHaveBeenCalled();
  };

  test('without --confirm it prints the checklist and the proposed transition and updates nothing', async () => {
    const ledger = makeLedger();
    const client = makeClient();
    await runStatusAbandonMode(client, args(), 'unused', { ledger });
    expect(ledger.markStatusChangeNeedsAttention).not.toHaveBeenCalled();
    const printed = log.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toMatch(/Stop or disable form dispatch/);
    expect(printed).toMatch(/every CLI process, including paused ones/);
    expect(printed).toMatch(/"from": "dispatched"/);
    expect(printed).toMatch(/"to": "needs_attention"/);
    noWrites(client);
  });

  test('with --confirm it makes exactly one conditional ledger update and no Dataverse write', async () => {
    const ledger = makeLedger();
    const client = makeClient();
    await runStatusAbandonMode(client, args({ confirm: true }), 'unused', { ledger });
    expect(ledger.markStatusChangeNeedsAttention).toHaveBeenCalledTimes(1);
    expect(ledger.markStatusChangeNeedsAttention).toHaveBeenCalledWith({
      changeId: CHANGE, onlyIf: 'dispatched', error: 'Owner confirmed no dispatcher is running; abandoned unresolved status change.',
    });
    noWrites(client);
  });

  test('a null result is an error, never a success message', async () => {
    const ledger = makeLedger({ closed: null });
    const client = makeClient();
    await expect(runStatusAbandonMode(client, args({ confirm: true }), 'unused', { ledger })).rejects.toThrow(/moved on.*nothing was changed/);
    expect(log.mock.calls.map((c) => c[0]).join('\n')).not.toMatch(/STATUS_ABANDONED/);
    noWrites(client);
  });

  test.each([
    ['planned', /resume with --set-status instead/],
    ['applied', /resume with --set-status instead/],
    ['complete', /already closed/],
    ['needs_attention', /already closed/],
  ])('a %s change is refused', async (status, message) => {
    const ledger = makeLedger({ changes: [change({ status })] });
    const client = makeClient();
    await expect(runStatusAbandonMode(client, args({ confirm: true }), 'unused', { ledger })).rejects.toThrow(message);
    expect(ledger.markStatusChangeNeedsAttention).not.toHaveBeenCalled();
    noWrites(client);
  });

  test('an unknown change ID, and a change ID belonging to another run, are refused', async () => {
    const ledger = makeLedger({ changes: [change({ changeId: '44444444-4444-4444-8444-444444444444' })] });
    const client = makeClient();
    await expect(runStatusAbandonMode(client, args({ confirm: true }), 'unused', { ledger })).rejects.toThrow(/no status change with that change ID/);
    expect(ledger.listStatusChanges).toHaveBeenCalledWith(RUN);
    expect(ledger.markStatusChangeNeedsAttention).not.toHaveBeenCalled();
    noWrites(client);
  });

  test('a missing or non-production run is refused', async () => {
    for (const run of [null, { runId: RUN, destinationEnvironment: 'sandbox', destinationRequestId: REQUEST }]) {
      const ledger = makeLedger({ run });
      await expect(runStatusAbandonMode(makeClient(), args({ confirm: true }), 'unused', { ledger })).rejects.toThrow(/No production test request run/);
      expect(ledger.markStatusChangeNeedsAttention).not.toHaveBeenCalled();
    }
  });

  test('the target value already present is recovered: refused, even with --confirm', async () => {
    const ledger = makeLedger();
    const client = makeClient(100000002);
    await expect(runStatusAbandonMode(client, args({ confirm: true }), 'unused', { ledger })).rejects.toThrow(/recovered.*resume with --set-status instead/);
    expect(ledger.markStatusChangeNeedsAttention).not.toHaveBeenCalled();
    noWrites(client);
  });

  test('a failed Request read is refused with nothing changed', async () => {
    const ledger = makeLedger();
    const client = makeClient();
    client.get.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(runStatusAbandonMode(client, args({ confirm: true }), 'unused', { ledger })).rejects.toThrow(/Request read failed/);
    expect(ledger.markStatusChangeNeedsAttention).not.toHaveBeenCalled();
  });

  test('the mode never touches the production write acknowledgement', () => {
    expect(runStatusAbandonMode.toString()).not.toMatch(/DATAVERSE_PROD_WRITE_ACK/);
  });
});

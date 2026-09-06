/**
 * @jest-environment node
 *
 * Stage 3K adapter op `setRequestMetadata` (Reviewer Lifecycle Stage 7
 * expansion, docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md census row 14,
 * decision D4). Replaces the picker's direct call to the generic
 * `bulkUpdateByRequest` with a field-whitelisted named op.
 *
 * The op is a verbatim delegation to `bulkUpdateByRequest` (findByRequest
 * selectedOnly + a sequential, unconditional per-row `updateLifecycle`, no
 * try/catch): transport calls must be BYTE-IDENTICAL to calling
 * `updateLifecycle` directly for each row, and the D4 partial-write-on-
 * failure behavior is preserved, not fixed — this suite pins that as
 * CURRENT behavior, an open owner decision, not an endorsement.
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  setRequestMetadata,
  updateLifecycle,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ROW_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ROW_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const ROW_C = 'cccccccc-1111-4111-8111-111111111111';

function existingRow(over = {}) {
  return {
    wmkf_applicantdisposition: null,
    wmkf_completedat: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewstatus: null,
    wmkf_honorariumeligibility: null,
    ...over,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('setRequestMetadata: field whitelist', () => {
  it.each([
    ['reviewStatus', { reviewStatus: 'complete' }],
    ['selected', { selected: false }],
    ['responseType', { responseType: 'accepted' }],
    ['empty object', {}],
  ])('rejects %s without any updateRecord call', async (_label, updates) => {
    const queryRecords = jest.spyOn(DynamicsService, 'queryRecords');
    const getRecord = jest.spyOn(DynamicsService, 'getRecord');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');

    await expect(setRequestMetadata(REQUEST_ID, updates, { actingUserSystemId: 'u-1' }))
      .rejects.toThrow();

    expect(queryRecords).not.toHaveBeenCalled();
    expect(getRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });
});

describe('setRequestMetadata: transport identity with updateLifecycle', () => {
  it('same DynamicsService.updateRecord args as calling updateLifecycle directly, for two selected rows, incl. programArea normalization', async () => {
    // 'Medical Research Program' is one of normalizeSuggestionProgramArea's
    // two canonical-label rewrites (reviewer-suggestion.js:232) — it becomes
    // 'Medical Research', not a pass-through — so this value actually
    // discriminates "normalization ran" from "raw value forwarded verbatim".
    const updates = { grantCycleCode: 'J26', programArea: 'Medical Research Program' };
    const rows = [existingRow(), existingRow()];

    // Path 1: setRequestMetadata over two rows.
    const queryRecords1 = jest.spyOn(DynamicsService, 'queryRecords')
      .mockResolvedValue({ records: [{ wmkf_appreviewersuggestionid: ROW_A }, { wmkf_appreviewersuggestionid: ROW_B }] });
    const getRecord1 = jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce(rows[0]).mockResolvedValueOnce(rows[1]);
    const updateRecord1 = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    const count = await setRequestMetadata(REQUEST_ID, updates, { actingUserSystemId: 'u-1' });
    expect(count).toBe(2);
    expect(queryRecords1).toHaveBeenCalledTimes(1);
    expect(getRecord1).toHaveBeenCalledTimes(2);
    expect(updateRecord1).toHaveBeenCalledTimes(2);
    const opCalls = updateRecord1.mock.calls;

    jest.restoreAllMocks();

    // Path 2: updateLifecycle called directly for each row, same order.
    const getRecord2 = jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce(rows[0]).mockResolvedValueOnce(rows[1]);
    const updateRecord2 = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    await updateLifecycle(ROW_A, updates, { actingUserSystemId: 'u-1' });
    await updateLifecycle(ROW_B, updates, { actingUserSystemId: 'u-1' });
    expect(getRecord2).toHaveBeenCalledTimes(2);
    expect(updateRecord2).toHaveBeenCalledTimes(2);

    expect(opCalls).toEqual(updateRecord2.mock.calls);
    // No ifMatch on either path — bulkUpdateByRequest's generic per-row write
    // never supplies one and reviewStatus is never in this whitelist, so
    // updateLifecycle's fallback ifMatch (status-change only) never engages.
    for (const call of opCalls) {
      expect(call[3]).toEqual({ actingUserSystemId: 'u-1' });
    }
    // Normalization actually ran (not a pass-through of the raw string).
    for (const call of opCalls) {
      expect(call[2].wmkf_programarea).toBe('Medical Research');
    }
  });
});

describe('D4: partial write on middle-row failure is preserved (open owner decision)', () => {
  it('first row written, error propagates, third row NOT written', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [
        { wmkf_appreviewersuggestionid: ROW_A },
        { wmkf_appreviewersuggestionid: ROW_B },
        { wmkf_appreviewersuggestionid: ROW_C },
      ],
    });
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce(existingRow())
      .mockResolvedValueOnce(existingRow())
      .mockResolvedValueOnce(existingRow());
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord')
      .mockResolvedValueOnce({}) // row A: written
      .mockRejectedValueOnce(new Error('Dataverse down')); // row B: fails

    await expect(
      setRequestMetadata(REQUEST_ID, { grantCycleCode: 'J26' }, { actingUserSystemId: 'u-1' }),
    ).rejects.toThrow('Dataverse down');

    // Row A committed, row B attempted (and failed), row C never reached —
    // no try/catch around the loop, so the throw propagates out of the op
    // exactly as it does out of bulkUpdateByRequest today.
    expect(updateRecord).toHaveBeenCalledTimes(2);
    expect(updateRecord.mock.calls[0][1]).toBe(ROW_A);
    expect(updateRecord.mock.calls[1][1]).toBe(ROW_B);
  });
});

describe('setRequestMetadata: actingUserSystemId forwarded', () => {
  it('forwards actingUserSystemId to the per-row write', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ wmkf_appreviewersuggestionid: ROW_A }],
    });
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue(existingRow());
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    await setRequestMetadata(REQUEST_ID, { grantCycleCode: 'J26' }, { actingUserSystemId: 'sys-42' });

    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      ROW_A,
      expect.objectContaining({ wmkf_grantcyclecode: 'J26' }),
      { actingUserSystemId: 'sys-42' },
    );
  });
});

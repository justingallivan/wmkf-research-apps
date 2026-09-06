/**
 * @jest-environment node
 *
 * Generic query/patch passthroughs added to potential-reviewer.js,
 * reviewer-suggestion.js, and review-answer.js for the review-flow
 * cross-entity conversion wave (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
 * Stages 3-6). Each mirrors DynamicsService's own call shape arg-for-arg
 * (same pattern as grant-request.js's queryRequests/queryAllRequests), so
 * callers with a bespoke filter/select can drop the raw DynamicsService
 * import without that filter moving into the adapter.
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getByIdWithSelect, queryReviewers } from '../../lib/dataverse/adapters/potential-reviewer.js';
import {
  findReviewDocxBackfillPopulation,
  findReviewDocxFilingCandidates,
  queryAllSuggestions,
} from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { queryAllAnswers } from '../../lib/dataverse/adapters/review-answer.js';

const ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('potential-reviewer.getByIdWithSelect', () => {
  it('forwards a caller select unchanged', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({});
    await getByIdWithSelect(ID, { select: 'wmkf_name,wmkf_emailaddress' });
    expect(spy).toHaveBeenCalledWith('wmkf_potentialreviewerses', ID, { select: 'wmkf_name,wmkf_emailaddress' });
  });

  it('reads the full record when select is omitted', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({});
    await getByIdWithSelect(ID);
    expect(spy).toHaveBeenCalledWith('wmkf_potentialreviewerses', ID);
  });
});

describe('potential-reviewer.queryReviewers', () => {
  it('forwards options unchanged to queryRecords', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    const options = { select: 'wmkf_name', filter: 'wmkf_potentialreviewersid eq 1', top: 500 };
    await queryReviewers(options);
    expect(spy).toHaveBeenCalledWith('wmkf_potentialreviewerses', options);
  });
});

describe('reviewer-suggestion.queryAllSuggestions', () => {
  it('forwards options unchanged to queryAllRecords', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    const options = { select: 'wmkf_appreviewersuggestionid', filter: 'wmkf_selected eq true' };
    await queryAllSuggestions(options);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', options);
  });
});

describe('reviewer-suggestion.findReviewDocxFilingCandidates', () => {
  it('uses an exact stamped-cycle filter and puts newest receipts first', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [], capped: false });
    await findReviewDocxFilingCandidates({ cycleCode: 'D26', top: 500 });
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', expect.objectContaining({
      orderby: 'wmkf_reviewreceivedat desc,wmkf_appreviewersuggestionid asc',
      filter: expect.stringContaining("wmkf_grantcyclecode eq 'D26'"),
    }));
    const filter = spy.mock.calls[0][1].filter;
    expect(filter).toContain('wmkf_reviewreceivedat ne null');
    expect(filter).toContain('wmkf_selected eq true');
    expect(filter).toContain('wmkf_reviewsharepointfolder eq null or wmkf_reviewfilename eq null');
    expect(filter).toContain('wmkf_applicantdisposition eq null');
    expect(filter).not.toContain('wmkf_grantcyclecode eq null');
  });
});

describe('reviewer-suggestion.findReviewDocxBackfillPopulation', () => {
  it('unions meeting-cycle and stamped-cycle rows while preserving ineligible rows for classification', async () => {
    const requestId = '22222222-2222-4222-8222-222222222222';
    const meetingSuggestion = '33333333-3333-4333-8333-333333333333';
    const stampedSuggestion = '44444444-4444-4444-8444-444444444444';
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords')
      .mockResolvedValueOnce({ records: [{ akoya_requestid: requestId }], capped: false })
      .mockResolvedValueOnce({ records: [{
        wmkf_appreviewersuggestionid: meetingSuggestion,
        wmkf_reviewreceivedat: '2026-08-01T00:00:00Z',
      }], capped: false })
      .mockResolvedValueOnce({ records: [{
        wmkf_appreviewersuggestionid: stampedSuggestion,
        wmkf_reviewreceivedat: '2026-08-02T00:00:00Z',
      }], capped: false });

    const result = await findReviewDocxBackfillPopulation({ cycleCode: 'D26' });

    expect(result.records.map((row) => row.wmkf_appreviewersuggestionid))
      .toEqual([meetingSuggestion, stampedSuggestion]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][1].filter).toContain('wmkf_meetingdate ge 2026-12-01T00:00:00Z');
    expect(spy.mock.calls[1][1].filter).toContain(`_wmkf_request_value eq ${requestId}`);
    expect(spy.mock.calls[2][1].filter).toContain("wmkf_grantcyclecode eq 'D26'");
    expect(spy.mock.calls[1][1].filter).not.toContain('wmkf_selected eq true');
  });

  it('keeps a request-number smoke inside the exact meeting-cycle request set', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords')
      .mockResolvedValueOnce({ records: [], capped: false });
    await findReviewDocxBackfillPopulation({ cycleCode: 'D26', requestNumber: '1002903' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].filter).toContain("akoya_requestnum eq '1002903'");
  });

  it('deduplicates a suggestion returned by both cycle populations', async () => {
    const requestId = '22222222-2222-4222-8222-222222222222';
    const suggestionId = '33333333-3333-4333-8333-333333333333';
    jest.spyOn(DynamicsService, 'queryAllRecords')
      .mockResolvedValueOnce({ records: [{ akoya_requestid: requestId }], capped: false })
      .mockResolvedValueOnce({ records: [{
        wmkf_appreviewersuggestionid: suggestionId,
        wmkf_reviewreceivedat: '2026-08-01T00:00:00Z',
      }], capped: false })
      .mockResolvedValueOnce({ records: [{
        wmkf_appreviewersuggestionid: suggestionId.toUpperCase(),
        wmkf_reviewreceivedat: '2026-08-01T00:00:00Z',
      }], capped: false });

    const result = await findReviewDocxBackfillPopulation({ cycleCode: 'D26' });

    expect(result).toMatchObject({ capped: false });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].wmkf_appreviewersuggestionid.toLowerCase()).toBe(suggestionId);
  });

  it('fails the population closed when any paginated batch reaches its cap', async () => {
    const requestId = '22222222-2222-4222-8222-222222222222';
    jest.spyOn(DynamicsService, 'queryAllRecords')
      .mockResolvedValueOnce({ records: [{ akoya_requestid: requestId }], capped: false })
      .mockResolvedValueOnce({ records: [], capped: true })
      .mockResolvedValueOnce({ records: [], capped: false });

    await expect(findReviewDocxBackfillPopulation({ cycleCode: 'D26' }))
      .resolves.toEqual({ records: [], capped: true });
  });
});

describe('review-answer.queryAllAnswers', () => {
  it('forwards options unchanged to queryAllRecords', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    const options = { select: 'wmkf_questionkey,wmkf_answertext', filter: '_wmkf_appreviewersuggestion_value eq 1' };
    await queryAllAnswers(options);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewanswers', options);
  });
});

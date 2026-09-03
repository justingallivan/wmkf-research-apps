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
  findReviewDocxFilingCandidates,
  patchFields,
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

describe('reviewer-suggestion.patchFields', () => {
  it('is the same passthrough as patchReviewReceipt (forwards payload+opts unchanged)', async () => {
    const spy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});
    const payload = { wmkf_emailsentat: '2026-07-04T00:00:00.000Z', wmkf_invited: true };
    await patchFields(ID, payload);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', ID, payload, {});
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

describe('review-answer.queryAllAnswers', () => {
  it('forwards options unchanged to queryAllRecords', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    const options = { select: 'wmkf_questionkey,wmkf_answertext', filter: '_wmkf_appreviewersuggestion_value eq 1' };
    await queryAllAnswers(options);
    expect(spy).toHaveBeenCalledWith('wmkf_appreviewanswers', options);
  });
});

/**
 * @jest-environment node
 *
 * Characterization coverage for fetchReviewerRollup (lib/services/reviewer-rollup.js)
 * — golden-path DTO shape (per-request counts) and one failure/empty path — written
 * BEFORE converting its raw DynamicsService.queryAllRecords call to the
 * reviewer-suggestion adapter (data-access-layer migration, Stage 3-6 conversion).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { fetchReviewerRollup, emptyCounts } from '../../lib/services/reviewer-rollup.js';
import { RESPONSE_TYPE_MAP } from '../../lib/dataverse/adapters/reviewer-suggestion.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus.js';

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('fetchReviewerRollup (characterization)', () => {
  test('returns {} without calling Dataverse when requestIds is empty', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords');
    const out = await fetchReviewerRollup([]);
    expect(out).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  test('golden path: aggregates counts per request from the queried rows', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_declined: false, wmkf_emailsentat: '2026-01-01', wmkf_responsetype: RESPONSE_TYPE_MAP.accepted, wmkf_reviewstatus: 100000004 },
        { _wmkf_request_value: REQUEST_A, wmkf_selected: false, wmkf_invited: true, wmkf_accepted: false, wmkf_declined: true, wmkf_emailsentat: '2026-01-01', wmkf_responsetype: RESPONSE_TYPE_MAP.declined, wmkf_reviewstatus: null },
        { _wmkf_request_value: REQUEST_B, wmkf_selected: true, wmkf_invited: false, wmkf_accepted: false, wmkf_declined: false, wmkf_emailsentat: null, wmkf_responsetype: null, wmkf_reviewstatus: null },
      ],
    });

    const out = await fetchReviewerRollup([REQUEST_A, REQUEST_B]);

    expect(out[REQUEST_A]).toEqual({
      candidates: 1,
      invited: 1,
      accepted: 1,
      declined: 1,
      held: 0,
      completed: 1,
      progress: {
        total: 2, accepted: 1, pending: 0, released: 0, declined: 1, uninvited: 0,
      },
    });
    expect(out[REQUEST_B]).toEqual({
      ...emptyCounts(),
      candidates: 1,
      progress: {
        total: 1, accepted: 0, pending: 0, released: 0, declined: 0, uninvited: 1,
      },
    });

    // Byte-mirror guard: entity set, select list, and filter shape (OR-chain +
    // active-or-declined + not-excluded) must survive the adapter conversion.
    expect(spy).toHaveBeenCalledTimes(1);
    const [entitySet, opts] = spy.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(opts.select).toBe('_wmkf_request_value,wmkf_selected,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_emailsentat,wmkf_responsetype,wmkf_reviewstatus');
    expect(opts.filter).toContain(`_wmkf_request_value eq ${REQUEST_A}`);
    expect(opts.filter).toContain(`_wmkf_request_value eq ${REQUEST_B}`);
    expect(opts.filter).toContain('(wmkf_selected eq true or wmkf_declined eq true or wmkf_responsetype eq 100000001)');
  });

  test('progress buckets are exclusive and preserve active lifecycle counts', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true },
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true },
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_responsetype: RESPONSE_TYPE_MAP.accepted },
        // Decline wins in the exclusive progress display if legacy flags conflict.
        { _wmkf_request_value: REQUEST_A, wmkf_selected: false, wmkf_invited: true, wmkf_accepted: true, wmkf_declined: true, wmkf_responsetype: RESPONSE_TYPE_MAP.accepted },
      ],
    });

    const out = await fetchReviewerRollup([REQUEST_A]);

    expect(out[REQUEST_A].progress).toEqual({
      total: 4,
      accepted: 1,
      pending: 1,
      released: 0,
      declined: 1,
      uninvited: 1,
    });
    expect(Object.values(out[REQUEST_A].progress).slice(1).reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(out[REQUEST_A]).toMatchObject({ candidates: 3, invited: 2, accepted: 1, declined: 1 });
  });

  // S406 owner report (request 1002959): releasing a pending invitee left the
  // dashboard card reading "2 pending" when only one invitee was still awaiting.
  // Neither release path archives the row or sets wmkf_declined, so both used to
  // fall through into `pending` (or, post-acceptance, stay in `accepted`).
  test('ended engagements land in `released`, not `pending`/`accepted`', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        // Still genuinely awaiting a response.
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true },
        // PD released as no longer needed (withdraw-sufficient): responsetype only.
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_responsetype: RESPONSE_TYPE_MAP.withdrawn_sufficient },
        // Closed out as no-response.
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_responsetype: RESPONSE_TYPE_MAP.no_response },
        // Withdrawn AFTER accepting (terminal-transition): terminal reviewstatus
        // on an accepted row, which used to keep inflating `accepted`.
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_responsetype: RESPONSE_TYPE_MAP.accepted, wmkf_reviewstatus: TERMINAL_REVIEW_STATUS_VALUES.released },
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_responsetype: RESPONSE_TYPE_MAP.accepted, wmkf_reviewstatus: TERMINAL_REVIEW_STATUS_VALUES.withdrew },
        // A real acceptance still reads as accepted.
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_accepted: true, wmkf_responsetype: RESPONSE_TYPE_MAP.accepted },
      ],
    });

    const out = await fetchReviewerRollup([REQUEST_A]);

    expect(out[REQUEST_A].progress).toEqual({
      total: 6,
      accepted: 1,
      pending: 1,
      released: 4,
      declined: 0,
      uninvited: 0,
    });
    // Still exclusive: every queried row lands in exactly one bucket.
    expect(Object.values(out[REQUEST_A].progress).slice(1).reduce((sum, value) => sum + value, 0)).toBe(6);
    // Active lifecycle counts are UNCHANGED — `deriveWorkRemaining` and the
    // needs-reviewers behavior must not shift with a display-bucket fix.
    expect(out[REQUEST_A]).toMatchObject({ candidates: 6, invited: 6, accepted: 3, declined: 0 });
  });

  // `held` is retired but still routes the reviewer to the accept form, so it must
  // stay 'awaiting'/pending rather than joining the ended-engagement bucket.
  test('a held row stays pending, not released', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { _wmkf_request_value: REQUEST_A, wmkf_selected: true, wmkf_invited: true, wmkf_responsetype: RESPONSE_TYPE_MAP.held },
      ],
    });

    const out = await fetchReviewerRollup([REQUEST_A]);

    expect(out[REQUEST_A].progress).toMatchObject({ pending: 1, released: 0 });
    expect(out[REQUEST_A].held).toBe(1);
  });

  test('chunks requestIds at 25 per OR-chain call: first call gets ids 0-24 in order, second gets id 25', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `3333333${i.toString().padStart(1, '0')}-0000-4000-8000-000000000000`);
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    await fetchReviewerRollup(ids);
    expect(spy).toHaveBeenCalledTimes(2);
    const firstFilter = spy.mock.calls[0][1].filter;
    const secondFilter = spy.mock.calls[1][1].filter;
    // The filter wraps the OR-chain in parens: `(${orChain}) and wmkf_selected …`.
    const firstOrChain = firstFilter.slice(firstFilter.indexOf('(') + 1, firstFilter.indexOf(')'));
    const secondOrChain = secondFilter.slice(secondFilter.indexOf('(') + 1, secondFilter.indexOf(')'));
    // Exact contents + order: first call gets elements 0..24 in order, second gets element 25..29.
    expect(firstOrChain.split(' or ')).toEqual(ids.slice(0, 25).map((id) => `_wmkf_request_value eq ${id}`));
    expect(secondOrChain.split(' or ')).toEqual(ids.slice(25).map((id) => `_wmkf_request_value eq ${id}`));
  });
});

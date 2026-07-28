import { evaluateReviewSynthesisReadiness } from '../../lib/services/review-synthesis-readiness';
import {
  APPLICANT_DISPOSITION_EXCLUDED,
  RESPONSE_TYPE_MAP,
  REVIEW_STATUS_MAP,
} from '../../lib/dataverse/adapters/reviewer-suggestion';

const NOW = '2026-07-28T18:00:00.000Z';

function row(id, patch = {}) {
  return {
    wmkf_appreviewersuggestionid: id,
    wmkf_selected: true,
    wmkf_applicantdisposition: null,
    wmkf_invited: true,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_reviewstatus: null,
    wmkf_reviewreceivedat: null,
    wmkf_externaltokenhash: `hash-${id}`,
    wmkf_externaltokenissued: '2026-07-20T00:00:00.000Z',
    wmkf_externaltokenexpires: '2026-08-20T00:00:00.000Z',
    wmkf_externaltokenrevoked: false,
    ...patch,
  };
}

describe('evaluateReviewSynthesisReadiness', () => {
  test('requires at least one submitted review even when every participant is resolved', () => {
    const result = evaluateReviewSynthesisReadiness([
      row('a', { wmkf_responsetype: RESPONSE_TYPE_MAP.declined }),
      row('b', { wmkf_reviewstatus: REVIEW_STATUS_MAP.released }),
    ], { now: NOW });

    expect(result).toMatchObject({
      ready: false,
      canRunManually: false,
      participantCount: 2,
      submittedCount: 0,
      resolvedCount: 2,
      blockingCount: 0,
    });
  });

  test('is ready when every participant resolves and at least one review is submitted', () => {
    const result = evaluateReviewSynthesisReadiness([
      row('submitted', {
        wmkf_accepted: true,
        wmkf_reviewreceivedat: '2026-07-27T12:00:00.000Z',
        wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received,
      }),
      row('declined', { wmkf_declined: true }),
      row('no-response', { wmkf_responsetype: RESPONSE_TYPE_MAP.no_response }),
      row('withdrawn', { wmkf_responsetype: RESPONSE_TYPE_MAP.withdrawn_sufficient }),
      row('withdrew', { wmkf_reviewstatus: REVIEW_STATUS_MAP.withdrew }),
      row('released', { wmkf_reviewstatus: REVIEW_STATUS_MAP.released }),
      row('revoked', { wmkf_externaltokenrevoked: true }),
      row('expired', { wmkf_externaltokenexpires: '2026-07-28T17:59:59.000Z' }),
    ], { now: NOW, contentHash: 'content-v1' });

    expect(result).toMatchObject({
      ready: true,
      canRunManually: true,
      participantCount: 8,
      submittedCount: 1,
      resolvedCount: 8,
      blockingCount: 0,
    });
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('ignores unselected, applicant-excluded, and never-engaged rows', () => {
    const result = evaluateReviewSynthesisReadiness([
      row('submitted', {
        wmkf_accepted: true,
        wmkf_reviewreceivedat: '2026-07-27T12:00:00.000Z',
      }),
      row('unselected', { wmkf_selected: false }),
      row('excluded', { wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED }),
      row('never-engaged', { wmkf_invited: false, wmkf_accepted: false }),
    ], { now: NOW });

    expect(result).toMatchObject({
      ready: true,
      participantCount: 1,
      submittedCount: 1,
      blockingCount: 0,
    });
  });

  test.each([
    ['live token', {}, 'active_invitation'],
    ['missing token', { wmkf_externaltokenhash: null }, 'missing_current_token'],
    ['missing issued date', { wmkf_externaltokenissued: null }, 'missing_token_issued_at'],
    ['missing expiry', { wmkf_externaltokenexpires: null }, 'missing_token_expires_at'],
    ['malformed issued date', { wmkf_externaltokenissued: 'not-a-date' }, 'malformed_token_issued_at'],
    ['malformed expiry', { wmkf_externaltokenexpires: 'not-a-date' }, 'malformed_token_expires_at'],
    ['unknown response type', { wmkf_responsetype: 999999999 }, 'unknown_response_type'],
    ['unknown review status', { wmkf_reviewstatus: 999999999 }, 'unknown_review_status'],
    ['malformed accepted flag', { wmkf_accepted: 'yes' }, 'malformed_wmkf_accepted'],
    ['malformed receipt date', { wmkf_reviewreceivedat: 'not-a-date' }, 'malformed_review_received_at'],
  ])('fails closed for %s', (_label, patch, reason) => {
    const result = evaluateReviewSynthesisReadiness([
      row('submitted', {
        wmkf_accepted: true,
        wmkf_reviewreceivedat: '2026-07-27T12:00:00.000Z',
      }),
      row('blocked', patch),
    ], { now: NOW });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContainEqual({ suggestionId: 'blocked', reason });
  });

  test('requires explicit manual override while participants remain unresolved', () => {
    const result = evaluateReviewSynthesisReadiness([
      row('submitted', {
        wmkf_accepted: true,
        wmkf_reviewreceivedat: '2026-07-27T12:00:00.000Z',
      }),
      row('waiting'),
    ], { now: NOW });

    expect(result).toMatchObject({
      ready: false,
      canRunManually: true,
      blockingCount: 1,
    });
  });

  test('changes the fingerprint when a token crosses expiry without a row write', () => {
    const rows = [
      row('submitted', {
        wmkf_accepted: true,
        wmkf_reviewreceivedat: '2026-07-27T12:00:00.000Z',
      }),
      row('expiring', { wmkf_externaltokenexpires: '2026-07-28T18:00:00.000Z' }),
    ];

    const before = evaluateReviewSynthesisReadiness(rows, {
      now: '2026-07-28T17:59:59.000Z',
      contentHash: 'same-content',
    });
    const after = evaluateReviewSynthesisReadiness(rows, {
      now: '2026-07-28T18:00:01.000Z',
      contentHash: 'same-content',
    });

    expect(before.ready).toBe(false);
    expect(after.ready).toBe(true);
    expect(after.inputHash).not.toBe(before.inputHash);
  });

  test('fingerprint is stable across source ordering and changes with review content', () => {
    const a = row('a', {
      wmkf_accepted: true,
      wmkf_reviewreceivedat: '2026-07-27T12:00:00.000Z',
    });
    const b = row('b', { wmkf_externaltokenrevoked: true });

    const first = evaluateReviewSynthesisReadiness([a, b], { now: NOW, contentHash: 'v1' });
    const reordered = evaluateReviewSynthesisReadiness([b, a], { now: NOW, contentHash: 'v1' });
    const changed = evaluateReviewSynthesisReadiness([a, b], { now: NOW, contentHash: 'v2' });

    expect(reordered.inputHash).toBe(first.inputHash);
    expect(changed.inputHash).not.toBe(first.inputHash);
  });
});

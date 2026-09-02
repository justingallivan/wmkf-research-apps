/**
 * Tests for the pure reviewer-management logic shared by ReviewerManagePanel,
 * SubTabBadges, ReviewersTab, and the Workbench shell
 * (shared/components/reviewers/reviewer-modes.js).
 *
 * The headline guarantee is the "no fallthrough" invariant: every reviewStatus
 * the API can return is bucketed into exactly one sub-tab mode, so no reviewer
 * can silently disappear from Track Reviewers (Codex S209 asked this).
 */

const {
  STATUS_PIPELINE,
  getStatusInfo,
  MODE_STATUSES,
  MODE_WORK_REMAINING,
  filterByMode,
  countForMode,
  workRemainingForMode,
  computeDefaultSub,
  computeCanManage,
  canTransitionToTerminal,
} = require('../../shared/components/reviewers/reviewer-modes.js');

// Mirror of REVIEW_STATUS_BY_VALUE in lib/services/review-manager/reviewers-service.js —
// the authoritative set of statuses the GET can emit.
const API_STATUSES = ['accepted', 'materials_sent', 'under_review', 'review_received', 'complete', 'withdrew', 'released'];

const rev = (reviewStatus) => ({ suggestionId: `s-${reviewStatus}-${Math.random()}`, reviewStatus });

describe('STATUS_PIPELINE', () => {
  it('covers exactly the API status set, in lifecycle order', () => {
    expect(STATUS_PIPELINE.map(s => s.key)).toEqual(API_STATUSES);
  });
});

describe('getStatusInfo', () => {
  it('returns the matching pipeline entry', () => {
    expect(getStatusInfo('complete').label).toBe('Complete');
  });
  it('falls back to the first stage for an unknown status', () => {
    expect(getStatusInfo('bogus')).toBe(STATUS_PIPELINE[0]);
    expect(getStatusInfo(undefined)).toBe(STATUS_PIPELINE[0]);
  });
});

describe('MODE_STATUSES partitioning (no-fallthrough invariant)', () => {
  const buckets = [MODE_STATUSES.track];

  it('every API status lands in exactly one mode bucket', () => {
    for (const status of API_STATUSES) {
      const hits = buckets.filter(b => b.includes(status)).length;
      expect(hits).toBe(1); // not 0 (would vanish), not >1 (would double-count)
    }
  });

  it('the buckets introduce no statuses outside the API set', () => {
    const union = new Set(buckets.flat());
    expect([...union].sort()).toEqual([...API_STATUSES].sort());
  });

  it('MODE_WORK_REMAINING is a subset of MODE_STATUSES for each mode', () => {
    for (const mode of ['track']) {
      for (const s of MODE_WORK_REMAINING[mode]) {
        expect(MODE_STATUSES[mode]).toContain(s);
      }
    }
  });
});

describe('filterByMode', () => {
  const all = API_STATUSES.map(rev);

  it('returns everything for "all" / undefined / unknown mode', () => {
    expect(filterByMode(all, 'all')).toHaveLength(7);
    expect(filterByMode(all, undefined)).toHaveLength(7);
    expect(filterByMode(all, 'nonsense')).toHaveLength(7);
  });

  it('scopes to the mode bucket', () => {
    expect(filterByMode(all, 'track').map(r => r.reviewStatus))
      .toEqual(['accepted', 'materials_sent', 'under_review', 'review_received', 'complete', 'withdrew', 'released']);
  });

  it('tolerates null/empty input', () => {
    expect(filterByMode(null, 'track')).toEqual([]);
    expect(filterByMode(undefined, 'all')).toEqual([]);
  });

  it('tracks the full post-acceptance lifecycle with no loss', () => {
    expect(filterByMode(all, 'track')).toHaveLength(all.length);
  });
});

describe('countForMode / workRemainingForMode', () => {
  const reviewers = [
    rev('accepted'), rev('accepted'), rev('materials_sent'), rev('review_received'),
    rev('complete'), rev('withdrew'), rev('released'),
  ];

  it('counts visible reviewers per mode', () => {
    expect(countForMode(reviewers, 'track')).toBe(7);
  });

  it('work-remaining excludes done-in-stage statuses', () => {
    expect(workRemainingForMode(reviewers, 'track')).toBe(3);  // accepted + materials_sent open; review_received/complete done
  });

  it('handles empty/null', () => {
    expect(countForMode([], 'track')).toBe(0);
    expect(workRemainingForMode(null, 'track')).toBe(0);
  });
});

describe('terminal transition convenience predicate', () => {
  it.each(['accepted', 'materials_sent', 'under_review'])('allows in-flight source %s', (reviewStatus) => {
    expect(canTransitionToTerminal({ reviewStatus, submitted: false, reviewReceivedAt: null })).toBe(true);
  });

  it.each(['review_received', 'complete', 'withdrew', 'released'])('rejects non-source %s', (reviewStatus) => {
    expect(canTransitionToTerminal({ reviewStatus, submitted: false, reviewReceivedAt: null })).toBe(false);
  });

  it('rejects a submitted/received row even if its displayed status is stale', () => {
    expect(canTransitionToTerminal({ reviewStatus: 'under_review', submitted: true })).toBe(false);
    expect(canTransitionToTerminal({ reviewStatus: 'under_review', reviewReceivedAt: '2026-07-22' })).toBe(false);
  });
});

describe('computeDefaultSub (state-aware landing)', () => {
  it('lands on Find when there are no reviewers', () => {
    expect(computeDefaultSub([])).toBe('find');
    expect(computeDefaultSub(null)).toBe('find');
  });
  it('lands on Track when accepted reviewers await materials', () => {
    expect(computeDefaultSub([rev('accepted'), rev('complete')])).toBe('track');
  });
  it('lands on Track when work is in flight', () => {
    expect(computeDefaultSub([rev('under_review'), rev('complete')])).toBe('track');
  });
  it('lands on Track when everything is complete', () => {
    expect(computeDefaultSub([rev('complete'), rev('complete')])).toBe('track');
  });
  it('lands on Track when only review_received remains', () => {
    // review_received is in MODE_STATUSES.track but NOT MODE_WORK_REMAINING.track,
    // so track work-remaining is 0; track count > 0 → track.
    expect(computeDefaultSub([rev('review_received')])).toBe('track');
  });
});

describe('computeCanManage (authoritative-gate mirror, fails closed)', () => {
  const PD = 'pd-guid';
  const ME = 'me-guid';

  it('superuser always manages', () => {
    expect(computeCanManage({ isSuperuser: true, pdId: PD, myUserId: 'someone-else' })).toBe(true);
  });
  it('lead PD manages their own request', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: PD, myUserId: PD })).toBe(true);
  });
  it('fails closed when the request PD is unresolved', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: null, myUserId: ME })).toBe(false);
  });
  it('fails closed when the viewer systemuser id is unresolved', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: PD, myUserId: null })).toBe(false);
  });
  it('hides controls only for a resolved non-superuser non-PD viewer', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: PD, myUserId: ME })).toBe(false);
  });
  it('compares Dynamics GUIDs case-insensitively', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: 'PD-GUID', myUserId: 'pd-guid' })).toBe(true);
  });
  it('defaults to denied with no args', () => {
    expect(computeCanManage()).toBe(false);
  });
});

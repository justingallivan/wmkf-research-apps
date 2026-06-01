/**
 * Tests for the pure reviewer-management logic shared by ReviewerManagePanel,
 * SubTabBadges, ReviewersTab, and the Workbench shell
 * (shared/components/reviewers/reviewer-modes.js).
 *
 * The headline guarantee is the "no fallthrough" invariant: every reviewStatus
 * the API can return is bucketed into exactly one sub-tab mode, so no reviewer
 * can silently disappear from Invite/Track/Completed (Codex S209 asked this).
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
} = require('../../shared/components/reviewers/reviewer-modes.js');

// Mirror of REVIEW_STATUS_BY_VALUE in pages/api/review-manager/reviewers.js —
// the authoritative set of statuses the GET can emit.
const API_STATUSES = ['accepted', 'materials_sent', 'under_review', 'review_received', 'complete'];

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
  const buckets = [MODE_STATUSES.invite, MODE_STATUSES.track, MODE_STATUSES.completed];

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
    for (const mode of ['invite', 'track', 'completed']) {
      for (const s of MODE_WORK_REMAINING[mode]) {
        expect(MODE_STATUSES[mode]).toContain(s);
      }
    }
  });
});

describe('filterByMode', () => {
  const all = API_STATUSES.map(rev);

  it('returns everything for "all" / undefined / unknown mode', () => {
    expect(filterByMode(all, 'all')).toHaveLength(5);
    expect(filterByMode(all, undefined)).toHaveLength(5);
    expect(filterByMode(all, 'nonsense')).toHaveLength(5);
  });

  it('scopes to the mode bucket', () => {
    expect(filterByMode(all, 'invite').map(r => r.reviewStatus)).toEqual(['accepted']);
    expect(filterByMode(all, 'track').map(r => r.reviewStatus))
      .toEqual(['materials_sent', 'under_review', 'review_received']);
    expect(filterByMode(all, 'completed').map(r => r.reviewStatus)).toEqual(['complete']);
  });

  it('tolerates null/empty input', () => {
    expect(filterByMode(null, 'invite')).toEqual([]);
    expect(filterByMode(undefined, 'all')).toEqual([]);
  });

  it('partitions the full set across the three modes with no loss', () => {
    const recombined = [
      ...filterByMode(all, 'invite'),
      ...filterByMode(all, 'track'),
      ...filterByMode(all, 'completed'),
    ];
    expect(recombined).toHaveLength(all.length);
  });
});

describe('countForMode / workRemainingForMode', () => {
  const reviewers = [rev('accepted'), rev('accepted'), rev('materials_sent'), rev('review_received'), rev('complete')];

  it('counts visible reviewers per mode', () => {
    expect(countForMode(reviewers, 'invite')).toBe(2);
    expect(countForMode(reviewers, 'track')).toBe(2);
    expect(countForMode(reviewers, 'completed')).toBe(1);
  });

  it('work-remaining excludes done-in-stage statuses', () => {
    expect(workRemainingForMode(reviewers, 'invite')).toBe(2); // both accepted need materials
    expect(workRemainingForMode(reviewers, 'track')).toBe(1);  // materials_sent open; review_received done
    expect(workRemainingForMode(reviewers, 'completed')).toBe(0);
  });

  it('handles empty/null', () => {
    expect(countForMode([], 'invite')).toBe(0);
    expect(workRemainingForMode(null, 'track')).toBe(0);
  });
});

describe('computeDefaultSub (state-aware landing)', () => {
  it('lands on Find when there are no reviewers', () => {
    expect(computeDefaultSub([])).toBe('find');
    expect(computeDefaultSub(null)).toBe('find');
  });
  it('prefers Invite when reviewers await materials', () => {
    expect(computeDefaultSub([rev('accepted'), rev('complete')])).toBe('invite');
  });
  it('falls to Track when work is in flight and none await materials', () => {
    expect(computeDefaultSub([rev('under_review'), rev('complete')])).toBe('track');
  });
  it('falls to Completed when everything is done', () => {
    expect(computeDefaultSub([rev('complete'), rev('complete')])).toBe('completed');
  });
  it('shows Invite (not Find) when only review_received remains (track has no open work but rows exist)', () => {
    // review_received is in MODE_STATUSES.track but NOT MODE_WORK_REMAINING.track,
    // so invite work-remaining is 0; track count > 0 → track.
    expect(computeDefaultSub([rev('review_received')])).toBe('track');
  });
});

describe('computeCanManage (soft gate, fails open)', () => {
  const PD = 'pd-guid';
  const ME = 'me-guid';

  it('superuser always manages', () => {
    expect(computeCanManage({ isSuperuser: true, pdId: PD, myUserId: 'someone-else' })).toBe(true);
  });
  it('lead PD manages their own request', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: PD, myUserId: PD })).toBe(true);
  });
  it('fails open when the request PD is unresolved', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: null, myUserId: ME })).toBe(true);
  });
  it('fails open when the viewer systemuser id is unresolved', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: PD, myUserId: null })).toBe(true);
  });
  it('hides controls only for a resolved non-superuser non-PD viewer', () => {
    expect(computeCanManage({ isSuperuser: false, pdId: PD, myUserId: ME })).toBe(false);
  });
  it('defaults to permissive with no args', () => {
    expect(computeCanManage()).toBe(true);
  });
});

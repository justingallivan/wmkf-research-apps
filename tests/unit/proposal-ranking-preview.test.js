import { syntheticReviewerVisibilityDto } from '../../lib/services/test-requests/isolation.js';
import { countOutstandingOrdinaryReviews, stableFingerprint } from '../../lib/services/proposal-ranking/preview-service.js';

describe('Proposal Ranking preview review progress', () => {
  test('counts only explicitly ordinary pending reviews after synthetic isolation is enabled', () => {
    const env = { SYNTHETIC_REVIEWER_ISOLATION: 'on' };
    const ordinaryNullMarker = syntheticReviewerVisibilityDto({ wmkf_issyntheticreviewer: null }, env);
    const synthetic = syntheticReviewerVisibilityDto({ wmkf_issyntheticreviewer: true }, env);
    expect(ordinaryNullMarker).toEqual({ isSyntheticReviewer: false });
    expect(synthetic).toEqual({ isSyntheticReviewer: true });
    expect(countOutstandingOrdinaryReviews([{ reviews: [
      { ...ordinaryNullMarker, synthetic: ordinaryNullMarker.isSyntheticReviewer, outstanding: true },
      { ...synthetic, synthetic: synthetic.isSyntheticReviewer, outstanding: true },
      { outstanding: true },
    ] }])).toBe(1);
  });

  test('binds displayed outstanding-review progress into the preview fingerprint', () => {
    const base = { snapshot: { proposals: [], seedOrders: { se: [], mr: [] } }, roster: [], unexpectedStatuses: [] };
    expect(stableFingerprint({ ...base, outstandingReviewCount: 1 }))
      .not.toBe(stableFingerprint({ ...base, outstandingReviewCount: 2 }));
  });
});

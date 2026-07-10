const mockGetSetting = jest.fn();
const mockSetSetting = jest.fn();

jest.mock('../../lib/services/settings-service', () => ({
  getSetting: (...args) => mockGetSetting(...args),
  setSetting: (...args) => mockSetSetting(...args),
}));

const {
  REVIEWER_CAMPAIGN_TIMELINE_KEY,
  DEFAULT_REVIEWER_CAMPAIGN_TIMELINE,
  normalizeTimeline,
  parseStoredTimeline,
  getReviewerCampaignTimeline,
  setReviewerCampaignTimeline,
} = require('../../lib/services/reviewer-campaign-timeline');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reviewer campaign timeline defaults', () => {
  test('absent setting returns built-in defaults', () => {
    expect(parseStoredTimeline(null)).toEqual({
      timeline: { ...DEFAULT_REVIEWER_CAMPAIGN_TIMELINE },
      isDefault: true,
      malformed: false,
    });
  });

  test('stored JSON is normalized into the public timeline shape', () => {
    const parsed = parseStoredTimeline(JSON.stringify({
      cycleLabel: ' D26 ',
      inviteStartDate: '2026-06-17',
      respondOffsetDays: null,
      proposalReleaseDate: '2026-07-08',
      reviewDueDate: '2026-07-22',
      desiredCount: 10,
      extra: 'ignored',
    }));
    expect(parsed).toEqual({
      timeline: {
        cycleLabel: 'D26',
        inviteStartDate: '2026-06-17',
        respondOffsetDays: null,
        proposalReleaseDate: '2026-07-08',
        reviewDueDate: '2026-07-22',
        desiredCount: 10,
      },
      isDefault: false,
      malformed: false,
    });
  });

  test('legacy stored JSON without desiredCount merges in the default (4)', () => {
    const parsed = parseStoredTimeline(JSON.stringify({
      cycleLabel: 'D25',
      respondOffsetDays: 7,
      reviewDueDate: '2026-01-01',
    }));
    expect(parsed.timeline.desiredCount).toBe(4);
    expect(parsed.isDefault).toBe(false);
  });

  test('stored JSON with desiredCount explicitly null keeps it null (not merged)', () => {
    const parsed = parseStoredTimeline(JSON.stringify({
      cycleLabel: 'D25',
      desiredCount: null,
    }));
    expect(parsed.timeline.desiredCount).toBeNull();
  });

  test('malformed stored JSON falls back without throwing', () => {
    expect(parseStoredTimeline('{bad')).toMatchObject({
      timeline: { ...DEFAULT_REVIEWER_CAMPAIGN_TIMELINE },
      isDefault: true,
      malformed: true,
    });
  });

  test('write validation rejects impossible dates and bad offsets', () => {
    expect(() => normalizeTimeline({ reviewDueDate: '2026-02-31' }))
      .toThrow('reviewDueDate must be a YYYY-MM-DD date or blank');
    expect(() => normalizeTimeline({ respondOffsetDays: -1 }))
      .toThrow('respondOffsetDays must be a non-negative integer or blank');
  });

  test('write validation rejects a bad desiredCount, accepts null/blank and a non-negative integer', () => {
    expect(() => normalizeTimeline({ desiredCount: -1 }))
      .toThrow('desiredCount must be a non-negative integer or blank');
    expect(() => normalizeTimeline({ desiredCount: 1.5 }))
      .toThrow('desiredCount must be a non-negative integer or blank');
    expect(normalizeTimeline({ desiredCount: null }).desiredCount).toBeNull();
    expect(normalizeTimeline({ desiredCount: '' }).desiredCount).toBeNull();
    expect(normalizeTimeline({ desiredCount: 6 }).desiredCount).toBe(6);
  });

  test('get reads the Dataverse setting key', async () => {
    mockGetSetting.mockResolvedValueOnce(JSON.stringify({ reviewDueDate: '2026-07-22' }));
    const out = await getReviewerCampaignTimeline();
    expect(mockGetSetting).toHaveBeenCalledWith(REVIEWER_CAMPAIGN_TIMELINE_KEY);
    expect(out).toMatchObject({
      key: REVIEWER_CAMPAIGN_TIMELINE_KEY,
      isDefault: false,
      timeline: { reviewDueDate: '2026-07-22' },
    });
  });

  test('set writes normalized JSON with the updater profile id', async () => {
    mockSetSetting.mockResolvedValueOnce(true);
    const out = await setReviewerCampaignTimeline({
      cycleLabel: 'D26',
      inviteStartDate: '2026-06-17',
      respondOffsetDays: '10',
      proposalReleaseDate: '',
      reviewDueDate: '2026-07-22',
      desiredCount: 5,
    }, 42);
    expect(mockSetSetting).toHaveBeenCalledWith(
      REVIEWER_CAMPAIGN_TIMELINE_KEY,
      JSON.stringify({
        cycleLabel: 'D26',
        inviteStartDate: '2026-06-17',
        respondOffsetDays: 10,
        proposalReleaseDate: '',
        reviewDueDate: '2026-07-22',
        desiredCount: 5,
      }),
      42,
    );
    expect(out.timeline.respondOffsetDays).toBe(10);
  });
});

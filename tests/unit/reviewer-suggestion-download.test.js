/**
 * @jest-environment node
 *
 * reviewer-suggestion.getForDownload — byte-mirrors the download-review.js
 * route's inline getRecord call (data-access-layer migration, Stage 3-6).
 * Deliberately distinct from findById: no applicant-excluded throw, so staff
 * can still retrieve a file for a since-excluded engagement row.
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { getForDownload, APPLICANT_DISPOSITION_EXCLUDED } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => jest.restoreAllMocks());

describe('getForDownload', () => {
  it('calls getRecord with the download-scoped select', async () => {
    const spy = jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_reviewsharepointfolder: 'akoya_request/REQ-1/Reviewer_Uploads/Jane',
      wmkf_reviewfilename: 'review.pdf',
    });

    const row = await getForDownload(SUGGESTION_ID);

    expect(spy).toHaveBeenCalledWith('wmkf_appreviewersuggestions', SUGGESTION_ID, {
      select: 'wmkf_appreviewersuggestionid,wmkf_reviewsharepointfolder,wmkf_reviewfilename',
    });
    expect(row.wmkf_reviewfilename).toBe('review.pdf');
  });

  it('does NOT throw on an applicant-excluded row (unlike findById)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_applicantdisposition: APPLICANT_DISPOSITION_EXCLUDED,
      wmkf_reviewsharepointfolder: 'folder',
      wmkf_reviewfilename: 'review.pdf',
    });
    await expect(getForDownload(SUGGESTION_ID)).resolves.toEqual(expect.objectContaining({ wmkf_reviewfilename: 'review.pdf' }));
  });

  it('propagates a 404 error unchanged', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('Get record failed (404): {}'));
    await expect(getForDownload(SUGGESTION_ID)).rejects.toThrow(/404/);
  });
});

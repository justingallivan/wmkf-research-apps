/**
 * Chunk 1 (S289 reviewer-merge): adapter plumbing for the pre-engagement-loser
 * merge. Behavior-neutral helpers — no existing path changes.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as potentialReviewer from '../../lib/dataverse/adapters/potential-reviewer.js';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const KEEPER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUG = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let original;
beforeEach(() => {
  original = {
    getRecord: DynamicsService.getRecord,
    updateRecord: DynamicsService.updateRecord,
    deleteRecord: DynamicsService.deleteRecord,
    queryAllRecords: DynamicsService.queryAllRecords,
  };
  DynamicsService.getRecord = jest.fn().mockResolvedValue({ wmkf_potentialreviewersid: LOSER });
  DynamicsService.updateRecord = jest.fn().mockResolvedValue(undefined);
  DynamicsService.deleteRecord = jest.fn().mockResolvedValue(undefined);
  DynamicsService.queryAllRecords = jest.fn().mockResolvedValue({ records: [], totalCount: 0 });
});
afterEach(() => {
  DynamicsService.getRecord = original.getRecord;
  DynamicsService.updateRecord = original.updateRecord;
  DynamicsService.deleteRecord = original.deleteRecord;
  DynamicsService.queryAllRecords = original.queryAllRecords;
});

describe('potential-reviewer merge helpers', () => {
  test('getByIdForMerge reads the WIDE select (wave6 biblio + identity), not the shared FIELD_SELECT', async () => {
    await potentialReviewer.getByIdForMerge(LOSER);
    const [entitySet, id, opts] = DynamicsService.getRecord.mock.calls[0];
    expect(entitySet).toBe('wmkf_potentialreviewerses');
    expect(id).toBe(LOSER);
    // The whole point of the separate constant: identity + bibliometric fields present.
    expect(opts.select).toMatch(/wmkf_identitystatus/);
    expect(opts.select).toMatch(/wmkf_hindex/);
    expect(opts.select).toMatch(/wmkf_emailsource/);
    // and it did NOT widen the shared FIELD_SELECT object (exported constant differs)
    expect(potentialReviewer.MERGE_FIELD_SELECT).toEqual(expect.arrayContaining(['wmkf_identitystatus', 'wmkf_emailaddress']));
  });

  test('getByIdForMerge requires an id', async () => {
    await expect(potentialReviewer.getByIdForMerge()).rejects.toThrow(/id required/);
  });

  // S387: clearing the address clears its provenance too. A source left behind describes
  // an address the row no longer has, so a later address written by any path that does not
  // set a source would silently inherit it (in the merge flow: a loser row keeping `orcid`
  // after its address moved to the keeper).
  test('clearEmail blanks wmkf_emailaddress AND its source (frees the alt-key)', async () => {
    await potentialReviewer.clearEmail(LOSER, { actingUserSystemId: 'sys', ifMatch: 'W/"1"' });
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_potentialreviewerses', LOSER, { wmkf_emailaddress: null, wmkf_emailsource: null },
      { actingUserSystemId: 'sys', ifMatch: 'W/"1"' },
    );
  });

  test('deactivate sets the Inactive state pair', async () => {
    await potentialReviewer.deactivate(LOSER, { actingUserSystemId: 'sys' });
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_potentialreviewerses', LOSER, { statecode: 1, statuscode: 2 },
      { actingUserSystemId: 'sys', ifMatch: undefined },
    );
  });
});

describe('reviewer-suggestion merge helpers', () => {
  test('findAllByPotentialReviewer paginates and does NOT filter on selected (includes removed rows)', async () => {
    DynamicsService.queryAllRecords.mockResolvedValueOnce({
      records: [{ wmkf_appreviewersuggestionid: SUG, wmkf_selected: false }], totalCount: 1,
    });
    const rows = await suggestionAdapter.findAllByPotentialReviewer(LOSER);
    expect(rows).toHaveLength(1);
    const [entitySet, opts] = DynamicsService.queryAllRecords.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(opts.filter).toBe(`_wmkf_potentialreviewer_value eq ${LOSER}`);
    expect(opts.filter).not.toMatch(/selected/); // removed rows must be included
    expect(opts.select).toMatch(/_wmkf_honorariumrequest_value/); // engagement signal present
    expect(opts.select).toMatch(/wmkf_sources/); // applicant-provenance gate (collision union) present
  });

  test('findAllByPotentialReviewer rejects a non-GUID', async () => {
    await expect(suggestionAdapter.findAllByPotentialReviewer('not-a-guid')).rejects.toThrow(/GUID/);
  });

  test('repointToPotentialReviewer rebinds to the keeper and passes ifMatch', async () => {
    await suggestionAdapter.repointToPotentialReviewer(SUG, KEEPER, { actingUserSystemId: 'sys', ifMatch: 'W/"7"' });
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      { 'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${KEEPER})` },
      { actingUserSystemId: 'sys', ifMatch: 'W/"7"' },
    );
  });

  test('repointToPotentialReviewer GUID-validates both ids', async () => {
    await expect(suggestionAdapter.repointToPotentialReviewer('x', KEEPER)).rejects.toThrow(/suggestionId/);
    await expect(suggestionAdapter.repointToPotentialReviewer(SUG, 'x')).rejects.toThrow(/keeperId/);
  });

  test('hardDeleteById conditional-deletes with ifMatch', async () => {
    await suggestionAdapter.hardDeleteById(SUG, { actingUserSystemId: 'sys', ifMatch: 'W/"9"' });
    expect(DynamicsService.deleteRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG, { actingUserSystemId: 'sys', ifMatch: 'W/"9"' },
    );
  });

  test('hardDeleteById GUID-validates', async () => {
    await expect(suggestionAdapter.hardDeleteById('nope')).rejects.toThrow(/GUID/);
  });

  describe('hasApplicantProvenance', () => {
    const RECOMMENDED = suggestionAdapter.APPLICANT_DISPOSITION_MAP.recommended;
    const EXCLUDED = suggestionAdapter.APPLICANT_DISPOSITION_MAP.excluded;

    test('true on the recommended disposition', () => {
      expect(suggestionAdapter.hasApplicantProvenance({ wmkf_applicantdisposition: RECOMMENDED })).toBe(true);
    });
    test('true on an "applicant" source token (even with null disposition)', () => {
      expect(suggestionAdapter.hasApplicantProvenance({ wmkf_sources: 'staff_manual,applicant', wmkf_applicantdisposition: null })).toBe(true);
    });
    test('false on a non-applicant row', () => {
      expect(suggestionAdapter.hasApplicantProvenance({ wmkf_sources: 'staff_manual', wmkf_applicantdisposition: null })).toBe(false);
    });
    test('false on an excluded row with no applicant source', () => {
      expect(suggestionAdapter.hasApplicantProvenance({ wmkf_applicantdisposition: EXCLUDED, wmkf_sources: '' })).toBe(false);
    });
    test('false on null/undefined', () => {
      expect(suggestionAdapter.hasApplicantProvenance(null)).toBe(false);
      expect(suggestionAdapter.hasApplicantProvenance(undefined)).toBe(false);
    });
  });
});

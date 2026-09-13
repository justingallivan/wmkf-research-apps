/** @jest-environment node */
jest.mock('../../lib/services/workbench-proposal-documents.js', () => ({ getAiProposalNarrativeText: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));

import { getAiProposalNarrativeText } from '../../lib/services/workbench-proposal-documents.js';
import * as requests from '../../lib/dataverse/adapters/grant-request.js';
import { prepareReviewPanelInput, ReviewPanelInputError, REVIEW_PANEL_INPUT_KEYS, REVIEW_PANEL_NARRATIVE_KEYS } from '../../lib/services/review-panel-input';

const ID = '11111111-1111-1111-1111-111111111111';

// The discriminating fixture: all four D2-excluded memo fields ARE populated
// on the row, exactly as a live akoya_request row would carry them. A fixture
// without these present would let the allowlist assertion pass even if the
// exclusion guard were deleted.
const rowWithMemos = {
  akoya_requestid: ID,
  akoya_requestnum: 'REQ-1',
  akoya_title: 'A Title',
  _akoya_applicantid_value: 'app-1',
  _akoya_applicantid_value_formatted: 'Example U',
  wmkf_ai_fitrationale: 'SECRET fit rationale text',
  wmkf_ai_summary: 'SECRET summary text',
  wmkf_ai_dataextract: 'SECRET data extract text',
  wmkf_ai_fieldprimer: 'SECRET field primer text',
};

const narrative = {
  text: 'A '.repeat(200),
  filename: 'project_narrative.pdf',
  siteId: 'site-1', driveId: 'drive-1', itemId: 'item-1', versionId: '1',
  contentHash: 'abc123',
};

beforeEach(() => {
  jest.clearAllMocks();
  requests.getById.mockResolvedValue(rowWithMemos);
  getAiProposalNarrativeText.mockResolvedValue(narrative);
});

test('DTO carries exactly the allowlisted keys, and JSON.stringify never contains any memo text', async () => {
  const dto = await prepareReviewPanelInput(ID);
  expect(Object.keys(dto).sort()).toEqual([...REVIEW_PANEL_INPUT_KEYS].sort());
  expect(Object.keys(dto.narrative).sort()).toEqual([...REVIEW_PANEL_NARRATIVE_KEYS].sort());
  const serialized = JSON.stringify(dto);
  expect(serialized).not.toContain('SECRET');
  expect(serialized).not.toContain('fitrationale');
});

test('the request select never asks the adapter for a memo column', async () => {
  await prepareReviewPanelInput(ID);
  const [, options] = requests.getById.mock.calls[0];
  expect(options.select).not.toMatch(/wmkf_ai_(fitrationale|summary|dataextract|fieldprimer)/);
});

test('narrative fields are sourced only from getAiProposalNarrativeText, never from parseAiContext-shaped memo fields', async () => {
  const dto = await prepareReviewPanelInput(ID);
  expect(dto.narrative.text).toBe(narrative.text);
  expect(dto.narrative.sha256).toBe('abc123');
  expect(dto.institution).toBe('Example U');
  expect(dto.title).toBe('A Title');
  expect(Object.isFrozen(dto)).toBe(true);
  expect(Object.isFrozen(dto.narrative)).toBe(true);
});

test('missing or short narrative fails closed', async () => {
  getAiProposalNarrativeText.mockResolvedValue({ text: 'too short' });
  await expect(prepareReviewPanelInput(ID)).rejects.toBeInstanceOf(ReviewPanelInputError);
});

test('an invalid requestId is rejected before any adapter call', async () => {
  await expect(prepareReviewPanelInput('not-a-guid')).rejects.toBeInstanceOf(ReviewPanelInputError);
  expect(requests.getById).not.toHaveBeenCalled();
});

test('a missing request row fails closed', async () => {
  requests.getById.mockResolvedValue(null);
  await expect(prepareReviewPanelInput(ID)).rejects.toMatchObject({ code: 'review_panel_request_missing' });
});

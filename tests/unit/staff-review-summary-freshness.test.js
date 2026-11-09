/** @jest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import StaffReviewSummary from '../../shared/components/workbench/StaffReviewSummary';

jest.mock('../../shared/components/Layout', () => ({ Button: ({ children }) => <button type="button">{children}</button>, Card: ({ children }) => <div>{children}</div> }));
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
import { requestJson } from '../../shared/utils/api-request';

const REQ = '11111111-1111-4111-8111-111111111111';
const A = 'a'.repeat(64); const B = 'b'.repeat(64);

test('step E: the read-only panel reports summary freshness when both evidence hashes are known, and unknown otherwise', async () => {
  const onJ27Facts = jest.fn();
  requestJson.mockResolvedValueOnce({ summary: 'Saved.', evidenceHash: A, currentEvidenceHash: B, version: 'v', reviewerFacts: null });
  render(<StaffReviewSummary requestId={REQ} readOnly onJ27Facts={onJ27Facts} />);
  await waitFor(() => expect(onJ27Facts).toHaveBeenCalledWith(REQ, { summaryStale: true }));
  expect(requestJson.mock.calls[0][0]).toContain('includeReviewerFacts=1');

  onJ27Facts.mockClear();
  requestJson.mockResolvedValueOnce({ summary: 'Saved.', evidenceHash: A, currentEvidenceHash: A, version: 'v' });
  render(<StaffReviewSummary requestId={REQ} readOnly onJ27Facts={onJ27Facts} />);
  await waitFor(() => expect(onJ27Facts).toHaveBeenCalledWith(REQ, { summaryStale: false }));

  onJ27Facts.mockClear();
  requestJson.mockResolvedValueOnce({ summary: 'Saved.', evidenceHash: A, currentEvidenceHash: null, version: 'v' });
  render(<StaffReviewSummary requestId={REQ} readOnly onJ27Facts={onJ27Facts} />);
  await waitFor(() => expect(onJ27Facts).toHaveBeenCalledWith(REQ, { summaryStale: null }));

  onJ27Facts.mockClear();
  requestJson.mockRejectedValueOnce(new Error('read failed'));
  render(<StaffReviewSummary requestId={REQ} readOnly onJ27Facts={onJ27Facts} />);
  await waitFor(() => expect(onJ27Facts).toHaveBeenCalledWith(REQ, { summaryStale: null }));
});

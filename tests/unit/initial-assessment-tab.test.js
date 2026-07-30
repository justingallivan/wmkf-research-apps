/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InitialAssessmentTab from '../../shared/components/workbench/InitialAssessmentTab';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function readyArtifact() {
  return {
    artifactId: '44444444-4444-4444-4444-444444444444',
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    operationLabel: 'Ready',
    lifecycleLabel: 'Draft',
    attemptCount: 1,
    file: {
      name: '1003001 Initial Assessment.docx',
      webUrl: 'https://example.sharepoint.com/initial-assessment.docx',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      return {
        ok: true,
        json: async () => ({ artifact: readyArtifact(), reused: true }),
      };
    }
    return {
      ok: true,
      json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }),
    };
  });
});

afterEach(() => {
  global.fetch = jest.fn();
  jest.useRealTimers();
});

it('lets staff refresh a Ready artifact so changed authoritative inputs can create a replacement', async () => {
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);

  const refresh = await screen.findByRole('button', {
    name: 'Refresh from current inputs',
  });
  expect(refresh).toBeEnabled();

  fireEvent.click(refresh);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/initial-assessment',
    expect.objectContaining({ method: 'POST' }),
  ));
});

it('does not let a polling tick strand a retry in the generating state', async () => {
  jest.useFakeTimers();
  let resolvePost;
  const postResult = new Promise((resolve) => { resolvePost = resolve; });
  const generatingArtifact = {
    ...readyArtifact(),
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    operationLabel: 'Generating',
    retryable: true,
  };
  global.fetch = jest.fn(async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') return postResult;
    return {
      ok: true,
      json: async () => ({ artifacts: [generatingArtifact], latestAttempts: [] }),
    };
  });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  const retry = await screen.findByRole('button', { name: 'Retry draft' });

  fireEvent.click(retry);
  jest.advanceTimersByTime(5000);
  resolvePost({
    ok: true,
    json: async () => ({ artifact: readyArtifact(), reused: false }),
  });

  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Refresh from current inputs',
  })).toBeEnabled());
});

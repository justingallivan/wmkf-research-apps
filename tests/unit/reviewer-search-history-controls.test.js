/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';
import { APPLICANT_ENRICHMENT_CACHE_VERSION } from '../../shared/components/reviewers/reviewer-search-logic';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = '11111111-1111-1111-1111-111111111111';

const addressTrustReceipt = (email) => ({
  receiptId: `receipt-${email}`,
  personConfirmed: true,
  email,
});

const generatedCandidate = {
  candidateKey: 'candidate:prior-generated',
  name: 'Prior Generated Reviewer',
  email: 'prior@example.edu',
  emailSource: 'openalex',
  emailPersistAllowed: true,
  addressTrustReceipt: addressTrustReceipt('prior@example.edu'),
  identityStatus: 'probable',
  verificationConfidence: 0.8,
  rosterUpdatedAt: '2026-07-19T16:00:00.000Z',
  provenance: {
    kind: 'literature_retrieved',
    sources: ['openalex'],
    seedRole: 'query_seed',
    groundingWorkIds: [],
  },
};

const applicantCandidate = {
  name: 'Applicant Reviewer',
  email: 'applicant@example.edu',
  identityStatus: 'probable',
  isApplicantRecommended: true,
  enrichedProposalKey: 'proposal',
  applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION,
  applicantKnownReviewer: {
    status: 'known',
    email: 'applicant@example.edu',
    emailSource: 'pubmed',
  },
  provenance: {
    kind: 'applicant_suggested',
    sources: ['applicant_form'],
    seedRole: 'applicant_suggested',
    groundingWorkIds: [],
  },
};

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, body: {} };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  delete window.confirm;
  global.fetch = jest.fn();
});

test('a warm applicant roster card remains visible before any proposal is prepared', async () => {
  global.fetch = jest.fn(() => {
    throw new Error('a parent-owned warm roster must not issue its own roster or provider request');
  });

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl={null}
      proposalKey={null}
      displayOnly
      rosterSnapshot={{
        requestId: REQ,
        authorityState: 'cached',
        data: {
          active: [applicantCandidate],
          excluded: [],
          ineligible: [],
          blocked: [],
          handled: [],
          savedKeys: [],
          allNames: [applicantCandidate.name],
        },
      }}
    />,
  );

  expect(await screen.findByText(applicantCandidate.name)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an embedded cold search fails closed until applicant inputs are explicitly ready', async () => {
  const rosterSnapshot = {
    requestId: REQ,
    authorityState: 'current',
    data: {
      active: [], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [],
    },
  };
  global.fetch = jest.fn((url) => {
    if (String(url) === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${url}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob"
      proposalKey="proposal"
      rosterSnapshot={rosterSnapshot}
      applicantInputsReady={false}
    />,
  );

  const blocked = await screen.findByRole('button', { name: 'Load applicant suggestions first' });
  expect(blocked).toBeDisabled();
  expect(screen.getByText(/Load applicant suggestions before running a search/i)).toBeInTheDocument();
  fireEvent.click(blocked);
  expect(global.fetch).not.toHaveBeenCalledWith(
    '/api/reviewer-finder/analyze',
    expect.objectContaining({ method: 'POST' }),
  );

  rerender(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob"
      proposalKey="proposal"
      rosterSnapshot={rosterSnapshot}
      applicantInputsReady
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviewer-finder/analyze',
    expect.objectContaining({ method: 'POST' }),
  ));
});

test('restored incomplete PubMed COI checks remain selectable but show one compact warning', async () => {
  const incompleteCandidate = {
    ...generatedCandidate,
    candidateKey: 'candidate:partial-coi',
    name: 'Partially Checked Reviewer',
    coauthorCheckStatus: 'incomplete',
    coauthorCheckFailures: [{
      proposalAuthor: 'Proposal Author',
      status: 429,
      reason: 'rate_limited',
    }],
  };
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [incompleteCandidate],
        excluded: [],
        ineligible: [],
        allNames: [incompleteCandidate.name],
      }));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);

  expect(await screen.findByText(
    /PubMed coauthor checks were incomplete after automatic retries for Partially Checked Reviewer/i
  )).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${incompleteCandidate.name}`)).toBeInTheDocument();
});

test('a handled suggestion-anchored roster row renders only in the Already handled summary with navigation', async () => {
  const onNavigate = jest.fn();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [],
        excluded: [],
        ineligible: [],
        handled: [{
          suggestionId: '22222222-2222-2222-2222-222222222222',
          candidateKey: 'suggestion:22222222-2222-2222-2222-222222222222',
          name: 'Already Invited Search Result',
          stage: 'invited',
        }],
        allNames: ['Already Invited Search Result'],
      }));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob"
      proposalKey="proposal"
      onNavigate={onNavigate}
    />,
  );

  expect(await screen.findByText('Already handled')).toBeInTheDocument();
  expect(screen.getByText('Already Invited Search Result')).toBeInTheDocument();
  expect(screen.queryByLabelText('Select Already Invited Search Result')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Track' }));
  expect(onNavigate).toHaveBeenCalledWith('track');
});

test('a declined handled row navigates to Removed instead of Track', async () => {
  const onNavigate = jest.fn();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [],
        excluded: [],
        ineligible: [],
        handled: [{
          suggestionId: '22222222-2222-2222-2222-222222222223',
          candidateKey: 'suggestion:22222222-2222-2222-2222-222222222223',
          name: 'Declined Reviewer',
          stage: 'declined',
        }],
        allNames: ['Declined Reviewer'],
      }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" onNavigate={onNavigate} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Open Removed' }));
  expect(onNavigate).toHaveBeenCalledWith('candidates');
});

test('a failed authoritative roster load blocks search until an explicit retry succeeds', async () => {
  let attempts = 0;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      attempts += 1;
      if (attempts === 1) return Promise.resolve(response({ error: 'failed' }, false, 500));
      return Promise.resolve(response({
        success: true,
        active: [],
        excluded: [],
        ineligible: [],
        blocked: [],
        handled: [],
        allNames: [],
      }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);

  expect(await screen.findByText(/Reviewer engagement could not be reconciled/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Run reviewer search' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry reviewer state' }));
  expect(await screen.findByRole('button', { name: 'Run reviewer search' })).toBeEnabled();
  expect(attempts).toBe(2);
});

test('a completed unresolved applicant run offers a manual applicant-suggestion update', async () => {
  const suggestionId = '33333333-3333-3333-3333-333333333333';
  const unresolvedApplicant = {
    ...applicantCandidate,
    candidateKey: `suggestion:${suggestionId}`,
    suggestionId,
    email: null,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
    needsIdentification: true,
    applicantEnrichmentCacheVersion: null,
  };
  const resolvedApplicant = {
    ...unresolvedApplicant,
    email: 'applicant@example.edu',
    identityStatus: 'probable',
    verificationStatus: 'verified',
    needsIdentification: false,
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [unresolvedApplicant],
        excluded: [],
        ineligible: [],
        allNames: [unresolvedApplicant.name],
      }));
    }
    if (target === '/api/workbench/enrich-recommended' && options.method === 'POST') {
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_res, onEvent) => {
    onEvent({ event: 'complete', data: { recommended: [resolvedApplicant] } });
  });

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob"
      proposalKey="proposal"
      recommended={[{ suggestionId, name: unresolvedApplicant.name }]}
    />,
  );

  const retry = await screen.findByRole('button', { name: 'Verify applicant suggestions' });
  expect(global.fetch).not.toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  );
  fireEvent.click(retry);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  ));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update applicant suggestions' })).toBeInTheDocument());
  expect(screen.getByText(/1 applicant-referred reviewer verified/i)).toBeInTheDocument();
});

test('a completed resolved applicant cache can be refreshed manually', async () => {
  const suggestionId = '44444444-4444-4444-4444-444444444444';
  const resolvedApplicant = {
    ...applicantCandidate,
    candidateKey: `suggestion:${suggestionId}`,
    suggestionId,
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [resolvedApplicant],
        excluded: [],
        ineligible: [],
        allNames: [resolvedApplicant.name],
      }));
    }
    if (target === '/api/workbench/enrich-recommended' && options.method === 'POST') {
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_res, onEvent) => {
    onEvent({ event: 'complete', data: { recommended: [resolvedApplicant] } });
  });

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob"
      proposalKey="proposal"
      recommended={[{ suggestionId, name: resolvedApplicant.name }]}
    />,
  );

  const update = await screen.findByRole('button', { name: 'Update applicant suggestions' });
  expect(global.fetch).not.toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  );

  fireEvent.click(update);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  ));
  await waitFor(() => expect(screen.getByText(/1 applicant-referred reviewer verified/i)).toBeInTheDocument());
});

test('a refreshed Blob URL for the same exact proposal key does not rerun applicant enrichment', async () => {
  const suggestionId = '55555555-5555-5555-5555-555555555555';
  const resolvedApplicant = {
    ...applicantCandidate,
    candidateKey: `suggestion:${suggestionId}`,
    suggestionId,
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [resolvedApplicant],
        excluded: [],
        ineligible: [],
        savedKeys: [],
        allNames: [resolvedApplicant.name],
      }));
    }
    if (target === '/api/workbench/enrich-recommended' && options.method === 'POST') {
      throw new Error('same-file refresh must not enrich');
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  const recommended = [{ suggestionId, name: resolvedApplicant.name }];
  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob-first-load"
      proposalKey="proposal"
      recommended={recommended}
    />,
  );
  await screen.findByRole('button', { name: 'Update applicant suggestions' });

  rerender(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob-after-refresh"
      proposalKey="proposal"
      recommended={recommended}
    />,
  );
  await waitFor(() => expect(global.fetch.mock.calls.filter(
    ([url]) => String(url).includes('/api/workbench/reviewer-roster?'),
  )).toHaveLength(2));
  expect(global.fetch).not.toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('labels restored generated rows and removes only the scoped previous results', async () => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [generatedCandidate, applicantCandidate],
        excluded: [],
        allNames: [generatedCandidate.name, applicantCandidate.name, 'Saved Reviewer'],
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return Promise.resolve(response({
        success: true,
        removed: 1,
        removedKeys: [generatedCandidate.candidateKey],
        active: [applicantCandidate],
        excluded: [],
        allNames: [applicantCandidate.name, 'Saved Reviewer'],
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);

  expect(await screen.findByText('Previously found')).toBeInTheDocument();
  expect(screen.getByText(/1 candidate below was restored from an earlier search/i)).toBeInTheDocument();
  expect(screen.getByText('Applicant recommended')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));

  await waitFor(() => expect(screen.queryByText(generatedCandidate.name)).not.toBeInTheDocument());
  expect(screen.getByText(applicantCandidate.name)).toBeInTheDocument();
  const removeCall = global.fetch.mock.calls.find(([url, options]) => (
    url === '/api/workbench/reviewer-roster'
      && options?.method === 'PATCH'
      && JSON.parse(options.body).action === 'remove_previous_results'
  ));
  expect(removeCall).toBeTruthy();
  expect(JSON.parse(removeCall[1].body)).toMatchObject({
    requestId: REQ,
    action: 'remove_previous_results',
    candidateRefs: [{
      candidateKey: expect.any(String),
      updatedAt: generatedCandidate.rosterUpdatedAt,
    }],
  });
});

test('removal blocks a same-request search until its refreshed roster arrives', async () => {
  const removal = deferred();
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [generatedCandidate],
        excluded: [],
        allNames: [generatedCandidate.name],
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return removal.promise;
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  await screen.findByText(generatedCandidate.name);
  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));

  expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();

  await act(async () => {
    removal.resolve(response({
      success: true,
      removed: 1,
      removedKeys: [generatedCandidate.candidateKey],
      active: [],
      excluded: [],
      allNames: [],
    }));
    await removal.promise;
  });
});

test('a search blocks prior-result removal until its roster write settles', async () => {
  const rosterWrite = deferred();
  const freshCandidate = {
    ...generatedCandidate,
    candidateKey: 'candidate:fresh',
    name: 'Fresh Reviewer',
    email: 'fresh@example.edu',
    addressTrustReceipt: addressTrustReceipt('fresh@example.edu'),
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [generatedCandidate],
        excluded: [],
        allNames: [generatedCandidate.name],
      }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return rosterWrite.promise;
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } },
      });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [freshCandidate], unverified: [] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [freshCandidate] } });
    });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const runButton = await screen.findByRole('button', { name: 'Run reviewer search' });
  fireEvent.click(runButton);

  await screen.findByLabelText(`Select ${freshCandidate.name}`);
  expect(screen.getByRole('button', { name: 'Remove previous results' })).toBeDisabled();

  await act(async () => {
    rosterWrite.resolve(response({ success: true, recorded: 1 }));
    await rosterWrite.promise;
  });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove previous results' })).toBeEnabled();
  });
});

test('a rejected stale roster write cannot change the newly selected request phase', async () => {
  const requestB = '22222222-2222-2222-2222-222222222222';
  const rosterWrite = deferred();
  const freshCandidate = {
    ...generatedCandidate,
    candidateKey: 'candidate:fresh',
    name: 'Fresh Reviewer',
    email: 'fresh@example.edu',
    addressTrustReceipt: addressTrustReceipt('fresh@example.edu'),
  };
  const requestBCandidate = {
    ...generatedCandidate,
    candidateKey: 'candidate:request-b',
    name: 'Request B Reviewer',
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      const active = target.includes(requestB) ? [requestBCandidate] : [generatedCandidate];
      return Promise.resolve(response({
        success: true,
        active,
        excluded: [],
        allNames: active.map((candidate) => candidate.name),
      }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return rosterWrite.promise;
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } },
      });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [freshCandidate], unverified: [] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [freshCandidate] } });
    });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByLabelText(`Select ${freshCandidate.name}`);

  await act(async () => {
    rerender(
      <ReviewerSearchSection requestId={requestB} blobUrl="blob-b" proposalKey="proposal-b" />
    );
  });
  await screen.findByText(requestBCandidate.name);

  await act(async () => {
    rosterWrite.reject(new Error('network dropped'));
    await rosterWrite.promise.catch(() => {});
  });

  expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeInTheDocument();
  expect(screen.getByText(requestBCandidate.name)).toBeInTheDocument();
});

test('a retained row stays selected when only another submitted key is deleted', async () => {
  const deletedCandidate = {
    ...generatedCandidate,
    candidateKey: 'candidate:deleted',
    name: 'Deleted Prior Reviewer',
  };
  const retainedCandidate = {
    ...generatedCandidate,
    candidateKey: 'candidate:retained',
    name: 'Concurrently Refreshed Reviewer',
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [deletedCandidate, retainedCandidate],
        excluded: [],
        allNames: [deletedCandidate.name, retainedCandidate.name],
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return Promise.resolve(response({
        success: true,
        removed: 1,
        removedKeys: [deletedCandidate.candidateKey],
        active: [{
          ...retainedCandidate,
          rosterUpdatedAt: '2026-07-19T16:05:00.000Z',
        }],
        excluded: [],
        allNames: [retainedCandidate.name],
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const retainedCheckbox = await screen.findByLabelText(`Select ${retainedCandidate.name}`);
  fireEvent.click(retainedCheckbox);
  expect(retainedCheckbox).toBeChecked();

  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));

  await waitFor(() => expect(screen.queryByText(deletedCandidate.name)).not.toBeInTheDocument());
  expect(screen.getByLabelText(`Select ${retainedCandidate.name}`)).toBeChecked();
});

test('continues after a terminal discovery read failure when the complete ranked result was received', async () => {
  const freshCandidate = {
    ...generatedCandidate,
    name: 'Fresh Reviewer',
    email: 'fresh@example.edu',
    addressTrustReceipt: addressTrustReceipt('fresh@example.edu'),
  };

  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({ success: true, active: [], excluded: [], allNames: [] }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } },
      });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [freshCandidate], unverified: [] } });
      throw new Error('Load failed');
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [freshCandidate] } });
    });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const runButton = await screen.findByRole('button', { name: 'Run reviewer search' });

  await act(async () => {
    fireEvent.click(runButton);
  });

  expect(await screen.findByLabelText(`Select ${freshCandidate.name}`)).toBeInTheDocument();
  expect(screen.queryByText('Load failed')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/reviewer-roster', expect.objectContaining({
    method: 'POST',
  }));
});

test('a late removal response cannot overwrite a newly selected request', async () => {
  const requestB = '22222222-2222-2222-2222-222222222222';
  const requestBCandidate = {
    ...generatedCandidate,
    name: 'Request B Reviewer',
    email: 'request-b@example.edu',
  };
  const removal = deferred();

  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      if (target.includes(REQ)) {
        return Promise.resolve(response({
          success: true,
          active: [generatedCandidate],
          excluded: [],
          allNames: [generatedCandidate.name],
        }));
      }
      if (target.includes(requestB)) {
        return Promise.resolve(response({
          success: true,
          active: [requestBCandidate],
          excluded: [],
          allNames: [requestBCandidate.name],
        }));
      }
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return removal.promise;
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ} blobUrl="blob-a" proposalKey="proposal-a" />
  );
  await screen.findByText(generatedCandidate.name);
  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));

  await act(async () => {
    rerender(
      <ReviewerSearchSection requestId={requestB} blobUrl="blob-b" proposalKey="proposal-b" />
    );
  });
  await screen.findByText(requestBCandidate.name);

  await act(async () => {
    removal.resolve(response({
      success: true,
      removed: 1,
      active: [],
      excluded: [],
      allNames: [],
    }));
    await removal.promise;
  });

  expect(screen.getByText(requestBCandidate.name)).toBeInTheDocument();
  expect(screen.queryByText(/previous search result removed/i)).not.toBeInTheDocument();
});

test('fails closed with stage-specific guidance when the discovery stream breaks before a ranked result arrives', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [generatedCandidate],
        excluded: [],
        allNames: [generatedCandidate.name],
      }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } },
      });
    })
    .mockRejectedValueOnce(new Error('Load failed'));

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const runButton = await screen.findByRole('button', { name: 'Run reviewer search' });
  fireEvent.click(runButton);

  expect(await screen.findByText('The candidate discovery connection was interrupted before results arrived. Please run the search again.')).toBeInTheDocument();
  expect(screen.queryByText('Load failed')).not.toBeInTheDocument();
  expect(screen.getByText(/previously found candidates below are unchanged/i)).toBeInTheDocument();
  expect(screen.getByText(generatedCandidate.name)).toBeInTheDocument();
});

test('replaces a raw analysis stream transport error with stage-specific retry guidance', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({ success: true, active: [], excluded: [], allNames: [] }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  readSseStream.mockRejectedValueOnce(new Error('Load failed'));

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const runButton = await screen.findByRole('button', { name: 'Run reviewer search' });
  fireEvent.click(runButton);

  expect(await screen.findByText('The proposal analysis connection was interrupted before results arrived. Please run the search again.')).toBeInTheDocument();
  expect(screen.queryByText('Load failed')).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalledWith('/api/reviewer-finder/discover', expect.anything());
});

test('replaces a raw browser fetch error before analysis starts with retry guidance', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({ success: true, active: [], excluded: [], allNames: [] }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.reject(new Error('Load failed'));
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  const runButton = await screen.findByRole('button', { name: 'Run reviewer search' });
  fireEvent.click(runButton);

  expect(await screen.findByText('The reviewer search connection was interrupted before results arrived. Please run the search again.')).toBeInTheDocument();
  expect(screen.queryByText('Load failed')).not.toBeInTheDocument();
  expect(readSseStream).not.toHaveBeenCalled();
});

test('a model refusal is shown as non-retryable guidance', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [],
        excluded: [],
        allNames: [],
      }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  readSseStream.mockImplementationOnce(async (_response, onEvent) => {
    onEvent({
      event: 'error',
      data: {
        status: 'analysis_refused',
        retryable: false,
        message: 'The analysis model declined this request.',
      },
    });
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('The analysis model declined this request.')).toBeInTheDocument();
  expect(screen.getByText(/This proposal needs an alternate analysis path/i)).toBeInTheDocument();
  expect(screen.queryByText(/Use Try again to rerun the analysis/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Alternate analysis required' })).toBeDisabled();
});

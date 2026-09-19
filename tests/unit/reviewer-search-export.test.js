/**
 * @jest-environment jsdom
 *
 * Stage 8/P8 export characterization for the public ReviewerSearchSection
 * facade. Stage0 already covers stale/unmounted export lifecycle and lock
 * behavior; these cases focus on the DTO boundary and download presentation.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { isCandidateSelectable } from '../../shared/components/reviewers/reviewer-search-logic';

jest.mock('../../shared/components/reviewers/reviewer-search-logic', () => {
  const actual = jest.requireActual('../../shared/components/reviewers/reviewer-search-logic');
  return { ...actual, isCandidateSelectable: jest.fn(actual.isCandidateSelectable) };
});


const REQUEST_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

function response(body, {
  ok = true,
  status = ok ? 200 : 500,
  filename = null,
} = {}) {
  return {
    ok,
    status,
    json: async () => body,
    blob: async () => new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    headers: {
      get: (name) => name === 'Content-Disposition' && filename
        ? `attachment; filename="${filename}"`
        : '',
    },
  };
}

function roster(active, excluded = []) {
  return response({
    success: true,
    active,
    excluded,
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: [...active, ...excluded].map((candidate) => candidate.name),
  });
}

function candidate(name, overrides = {}) {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.edu`;
  return {
    name,
    affiliation: 'Department of Chemistry, Example University',
    email,
    emailSource: 'pubmed',
    emailPersistAllowed: true,
    addressTrustReceipt: {
      receiptId: `receipt-${name}`,
      personConfirmed: true,
      email,
    },
    identityStatus: 'probable',
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
    ...overrides,
  };
}

function exportPayload() {
  const call = global.fetch.mock.calls.find(([url]) => url === '/api/workbench/export-candidates');
  expect(call).toBeTruthy();
  return JSON.parse(call[1].body);
}

let originalCreateObjectURL;
let originalRevokeObjectURL;
let originalAnchorClick;

beforeEach(() => {
  jest.clearAllMocks();
  isCandidateSelectable.mockImplementation(jest.requireActual('../../shared/components/reviewers/reviewer-search-logic').isCandidateSelectable);
  originalCreateObjectURL = URL.createObjectURL;
  originalRevokeObjectURL = URL.revokeObjectURL;
  originalAnchorClick = HTMLAnchorElement.prototype.click;
  window.confirm = jest.fn(() => true);
  global.fetch = jest.fn((url) => {
    if (String(url).startsWith('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(roster([]));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else delete URL.createObjectURL;
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
  else delete URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  delete window.confirm;
  jest.restoreAllMocks();
});

test('exports only selected selectable rows and preserves top-level/enrichment fallback fields', async () => {
  const topLevel = candidate('Dr Top Level', {
    email: 'top-level@example.edu',
    addressTrustReceipt: {
      receiptId: 'receipt-top-level',
      personConfirmed: true,
      email: 'top-level@example.edu',
    },
    orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
    googleScholarUrl: 'https://scholar.google.com/citations?user=real-profile',
    expertiseAreas: ['catalysis', 'surface chemistry'],
    hIndex: 31,
    publications: [{ title: 'One' }],
  });
  const enrichmentFallback = candidate('Dr Enrichment Fallback', {
    email: undefined,
    emailSource: undefined,
    emailPersistAllowed: undefined,
    addressTrustReceipt: {
      receiptId: 'receipt-fallback',
      personConfirmed: true,
      email: 'fallback@example.edu',
    },
    contactEnrichment: {
      email: 'fallback@example.edu',
      emailSource: 'orcid',
      emailPersistAllowed: true,
      orcidUrl: 'https://orcid.org/0000-0002-1825-0098',
      googleScholarUrl: 'https://scholar.google.com/citations?view_op=search_authors&mauthors=Dr%20Enrichment%20Fallback',
      hIndex: 19,
    },
    publications: [{ title: 'One' }, { title: 'Two' }],
  });
  const unsafe = candidate('Dr Unsafe Row', {
    addressVerificationRequired: true,
  });
  const unselected = candidate('Dr Unselected Row');
  const excluded = candidate('Dr Excluded Row');
  global.fetch.mockImplementation((url, options = {}) => {
    if (String(url).startsWith('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(roster([topLevel, enrichmentFallback, unsafe, unselected], [excluded]));
    }
    if (url === '/api/workbench/export-candidates' && options.method === 'POST') {
      return Promise.resolve(response({}, { filename: 'reviewers.xlsx' }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  URL.createObjectURL = jest.fn(() => 'blob:reviewers');
  URL.revokeObjectURL = jest.fn();
  HTMLAnchorElement.prototype.click = jest.fn();

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-url" proposalKey="proposal-key" />);

  expect(await screen.findByText(topLevel.name)).toBeInTheDocument();
  fireEvent.click(await screen.findByLabelText(`Select ${topLevel.name}`));
  fireEvent.click(screen.getByLabelText(`Select ${enrichmentFallback.name}`));
  expect(screen.queryByLabelText(`Select ${unsafe.name}`)).not.toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${unselected.name}`)).toBeInTheDocument();
  expect(screen.getByText(/Excluded \(1\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Export 2 to Excel/i }));

  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  const payload = exportPayload();
  expect(payload.requestId).toBe(REQUEST_ID);
  expect(payload.candidates).toHaveLength(2);
  expect(payload.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: topLevel.name,
      email: 'top-level@example.edu',
      orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
      scholarUrl: 'https://scholar.google.com/citations?user=real-profile',
      hasRealScholar: true,
      keywords: 'catalysis, surface chemistry',
      hIndex: 31,
      publicationCount5yr: 1,
    }),
    expect.objectContaining({
      name: enrichmentFallback.name,
      email: 'fallback@example.edu',
      orcidUrl: 'https://orcid.org/0000-0002-1825-0098',
      scholarUrl: 'https://scholar.google.com/citations?view_op=search_authors&mauthors=Dr%20Enrichment%20Fallback',
      hasRealScholar: false,
      hIndex: 19,
      publicationCount5yr: 2,
    }),
  ]));
  expect(payload.candidates.map((row) => row.name)).not.toEqual(expect.arrayContaining([
    unsafe.name,
    unselected.name,
    excluded.name,
  ]));
});

test('uses the fallback filename and cleans up the temporary download anchor and object URL', async () => {
  const selected = candidate('Dr Download Cleanup');
  let clickedDownload;
  global.fetch.mockImplementation((url, options = {}) => {
    if (String(url).startsWith('/api/workbench/reviewer-roster?')) return Promise.resolve(roster([selected]));
    if (url === '/api/workbench/export-candidates' && options.method === 'POST') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${url}`);
  });
  URL.createObjectURL = jest.fn(() => 'blob:fallback');
  URL.revokeObjectURL = jest.fn();
  HTMLAnchorElement.prototype.click = jest.fn(function click() {
    clickedDownload = { href: this.href, download: this.download };
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-url" />);
  fireEvent.click(await screen.findByLabelText(`Select ${selected.name}`));
  fireEvent.click(screen.getByRole('button', { name: /Export 1 to Excel/i }));

  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fallback'));
  expect(clickedDownload).toEqual({ href: 'blob:fallback', download: 'reviewer-candidates.xlsx' });
  expect(document.body.querySelector('a[download="reviewer-candidates.xlsx"]')).not.toBeInTheDocument();
});

test('surfaces export failure independently while preserving the selected candidate view', async () => {
  const selected = candidate('Dr Export Failure');
  global.fetch.mockImplementation((url, options = {}) => {
    if (String(url).startsWith('/api/workbench/reviewer-roster?')) return Promise.resolve(roster([selected]));
    if (url === '/api/workbench/export-candidates' && options.method === 'POST') {
      return Promise.resolve(response({ error: 'Exporter offline' }, { ok: false, status: 503 }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-url" />);
  fireEvent.click(await screen.findByLabelText(`Select ${selected.name}`));
  fireEvent.click(screen.getByRole('button', { name: /Export 1 to Excel/i }));

  expect(await screen.findByText('Export failed: Exporter offline')).toBeInTheDocument();
  expect(screen.getByText(selected.name)).toBeInTheDocument();
  expect(screen.getByLabelText(`Select ${selected.name}`)).toBeChecked();
  expect(screen.getByRole('button', { name: /Export 1 to Excel/i })).toBeEnabled();
});


test('export rechecks a selected row after it becomes unselectable', async () => {
  const row = candidate('Previously selectable');
  global.fetch.mockImplementation((url) => {
    if (String(url).startsWith('/api/workbench/reviewer-roster?')) return Promise.resolve(roster([row]));
    if (url === '/api/workbench/export-candidates') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${url}`);
  });
  URL.createObjectURL = jest.fn(() => 'blob:must-not-download');
  URL.revokeObjectURL = jest.fn();
  HTMLAnchorElement.prototype.click = jest.fn();
  const props = { requestId: REQUEST_ID, blobUrl: 'blob-url' };
  const { rerender } = render(<ReviewerSearchSection {...props} />);
  fireEvent.click(await screen.findByLabelText(`Select ${row.name}`));
  expect(screen.getByRole('button', { name: 'Export 1 to Excel' })).toBeEnabled();
  const realSelectable = jest.requireActual('../../shared/components/reviewers/reviewer-search-logic').isCandidateSelectable;
  isCandidateSelectable.mockImplementation((candidate) => candidate.name !== row.name && realSelectable(candidate));
  rerender(<ReviewerSearchSection {...props} />);
  // The selected Set survives same-context reclassification. Export must still
  // recheck readiness rather than treating the old selection as authority.
  const exportButton = screen.getByRole('button', { name: 'Export 1 to Excel' });
  expect(exportButton).toBeEnabled();
  await act(async () => { fireEvent.click(exportButton); });
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/workbench/export-candidates')).toHaveLength(0);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

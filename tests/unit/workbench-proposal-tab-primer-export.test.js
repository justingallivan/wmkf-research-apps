/**
 * The Field Primer "Export PDF" affordance on the Workbench Proposal tab
 * (S493). Proves the button is gated on a stored primer, that it hands the
 * renderer the envelope plus request identity, and that a renderer failure
 * surfaces to the user instead of failing silently.
 *
 * The two PDF modules are loaded through dynamic `import()` in the component
 * (pdf-lib stays out of the main bundle), so they are mocked by module path.
 *
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProposalTab from '../../shared/components/workbench/ProposalTab';
import { generateFieldPrimerPdf, fieldPrimerPdfFilename } from '../../shared/utils/field-primer-pdf';
import { generateFieldPrimerDocx, fieldPrimerDocxFilename } from '../../shared/utils/field-primer-docx';
import { downloadPdf } from '../../shared/utils/pdf-export';

jest.mock('../../shared/utils/field-primer-pdf', () => ({
  generateFieldPrimerPdf: jest.fn(async () => new Uint8Array([1, 2, 3])),
  fieldPrimerPdfFilename: jest.fn(() => 'field-primer-1002852-2026-09-07.pdf'),
}));
jest.mock('../../shared/utils/field-primer-docx', () => ({
  generateFieldPrimerDocx: jest.fn(async () => new Blob(['docx'])),
  fieldPrimerDocxFilename: jest.fn(() => 'field-primer-1002852-2026-09-07.docx'),
}));
jest.mock('../../shared/utils/pdf-export', () => ({
  downloadPdf: jest.fn(),
}));

const REQUEST_ID = 'e5df0b46-3c43-f111-88b5-000d3a3065b8';

const ENVELOPE = {
  schema: 'field-primer/v1',
  generatedAt: '2026-09-07T20:20:00.000Z',
  model: 'claude-sonnet-5',
  runId: 'run-abc',
  primer: { field_overview: 'ADP-ribosylation biology.' },
};

// Mirrors the real resolveWorkbenchRequest response shape: `institution` is a
// TOP-LEVEL context field and `proposalInfo` carries only pi/coPIs/abstract/
// amounts (lib/services/workbench/resolve-request-service.js). An earlier
// fixture put institution inside proposalInfo, which hid a wiring bug.
function context(fieldPrimer) {
  return {
    requestId: REQUEST_ID,
    requestNumber: '1002852',
    title: 'Structural principles of poly(ADP-ribose)',
    institution: 'Johns Hopkins University',
    proposalInfo: { coPIs: [], pi: 'Anthony Leung', abstract: null, requestedAmount: null, totalProjectBudget: null },
    aiContent: fieldPrimer === undefined ? {} : { fieldPrimer },
  };
}

// The DOCX path downloads a Blob through an anchor, so capture the click
// instead of letting jsdom navigate.
let anchorClicks;
beforeEach(() => {
  jest.clearAllMocks();
  anchorClicks = [];
  global.URL.createObjectURL = jest.fn(() => 'blob:primer');
  global.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
    anchorClicks.push({ href: this.href, download: this.download });
  });
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, reviewerMaterials: [], aiMaterials: [] }),
  }));
});

test('neither export button appears until a primer is stored', async () => {
  render(<ProposalTab context={context()} />);
  expect(await screen.findByRole('button', { name: 'Generate field primer' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Export PDF/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Export Word/ })).not.toBeInTheDocument();
});

test('exports Word with the same envelope and identity, and downloads it as a .docx', async () => {
  render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Export Word' }));

  await waitFor(() => expect(anchorClicks).toHaveLength(1));
  expect(generateFieldPrimerDocx).toHaveBeenCalledWith(ENVELOPE, {
    requestNumber: '1002852',
    title: 'Structural principles of poly(ADP-ribose)',
    institution: 'Johns Hopkins University',
    pi: 'Anthony Leung',
  });
  expect(fieldPrimerDocxFilename).toHaveBeenCalledWith(expect.objectContaining({ requestNumber: '1002852' }));
  expect(anchorClicks[0].download).toBe('field-primer-1002852-2026-09-07.docx');
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:primer');
  // The PDF path is untouched by a Word export.
  expect(generateFieldPrimerPdf).not.toHaveBeenCalled();
  expect(downloadPdf).not.toHaveBeenCalled();
});

test('an in-flight export disables both buttons, so two renders cannot overlap', async () => {
  let release;
  generateFieldPrimerDocx.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

  render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export Word' }));

  const preparing = await screen.findByRole('button', { name: 'Preparing Word…' });
  expect(preparing).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();

  await act(async () => {
    release(new Blob(['docx']));
    await Promise.resolve();
  });
  expect(screen.getByRole('button', { name: 'Export Word' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
});

test('a Word renderer failure names the Word document, not the PDF', async () => {
  generateFieldPrimerDocx.mockRejectedValueOnce(new Error('packer blew up'));
  render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Export Word' }));

  expect(await screen.findByText(/Could not build the Word document: packer blew up/)).toBeInTheDocument();
  expect(anchorClicks).toHaveLength(0);
});

test('exports the stored envelope with the request identity and downloads under a named file', async () => {
  render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);

  const button = await screen.findByRole('button', { name: 'Export PDF' });
  fireEvent.click(button);

  await waitFor(() => expect(downloadPdf).toHaveBeenCalled());
  // Every identity field the PDF header prints must arrive, each read from the
  // level the resolver actually puts it at.
  expect(generateFieldPrimerPdf).toHaveBeenCalledWith(ENVELOPE, {
    requestNumber: '1002852',
    title: 'Structural principles of poly(ADP-ribose)',
    institution: 'Johns Hopkins University',
    pi: 'Anthony Leung',
  });
  expect(fieldPrimerPdfFilename).toHaveBeenCalledWith(expect.objectContaining({ requestNumber: '1002852' }));
  expect(downloadPdf).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'field-primer-1002852-2026-09-07.pdf');
  // Regenerate stays available alongside the export.
  expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
});

test('a renderer failure is shown to the user and leaves the button usable', async () => {
  generateFieldPrimerPdf.mockRejectedValueOnce(new Error('font embed failed'));
  render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));

  expect(await screen.findByText(/Could not build the PDF: font embed failed/)).toBeInTheDocument();
  expect(downloadPdf).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
});

test('an export superseded by a request change neither downloads nor writes its error into the new request', async () => {
  let releaseRender;
  generateFieldPrimerPdf.mockImplementationOnce(() => new Promise((resolve, reject) => {
    releaseRender = { resolve, reject };
  }));

  const { rerender } = render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(releaseRender).toBeDefined());

  // The user moves to another request while the render is still pending. The
  // reset effect bumps the generation token.
  const other = { ...context(JSON.stringify({ ...ENVELOPE, runId: 'run-other' })), requestId: 'ffffffff-3c43-f111-88b5-000d3a3065b8', requestNumber: '1002999' };
  rerender(<ProposalTab context={other} />);
  // The new request gets a usable button immediately; the superseded render is
  // still pending but can no longer own this panel's state.
  await screen.findByRole('button', { name: 'Export PDF' });
  expect(screen.queryByRole('button', { name: 'Preparing PDF…' })).not.toBeInTheDocument();

  releaseRender.resolve(new Uint8Array([9, 9, 9]));
  await waitFor(() => expect(generateFieldPrimerPdf).toHaveBeenCalledTimes(1));
  expect(downloadPdf).not.toHaveBeenCalled();

  // A late FAILURE on a superseded export must not surface either. The
  // rejection is flushed inside act() so the state write it would perform has
  // actually run by the time we assert — asserting before the rejection
  // propagates would pass even with the guard removed.
  generateFieldPrimerPdf.mockImplementationOnce(() => new Promise((_r, reject) => { releaseRender = { reject }; }));
  fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(generateFieldPrimerPdf).toHaveBeenCalledTimes(2));
  rerender(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);
  await act(async () => {
    releaseRender.reject(new Error('late failure'));
    await Promise.resolve();
  });
  expect(screen.queryByText(/Could not build the PDF/)).not.toBeInTheDocument();
});

// Same request and same stored primer, but the parent re-renders with changed
// header metadata while the render is pending.
//
// The envelope/metadata pair CANNOT mix: `exportPdf` closes over the props of
// the render it was created in, so a later render's metadata is unreachable
// from an in-flight call. (The explicit `const meta` snapshot in exportPdf is
// defensive clarity, not the mechanism — reading `exportMeta` after the await
// behaves identically.) This test therefore documents that pairing rather than
// enforcing it.
//
// What it DOES enforce: a metadata change must not be treated as superseding
// the export. Invalidating the generation token on a metadata change cancels a
// legitimate download, and this test fails if anyone does that.
test('metadata changing mid-export cannot mix into the file, and does not cancel the export', async () => {
  let releaseRender;
  generateFieldPrimerPdf.mockImplementationOnce(() => new Promise((resolve) => { releaseRender = resolve; }));

  const { rerender } = render(<ProposalTab context={context(JSON.stringify(ENVELOPE))} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
  await waitFor(() => expect(releaseRender).toBeDefined());

  rerender(<ProposalTab context={{
    ...context(JSON.stringify(ENVELOPE)),
    title: 'A retitled proposal',
    institution: 'Some Other University',
    proposalInfo: { coPIs: [], pi: 'Someone Else' },
  }} />);

  await act(async () => {
    releaseRender(new Uint8Array([4, 5, 6]));
    await Promise.resolve();
  });

  // Rendered with the metadata as of the click, not the replacement.
  expect(generateFieldPrimerPdf).toHaveBeenCalledWith(ENVELOPE, {
    requestNumber: '1002852',
    title: 'Structural principles of poly(ADP-ribose)',
    institution: 'Johns Hopkins University',
    pi: 'Anthony Leung',
  });
  expect(generateFieldPrimerPdf).not.toHaveBeenCalledWith(ENVELOPE, expect.objectContaining({ title: 'A retitled proposal' }));
  // Not superseded: the request is the same, so the user still gets the file,
  // named from the same snapshot.
  expect(downloadPdf).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]), 'field-primer-1002852-2026-09-07.pdf');
  expect(fieldPrimerPdfFilename).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Structural principles of poly(ADP-ribose)',
  }));
});

test('a malformed stored primer offers generation, not export', async () => {
  render(<ProposalTab context={context('{"schema":"something-else"}')} />);
  expect(await screen.findByRole('button', { name: 'Generate field primer' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Export PDF/ })).not.toBeInTheDocument();
});

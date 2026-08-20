/**
 * @jest-environment jsdom
 *
 * GranteeDeliverableForm — the external grantee edit form. Covers the publish
 * waiver SUBMIT GATE (button disabled until the waiver is acknowledged AND the
 * required fields are present AND the signed render token is present), the
 * versioned waiver text, the direct private-Blob + JSON finalize contract, and
 * the thank-you state.
 *
 * As of S351 the inline checkbox was replaced by the scroll-gated PolicyAckModal
 * (see grantee-deliverable-form-waiver.test.js for the modal-wiring test).
 * PolicyAckModal is mocked at its boundary here too, so acknowledgment is
 * "click Read waiver, then click the mock's acknowledge button" instead of
 * "click the checkbox". The signed waiverToken (never the raw acknowledgment)
 * is still what's sent to the server.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GranteeDeliverableForm from '../../shared/components/external/GranteeDeliverableForm';
import { put } from '@vercel/blob/client';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

// Minimal stand-in exposing the two callbacks the form depends on (mirrors
// grantee-deliverable-form-waiver.test.js's mocking pattern).
jest.mock('../../shared/components/external/PolicyAckModal', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="policy-modal">
      <span>{props.policy?.body}</span>
      <button type="button" onClick={props.onAcknowledge}>mock-acknowledge</button>
      <button type="button" onClick={props.onClose}>mock-close</button>
    </div>
  ),
}));

// The editor's serializer/toolbar behavior is covered at its own boundary. These
// form tests keep a textarea-shaped stand-in so they can focus on submit gating
// and the exact Markdown passed into FormData.
jest.mock('../../shared/components/external/GranteeAbstractEditor', () => ({
  __esModule: true,
  default: ({ value, htmlValue, onChange, disabled, invalid, ariaLabel, toolbarLabel = 'Abstract formatting' }) => (
    <div>
      <div role="toolbar" aria-label={toolbarLabel} />
      <textarea
        aria-label={ariaLabel}
        aria-invalid={invalid ? 'true' : 'false'}
        data-html-value={htmlValue}
        value={value}
        readOnly={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));

const deliverable = {
  abstractFormatted: 'The team will measure the thing across a long enough sentence to be valid.',
  abstractApproved: null,
  caption: null,
  hasImage: false,
};
const WAIVER_POLICY = { title: 'Publication Consent Waiver', body: 'I, the grantee, consent to publication of the versioned waiver text.', versionId: 'v-1' };
const WAIVER_TOKEN = 'signed.render.token';

const renderForm = (props = {}) => render(
  <GranteeDeliverableForm
    token="tok"
    deliverable={deliverable}
    waiverPolicy={WAIVER_POLICY}
    waiverToken={WAIVER_TOKEN}
    {...props}
  />,
);

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'fig.png', { type: 'image/png' });
}

function unsupportedImageFile() {
  return new File([new Uint8Array([0x49, 0x49, 0x2a, 0x00])], 'figure.tif', { type: 'image/tiff' });
}

beforeEach(() => { put.mockReset().mockResolvedValue({ pathname: 'portal-staging/x' }); });
afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

const submitBtn = () => screen.getByRole('button', { name: /^submit$/i });

// Acknowledge via the mocked PolicyAckModal: open it, then click its acknowledge
// button — mirrors the real "Read waiver" → scroll-gate → acknowledge flow that
// grantee-deliverable-form-waiver.test.js exercises against the real modal wiring.
function acknowledgeWaiver() {
  fireEvent.click(screen.getByRole('button', { name: /read waiver/i }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-acknowledge' }));
}

test('renders the VERSIONED waiver text from waiverPolicy (not the hardcoded constant)', () => {
  renderForm();
  fireEvent.click(screen.getByRole('button', { name: /read waiver/i }));
  expect(screen.getByText(/consent to publication of the versioned waiver text/i)).toBeInTheDocument();
});

test('prefills the abstract and disables submit until waiver + fields are complete', () => {
  renderForm();
  expect(screen.getByLabelText('Abstract')).toHaveValue(deliverable.abstractFormatted);
  const submit = submitBtn();
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  expect(submit).toBeDisabled();

  acknowledgeWaiver();
  expect(submit).toBeEnabled();
});

test('caption uses the shared rich-text controls and the sanitized server seed', () => {
  renderForm({
    deliverable: {
      ...deliverable,
      caption: '*Escherichia coli* image',
      captionHtml: '<em>Escherichia coli</em> image',
    },
  });

  expect(screen.getByRole('toolbar', { name: 'Caption formatting' })).toBeInTheDocument();
  expect(screen.getByLabelText('Image caption')).toHaveValue('*Escherichia coli* image');
  expect(screen.getByLabelText('Image caption')).toHaveAttribute(
    'data-html-value',
    '<em>Escherichia coli</em> image',
  );
});

test('a missing render token keeps submit disabled even when everything else is complete (defensive gate)', () => {
  renderForm({ waiverToken: null });
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  expect(submitBtn()).toBeDisabled();
});

test('serialized Markdown over the shared limit blocks submit without truncating the edit', () => {
  renderForm();
  const overLimit = 'x'.repeat(20001);
  fireEvent.change(screen.getByLabelText('Abstract'), { target: { value: overLimit } });
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();

  expect(screen.getByLabelText('Abstract')).toHaveValue(overLimit);
  expect(screen.getByLabelText('Abstract')).toHaveAttribute('aria-invalid', 'true');
  expect(submitBtn()).toBeDisabled();
});

test('caption Markdown over the shared limit blocks submit without truncating the edit', () => {
  renderForm({ deliverable: { ...deliverable, hasImage: true } });
  const overLimit = 'x'.repeat(2001);
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: overLimit } });
  acknowledgeWaiver();

  expect(screen.getByLabelText('Image caption')).toHaveValue(overLimit);
  expect(screen.getByLabelText('Image caption')).toHaveAttribute('aria-invalid', 'true');
  expect(submitBtn()).toBeDisabled();
});

test('checking the waiver alone does NOT enable submit without an image', () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  acknowledgeWaiver();
  expect(submitBtn()).toBeDisabled();
});

test('unsupported image types are rejected before submit', () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [unsupportedImageFile()] } });
  acknowledgeWaiver();

  expect(screen.getByRole('alert')).toHaveTextContent(/jpeg, png, or webp/i);
  expect(screen.getByRole('alert')).toHaveTextContent(/tiff, heic, gif, word, and powerpoint/i);
  expect(submitBtn()).toBeDisabled();
});

test('an already-on-file image satisfies the image requirement (no re-upload needed)', () => {
  renderForm({ deliverable: { ...deliverable, hasImage: true, caption: 'Existing caption.' } });
  acknowledgeWaiver();
  expect(submitBtn()).toBeEnabled();
});

test('uploads directly to private Blob, finalizes with JSON, and shows the thank-you state', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        stagingId: 'stage-1',
        pathname: 'portal-staging/grantee/x',
        clientToken: 'client-token',
        contentType: 'image/png',
      }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  renderForm({ token: 'tok-123' });

  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  fireEvent.click(submitBtn());

  await waitFor(() => expect(screen.getByText(/your materials have been submitted/i)).toBeInTheDocument());

  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(fetchSpy.mock.calls[0][0]).toBe('/api/external/grantee/tok-123/upload-token');
  expect(put).toHaveBeenCalledWith(
    'portal-staging/grantee/x',
    expect.any(File),
    expect.objectContaining({ access: 'private', token: 'client-token', contentType: 'image/png' }),
  );
  expect(put.mock.calls[0][2].onUploadProgress).toEqual(expect.any(Function));
  const [url, opts] = fetchSpy.mock.calls[1];
  expect(url).toBe('/api/external/grantee/tok-123/submit');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(opts.body)).toEqual({
    editedAbstract: deliverable.abstractFormatted,
    caption: 'A figure.',
    waiverToken: WAIVER_TOKEN,
    stagingId: 'stage-1',
  });
});

test('a failed submit surfaces an error and re-enables the button', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Scan failed.' }) });
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  fireEvent.click(submitBtn());

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/scan failed/i));
  expect(submitBtn()).toBeEnabled();
});

test('a direct Blob SDK failure sends only closed, authenticated client telemetry', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true, stagingId: 'stage-1', pathname: 'portal-staging/grantee/x',
        clientToken: 'client-token', contentType: 'image/png',
      }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  put.mockRejectedValueOnce(new Error('SDK detail and signed URL must not be sent'));
  renderForm({ token: 'tok-123' });
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  fireEvent.click(submitBtn());

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/image could not be uploaded/i));
  const [url, opts] = fetchSpy.mock.calls[1];
  expect(url).toBe('/api/external/grantee/tok-123/upload-failure');
  const body = JSON.parse(opts.body);
  expect(body).toEqual({
    stage: 'blob_put', category: 'sdk_failure', httpStatus: null,
    declaredBytes: 4, contentType: 'image/png',
  });
  expect(opts.body).not.toMatch(/SDK detail|signed URL|fig\.png/i);
});

test('an expired staging row is cleared so the next submit re-uploads without losing edits', async () => {
  const tokenResponse = (id) => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true, stagingId: id, pathname: `portal-staging/grantee/${id}`,
      clientToken: `client-${id}`, contentType: 'image/png',
    }),
  });
  const fetchSpy = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(tokenResponse('stage-1'))
    .mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({ ok: false, reason: 'staging_expired' }) })
    .mockResolvedValueOnce(tokenResponse('stage-2'))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
  renderForm({ token: 'tok-123' });
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'Edited caption survives.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();

  fireEvent.click(submitBtn());
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/temporary image upload expired/i));
  expect(screen.getByLabelText('Image caption')).toHaveValue('Edited caption survives.');

  fireEvent.click(submitBtn());
  await waitFor(() => expect(screen.getByText(/your materials have been submitted/i)).toBeInTheDocument());
  expect(put).toHaveBeenCalledTimes(2);
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/upload-token'))).toHaveLength(2);
});

test('a server reason is translated into a useful submit error', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ ok: false, reason: 'image_invalid' }) });
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  fireEvent.click(submitBtn());

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be accepted/i));
  expect(screen.getByRole('alert')).toHaveTextContent(/tiff, heic, gif, word, or powerpoint/i);
  expect(submitBtn()).toBeEnabled();
});

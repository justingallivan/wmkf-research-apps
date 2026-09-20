/**
 * @jest-environment jsdom
 *
 * PoliciesSection — unique-label guidance in the publish form (S356, label_conflict
 * UX). Server-side immutability and the label_conflict outcome are covered by
 * tests/unit/policies-service.test.js; this is UI-only coverage that the form
 * steers staff toward a unique label BEFORE they hit the 409:
 *   - the label field defaults to a label not already used by a version
 *   - typing the active label shows the inline warning + suggestion
 *   - applying the suggestion clears the warning
 *
 * Build E (2026-09-10) rewrote the trigger from "Publish new version"/"Prefill
 * from active version" to "Edit policy"/"Reset to active version", and moved
 * the default prefill (title/body from the active version) onto form open
 * rather than behind a link — so the taken-label warning is now reached by
 * typing the active label directly, not by a prefill click.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PoliciesSection from '../../shared/components/admin/PoliciesSection';

const TODAY = new Date().toISOString().slice(0, 10);

function makeState({ versions }) {
  const active = versions.find(v => v.isActive) || null;
  return {
    slots: [{
      code: 'grantee-waiver',
      parentId: 'p-1',
      displayName: 'Grantee Publication Waiver',
      parentEtag: 'W/"1"',
      activeVersion: active && {
        id: active.id,
        versionLabel: active.versionLabel,
        title: active.title,
        body: active.body,
        effectiveDate: active.effectiveDate,
      },
      versions,
    }],
  };
}

function mockGet(state) {
  return jest.spyOn(global, 'fetch').mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => state }));
}

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

async function openForm() {
  await waitFor(() => expect(screen.getByText('Grantee Publication Waiver')).toBeInTheDocument());
  // The slot row is a closed disclosure by default; open it, then click "Edit policy".
  fireEvent.click(screen.getByText('Grantee Publication Waiver').closest('summary'));
  fireEvent.click(screen.getByRole('button', { name: /^edit policy$/i }));
}

const version = (label, extra = {}) => ({
  id: `v-${label}`, versionLabel: label, title: 'Waiver', body: 'x'.repeat(60),
  effectiveDate: '2026-07-01', statecode: 0, statuscode: 1,
  isActive: false, isResidue: false, ...extra,
});

describe('PoliciesSection — unique-label guidance', () => {
  test('label defaults to a -2 suffix when today\'s label is already a version', async () => {
    mockGet(makeState({ versions: [version(TODAY, { isActive: true })] }));
    render(<PoliciesSection />);
    await openForm();
    expect(screen.getByDisplayValue(`${TODAY}-2`)).toBeInTheDocument();
    expect(screen.queryByText(/already used by a published version/i)).not.toBeInTheDocument();
  });

  test('label defaults to today unchanged when no version uses it', async () => {
    mockGet(makeState({ versions: [version('2026-01-01', { isActive: true })] }));
    render(<PoliciesSection />);
    await openForm();
    expect(screen.getByLabelText(/version label/i)).toHaveValue(TODAY);
  });

  test('opening "Edit policy" prefills title and body from the active version', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    expect(screen.getByDisplayValue('Waiver Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('y'.repeat(60))).toBeInTheDocument();
  });

  test('typing the active label shows the warning; the suggestion button resolves it', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true }), version('v1-2')] }));
    render(<PoliciesSection />);
    await openForm();

    const labelInput = screen.getByLabelText(/version label/i);
    fireEvent.change(labelInput, { target: { value: 'v1' } });
    expect(screen.getByDisplayValue('v1')).toBeInTheDocument();
    expect(screen.getByText(/already used by a published version/i)).toBeInTheDocument();

    // v1 and v1-2 are taken → suggests v1-3
    fireEvent.click(screen.getByRole('button', { name: /use “v1-3”/i }));
    expect(screen.getByDisplayValue('v1-3')).toBeInTheDocument();
    expect(screen.queryByText(/already used by a published version/i)).not.toBeInTheDocument();
  });

  test('taken-label match is case-insensitive and trimmed, mirroring the server lookup', async () => {
    mockGet(makeState({ versions: [version('Spring-2026', { isActive: true })] }));
    render(<PoliciesSection />);
    await openForm();

    const input = screen.getByLabelText(/version label/i);
    fireEvent.change(input, { target: { value: '  spring-2026 ' } });
    expect(screen.getByText(/already used by a published version/i)).toBeInTheDocument();
  });

  test('"Reset to active version" restores the active title/body, today\'s date, and a fresh label suggestion', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Edited title' } });
    fireEvent.change(screen.getByLabelText(/body \(markdown\)/i), { target: { value: 'z'.repeat(70) } });
    fireEvent.change(screen.getByLabelText(/version label/i), { target: { value: 'v1' } });

    fireEvent.click(screen.getByRole('button', { name: /reset to active version/i }));

    expect(screen.getByDisplayValue('Waiver Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('y'.repeat(60))).toBeInTheDocument();
    expect(screen.getByLabelText(/version label/i)).toHaveValue(TODAY);
  });

  test('Publish opens a confirm panel with a diff and does not call fetch until confirmed; Back returns with values intact', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    global.fetch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    expect(screen.getByText(/published versions cannot be edited later/i)).toBeInTheDocument();
    expect(screen.getByText('Existing')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByDisplayValue('New title')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('confirming Publish calls the API exactly once with the submitted fields', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    const getSpy = global.fetch;
    render(<PoliciesSection />);
    await openForm();

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    getSpy.mockImplementation((url, opts) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'completed' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) });
    });

    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/admin/policies', expect.objectContaining({ method: 'POST' })));
    const postCalls = getSpy.mock.calls.filter(([, opts]) => opts?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(postCalls[0][1].body)).toMatchObject({ slotCode: 'grantee-waiver', title: 'New title' });
  });

  // T3 matrix (Stage 3, group A) ahead of migrating both fetch sites onto
  // shared/utils/api-request.js. fetchState (GET) branches on status before
  // reading the body (403 -> exact pinned message, plan §2.3); PublishForm's
  // submit (POST, PoliciesSection.js:363) is D1 PRESERVE — no ok check, reads
  // data.status regardless of HTTP status.
  test('(b) GET 403 shows "Admin access required" verbatim', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'ignored' }) });
    render(<PoliciesSection />);
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  test('(b) GET non-403 non-2xx shows the generic load failure, body never read', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('should not be called'); } });
    render(<PoliciesSection />);
    expect(await screen.findByText('Failed to load policies')).toBeInTheDocument();
  });

  test('(c) GET network rejection surfaces the rejection\'s own message', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));
    render(<PoliciesSection />);
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });

  test('(d) GET malformed 2xx body (strict, bare .json()) rejects into the same error state', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
    render(<PoliciesSection />);
    expect(await screen.findByText('bad json')).toBeInTheDocument();
  });

  test('(b) D1 fix: non-2xx {error} with no status field surfaces the server error message, not a blank banner', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    global.fetch.mockImplementationOnce((url, opts) => (opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Audit log unavailable' }) })
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText('Publishing failed. Try again; if it keeps failing, contact an administrator.')).toBeInTheDocument();
    expect(screen.getByText('Audit log unavailable')).toBeInTheDocument();
  });

  test('(b) D1 fix: non-2xx unparseable body (502) surfaces the fallback message, not a blank banner', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    global.fetch.mockImplementationOnce((url, opts) => (opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad gateway'); } })
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText('Publishing failed. Try again; if it keeps failing, contact an administrator.')).toBeInTheDocument();
    expect(screen.getByText('Request failed (502)')).toBeInTheDocument();
  });

  test('(b) POST: a well-formed non-2xx body (409 label_conflict) is read regardless of status (unchanged, not a D1 defect)', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    global.fetch.mockImplementationOnce((url, opts) => (opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ status: 'label_conflict', warnings: [] }) })
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText(/pick a new label/i)).toBeInTheDocument();
  });

  test('(c) POST: a network rejection is caught and rendered as a failed outcome', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    global.fetch.mockImplementationOnce((url, opts) => (opts?.method === 'POST'
      ? Promise.reject(new Error('network down'))
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText('Publishing failed. Try again; if it keeps failing, contact an administrator.')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
  });

  test('(d) POST: a malformed 2xx body (bare .json()) is caught and rendered as a failed outcome', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    global.fetch.mockImplementationOnce((url, opts) => (opts?.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText('Publishing failed. Try again; if it keeps failing, contact an administrator.')).toBeInTheDocument();
    expect(screen.getByText('bad json')).toBeInTheDocument();
  });

  test('(e) POST: a non-2xx unparseable body (502 gateway page) is rendered as a failed outcome, never silent', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    global.fetch.mockImplementationOnce((url, opts) => (opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } })
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    expect(await screen.findByText('Publishing failed. Try again; if it keeps failing, contact an administrator.')).toBeInTheDocument();
    expect(screen.getByText('Unexpected token < in JSON')).toBeInTheDocument();
  });

  test('request bytes: POST sends the same method/headers/body shape', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true, title: 'Waiver Title', body: 'y'.repeat(60) })] }));
    const getSpy = global.fetch;
    render(<PoliciesSection />);
    await openForm();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    getSpy.mockImplementation((url, opts) => (opts?.method === 'POST'
      ? Promise.resolve({ ok: true, json: async () => ({ status: 'completed' }) })
      : Promise.resolve({ ok: true, status: 200, json: async () => makeState({ versions: [version('v1', { isActive: true })] }) })));
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/admin/policies', expect.objectContaining({ method: 'POST' })));
    const postCall = getSpy.mock.calls.find(([, opts]) => opts?.method === 'POST');
    expect(postCall[1].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(postCall[1].body)).toMatchObject({ slotCode: 'grantee-waiver', title: 'New title', versionLabel: TODAY, parentEtag: 'W/"1"' });
  });
});

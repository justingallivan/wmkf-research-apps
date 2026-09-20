/**
 * @jest-environment jsdom
 *
 * T4 matrix for InviteEmailModal's migrated Stage 4 sites: campaign-timeline-
 * defaults, campaign-config, render-emails (request bytes + malformed 2xx),
 * my-candidates PATCH (mark manual invite sent), reviewer-address-trust
 * (verify + create repair request), update-abstract, and the sticky-timing
 * save (best-effort). :292 (invite-timing GET) is D1-preserve, unguarded, not
 * migrated here; :735 (send-emails) is the allowlisted SSE stream.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteEmailModal from '../../shared/components/reviewers/InviteEmailModal';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const CANDIDATES = [{ suggestionId: 'S1', name: 'Dr. Test Reviewer', email: 'reviewer@example.org' }];

function mockJson(data, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: async () => data };
}

const conflictedDraft = {
  suggestionId: 'S1',
  candidateName: 'Dr. Test Reviewer',
  candidateEmail: 'reviewer@example.org',
  skipped: 'address_conflict_pending',
  addressConflict: {
    storedEmail: 'reviewer@example.org',
    foundEmail: 'reviewer@new.example.org',
    reason: 'email_mismatch',
  },
};

const researchOnlyDraftWithLink = {
  suggestionId: 'S1',
  candidateName: 'Dr. Test Reviewer',
  candidateEmail: 'reviewer@example.org',
  skipped: 'email_research_only',
  emailConfidence: { action: 'research_only' },
  manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
};

const okDraft = {
  suggestionId: 'S1',
  candidateName: 'Dr. Test Reviewer',
  candidateEmail: 'reviewer@example.org',
  subject: 'Invitation',
  body: 'Body',
};

function baseHandlers({ renderEmails = mockJson({ drafts: [okDraft] }), campaignTimeline, campaignConfig, inviteTiming } = {}) {
  return async (url, options = {}) => {
    const u = String(url);
    if (u.startsWith('/api/user-preferences')) {
      if (options.method === 'POST') return mockJson({});
      return inviteTiming || mockJson({});
    }
    if (u === '/api/review-manager/campaign-timeline-defaults') {
      return campaignTimeline || mockJson({ timeline: {}, isDefault: true });
    }
    if (u.startsWith('/api/review-manager/campaign-config')) {
      return campaignConfig || mockJson({ config: {} });
    }
    if (u === '/api/review-manager/render-emails') return renderEmails;
    throw new Error(`Unexpected fetch: ${u}`);
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  window.confirm.mockRestore();
});

describe('render-emails (:388)', () => {
  test('T4 request bytes: exact method, headers, and body (minus signal)', async () => {
    global.fetch = jest.fn(baseHandlers());
    render(<InviteEmailModal candidates={CANDIDATES} settings={{ signature: 'PD' }} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    const call = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/render-emails');
    const [, init] = call;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      suggestionIds: ['S1'],
      templateType: 'invitation',
      template: { subject: '', body: '' },
      settings: { signature: 'PD' },
    });
  });

  test('T4 axis (d): a malformed 2xx body is treated as zero drafts (only read on the !ok path)', async () => {
    global.fetch = jest.fn(baseHandlers({
      renderEmails: { ok: true, status: 200, json: async () => { throw new Error('bad json'); } },
    }));
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    expect(await screen.findByRole('button', { name: /^send invitations$/i })).toBeDisabled();
    expect(screen.queryByText(/retrying is safe/i)).not.toBeInTheDocument();
  });
});

describe('campaign-timeline-defaults and campaign-config (:304, :315) — best-effort preview hydration', () => {
  test('a malformed 2xx campaign-timeline-defaults body is ignored, defaults stay put', async () => {
    global.fetch = jest.fn(baseHandlers({
      campaignTimeline: { ok: true, status: 200, json: async () => { throw new Error('bad json'); } },
    }));
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    // No crash, no visible error banner from timing hydration.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a non-2xx campaign-config body that fails to parse is ignored (best-effort), never throws to the UI', async () => {
    global.fetch = jest.fn(baseHandlers({
      campaignConfig: { ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } },
    }));
    render(<InviteEmailModal requestId="req-1" candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a campaign-timeline-defaults network rejection is ignored (best-effort)', async () => {
    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === '/api/review-manager/campaign-timeline-defaults') throw new Error('offline');
      return baseHandlers()(url, options);
    });
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('markManualInviteSent — my-candidates PATCH (:524)', () => {
  function renderWithResearchOnlyDraft(extraHandlers = {}) {
    global.fetch = jest.fn(baseHandlers({ renderEmails: mockJson({ drafts: [researchOnlyDraftWithLink] }) }));
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/reviewer-finder/my-candidates' && options?.method === 'PATCH') return extraHandlers.patch(url, options);
      return originalImpl(url, options);
    });
    const onSent = jest.fn();
    const onClose = jest.fn();
    return { onSent, onClose, view: render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={onClose} onSent={onSent} />) };
  }

  test('T4 request bytes: exact method, headers, and body; success calls onSent and onClose', async () => {
    const { onSent, onClose } = renderWithResearchOnlyDraft({ patch: () => Promise.resolve(mockJson({})) });
    fireEvent.click(await screen.findByRole('button', { name: /i sent it/i }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ invitedSuggestionIds: ['S1'] })));
    expect(onClose).toHaveBeenCalledTimes(1);
    const call = global.fetch.mock.calls.find(([url, o]) => url === '/api/reviewer-finder/my-candidates' && o?.method === 'PATCH');
    expect(call[1]).toEqual({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestionId: 'S1',
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      }),
    });
  });

  test('T4 axis (b): a non-2xx body surfaces its error verbatim', async () => {
    renderWithResearchOnlyDraft({ patch: () => Promise.resolve(mockJson({ error: 'record blew up' }, { ok: false, status: 500 })) });
    fireEvent.click(await screen.findByRole('button', { name: /i sent it/i }));
    expect(await screen.findByText('record blew up')).toBeInTheDocument();
  });

  test('T4 axis (c): a network rejection surfaces its message', async () => {
    renderWithResearchOnlyDraft({ patch: () => Promise.reject(new Error('offline')) });
    fireEvent.click(await screen.findByRole('button', { name: /i sent it/i }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('T4 axis (e): a non-2xx body that fails to parse falls back to the generic message, never silently', async () => {
    renderWithResearchOnlyDraft({ patch: () => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } }) });
    fireEvent.click(await screen.findByRole('button', { name: /i sent it/i }));
    expect(await screen.findByText('Could not record the manual invitation.')).toBeInTheDocument();
  });
});

describe('reviewer-address-trust verify (:579)', () => {
  function renderWithConflict(verifyHandler) {
    global.fetch = jest.fn(baseHandlers({ renderEmails: mockJson({ drafts: [conflictedDraft] }) }));
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/workbench/reviewer-address-trust') {
        const body = JSON.parse(options.body);
        if (body.action === 'verify_person_and_address') return verifyHandler(url, options);
      }
      return originalImpl(url, options);
    });
    return render(
      <InviteEmailModal requestId="req-1" candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />,
    );
  }

  async function fillAndSubmitVerify() {
    fireEvent.click(screen.getByRole('radio', { name: 'reviewer@new.example.org' }));
    fireEvent.change(screen.getByLabelText(/evidence link for dr\. test reviewer/i), {
      target: { value: 'https://example.org/corresponding-author' },
    });
    fireEvent.click(screen.getByRole('button', { name: /record verified address/i }));
  }

  test('T4 axis (b): a non-2xx body surfaces its error verbatim', async () => {
    renderWithConflict(() => Promise.resolve(mockJson({ error: 'verify blew up' }, { ok: false, status: 500 })));
    await screen.findByText(/resolve the stored-versus-found address/i);
    await fillAndSubmitVerify();
    expect(await screen.findByText('verify blew up')).toBeInTheDocument();
  });

  test('T4 axis (c): a network rejection surfaces its message', async () => {
    renderWithConflict(() => Promise.reject(new Error('offline')));
    await screen.findByText(/resolve the stored-versus-found address/i);
    await fillAndSubmitVerify();
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('T4 axis (e): a non-2xx body that fails to parse falls back to the generic message, never silently', async () => {
    renderWithConflict(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } }));
    await screen.findByText(/resolve the stored-versus-found address/i);
    await fillAndSubmitVerify();
    expect(await screen.findByText('Could not record the verification.')).toBeInTheDocument();
  });
});

describe('reviewer-address-trust create_repair_request (:609)', () => {
  function renderWithConflict(repairHandler) {
    global.fetch = jest.fn(baseHandlers({ renderEmails: mockJson({ drafts: [conflictedDraft] }) }));
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/workbench/reviewer-address-trust') {
        const body = JSON.parse(options.body);
        if (body.action === 'create_repair_request') return repairHandler(url, options);
      }
      return originalImpl(url, options);
    });
    return render(
      <InviteEmailModal requestId="req-1" candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />,
    );
  }

  test('T4 request bytes: exact method, headers, and body', async () => {
    renderWithConflict(() => Promise.resolve(mockJson({ success: true, message: 'Repair requested.' })));
    await screen.findByText(/resolve the stored-versus-found address/i);
    fireEvent.click(screen.getByRole('button', { name: /create repair request/i }));
    await screen.findByText('Repair requested.');
    const call = global.fetch.mock.calls.find(([url, o]) => url === '/api/workbench/reviewer-address-trust' && JSON.parse(o.body).action === 'create_repair_request');
    expect(call[1]).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'req-1',
        suggestionId: 'S1',
        action: 'create_repair_request',
        code: 'address_conflict_pending',
      }),
    });
  });

  test('pins a 200 body-level {success:false} to the generic failure message (never treated as ok)', async () => {
    renderWithConflict(() => Promise.resolve(mockJson({ success: false })));
    await screen.findByText(/resolve the stored-versus-found address/i);
    fireEvent.click(screen.getByRole('button', { name: /create repair request/i }));
    expect(await screen.findByText('Could not create a repair request.')).toBeInTheDocument();
  });

  test('T4 axis (b): a non-2xx body surfaces its error verbatim', async () => {
    renderWithConflict(() => Promise.resolve(mockJson({ error: 'repair blew up' }, { ok: false, status: 500 })));
    await screen.findByText(/resolve the stored-versus-found address/i);
    fireEvent.click(screen.getByRole('button', { name: /create repair request/i }));
    expect(await screen.findByText('repair blew up')).toBeInTheDocument();
  });

  test('T4 axis (c): a network rejection surfaces its message', async () => {
    renderWithConflict(() => Promise.reject(new Error('offline')));
    await screen.findByText(/resolve the stored-versus-found address/i);
    fireEvent.click(screen.getByRole('button', { name: /create repair request/i }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('T4 axis (e): a non-2xx body that fails to parse falls back to the generic message, never silently', async () => {
    renderWithConflict(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } }));
    await screen.findByText(/resolve the stored-versus-found address/i);
    fireEvent.click(screen.getByRole('button', { name: /create repair request/i }));
    expect(await screen.findByText('Could not create a repair request.')).toBeInTheDocument();
  });
});

describe('update-abstract (:648)', () => {
  const flaggedDraft = {
    suggestionId: 'S1',
    candidateName: 'Dr. Test Reviewer',
    candidateEmail: 'reviewer@example.org',
    subject: 'Invitation',
    body: 'Body',
    abstractFlagged: true,
    requestId: 'req-1',
    currentAbstract: 'Old abstract text.',
    reflowedAbstract: 'Old abstract text (reflowed).',
  };

  function renderWithFlaggedAbstract(saveHandler) {
    global.fetch = jest.fn(baseHandlers({ renderEmails: mockJson({ drafts: [flaggedDraft] }) }));
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/review-manager/update-abstract') return saveHandler(url, options);
      return originalImpl(url, options);
    });
    return render(
      <InviteEmailModal requestId="req-1" candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />,
    );
  }

  async function openEditorAndSave(newText = 'Fixed abstract text.') {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit abstract' }));
    const textarea = screen.getByDisplayValue('Old abstract text (reflowed).');
    fireEvent.change(textarea, { target: { value: newText } });
    fireEvent.click(screen.getByRole('button', { name: /save abstract/i }));
  }

  test('a 409 conflict re-renders previews and surfaces the fallback message', async () => {
    let renderCalls = 0;
    global.fetch = jest.fn(baseHandlers({ renderEmails: mockJson({ drafts: [flaggedDraft] }) }));
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/review-manager/render-emails') { renderCalls += 1; return mockJson({ drafts: [flaggedDraft] }); }
      if (u === '/api/review-manager/update-abstract') return mockJson({ error: 'stale' }, { ok: false, status: 409 });
      return originalImpl(url, options);
    });
    render(<InviteEmailModal requestId="req-1" candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await openEditorAndSave();
    await waitFor(() => expect(renderCalls).toBeGreaterThan(1));
    expect(await screen.findByText('stale')).toBeInTheDocument();
  });

  test('T4 axis (e): a non-2xx body that fails to parse falls back to the generic message, never silently', async () => {
    renderWithFlaggedAbstract(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } }));
    await openEditorAndSave();
    expect(await screen.findByText('Failed to save abstract')).toBeInTheDocument();
  });
});

describe('invite-timing GET (:293, D1-preserve, unguarded — not migrated here)', () => {
  test('T4 axis (a): a 2xx body with a value overlays the sticky respondOffsetDays', async () => {
    global.fetch = jest.fn(baseHandlers({ inviteTiming: mockJson({ value: { respondOffsetDays: 14 } }) }));
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    fireEvent.click(screen.getByText('Reviewer campaign timeline').closest('button'));
    expect(await screen.findByDisplayValue('14')).toBeInTheDocument();
  });

  test('T4 axis (b): a non-2xx {error} body is still read (unguarded, no ok check) and overlays timing as-is', async () => {
    global.fetch = jest.fn(baseHandlers({
      inviteTiming: mockJson({ error: 'nope', value: { respondOffsetDays: 21 } }, { ok: false, status: 400 }),
    }));
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    fireEvent.click(screen.getByText('Reviewer campaign timeline').closest('button'));
    expect(await screen.findByDisplayValue('21')).toBeInTheDocument();
  });

  test('T4 axis (c): a network rejection is swallowed; default respondOffsetDays (7) stays put', async () => {
    global.fetch = jest.fn(async (url, options) => {
      if (String(url).startsWith('/api/user-preferences') && options?.method !== 'POST') throw new Error('offline');
      return baseHandlers()(url, options);
    });
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    fireEvent.click(screen.getByText('Reviewer campaign timeline').closest('button'));
    expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
  });

  test('T4 axis (d): a malformed 2xx body falls back to {} (default respondOffsetDays stays put)', async () => {
    global.fetch = jest.fn(baseHandlers({
      inviteTiming: { ok: true, status: 200, json: async () => { throw new Error('bad json'); } },
    }));
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    fireEvent.click(screen.getByText('Reviewer campaign timeline').closest('button'));
    expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
  });

  test('T4 axis (e): an unparseable 502 body falls back to {} (default respondOffsetDays stays put)', async () => {
    global.fetch = jest.fn(baseHandlers({
      inviteTiming: { ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } },
    }));
    render(<InviteEmailModal candidates={CANDIDATES} settings={{}} onClose={jest.fn()} onSent={jest.fn()} />);
    await screen.findByDisplayValue('Invitation');
    fireEvent.click(screen.getByText('Reviewer campaign timeline').closest('button'));
    expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
  });
});

describe('sticky timing save (:706, intentional best-effort)', () => {
  test('a network rejection on save is swallowed; send still succeeds', async () => {
    global.fetch = jest.fn(baseHandlers());
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/user-preferences' && options?.method === 'POST') throw new Error('offline');
      if (u === '/api/review-manager/send-emails') return { ok: true, body: { getReader: () => ({ read: jest.fn() }) } };
      return originalImpl(url, options);
    });
    readSseStream.mockImplementation(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { sent: [{ suggestionId: 'S1', candidateName: 'Dr. Test Reviewer', emailId: 'e1' }], failed: [], skipped: [] } });
    });
    render(<InviteEmailModal candidates={CANDIDATES} settings={{ signature: 'PD' }} onClose={jest.fn()} onSent={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /send 1 invitation/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  test('a malformed 2xx body on save is swallowed (never read on the resolved path)', async () => {
    global.fetch = jest.fn(baseHandlers());
    const originalImpl = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options) => {
      const u = String(url);
      if (u === '/api/user-preferences' && options?.method === 'POST') {
        return { ok: true, status: 200, json: async () => { throw new Error('bad json'); } };
      }
      if (u === '/api/review-manager/send-emails') return { ok: true, body: { getReader: () => ({ read: jest.fn() }) } };
      return originalImpl(url, options);
    });
    readSseStream.mockImplementation(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { sent: [{ suggestionId: 'S1', candidateName: 'Dr. Test Reviewer', emailId: 'e1' }], failed: [], skipped: [] } });
    });
    render(<InviteEmailModal candidates={CANDIDATES} settings={{ signature: 'PD' }} onClose={jest.fn()} onSent={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /send 1 invitation/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

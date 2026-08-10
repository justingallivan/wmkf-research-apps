/**
 * @jest-environment jsdom
 *
 * AwardeeTab (chunk 3d) — staff orchestration: load recipients → generate
 * abstract → send invite. Drives the three grantee-deliverables endpoints.
 */
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import AwardeeTab from '../../shared/components/workbench/AwardeeTab';
import {
  GRANTEE_INVITE_SEED_BODY,
  GRANTEE_INVITE_SEED_SUBJECT,
} from '../../lib/seed/email-defaults/grantee-invite';

// AwardeeTab reads the logged-in PD's saved custom invite body + profile identity
// via useProfile. Mock the context so the component renders in isolation;
// mockPreferences/mockProfileId are mutable per-test (the "mock" prefix lets the
// jest.mock factory reference them) so profile-switch behavior is testable.
let mockPreferences = {};
let mockProfileId = 'p1';
jest.mock('../../shared/context/ProfileContext', () => ({
  useProfile: () => ({ preferences: mockPreferences, currentProfile: { id: mockProfileId } }),
}));
beforeEach(() => { mockPreferences = {}; mockProfileId = 'p1'; });

const REQ = '11111111-1111-1111-1111-111111111111';

const CYCLE_CTX = { cycleCode: 'J26', cycleLabel: 'June 2026' };

function defaultEmailDefaults(overrides = {}) {
  const subject = overrides.subject ?? GRANTEE_INVITE_SEED_SUBJECT;
  const body = overrides.body ?? GRANTEE_INVITE_SEED_BODY;
  return {
    subject,
    body,
    configured: subject.trim() !== '' && body.trim() !== '',
    unavailable: false,
    ...overrides,
  };
}

function wireFetch({
  generateOk = true,
  sendOk = true,
  websiteOk = true,
  abstract = null,
  saveOk = true,
  emailDefaults = defaultEmailDefaults(),
  sentInvitedAt = '2026-08-09T16:00:00Z',
  failAbstractReloadAfterSend = false,
} = {}) {
  // Stateful effective-abstract mock (S278): GET returns the current state, the
  // generate POST seeds the draft, and PUT persists a PD edit so the editor flow
  // round-trips like the real route.
  const state = {
    effective: abstract?.effective ?? '',
    effectiveField: abstract?.effectiveField ?? null,
    etag: abstract?.etag ?? 'W/"1"',
    status: abstract?.status ?? null,
    editable: abstract?.editable ?? true,
    // Grantee submission fields — absent/false unless a test supplies them.
    caption: abstract?.caption ?? null,
    imageRef: abstract?.imageRef ?? null,
    imageUrl: abstract?.imageUrl ?? null,
    hasImage: abstract?.hasImage ?? false,
    submittedAt: abstract?.submittedAt ?? null,
    invitedAt: abstract?.invitedAt ?? null,
    remindedAt: abstract?.remindedAt ?? null,
    invitationSent: false,
  };
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/email-defaults/grantee-invite')) {
      return { ok: true, json: async () => emailDefaults };
    }
    if (u.includes('/grantee-deliverables/recipients')) {
      return { ok: true, json: async () => ({
        pi: { name: 'Monika Raj', email: 'monika.raj@emory.edu', hasEmail: true },
        liaison: { name: 'Lorena McLaren', email: 'lorena.mclaren@emory.edu', hasEmail: true },
      }) };
    }
    if (u.includes('/grantee-deliverables/abstract')) {
      if ((opts.method || 'GET') === 'PUT') {
        if (!saveOk) return { ok: false, json: async () => ({ error: 'Could not save the abstract.' }) };
        const b = JSON.parse(opts.body);
        state.effective = b.text;
        state.etag = 'W/"saved"';
        return { ok: true, json: async () => ({ ok: true, field: state.effectiveField || 'formatted', etag: state.etag, status: state.status }) };
      }
      if (state.invitationSent && failAbstractReloadAfterSend) {
        throw new Error('reload failed');
      }
      return { ok: true, json: async () => ({
        effective: state.effective, effectiveField: state.effectiveField,
        etag: state.etag, status: state.status, editable: state.editable,
        caption: state.caption, imageRef: state.imageRef,
        imageUrl: state.imageUrl, hasImage: state.hasImage,
        submittedAt: state.submittedAt,
        invitedAt: state.invitedAt, remindedAt: state.remindedAt,
      }) };
    }
    if (u.includes('/grantee-deliverables/generate')) {
      if (generateOk) {
        state.effective = 'The team will study the thing in a long enough abstract.';
        state.effectiveField = 'formatted';
        state.status = 100000000;
      }
      return generateOk
        ? { ok: true, json: async () => ({ abstractFormatted: state.effective, status: 100000000 }) }
        : { ok: false, json: async () => ({ error: 'no applicant abstract' }) };
    }
    if (u.includes('/grantee-deliverables/send-invite')) {
      if (sendOk) {
        state.status = 100000001;
        state.invitedAt = sentInvitedAt;
        state.invitationSent = true;
      }
      return sendOk
        ? { ok: true, json: async () => ({ ok: true, status: 100000001 }) }
        : { ok: false, json: async () => ({ error: 'send failed' }) };
    }
    if (u.includes('/grantee-deliverables/preview-invite')) {
      return { ok: true, json: async () => ({ html: '<p>Dear Professor [Name],</p><a>Open the Grantee Portal</a>' }) };
    }
    if (u.includes('/grantee-deliverables/website-html')) {
      return websiteOk
        ? { ok: true, json: async () => ({ requestId: REQ, html: '<article class="grantee-award"><strong>Emory University</strong></article>' }) }
        : { ok: false, json: async () => ({ error: 'no request found' }) };
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}

afterEach(() => { if (global.fetch?.mockRestore) global.fetch.mockRestore(); });

// Sending is now behind a confirm modal: the page button OPENS it, the modal
// button commits. Tests that exercise a real send go through both.
function confirmSendInModal() {
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /send invitation/i }));
}


test('loads recipients on mount and pre-fills To/Cc', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  expect(screen.getByLabelText('Cc email')).toHaveValue('lorena.mclaren@emory.edu');
  expect(screen.getByText(/Status:/)).toHaveTextContent('Not started');
  // Send disabled until an abstract is generated
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
});

test('generate shows the abstract, sets status Drafted, and flips the button to Regenerate', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());
  expect(screen.getByText(/Status:/)).toHaveTextContent('Drafted');
  expect(screen.getByRole('button', { name: /regenerate abstract/i })).toBeInTheDocument();
});

test('full flow: generate then send → status Invited + confirmation', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());

  const sendBtn = screen.getByRole('button', { name: /send invitation/i });
  expect(sendBtn).toBeEnabled();
  fireEvent.click(sendBtn);
  // The page button only opens the confirm step — nothing has been sent yet.
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/send-invite'))).toBe(false);
  confirmSendInModal();
  await waitFor(() => expect(screen.getByText(/invitation sent/i)).toBeInTheDocument());
  expect(screen.getByText(/Status:/)).toHaveTextContent('Invited');

  // verify the send payload carried the confirmed To/Cc + subject
  const sendCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/send-invite'));
  expect(JSON.parse(sendCall[1].body)).toMatchObject({
    requestId: REQ, toEmail: 'monika.raj@emory.edu', ccEmail: 'lorena.mclaren@emory.edu',
  });
});

test('successful send reloads the recorded invite date into the status header', async () => {
  wireFetch({
    abstract: {
      effective: 'Ready abstract.', effectiveField: 'formatted', status: 100000000, editable: true,
    },
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  confirmSendInModal();

  await waitFor(() => expect(screen.getByText(/invitation sent/i)).toBeInTheDocument());
  expect(screen.getByText(/Status:/)).toHaveTextContent('Invited');
  expect(screen.getByText(/Invited Aug 9, 2026/)).toBeInTheDocument();
  expect(screen.queryByText('Not yet invited')).not.toBeInTheDocument();
});

test('a failed post-send reload does not turn a successful send into an error', async () => {
  wireFetch({
    abstract: {
      effective: 'Ready abstract.', effectiveField: 'formatted', status: 100000000, editable: true,
    },
    failAbstractReloadAfterSend: true,
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  confirmSendInModal();

  await waitFor(() => expect(screen.getByText(/invitation sent/i)).toBeInTheDocument());
  expect(screen.getByText(/Status:/)).toHaveTextContent('Invited');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('resolves grantee invite subject tokens in compose state and send payload', async () => {
  wireFetch({
    emailDefaults: defaultEmailDefaults({ subject: 'Abstract for {{proposalTitle}}' }),
  });
  render(<AwardeeTab requestId={REQ} context={{ ...CYCLE_CTX, title: 'Quantum Widgets' }} />);
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Abstract for Quantum Widgets'));

  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Legacy [title]' } });
  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  // The modal shows the RESOLVED subject before the PD commits, so what they
  // confirm is what actually goes out.
  expect(within(screen.getByRole('dialog')).getByText('Legacy Quantum Widgets')).toBeInTheDocument();
  confirmSendInModal();
  await waitFor(() => expect(screen.getByText(/invitation sent/i)).toBeInTheDocument());
  const sendCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/send-invite'));
  expect(JSON.parse(sendCall[1].body).subject).toBe('Legacy Quantum Widgets');
});

test('a generation error surfaces and leaves Send disabled', async () => {
  wireFetch({ generateOk: false });
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no applicant abstract/i));
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
});

// --- Editable abstract (S278) ---

test('after generate the abstract is editable; editing then Save PUTs text + etag + baseField', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());

  const textarea = screen.getByLabelText('Formatted abstract');
  expect(textarea).not.toHaveAttribute('readonly');
  // Save is disabled until there's an actual edit.
  expect(screen.getByRole('button', { name: /save edits/i })).toBeDisabled();

  fireEvent.change(textarea, { target: { value: 'PD-refined abstract text for the website.' } });
  const saveBtn = screen.getByRole('button', { name: /save edits/i });
  expect(saveBtn).toBeEnabled();
  fireEvent.click(saveBtn);

  await waitFor(() => expect(screen.getByText(/abstract saved/i)).toBeInTheDocument());
  const putCall = global.fetch.mock.calls.find(
    ([u, o]) => String(u).includes('/grantee-deliverables/abstract') && o?.method === 'PUT',
  );
  expect(JSON.parse(putCall[1].body)).toMatchObject({
    requestId: REQ, text: 'PD-refined abstract text for the website.', etag: 'W/"1"', baseField: 'formatted',
  });
});

test('loads a grantee-approved abstract on mount, labeled as the published version', async () => {
  wireFetch({ abstract: { effective: 'Grantee-approved abstract.', effectiveField: 'approved', etag: 'W/"9"', status: 100000003, editable: true } });
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Grantee-approved abstract.'));
  expect(screen.getByText(/this is what publishes to the website/i)).toBeInTheDocument();
});

test('a read-only (status-gated) abstract cannot be saved', async () => {
  wireFetch({ abstract: { effective: 'Locked approved abstract.', effectiveField: 'approved', etag: 'W/"9"', status: 100000006, editable: false } });
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Locked approved abstract.'));
  expect(screen.getByLabelText('Formatted abstract')).toHaveAttribute('readonly');
  expect(screen.getByText(/read-only in the current status/i)).toBeInTheDocument();
});

test('default invitation copy is the PD-voice template (subject + body)', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());

  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue(GRANTEE_INVITE_SEED_SUBJECT));
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Dear Professor Raj,/));
  const body = screen.getByLabelText('Email body').value;
  expect(body).toMatch(/^Dear Professor Raj,/);
  expect(body).toContain('post an abstract on the Foundation’s website describing your award entitled “{{proposalTitle}}”');
  expect(body).toContain('lightly edited to conform to the style that the Foundation uses in its publications');
  expect(body).toMatch(/no later than COB [A-Z][a-z]+ \d{1,2}, \d{4}/);
  expect(body).toContain('we will assume that we have your concurrence to post the draft as written');
  expect(body).toContain('agreed to acknowledge'); // acknowledgment-of-support paragraph
  expect(body).not.toContain('[Program Director name]'); // server appends the canonical assigned-PD signature
  // Body-only invariant: the body ends with the "Thank you," closing salutation; the
  // server appends the SIGNATURE block after it (no signature lines in the body).
  expect(body.trimEnd()).toMatch(/Thank you,$/);
  expect(body).toContain('additional information.');
});

test('Preview email renders into a new tab without sending (no send-invite call)', async () => {
  wireFetch();
  const doc = { write: jest.fn(), close: jest.fn() };
  const openSpy = jest.spyOn(window, 'open').mockReturnValue({ document: doc });

  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /preview email/i }));
  await waitFor(() => expect(openSpy).toHaveBeenCalledWith('', '_blank'));

  // it called the render-only preview endpoint, NOT send-invite
  const calls = global.fetch.mock.calls.map(([u]) => String(u));
  expect(calls.some((u) => u.includes('/preview-invite'))).toBe(true);
  expect(calls.some((u) => u.includes('/send-invite'))).toBe(false);
  const previewCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/preview-invite'));
  expect(JSON.parse(previewCall[1].body)).toMatchObject({ requestId: REQ });

  // the new tab got the rendered email behind a PREVIEW banner
  const written = doc.write.mock.calls[0][0];
  expect(written).toContain('PREVIEW');
  expect(written).toContain('Open the Grantee Portal');
  openSpy.mockRestore();
});

// --- Deliverable outputs (chunk 8 b/c) ---

test('Copy website HTML fetches the fragment, shows it, and copies to clipboard', async () => {
  wireFetch();
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /copy website html/i }));
  await waitFor(() => expect(screen.getByLabelText('Website HTML')).toBeInTheDocument());
  expect(screen.getByLabelText('Website HTML').value).toContain('Emory University');
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('grantee-award'));
  expect(screen.getByText(/copied to the clipboard/i)).toBeInTheDocument();

  const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/website-html'));
  expect(String(call[0])).toContain(`requestId=${REQ}`);
});

test('Copy website HTML still shows the fragment when the clipboard API is unavailable', async () => {
  wireFetch();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: jest.fn().mockRejectedValue(new Error('blocked')) },
    configurable: true,
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /copy website html/i }));
  await waitFor(() => expect(screen.getByLabelText('Website HTML')).toBeInTheDocument());
  expect(screen.getByText(/select the text below to copy/i)).toBeInTheDocument();
});

test('a website-html error surfaces and no fragment is shown', async () => {
  wireFetch({ websiteOk: false });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /copy website html/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no request found/i));
  expect(screen.queryByLabelText('Website HTML')).not.toBeInTheDocument();
});

test('Cycle export link targets the cycle-export route for the request cycle', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  const link = screen.getByRole('link', { name: /cycle export/i });
  expect(link).toHaveAttribute('href', '/api/workbench/grantee-deliverables/cycle-export?cycleCode=J26');
  expect(link).toHaveTextContent('June 2026');
  expect(link).toHaveAttribute('target', '_blank');
});

test('Cycle export is unavailable (no link) when the request has no June/December cycle', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={{ cycleCode: null }} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /cycle export/i })).not.toBeInTheDocument();
  expect(screen.getByText(/cycle export unavailable/i)).toBeInTheDocument();
});

test('seeds the body from the PD saved custom body (placeholders still filled)', async () => {
  mockPreferences = { grantee_invite_body: 'Hi [Name], your award “[title]” — reply by COB [date]. Custom sign-off.' };
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Hi Raj,/));
  const body = screen.getByLabelText('Email body').value;
  expect(body).toContain('your award “[title]”'); // no awardTitle in CYCLE_CTX → [title] left as-is
  expect(body).toMatch(/COB [A-Z][a-z]+ \d{1,2}, \d{4}/); // COB [date] filled
  expect(body).not.toMatch(/^Dear Professor/); // default NOT used
  expect(screen.getByText(/saved custom body/i)).toBeInTheDocument();
});

test('whitespace-only saved body falls back to the Foundation default', async () => {
  mockPreferences = { grantee_invite_body: '   \n  ' };
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Dear Professor Raj,/));
});

test('blank admin defaults block sending with a not-configured message', async () => {
  wireFetch({
    abstract: { effective: 'Ready abstract.', effectiveField: 'formatted', etag: 'W/"2"', status: 100000000, editable: true },
    emailDefaults: defaultEmailDefaults({ subject: '', body: '', configured: false }),
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());

  expect(screen.getByText(/default not configured/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/send-invite'))).toBe(false);
});

test('settings-read failure blocks sending with an unavailable message', async () => {
  wireFetch({
    abstract: { effective: 'Ready abstract.', effectiveField: 'formatted', etag: 'W/"2"', status: 100000000, editable: true },
    emailDefaults: defaultEmailDefaults({ subject: '', body: '', configured: false, unavailable: true }),
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/settings read failed/i)).toBeInTheDocument());

  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
});

test('"Reset to default" restores the Foundation default over a saved custom body', async () => {
  mockPreferences = { grantee_invite_body: 'Custom body for [Name].' };
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Custom body for Raj\./));
  fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
  expect(screen.getByLabelText('Email body').value).toMatch(/^Dear Professor Raj,/);
  // Stays reset — does not bounce back to the custom body on a later effect run.
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByLabelText('Email body').value).toMatch(/^Dear Professor Raj,/);
});

// --- Lifecycle (compose-state) regression tests: bugs #1 and #2 (S272) ---

test('switching profile reseeds the body to the new PD saved body (not stale)', async () => {
  mockProfileId = 'pA';
  mockPreferences = { grantee_invite_body: 'Body A for [Name].' };
  wireFetch();
  const { rerender } = render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Body A for Raj\./));

  mockProfileId = 'pB';
  mockPreferences = { grantee_invite_body: 'Body B for [Name].' };
  rerender(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Body B for Raj\./));
});

test('switching profile AFTER editing discards the edit and loads the new PD body (#1)', async () => {
  mockProfileId = 'pA';
  mockPreferences = { grantee_invite_body: 'Body A for [Name].' };
  wireFetch();
  const { rerender } = render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Body A for Raj\./));

  fireEvent.change(screen.getByLabelText('Email body'), { target: { value: 'half-typed draft for pA' } });
  expect(screen.getByLabelText('Email body').value).toBe('half-typed draft for pA');

  mockProfileId = 'pB';
  mockPreferences = { grantee_invite_body: 'Body B for [Name].' };
  rerender(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  // Identity changed → the edit (provenance: pA) is discarded; pB's body derives.
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Body B for Raj\./));
});

test('initial profile id resolution preserves an in-progress body edit (NI-4)', async () => {
  mockProfileId = null;
  wireFetch();
  const { rerender } = render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.change(screen.getByLabelText('Email body'), { target: { value: 'early draft while profile loads' } });
  expect(screen.getByLabelText('Email body')).toHaveValue('early draft while profile loads');

  mockProfileId = 'user-1';
  rerender(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue(GRANTEE_INVITE_SEED_SUBJECT));
  expect(screen.getByLabelText('Email body')).toHaveValue('early draft while profile loads');
});

test('late recipients response from a previous request cannot overwrite the current request (NI-5)', async () => {
  const requestA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const requestB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  let resolveA;
  let resolveB;

  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/email-defaults/grantee-invite')) {
      return { ok: true, json: async () => defaultEmailDefaults() };
    }
    if (u.includes('/grantee-deliverables/abstract')) {
      return { ok: true, json: async () => ({
        effective: '', effectiveField: null, etag: 'W/"1"', status: null, editable: true,
      }) };
    }
    if (!u.includes('/grantee-deliverables/recipients')) {
      throw new Error(`unexpected fetch ${u}`);
    }
    if (u.includes(encodeURIComponent(requestA))) {
      await new Promise((res) => { resolveA = res; });
      return { ok: true, json: async () => ({
        pi: { name: 'Request A', email: 'request-a@example.org' },
        liaison: { email: 'liaison-a@example.org' },
      }) };
    }
    if (u.includes(encodeURIComponent(requestB))) {
      await new Promise((res) => { resolveB = res; });
      return { ok: true, json: async () => ({
        pi: { name: 'Request B', email: 'request-b@example.org' },
        liaison: { email: 'liaison-b@example.org' },
      }) };
    }
    throw new Error(`unexpected requestId ${u}`);
  });

  const { rerender } = render(<AwardeeTab requestId={requestA} context={CYCLE_CTX} />);
  await waitFor(() => expect(resolveA).toBeDefined());

  rerender(<AwardeeTab requestId={requestB} context={CYCLE_CTX} />);
  await waitFor(() => expect(resolveB).toBeDefined());
  resolveB();
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('request-b@example.org'));

  resolveA();
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByLabelText('To email')).toHaveValue('request-b@example.org');
  expect(screen.getByLabelText('Cc email')).toHaveValue('liaison-b@example.org');
});

test('reset BEFORE recipients load still fills [Name] when they arrive (#2)', async () => {
  let resolveRecipients;
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/email-defaults/grantee-invite')) {
      return { ok: true, json: async () => defaultEmailDefaults() };
    }
    if (u.includes('/grantee-deliverables/abstract')) {
      return { ok: true, json: async () => ({
        effective: '', effectiveField: null, etag: 'W/"1"', status: null, editable: true,
      }) };
    }
    if (u.includes('/grantee-deliverables/recipients')) {
      await new Promise((res) => { resolveRecipients = res; });
      return { ok: true, json: async () => ({ pi: { name: 'Monika Raj', email: 'monika.raj@emory.edu' }, liaison: {} }) };
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  // Recipients not resolved yet → {{granteeName}} placeholder still present.
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/Dear Professor {{granteeName}},/));

  fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
  expect(screen.getByLabelText('Email body').value).toMatch(/Dear Professor {{granteeName}},/);

  resolveRecipients();
  // After recipients land, the reset (foundation, not "edited") refills {{granteeName}}.
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^Dear Professor Raj,/));
});

test('preserves a custom body verbatim incl. leading/trailing whitespace (no trim)', async () => {
  mockPreferences = { grantee_invite_body: '  Hello [Name], spaced body.  ' };
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Email body').value).toMatch(/^ {2}Hello Raj, spaced body\. {2}$/));
});

// ── Grantee submission section (caption + image visibility) ──

const SP_URL = 'https://wmkf.sharepoint.com/sites/grants/Grantee_Uploads/fig.png';

const submitted = (over = {}) => ({
  effective: 'The grantee-approved abstract text.',
  effectiveField: 'approved',
  status: 100000003, // Submitted
  editable: true,
  submittedAt: '2026-07-12T15:04:05Z',
  ...over,
});

test('submission section is hidden entirely pre-submit', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  expect(screen.queryByText('Grantee submission')).not.toBeInTheDocument();
});

test('shows caption and a SharePoint link once submitted', async () => {
  wireFetch({ abstract: submitted({ caption: 'Cryo-EM structure.', imageRef: SP_URL, imageUrl: SP_URL, hasImage: true }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);

  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByText('Cryo-EM structure.')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /open image in sharepoint/i });
  expect(link).toHaveAttribute('href', SP_URL);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // Labeled as the waiver acknowledgment, not as a submitted date.
  expect(screen.getByText(/Waiver acknowledged/)).toBeInTheDocument();
});

test('relative image ref renders as text, never as a link', async () => {
  wireFetch({ abstract: submitted({
    imageRef: '1002794_ABCDEF/Grantee_Uploads/fig.png', imageUrl: null, hasImage: true,
  }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);

  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByText('1002794_ABCDEF/Grantee_Uploads/fig.png')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /open image in sharepoint/i })).not.toBeInTheDocument();
  expect(screen.getByText(/path in the grantee SharePoint library/)).toBeInTheDocument();
});

test('submitted with no image says so', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption without an image.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);

  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByText('No image uploaded.')).toBeInTheDocument();
});

test('image with no caption says so', async () => {
  wireFetch({ abstract: submitted({ imageRef: SP_URL, imageUrl: SP_URL, hasImage: true }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);

  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByText('No caption provided.')).toBeInTheDocument();
});

test('a caption containing markup renders as literal text', async () => {
  const hostile = '<script>alert(1)</script> and <b>bold</b>';
  wireFetch({ abstract: submitted({ caption: hostile, imageRef: SP_URL, imageUrl: SP_URL, hasImage: true }) });
  const { container } = render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);

  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByText(hostile)).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
});

// ── Status header + Invitation/Submission panes (S411) ──
//
// The page previously rendered outbound work and inbound results in one scroll,
// and the inbound half disappeared entirely when empty — so "the grantee has not
// responded" and "this surface does not exist" looked identical. These pin the
// split, the badge that answers "did they respond?" without a click, and the
// empty state that replaced the silence.

test('a stale mount load cannot overwrite a newer post-generate load for the same request', async () => {
  let resolveMountAbstract;
  const mountAbstract = new Promise((resolve) => { resolveMountAbstract = resolve; });
  let abstractGetCount = 0;

  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/api/email-defaults/grantee-invite')) {
      return Promise.resolve({ ok: true, json: async () => defaultEmailDefaults() });
    }
    if (u.includes('/grantee-deliverables/recipients')) {
      return Promise.resolve({ ok: true, json: async () => ({
        pi: { name: 'Monika Raj', email: 'monika.raj@emory.edu', hasEmail: true },
        liaison: { name: 'Lorena McLaren', email: 'lorena.mclaren@emory.edu', hasEmail: true },
      }) });
    }
    if (u.includes('/grantee-deliverables/generate')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ abstractFormatted: 'Generated draft.', status: 100000000 }),
      });
    }
    if (u.includes('/grantee-deliverables/abstract')) {
      abstractGetCount += 1;
      if (abstractGetCount === 1) return mountAbstract;
      return Promise.resolve({ ok: true, json: async () => ({
        effective: 'Newer approved abstract.',
        effectiveField: 'approved',
        etag: 'W/"newer"',
        status: 100000003,
        editable: true,
        caption: 'Newer caption.',
        hasImage: false,
        submittedAt: '2026-08-09T16:00:00Z',
        invitedAt: '2026-07-20T16:00:00Z',
        remindedAt: '2026-08-01T16:00:00Z',
      }) });
    }
    throw new Error(`unexpected fetch ${u}`);
  });

  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(abstractGetCount).toBe(1));

  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Newer approved abstract.'));
  expect(screen.getByRole('tab', { name: /Submission/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('✓ received')).toBeInTheDocument();

  await act(async () => {
    resolveMountAbstract({ ok: true, json: async () => ({
      effective: 'Older mount abstract.',
      effectiveField: 'formatted',
      etag: 'W/"older"',
      status: 100000000,
      editable: true,
      caption: null,
      hasImage: false,
      submittedAt: null,
      invitedAt: null,
      remindedAt: null,
    }) });
    await mountAbstract;
  });

  expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Newer approved abstract.');
  expect(screen.getByRole('tab', { name: /Submission/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('✓ received')).toBeInTheDocument();
});

test('status header shows the invite date and the derived response deadline', async () => {
  wireFetch({ abstract: { invitedAt: '2026-07-12T15:04:05Z' } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  // +14d from the recorded invite date; this is an estimate, not the editable email date.
  await waitFor(() => expect(screen.getByText(/Invited Jul 12, 2026/)).toBeInTheDocument());
  expect(screen.getByText(/estimated response due July 26, 2026/)).toBeInTheDocument();
});

test('status header shows the reminder date once the day-12 cron has sent one', async () => {
  wireFetch({ abstract: { invitedAt: '2026-07-12T15:04:05Z', remindedAt: '2026-07-24T09:00:00Z' } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/reminded Jul 24, 2026/)).toBeInTheDocument());
});

test('an unanswered invitation past the estimated date is called out; a fresh one is not', async () => {
  const longAgo = new Date(Date.now() - 20 * 86400000).toISOString();
  wireFetch({ abstract: { invitedAt: longAgo } });
  const { unmount } = render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/past the estimated response date/i)).toBeInTheDocument());
  expect(screen.getByText(/No response 6 days past/i)).toBeInTheDocument();
  unmount();

  wireFetch({ abstract: { invitedAt: new Date(Date.now() - 2 * 86400000).toISOString() } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  expect(screen.queryByText(/past the estimated response date/i)).not.toBeInTheDocument();
});

test('a submitted package never shows an overdue warning, however old the invite', async () => {
  const longAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  wireFetch({ abstract: submitted({ invitedAt: longAgo, caption: 'A caption.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.queryByText(/past the estimated response date/i)).not.toBeInTheDocument();
  expect(screen.getByText(/response received/)).toBeInTheDocument();
});

test('the Submission tab badge answers "did they respond?" without a click', async () => {
  wireFetch({ abstract: { invitedAt: '2026-07-12T15:04:05Z' } });
  const { unmount } = render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('pending')).toBeInTheDocument());
  // Still on the outbound pane — the answer came from the badge, not a click.
  expect(screen.getByRole('tab', { name: /Invitation/ })).toHaveAttribute('aria-selected', 'true');
  unmount();

  wireFetch({ abstract: submitted({ caption: 'A caption.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('✓ received')).toBeInTheDocument());
});

test('pre-submit the Submission pane explains the silence instead of rendering nothing', async () => {
  wireFetch({ abstract: { invitedAt: '2026-07-12T15:04:05Z' } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  fireEvent.click(screen.getByRole('tab', { name: /Submission/ }));
  expect(screen.getByText('No submission received yet.')).toBeInTheDocument();
  expect(screen.getByText(/recorded invite date gives an estimated response date of July 26, 2026/i)).toBeInTheDocument();
  expect(screen.queryByText('Grantee submission')).not.toBeInTheDocument();
});

test('with no invitation sent, the empty state points at the Invitation tab', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  fireEvent.click(screen.getByRole('tab', { name: /Submission/ }));
  expect(screen.getByText(/Send the invitation from the Invitation tab/i)).toBeInTheDocument();
});

test('the panes actually separate outbound from inbound', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  // Auto-advanced to the response, since there is one.
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.queryByLabelText('To email')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: /Invitation/ }));
  expect(screen.getByLabelText('To email')).toBeInTheDocument();
  expect(screen.queryByText('Grantee submission')).not.toBeInTheDocument();
});

test('the approved-abstract editor follows its mode into the Submission pane', async () => {
  // effectiveField 'approved' with NO caption/image: the editor must still be
  // reachable and the pane must not claim nothing was received. This is the
  // regression test for the first cut, where the editor rendered into a pane
  // whose empty state simultaneously said "No submission received yet."
  wireFetch({ abstract: { effective: 'Approved text.', effectiveField: 'approved', status: 100000006, editable: false } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Approved text.'));
  expect(screen.getByRole('tab', { name: /Submission/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('✓ received')).toBeInTheDocument();
  expect(screen.queryByText('No submission received yet.')).not.toBeInTheDocument();
});

test('the draft abstract editor lives with the invitation', async () => {
  wireFetch({ abstract: { effective: 'Draft text.', effectiveField: 'formatted', editable: true } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Draft text.'));
  expect(screen.getByRole('tab', { name: /Invitation/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: /Submission/ }));
  expect(screen.queryByLabelText('Formatted abstract')).not.toBeInTheDocument();
});

test('a manual pane choice survives a later refetch', async () => {
  // A submitted package whose grantee left the abstract alone: approved is empty,
  // so the effective field is still the draft. That puts the editor (and its
  // Generate button) on Invitation while the caption sits on Submission — the one
  // realistic shape where a refetch can be triggered from the pane the PD chose.
  wireFetch({ abstract: {
    effective: 'Draft the grantee did not touch.',
    effectiveField: 'formatted',
    editable: true,
    caption: 'A caption.',
    submittedAt: '2026-07-12T15:04:05Z',
  } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  // Auto-advanced to the response.
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('tab', { name: /Invitation/ }));
  expect(screen.getByLabelText('To email')).toBeInTheDocument();
  // Regenerating reloads the abstract; the pane must not jump back under the PD.
  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /Invitation/ })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByLabelText('To email')).toBeInTheDocument();
});

test('Deliverable outputs stay reachable from either pane', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Deliverable outputs')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('tab', { name: /Invitation/ }));
  expect(screen.getByText('Deliverable outputs')).toBeInTheDocument();
});

// ── Inline image (S411 increment 2) ──
//
// The image renders through the staff-guarded proxy route. The SharePoint
// affordance is retained, not replaced, because the proxy can 404 on a ref shape
// it does not recognize or 502 when Graph is down.

test('a submitted image renders inline through the proxy route', async () => {
  wireFetch({ abstract: submitted({ caption: 'Cryo-EM structure.', imageRef: SP_URL, imageUrl: SP_URL, hasImage: true }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());

  const img = screen.getByRole('img');
  expect(img).toHaveAttribute('src', `/api/workbench/grantee-deliverables/image?requestId=${REQ}`);
  // The caption doubles as alt text; screen readers get the grantee's own words.
  expect(img).toHaveAttribute('alt', 'Cryo-EM structure.');
  // The SharePoint link is kept alongside it, not replaced.
  expect(screen.getByRole('link', { name: /open image in sharepoint/i })).toBeInTheDocument();
});

test('with no caption the inline image still carries descriptive alt text', async () => {
  wireFetch({ abstract: submitted({ imageRef: SP_URL, imageUrl: SP_URL, hasImage: true }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Grantee-submitted award image');
});

test('a failed image load falls back to the SharePoint affordance', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption.', imageRef: SP_URL, imageUrl: SP_URL, hasImage: true }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());

  fireEvent.error(screen.getByRole('img'));

  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/could not be loaded in the app/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open image in sharepoint/i })).toBeInTheDocument();
});

test('no image on the package renders neither an img nor a broken-image note', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('No image uploaded.')).toBeInTheDocument();
  expect(screen.queryByText(/could not be loaded in the app/i)).not.toBeInTheDocument();
});

test('a relative-path ref still renders inline; the proxy resolves it server-side', async () => {
  // imageUrl is null (not linkifiable) but the proxy re-derives the path itself,
  // so the in-app image is exactly the case this increment fixes.
  wireFetch({ abstract: submitted({ caption: 'A caption.', imageRef: 'folder/Grantee_Uploads/x.png', hasImage: true }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText('Grantee submission')).toBeInTheDocument());
  expect(screen.getByRole('img')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /open image in sharepoint/i })).not.toBeInTheDocument();
  expect(screen.getByText(/path in the grantee SharePoint library/i)).toBeInTheDocument();
});

// ── Send-invitation confirm modal (S411) ──
//
// The page button used to send immediately and drop a receipt at the TOP of the
// pane while the button sits at the bottom — so the only feedback for a real
// outbound email was off-screen, and a stray second click re-sent it.

const ready = (over = {}) => ({
  effective: 'Ready abstract.', effectiveField: 'formatted', status: 100000000, editable: true, ...over,
});

test('the page button opens a confirm step and sends nothing on its own', async () => {
  wireFetch({ abstract: ready() });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));

  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(within(dialog).getByText('Send invitation?')).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/send-invite'))).toBe(false);
});

test('the confirm step shows who the invitation goes to', async () => {
  wireFetch({ abstract: ready() });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));

  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('monika.raj@emory.edu')).toBeInTheDocument();
  expect(within(dialog).getByText('lorena.mclaren@emory.edu')).toBeInTheDocument();
  expect(within(dialog).getByText('Monika Raj')).toBeInTheDocument();
});

test('Cancel closes the confirm step without sending', async () => {
  wireFetch({ abstract: ready() });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/send-invite'))).toBe(false);
});

test('the sent receipt names the recipient and the estimated response date', async () => {
  wireFetch({ abstract: ready(), sentInvitedAt: '2026-08-09T16:00:00Z' });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  confirmSendInModal();

  await waitFor(() => expect(screen.getByText(/✓ Invitation sent/)).toBeInTheDocument());
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/Sent to Monika Raj/)).toBeInTheDocument();
  // +14d from the recorded invite date, and the day-12 reminder is stated.
  expect(within(dialog).getByText(/Estimated response due August 23, 2026/)).toBeInTheDocument();
  expect(within(dialog).getByText(/reminder sends automatically at day 12/i)).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole('button', { name: /done/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // The durable confirmation is the status header, which now carries the date.
  expect(screen.getByText(/Invited Aug 9, 2026/)).toBeInTheDocument();
});

test('a send failure closes the modal and surfaces the error inline, next to the fields', async () => {
  wireFetch({ abstract: ready(), sendOk: false });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  confirmSendInModal();

  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/send failed/i);
});

test('an already-invited award relabels the button and warns before re-sending', async () => {
  wireFetch({ abstract: ready({ status: 100000001, invitedAt: '2026-07-12T15:04:05Z' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/Status:/)).toHaveTextContent('Invited'));

  // Not "Send invitation" — a re-send must not look like a first send.
  const btn = screen.getByRole('button', { name: /re-send invitation/i });
  fireEvent.click(btn);

  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Re-send this invitation?')).toBeInTheDocument();
  // The service keeps the original invite date, so the deadline will not move.
  expect(within(dialog).getByText(/keeps the original invitation date/i)).toBeInTheDocument();
});

test('a reminder-sent award also offers a re-send, not a first send', async () => {
  wireFetch({ abstract: ready({ status: 100000002, invitedAt: '2026-07-12T15:04:05Z' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/Status:/)).toHaveTextContent('Reminder Sent'));
  expect(screen.getByRole('button', { name: /re-send invitation/i })).toBeInTheDocument();
});

test('the old top-of-pane sent banner is gone', async () => {
  wireFetch({ abstract: ready() });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));

  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));
  confirmSendInModal();
  await waitFor(() => expect(screen.getByText(/✓ Invitation sent/)).toBeInTheDocument());
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /done/i }));

  // Dismissing the receipt leaves no stray inline banner behind.
  expect(screen.queryByText('Invitation sent to the grantee.')).not.toBeInTheDocument();
});

// ── Send gate mirrors the server (S411 fix) ──
//
// send-invite-service.js:82-88 refuses status < DRAFTED ("generate first") and
// status >= SUBMITTED ("already submitted; a new invite cannot be sent"). The
// button previously ignored status entirely, so on a submitted package it stayed
// enabled and walked the PD through the whole confirm modal to a guaranteed 409
// — reported from the 1002788 production run.

test('a submitted package disables the send button and says why', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption.', invitedAt: '2026-08-09T16:00:00Z' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/Status:/)).toHaveTextContent('Submitted'));

  fireEvent.click(screen.getByRole('tab', { name: /Invitation/ }));
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
  expect(screen.getByText(/already returned this package/i)).toBeInTheDocument();
});

test('a disabled send button cannot open the confirm modal', async () => {
  wireFetch({ abstract: submitted({ caption: 'A caption.' }) });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByText(/Status:/)).toHaveTextContent('Submitted'));

  fireEvent.click(screen.getByRole('tab', { name: /Invitation/ }));
  fireEvent.click(screen.getByRole('button', { name: /send invitation/i }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/send-invite'))).toBe(false);
});

test.each([
  ['Complete', 100000006],
  ['Closed No Response', 100000007],
])('%s is past the send gate too', async (_label, status) => {
  wireFetch({ abstract: { effective: 'Text.', effectiveField: 'approved', status, editable: false } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Text.'));
  fireEvent.click(screen.getByRole('tab', { name: /Invitation/ }));
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
});

test.each([
  ['Drafted', 100000000],
  ['Invited', 100000001],
  ['Reminder Sent', 100000002],
])('%s can still be invited', async (_label, status) => {
  wireFetch({ abstract: { effective: 'Ready abstract.', effectiveField: 'formatted', status, editable: true } });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toHaveValue('Ready abstract.'));
  expect(screen.getByRole('button', { name: /send invitation|re-send invitation/i })).toBeEnabled();
  expect(screen.queryByText(/already returned this package/i)).not.toBeInTheDocument();
});

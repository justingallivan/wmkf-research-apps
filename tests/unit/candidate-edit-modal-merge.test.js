/**
 * @jest-environment jsdom
 *
 * CandidateEditModal MERGE mode (S289 chunk-4). When a saved-candidate email edit
 * hits a duplicate-key 409 (another wmkf_potentialreviewers row owns the address),
 * the modal switches to a field-by-field record merge instead of a dead-end error.
 * Backend contract: POST /api/reviewer-finder/merge-candidates (plan / confirm).
 * Design: docs/REVIEWER_MERGE_DESIGN.md §Chunk 4 + §Keeper selection +
 * §Field-picker + §Email-move atomicity (Option B / orphan-detection recovery).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';

const KEEPER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // the edited (curated) record
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // conflictingRecordId (email owner)
const TARGET = 'josh@princeton.edu';                  // the address the staffer was setting

const candidate = {
  name: 'Joshua Rabinowitz',
  affiliation: 'Princeton',
  email: 'old@princeton.edu',
  website: '',
  hIndex: 10,
  suggestionId: 'S1',
  potentialReviewerId: KEEPER,
};

const resp = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });

// 409 the my-candidates PATCH returns when TARGET is already owned by LOSER.
const patch409 = resp(
  { error: 'duplicate_key', message: 'Another reviewer record already has that email.', field: 'wmkf_emailaddress', value: TARGET, conflictingRecordId: LOSER },
  { ok: false, status: 409 },
);

// Plan with keeper=KEEPER (the edited record), loser=LOSER (the email owner).
const planForward = (over = {}) => ({
  blocked: false,
  reasons: [],
  keeper: { id: KEEPER, name: 'Joshua Rabinowitz', email: 'old@princeton.edu', identityStatus: null },
  loser: { id: LOSER, name: 'Joshua Ravinowitz', email: TARGET, identityStatus: null, statecode: 0 },
  fields: [
    { field: 'name', keeper: 'Joshua Rabinowitz', loser: 'Joshua Ravinowitz', differs: true },
    { field: 'affiliation', keeper: 'Princeton', loser: 'Princeton', differs: false },
    { field: 'email', keeper: 'old@princeton.edu', loser: TARGET, differs: true },
    { field: 'website', keeper: '', loser: '', differs: false },
    { field: 'hIndex', keeper: 10, loser: null, differs: true },
  ],
  repointCount: 1,
  collisionCount: 0,
  ...over,
});

// Plan after Swap: keeper=LOSER (owns TARGET), loser=KEEPER (old email).
const planSwapped = (over = {}) => ({
  blocked: false,
  reasons: [],
  keeper: { id: LOSER, name: 'Joshua Ravinowitz', email: TARGET, identityStatus: null },
  loser: { id: KEEPER, name: 'Joshua Rabinowitz', email: 'old@princeton.edu', identityStatus: null, statecode: 0 },
  fields: [
    { field: 'name', keeper: 'Joshua Ravinowitz', loser: 'Joshua Rabinowitz', differs: true },
    { field: 'affiliation', keeper: 'Princeton', loser: 'Princeton', differs: false },
    { field: 'email', keeper: TARGET, loser: 'old@princeton.edu', differs: true },
    { field: 'website', keeper: '', loser: '', differs: false },
    { field: 'hIndex', keeper: null, loser: 10, differs: true },
  ],
  repointCount: 0,
  collisionCount: 0,
  ...over,
});

const parse = (opts) => (opts?.body ? JSON.parse(opts.body) : {});
const triggerMerge = () => {
  fireEvent.change(screen.getByDisplayValue('old@princeton.edu'), { target: { value: TARGET } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
};
const confirmCall = (spy) => spy.mock.calls.find(([u, o]) => u === '/api/reviewer-finder/merge-candidates' && parse(o).confirm);

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

describe('CandidateEditModal — merge mode', () => {
  // (a)
  test('a duplicate-key 409 with conflictingRecordId enters merge mode and shows the plan', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      return resp({ plan: planForward() });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    expect(await screen.findByText(/Merge duplicate reviewer records/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /merge records/i })).toBeInTheDocument();
  });

  test('the merge plan summary reads projected repoint/collision counts', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      return resp({ plan: planForward({ repointCount: 2, collisionCount: 1 }) });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    expect(await screen.findByText(/2 proposals re-linked, 1 duplicate entry removed/i)).toBeInTheDocument();
  });

  // (b)
  test('a 409 WITHOUT a potential-reviewer id does NOT enter merge mode (normal error)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(patch409);
    const { suggestionId } = candidate;
    render(<CandidateEditModal candidate={{ name: candidate.name, email: candidate.email, suggestionId }} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    expect(await screen.findByText(/already has that email/i)).toBeInTheDocument();
    expect(screen.queryByText(/Merge duplicate reviewer records/i)).not.toBeInTheDocument();
  });

  // (c)
  test('a blocked plan shows the reasons, keeps Swap, and offers no Merge button', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      return resp({ plan: planForward({ blocked: true, reasons: [{ code: 'loser_engaged', detail: 'The other record has already been invited on a request.' }] }) });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    expect(await screen.findByText(/already been invited on a request/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge records/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /swap — keep/i })).toBeInTheDocument();
  });

  // (d) + (f)
  test('confirm posts {keeperId, loserId, fieldChoices, confirm} with email defaulted to the TARGET owner, then refreshes', async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      if (parse(opts).confirm) return resp({ success: true, summary: { repointed: 1, deleted: 0, emailMoved: true } });
      return resp({ plan: planForward() }); // initial plan + post-success recovery re-read
    });
    render(<CandidateEditModal candidate={candidate} onClose={onClose} onSaved={onSaved} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    const body = parse(confirmCall(spy)[1]);
    expect(body).toEqual({
      keeperId: KEEPER,
      loserId: LOSER,
      confirm: true,
      fieldChoices: { name: 'keeper', affiliation: 'keeper', email: 'loser', website: 'keeper', hIndex: 'keeper' },
    });
  });

  // (e) + (g)
  test('Swap re-plans with swapped ids and the email default does NOT transplant the old email onto the owner keeper', async () => {
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) return resp({ success: true, summary: {} });
      if (body.keeperId === LOSER) return resp({ plan: planSwapped() });
      return resp({ plan: planForward() });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /swap — keep Joshua Ravinowitz/i }));
    // After swap the kept record is the email owner, so the Swap control now offers
    // to keep the OTHER record (Rabinowitz) — a unique signal the re-plan landed.
    await screen.findByRole('button', { name: /swap — keep Joshua Rabinowitz/i });
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));

    await waitFor(() => expect(confirmCall(spy)).toBeTruthy());
    const body = parse(confirmCall(spy)[1]);
    expect(body.keeperId).toBe(LOSER);
    expect(body.loserId).toBe(KEEPER);
    // Email owner is now keeper, so the default is 'keeper' — NOT 'loser' (which
    // would transplant the edited row's stale old@princeton.edu onto the keeper).
    expect(body.fieldChoices.email).toBe('keeper');
  });

  // (h.1) orphan tear
  test('a confirm 500 where the target address is owned by neither side shows the orphan-repair prompt', async () => {
    const onSaved = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) return resp({ error: 'Merge failed during email transfer', code: 'merge_email_move_failed' }, { ok: false, status: 500 });
      // recovery re-read: TARGET cleared from loser, never landed on keeper → orphaned
      return resp({ plan: planForward({ keeper: { id: KEEPER, name: 'Joshua Rabinowitz', email: 'old@princeton.edu', identityStatus: null }, loser: { id: LOSER, name: 'Joshua Ravinowitz', email: '', identityStatus: null, statecode: 0 } }) });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={onSaved} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/removed during a failed merge/i)).toBeInTheDocument();
    expect(screen.getByText(TARGET)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge records/i })).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // (h.2) transient 500, target still owned → retryable
  test('a confirm 500 where the target is still owned shows a retryable generic error', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) return resp({ error: 'Merge failed' }, { ok: false, status: 500 });
      return resp({ plan: planForward() }); // TARGET still on loser → not orphaned
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/try again/i)).toBeInTheDocument();
    // Retry is allowed — the Merge button is still present.
    expect(screen.getByRole('button', { name: /merge records/i })).toBeInTheDocument();
  });

  // (h.3) benign empty-keeper after success
  test('a successful confirm where the surviving keeper has no email shows the add-email prompt', async () => {
    const onClose = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) return resp({ success: true, summary: {} });
      return resp({ plan: planForward({ keeper: { id: KEEPER, name: 'Joshua Rabinowitz', email: '', identityStatus: null } }) });
    });
    render(<CandidateEditModal candidate={candidate} onClose={onClose} onSaved={jest.fn()} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/surviving record has no email/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // (i.1) confirm-time 409 → re-render reasons, no onSaved/onClose
  test('a confirm 409 re-renders the block reasons and does not refresh', async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    let confirmed = false;
    jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) { confirmed = true; return resp({ error: 'Merge blocked', reasons: [{ code: 'loser_engaged', detail: 'Now engaged on a request.' }] }, { ok: false, status: 409 }); }
      // first plan eligible; the re-plan after the 409 returns blocked
      return resp({ plan: confirmed ? planForward({ blocked: true, reasons: [{ code: 'loser_engaged', detail: 'Now engaged on a request.' }] }) : planForward() });
    });
    render(<CandidateEditModal candidate={candidate} onClose={onClose} onSaved={onSaved} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/now engaged on a request/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge records/i })).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a retryable confirm 409 re-plans, shows retry guidance, and does not run Option-B', async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    let confirmed = false;
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) {
        confirmed = true;
        return resp({
          error: 'Concurrent modification - re-plan and retry',
          code: 'merge_retryable_replan',
          retryable: true,
          action: 'replan',
          step: 4,
          operation: 'suggestion_repoint',
          reason: 'precondition_failed',
        }, { ok: false, status: 409 });
      }
      return resp({ plan: confirmed ? planForward({ repointCount: 2 }) : planForward() });
    });
    render(<CandidateEditModal candidate={candidate} onClose={onClose} onSaved={onSaved} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/records changed while merging/i)).toBeInTheDocument();
    expect(await screen.findByText(/2 proposals re-linked/i)).toBeInTheDocument();
    expect(screen.queryByText(/removed during a failed merge/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /merge records/i })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const mergeCalls = spy.mock.calls.filter(([url]) => url === '/api/reviewer-finder/merge-candidates');
    expect(mergeCalls.filter(([, opts]) => parse(opts).confirm)).toHaveLength(1);
    expect(mergeCalls.filter(([, opts]) => !parse(opts).confirm)).toHaveLength(2);
  });

  // (i.2) confirm-time 400 → message + refresh-close affordance, no onSaved
  test('a confirm 400 (already merged) shows a non-retryable message and does not call onSaved', async () => {
    const onSaved = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) return resp({ error: 'Loser record is already inactive (already merged or retired); nothing to do.' }, { ok: false, status: 400 });
      return resp({ plan: planForward() });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={onSaved} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/already inactive/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh and close/i })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // (j) stale-async guard: a plan response landing after the candidate changed must not enter merge mode
  test('a plan response that resolves after the candidate changes is ignored (stale-async guard)', async () => {
    let releasePlan;
    const planGate = new Promise((r) => { releasePlan = r; });
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      await planGate; // hold the plan in-flight
      return resp({ plan: planForward() });
    });
    const other = { name: 'Someone Else', affiliation: 'MIT', email: 'else@mit.edu', website: '', hIndex: 5, suggestionId: 'S2', potentialReviewerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
    const { rerender } = render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    // Swap the modal to a different candidate while the plan is still in flight.
    rerender(<CandidateEditModal candidate={other} onClose={jest.fn()} onSaved={jest.fn()} />);
    releasePlan();
    await waitFor(() => expect(screen.getByDisplayValue('else@mit.edu')).toBeInTheDocument());
    // The stale plan never opened merge mode.
    expect(screen.queryByText(/Merge duplicate reviewer records/i)).not.toBeInTheDocument();
  });

  // (k) stale-async guard on the PATCH 409 itself: a 409 landing after the candidate
  // changed must NOT open merge mode for the stale candidate.
  test('a PATCH 409 that resolves after the candidate changes does not enter merge mode', async () => {
    let releasePatch;
    const patchGate = new Promise((r) => { releasePatch = r; });
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/reviewer-finder/my-candidates') { await patchGate; return patch409; }
      return resp({ plan: planForward() });
    });
    const other = { name: 'Someone Else', affiliation: 'MIT', email: 'else@mit.edu', website: '', hIndex: 5, suggestionId: 'S2', potentialReviewerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
    const { rerender } = render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge(); // PATCH is in flight (gated)
    rerender(<CandidateEditModal candidate={other} onClose={jest.fn()} onSaved={jest.fn()} />);
    releasePatch();
    await waitFor(() => expect(screen.getByDisplayValue('else@mit.edu')).toBeInTheDocument());
    expect(screen.queryByText(/Merge duplicate reviewer records/i)).not.toBeInTheDocument();
  });

  // (l) torn-email where the recovery re-plan ALSO fails: must NOT offer a plain
  // retry (would deactivate the loser and orphan the address) — show the unknown-state
  // repair prompt instead.
  test('a confirm 500 whose recovery re-plan also fails shows the unverifiable-state prompt, not a retry', async () => {
    let confirmed = false;
    jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/reviewer-finder/my-candidates') return patch409;
      const body = parse(opts);
      if (body.confirm) { confirmed = true; return resp({ error: 'Merge failed' }, { ok: false, status: 500 }); }
      // initial plan loads fine; the post-confirm recovery re-plan fails (can't verify live state)
      return confirmed ? resp({ error: 'unavailable' }, { ok: false, status: 500 }) : resp({ plan: planForward() });
    });
    render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
    triggerMerge();
    fireEvent.click(await screen.findByRole('button', { name: /merge records/i }));
    expect(await screen.findByText(/couldn’t be verified|don’t retry from here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge records/i })).not.toBeInTheDocument();
  });
});

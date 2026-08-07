/**
 * @jest-environment jsdom
 *
 * Confirm-reviewer modal coherence (owner report, 2026-08-06): the confirm
 * flow stacked two checkboxes that both opened "I verified this is the
 * correct person" (one attests the ADDRESS, one the IDENTITY), explained the
 * identity gate in engineer-speak ("auto-suggested ORCID and metrics won't be
 * carried over"), and asked for the same URL twice (Evidence link vs
 * Website). Pins:
 *   1. The two attestation boxes carry distinct plain headers ("Email
 *      address" / "Right person?") and neither uses the old duplicate opener
 *      or the "carried over" jargon.
 *   2. Cross-fill affordances: with a Website and no Evidence link, "Use the
 *      Website URL below" fills the evidence link; with an Evidence link and
 *      no Website, "Same as the evidence link above" fills the website. Each
 *      renders only when it would do something.
 *   3. Gating semantics unchanged: confirm still requires the identity box
 *      ("Tick the confirmation box to add this reviewer."), and the two
 *      stored facts stay separate in the onConfirm payload.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';

const CANDIDATE = {
  suggestionId: 's-1',
  name: 'Yael David',
  affiliation: 'Memorial Sloan Kettering Cancer Center',
  email: 'davidshy@mskcc.org',
  website: '',
};

function openConfirm(onConfirm = jest.fn()) {
  render(
    <CandidateEditModal
      candidate={CANDIDATE}
      confirmMode
      onConfirm={onConfirm}
      onVerifyAddress={jest.fn()}
      onClose={() => {}}
    />,
  );
  return onConfirm;
}

function labeledInput(labelText) {
  return screen.getByText(labelText).parentElement.querySelector('input');
}

test('pin 1: distinct plain headers, no duplicate opener, no carried-over jargon', () => {
  openConfirm();
  expect(screen.getByText('Email address')).toBeTruthy();
  expect(screen.getByText('Right person?')).toBeTruthy();
  expect(screen.queryByText(/I verified that this is the correct person/)).toBeNull();
  expect(screen.queryByText(/carried over/)).toBeNull();
  // The identity note says what actually happens, in plain words.
  expect(screen.getByText(/wasn’t verified as theirs, so it won’t be saved/)).toBeTruthy();
});

test('pin 2: cross-fill affordances appear only when useful and copy the URL', () => {
  openConfirm();
  // Institution/lab page is not the default — select it so Evidence link renders.
  fireEvent.change(screen.getByDisplayValue('Corresponding-author publication'), {
    target: { value: 'institution_page' },
  });

  // Neither URL present: neither affordance renders.
  expect(screen.queryByText('Use the Website URL below')).toBeNull();
  expect(screen.queryByText('Same as the evidence link above')).toBeNull();

  // Website filled first → evidence side offers the fill.
  fireEvent.change(labeledInput('Website'), { target: { value: 'https://www.davidlabmsk.com' } });
  fireEvent.click(screen.getByText('Use the Website URL below'));
  expect(labeledInput('Evidence link').value).toBe('https://www.davidlabmsk.com');
  // Both filled: affordances disappear.
  expect(screen.queryByText('Use the Website URL below')).toBeNull();
  expect(screen.queryByText('Same as the evidence link above')).toBeNull();

  // Reverse direction: clear website, fill evidence → website side offers the fill.
  fireEvent.change(labeledInput('Website'), { target: { value: '' } });
  fireEvent.change(labeledInput('Evidence link'), { target: { value: 'https://lab.example.edu' } });
  fireEvent.click(screen.getByText('Same as the evidence link above'));
  expect(labeledInput('Website').value).toBe('https://lab.example.edu');
});

test('pin 3: identity gate unchanged and the two facts stay separate in the payload', async () => {
  const onConfirm = openConfirm();
  fireEvent.change(screen.getByDisplayValue('Corresponding-author publication'), {
    target: { value: 'institution_page' },
  });
  fireEvent.change(labeledInput('Evidence link'), { target: { value: 'https://www.davidlabmsk.com' } });
  fireEvent.change(labeledInput('Website'), { target: { value: 'https://different.example.org' } });
  // Address attestation ticked, identity box NOT ticked → the save button
  // itself is the gate (disabled until the identity box is checked).
  fireEvent.click(screen.getByText(/belongs to this person — I checked the evidence below/));
  const saveButton = screen.getByText('Add to candidates');
  expect(saveButton).toBeDisabled();
  fireEvent.click(saveButton);
  expect(onConfirm).not.toHaveBeenCalled();

  // Tick identity → confirm fires with evidence URL and website as SEPARATE facts.
  fireEvent.click(screen.getByText('This is the person I intend to add.'));
  fireEvent.click(screen.getByText('Add to candidates'));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  const [contact, evidence] = onConfirm.mock.calls[0];
  expect(contact.website).toBe('https://different.example.org');
  expect(evidence.evidenceUrl).toBe('https://www.davidlabmsk.com');
});

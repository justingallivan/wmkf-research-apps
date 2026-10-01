import { readRosterSaveReceipt } from '../../shared/components/reviewers/search/rosterSaveReceipt';

const completeReceipt = {
  success: false,
  recorded: 1,
  outcomes: [
    { inputIndex: 0, candidateKey: 'candidate:one', status: 'recorded' },
    { inputIndex: 1, candidateKey: 'candidate:two', status: 'failed' },
  ],
};

test('accepts a complete indexed partial receipt', () => {
  expect(readRosterSaveReceipt(completeReceipt, 2)).toEqual(completeReceipt);
});

test.each([
  ['missing row', { ...completeReceipt, outcomes: completeReceipt.outcomes.slice(0, 1) }],
  ['duplicate or wrong index', { ...completeReceipt, outcomes: [completeReceipt.outcomes[0], { ...completeReceipt.outcomes[1], inputIndex: 0 }] }],
  ['unknown status', { ...completeReceipt, outcomes: [completeReceipt.outcomes[0], { ...completeReceipt.outcomes[1], status: 'maybe' }] }],
  ['bad count', { ...completeReceipt, recorded: 2 }],
  ['bad success flag', { ...completeReceipt, success: true }],
  ['missing canonical key', { ...completeReceipt, outcomes: [completeReceipt.outcomes[0], { ...completeReceipt.outcomes[1], candidateKey: null }] }],
  ['null body', null],
])('rejects %s as an unknown outcome', (_label, data) => {
  expect(readRosterSaveReceipt(data, 2)).toBeNull();
});

test('accepts an invalid input only when it is identified at its original index', () => {
  expect(readRosterSaveReceipt({
    success: false,
    recorded: 0,
    outcomes: [{ inputIndex: 0, candidateKey: null, status: 'invalid' }],
  }, 1)).toMatchObject({ success: false, outcomes: [{ status: 'invalid' }] });
});

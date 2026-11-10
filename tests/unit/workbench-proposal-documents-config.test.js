import {
  getProposalDocumentConfig,
  SINGLE_SUBMISSION_LAYOUT,
} from '../../shared/config/workbenchProposalDocuments';

test('cycles before J27 and requests with no readable cycle keep the Phase I slot layout', () => {
  for (const cycle of ['D26', 'J26', 'D25', null, undefined, '', 'nonsense']) {
    const config = getProposalDocumentConfig(cycle);
    expect(config.layout).toBeUndefined();
    expect(config.phaseFolder).toBe('Phase I');
    expect(config.slots.length).toBe(4);
  }
});

test('J27 and every later cycle list individual files, with no entry needed per cycle', () => {
  for (const cycle of ['J27', 'D27', 'J28', 'D31']) {
    const config = getProposalDocumentConfig(cycle);
    expect(config.layout).toBe(SINGLE_SUBMISSION_LAYOUT);
    expect(config.phaseFolder).toBeNull();
    expect(config.slots).toEqual([]);
  }
});

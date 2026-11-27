import { readPanelExpertise } from '../../lib/services/reviewer-discovery-brief';

const pages = ['A different page', 'Photometry and stellar populations'];
const specialty = { specialty: 'Astronomy', source: 2, anchor: 'stellar populations' };
test('carries only specialties with an exact supporting phrase on the cited page', async () => {
  const complete = jest.fn(async () => ({ text: JSON.stringify([
    specialty, { ...specialty, source: 1 }, { ...specialty, anchor: 'fabricated phrase' },
  ]) }));
  await expect(readPanelExpertise({ pages, complete })).resolves.toEqual({ topics: [{ specialty: 'Astronomy', source: 2 }] });
  expect(complete.mock.calls[0][0]).toContain(pages[1]);
});
test('a refusal terminates the pass even if the response contains parseable text', async () => {
  const complete = jest.fn(async () => ({ stopReason: 'refusal', text: JSON.stringify([specialty]) }));
  await expect(readPanelExpertise({ pages, complete })).resolves.toEqual({ status: 'analysis_refused' });
  expect(complete).toHaveBeenCalledTimes(1);
});
test('unsupported source citations require recovery', async () => {
  await expect(readPanelExpertise({ pages, complete: async () => ({ text: '[{"source":99}]' }) }))
    .resolves.toEqual({ status: 'analysis_invalid' });
});

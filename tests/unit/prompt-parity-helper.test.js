/** @jest-environment node */
import { withDeterministicNonces, nonceFromSeed } from '../helpers/prompt-parity';
import { wrapUntrustedContent } from '../../lib/utils/ai-payload-boundary';

const BASE = { source: 'parity.test', dataClass: 'proposal_text', maxChars: 1000 };
const run = (seeds) => withDeterministicNonces(seeds, () => [
  wrapUntrustedContent({ ...BASE, text: 'one', label: 'a' }).text,
  wrapUntrustedContent({ ...BASE, text: 'two', label: 'b' }).text,
].join('\n'));

test('same seed sequence gives identical output; different sequence differs', () => {
  expect(run(['s1', 's2'])).toBe(run(['s1', 's2']));
  expect(run(['s1', 's2'])).not.toBe(run(['s1', 's3']));
  expect(run(['s1', 's2'])).toContain(`nonce=${nonceFromSeed('s1')}`);
});

test('exhausted sequence throws and randomness is restored afterwards', () => {
  expect(() => run(['only-one'])).toThrow(/nonce sequence exhausted/);
  const a = wrapUntrustedContent({ ...BASE, text: 'x' }).nonce;
  const b = wrapUntrustedContent({ ...BASE, text: 'x' }).nonce;
  expect(a).not.toBe(b);
});

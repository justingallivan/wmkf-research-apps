/**
 * Prompt-parity helper for per-app parity tests (convergence plan Stage 0).
 *
 * Problem: an OLD prompt builder mints random A7 nonces internally via
 * wrapUntrustedContent (lib/utils/ai-payload-boundary.js:187,
 * `crypto.randomBytes(12).toString('hex')`), so its output differs run to run.
 * The NEW path (variables helper + composeToolPrompt) mints nonces the same way.
 * To compare them byte-for-byte, make nonce minting a deterministic sequence.
 *
 * Approach: spy on `crypto.randomBytes` and answer ONLY the 12-byte requests the
 * boundary module makes for nonces; all other sizes pass through to the real
 * implementation. (Callers that pass an explicit 24-hex `nonce` bypass minting.)
 * Nonces are consumed in call order, so old and new paths must wrap the same
 * pieces in the same order.
 *
 * Usage (in a jest test file):
 *   import { withDeterministicNonces, nonceFromSeed } from '../../helpers/prompt-parity';
 *
 *   const oldOut = withDeterministicNonces(['seed-a', 'seed-b'], () => buildOldPrompt(input));
 *   const newOut = withDeterministicNonces(['seed-a', 'seed-b'], () => {
 *     const { variables, nonces } = buildNewVariables(input);
 *     return composeToolPrompt(template, variables, { nonces });
 *   });
 *   expect(newOut).toBe(oldOut);
 *
 * `seeds` are strings; each becomes a stable 24-hex nonce via nonceFromSeed. When
 * the sequence is exhausted the helper throws, so a path that wraps more blocks
 * than expected fails loudly instead of falling back to random.
 */
import crypto from 'crypto';

/** Deterministic 24-hex nonce for a seed string. */
export function nonceFromSeed(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 24);
}

/**
 * Run `fn` (sync or async) with nonce minting forced to the given seed sequence.
 * Restores crypto.randomBytes afterwards (also on throw / rejection).
 * @param {string[]} seeds
 * @param {() => any} fn
 */
export function withDeterministicNonces(seeds, fn) {
  const real = crypto.randomBytes;
  let i = 0;
  const spy = jest.spyOn(crypto, 'randomBytes').mockImplementation((size, ...rest) => {
    if (size !== 12) return real.call(crypto, size, ...rest);
    if (i >= seeds.length) {
      throw new Error(`prompt-parity: nonce sequence exhausted after ${seeds.length} nonce(s)`);
    }
    return Buffer.from(nonceFromSeed(seeds[i++]), 'hex');
  });
  const restore = () => spy.mockRestore();
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
  }
  restore();
  return result;
}

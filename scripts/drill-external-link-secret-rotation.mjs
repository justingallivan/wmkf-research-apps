/**
 * Drill: EXTERNAL_LINK_SECRET rotation window.
 *
 * Exercises the dual-secret rotation path of lib/services/external-token.js
 * end-to-end, in-process, with throwaway secrets — it touches no real
 * environment and no database. Run it before a real rotation to confirm the
 * mechanism still holds, or any time as a regression check.
 *
 *   node scripts/drill-external-link-secret-rotation.mjs
 *
 * Models the three phases of a real rotation (see
 * docs/CREDENTIALS_RUNBOOK.md § "Rotating EXTERNAL_LINK_SECRET"):
 *
 *   Phase 1  before rotation — a live magic link is minted under the old secret
 *   Phase 2  rotation window — EXTERNAL_LINK_SECRET=new, _PREVIOUS=old;
 *            the old link must still verify, new links must verify
 *   Phase 3  window closed   — _PREVIOUS cleared; the old link must now reject,
 *            new links must still verify
 *
 * Exits 0 if every assertion holds, 1 otherwise.
 */

import { randomBytes } from 'crypto';
import { mintToken, verifyToken } from '../lib/services/external-token.js';

const OLD_SECRET = randomBytes(24).toString('base64'); // 32 chars
const NEW_SECRET = randomBytes(24).toString('base64');

const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const OPS = ['download_proposal', 'upload_review'];

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures += 1;
  }
}

function mint() {
  return mintToken({
    suggestionId: SUGGESTION_ID,
    requestId: REQUEST_ID,
    ops: OPS,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

async function run() {
  console.log('EXTERNAL_LINK_SECRET rotation drill\n');

  // ── Phase 1: before rotation ───────────────────────────────────────────
  console.log('Phase 1 — before rotation (old secret live):');
  process.env.EXTERNAL_LINK_SECRET = OLD_SECRET;
  delete process.env.EXTERNAL_LINK_SECRET_PREVIOUS;
  const oldLink = (await mint()).jwt;
  check('a magic link minted under the old secret verifies', (await verifyToken(oldLink)).valid);

  // ── Phase 2: rotation window ───────────────────────────────────────────
  console.log('\nPhase 2 — rotation window (new=current, old=previous):');
  process.env.EXTERNAL_LINK_SECRET = NEW_SECRET;
  process.env.EXTERNAL_LINK_SECRET_PREVIOUS = OLD_SECRET;
  check('the pre-rotation link STILL verifies (no reviewer lockout)',
    (await verifyToken(oldLink)).valid);
  const newLink = (await mint()).jwt;
  check('a link minted after rotation verifies', (await verifyToken(newLink)).valid);

  // ── Phase 3: window closed ─────────────────────────────────────────────
  console.log('\nPhase 3 — window closed (_PREVIOUS cleared):');
  delete process.env.EXTERNAL_LINK_SECRET_PREVIOUS;
  const oldAfter = await verifyToken(oldLink);
  check('the pre-rotation link is now REJECTED', !oldAfter.valid);
  check('  …with reason invalid_signature', oldAfter.reason === 'invalid_signature');
  check('the post-rotation link still verifies', (await verifyToken(newLink)).valid);

  console.log('');
  if (failures === 0) {
    console.log('DRILL PASSED — rotation window behaves correctly.');
    process.exit(0);
  }
  console.error(`DRILL FAILED — ${failures} assertion(s) did not hold.`);
  process.exit(1);
}

run().catch((e) => {
  console.error('DRILL ERROR:', e);
  process.exit(1);
});

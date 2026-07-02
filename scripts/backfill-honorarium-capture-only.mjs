#!/usr/bin/env node
/**
 * backfill-honorarium-capture-only.mjs — complete honorarium onboarding for
 * reviewers who accepted while the pipeline was in CAPTURE-ONLY (deferred) mode.
 *
 * Context: when `HONORARIUM_ONBOARDING_DEFERRED=true` (or the discriminator GUIDs
 * are unset), a non-opted-out reviewer's accept captures their CRM contact +
 * mailing address but the orchestrator returns `status:'deferred'` BEFORE minting
 * the honorarium `akoya_request` or calling BILL (see
 * lib/bill/honorarium-onboard-orchestrator.js). Those reviewers won't re-accept,
 * so once the pipeline is built this script mints the missing records for them.
 *
 * SCOPE — a cycle is REQUIRED (`--cycle J26`). The backfill only touches reviewers
 * whose proposal's meeting date falls in that cycle, so it can never sweep in
 * reviewers who accepted in an unrelated/older cycle and mint unintended payments
 * (Codex S274 P1). The opt-out predicate uses the `eq null or ne true` form so the
 * common null-means-not-opted-out rows are INCLUDED, not silently dropped (Dataverse
 * omits rows whose filter evaluates to null — Codex S274 P2).
 *
 * WHAT IT DOES — for every eligible suggestion in the cycle (accepted, NOT opted
 * out, NO honorarium linked yet, selected, not excluded, mailing address captured):
 *   1. Re-loads the suggestion with its request + reviewer expanded (same shape as
 *      lib/external/verify-suggestion-token.js).
 *   2. Reconstructs `body.address` from the reviewer's contact `address1_*`
 *      (captured at accept time) so the orchestrator's address re-PATCH and the
 *      BILL payload have the data.
 *   3. Calls `ensureHonorariumOnboarding(...)` — the SAME idempotent path the
 *      portal uses. Deterministic-GUID create + junction reuse means re-running is
 *      safe: an already-minted honorarium is reused, never duplicated.
 *
 * It does NOT reimplement any create/BILL logic — it drives the tested orchestrator
 * so there is no money-adjacent drift between portal and backfill.
 *
 * PRE-FLIGHT: refuses to run while the pipeline is still deferred (flag set or
 * GUIDs unset) — backfilling then would just re-capture and mint nothing. Configure
 * HONORARIUM_PROGRAM_ID / HONORARIUM_GRANTPROGRAM_ID / HONORARIUM_TYPE_ID and ensure
 * HONORARIUM_ONBOARDING_DEFERRED is unset first. BILL itself may stay deferred/
 * disabled — the orchestrator's onboard step degrades internally (the akoya_request,
 * the primary goal, is still created).
 *
 * SAFETY: dry-run by DEFAULT — prints exactly which suggestions it WOULD onboard.
 * Pass --execute to write. Idempotent. Restriction-bypassed. Acts against whatever
 * .env.local points at (prod Dataverse) — confirm the dry-run before --execute.
 *
 * Usage:
 *   node scripts/backfill-honorarium-capture-only.mjs --cycle J26            # dry-run (default)
 *   node scripts/backfill-honorarium-capture-only.mjs --cycle J26 --execute  # write
 *   node scripts/backfill-honorarium-capture-only.mjs --cycle J26 --limit 5  # cap rows processed
 *   node scripts/backfill-honorarium-capture-only.mjs --cycle J26 --force    # override the sanity ceiling
 *   node scripts/backfill-honorarium-capture-only.mjs --help
 */

import fs from 'fs';

// --- env: load .env.local (same pattern as the other scripts) -----------------
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repo root.');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 50).join('\n').replace(/^ \*?/gm, ''));
  process.exit(0);
}
const EXECUTE = args.includes('--execute');
const FORCE = args.includes('--force');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i === -1) return Infinity;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error('--limit needs a positive integer.');
    process.exit(2);
  }
  return n;
})();
const CYCLE = (() => {
  const i = args.indexOf('--cycle');
  if (i === -1) {
    console.error('--cycle <CODE> is REQUIRED (e.g. --cycle J26) — the backfill must be scoped to one grant cycle so it cannot mint unintended honoraria for unrelated/older cohorts.');
    process.exit(2);
  }
  return args[i + 1];
})();

const ENTITY_SET = 'wmkf_appreviewersuggestions';
const SANITY_MAX = 200; // eligible set larger than this needs --force (guards a bad filter)

// Re-load shape mirrors lib/external/verify-suggestion-token.js so the orchestrator
// receives the same { suggestion, request, reviewer } it does in the portal path.
const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_accepted', 'wmkf_declined', 'wmkf_honorariumoptout', 'wmkf_selected',
  'wmkf_reviewerfirstname', 'wmkf_reviewerlastname', 'wmkf_revieweremail',
  '_wmkf_honorariumrequest_value', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
].join(',');
// akoya_title is required so ensureHonorariumOnboarding's deriveHonorariumTitle()
// produces the same "Reviewer honorarium — <proposal title> (#num)" it does in the
// portal path; the live token verifier (lib/external/verify-suggestion-token.js)
// selects it too. Without it, backfilled honoraria fall back to a generic title.
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'akoya_title', 'wmkf_meetingdate'].join(',');
const REVIEWER_SELECT = [
  'wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_emailaddress',
  'wmkf_firstname', 'wmkf_lastname', 'wmkf_orcid', 'wmkf_identitystatus',
  '_wmkf_contact_value',
].join(',');
const CONTACT_SELECT = [
  'contactid', 'address1_line1', 'address1_line2', 'address1_city',
  'address1_stateorprovince', 'address1_postalcode', 'address1_country',
  'address1_telephone1',
].join(',');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { ensureHonorariumOnboarding } = await import('../lib/bill/honorarium-onboard-orchestrator.js');
const { honorariumDiscriminatorsConfigured } = await import('../lib/bill/honorarium-discriminators.js');
const { notExcludedFilter } = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const { cycleCodeToOdataFilter, cycleCodeToLabel } = await import('../lib/utils/cycle-code.js');
const { missingRequiredAddressFields, validateAddress } = await import('../lib/external/required-address.js');

// Scope the backfill to one cycle by filtering on the suggestion's request
// meeting date (single-valued nav property). Validated up front — an unparseable
// cycle yields null and we refuse to run.
const CYCLE_FILTER = cycleCodeToOdataFilter(CYCLE, 'wmkf_Request/wmkf_meetingdate');
if (!CYCLE_FILTER) {
  console.error(`--cycle '${CYCLE}' is not a valid cycle code (expected J## or D##, e.g. J26).`);
  process.exit(2);
}

enterDynamicsBypassForScript('backfill-honorarium-capture-only');

// Reverse of the orchestrator's patchContactAddress map: contact address1_* →
// body.address. Empty fields are dropped (the orchestrator + BILL validator treat
// absent fields leniently and alert on a genuinely incomplete BILL payload).
function addressFromContact(contact) {
  if (!contact) return {};
  const map = {
    line1: 'address1_line1', line2: 'address1_line2', city: 'address1_city',
    state: 'address1_stateorprovince', postalCode: 'address1_postalcode',
    country: 'address1_country', phone: 'address1_telephone1',
  };
  const out = {};
  for (const [k, col] of Object.entries(map)) {
    const v = contact[col];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v;
  }
  return out;
}

function label(suggestion, request, reviewer) {
  const who = reviewer?.wmkf_name
    || [suggestion.wmkf_reviewerfirstname, suggestion.wmkf_reviewerlastname].filter(Boolean).join(' ').trim()
    || '(unknown reviewer)';
  const req = request?.akoya_requestnum ? `req #${request.akoya_requestnum}` : `req ${(suggestion._wmkf_request_value || '').slice(0, 8)}`;
  return `${who} — ${req}`;
}

async function main() {
  console.log(`\n=== honorarium capture-only backfill — ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}${FORCE ? ' (--force)' : ''} ===`);
  console.log(`cycle: ${CYCLE} (${cycleCodeToLabel(CYCLE)})\n`);

  // --- Pre-flight: the pipeline MUST be live, or this is a no-op -------------
  const flagDeferred = process.env.HONORARIUM_ONBOARDING_DEFERRED === 'true';
  if (flagDeferred || !honorariumDiscriminatorsConfigured()) {
    console.error('REFUSING TO RUN — the honorarium pipeline is still deferred:');
    if (flagDeferred) console.error('  • HONORARIUM_ONBOARDING_DEFERRED=true (unset it)');
    if (!honorariumDiscriminatorsConfigured()) {
      console.error('  • discriminator GUIDs not all configured (set HONORARIUM_PROGRAM_ID, HONORARIUM_GRANTPROGRAM_ID, HONORARIUM_TYPE_ID)');
      console.error('    resolve them with scripts/probe-honorarium-discriminators.js');
    }
    console.error('\nBackfilling while deferred would only re-capture and mint nothing. Aborting.');
    process.exit(1);
  }

  // --- Find eligible suggestions --------------------------------------------
  // In-cycle, accepted, not opted out, no honorarium linked yet, selected, not
  // excluded. The opt-out predicate uses `eq null or ne true` because Dataverse
  // OMITS any row whose filter evaluates to null, and `field ne X` is null when
  // the field is null — a bare `ne true` would silently drop the common
  // null-means-not-opted-out reviewers (Codex S274 P2; same trap notExcludedFilter
  // documents).
  const filter = [
    `(${CYCLE_FILTER})`,
    'wmkf_accepted eq true',
    '(wmkf_honorariumoptout eq null or wmkf_honorariumoptout ne true)',
    '_wmkf_honorariumrequest_value eq null',
    'wmkf_selected eq true',
    notExcludedFilter(),
  ].join(' and ');

  const { records: candidates } = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: SUGGESTION_SELECT,
    filter,
  });

  console.log(`Eligible (accepted, not opted out, no honorarium linked): ${candidates.length}\n`);
  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }
  if (candidates.length > SANITY_MAX && !FORCE) {
    console.error(`Eligible set (${candidates.length}) exceeds the sanity ceiling (${SANITY_MAX}).`);
    console.error('That is more than a single cycle of reviewers — re-check the filter, or pass --force if it is genuinely correct.');
    process.exit(1);
  }

  const toProcess = candidates.slice(0, LIMIT);
  if (toProcess.length < candidates.length) {
    console.log(`(--limit ${LIMIT}: processing ${toProcess.length} of ${candidates.length})\n`);
  }

  const results = { onboarded: 0, reused: 0, deferred: 0, failed: 0, skipped: 0, byOnboardStatus: {} };
  const bumpOnboard = (s) => { const k = s || 'n/a'; results.byOnboardStatus[k] = (results.byOnboardStatus[k] || 0) + 1; };

  for (const row of toProcess) {
    const id = row.wmkf_appreviewersuggestionid;
    // Re-load with request + reviewer expanded (the orchestrator's input contract).
    let suggestion;
    try {
      suggestion = await DynamicsService.getRecord(ENTITY_SET, id, {
        select: SUGGESTION_SELECT,
        expand: `wmkf_Request($select=${REQUEST_SELECT}),wmkf_PotentialReviewer($select=${REVIEWER_SELECT})`,
      });
    } catch (e) {
      results.failed += 1;
      console.error(`  ✗ ${id}: reload failed — ${String(e.message || e).slice(0, 200)}`);
      continue;
    }
    const request = suggestion.wmkf_Request || null;
    const reviewer = suggestion.wmkf_PotentialReviewer || null;
    const lbl = `${label(suggestion, request, reviewer)}  [${id.slice(0, 8)}]`;

    // Reconstruct the captured mailing address from the contact. A non-opted-out
    // accept REQUIRED a full address (server 422 via missingRequiredAddressFields)
    // and the orchestrator wrote it to the contact, so every eligible row SHOULD
    // have a complete one. But the accept-time contact-address PATCH was
    // best-effort/non-fatal, so a historical row may have a partial address. SKIP
    // unless the reconstructed address passes the SAME completeness check fresh
    // accept enforces — minting from an incomplete address would link the
    // suggestion, drop it from the eligible set, and strand a honorarium with no
    // payable mailing address / no BILL counterpart (Codex S274 P1). A skipped row
    // stays eligible and is retried on a later run once the contact is fixed.
    const contactId = reviewer?._wmkf_contact_value || null;
    let contact = null;
    let contactReadError = null;
    if (contactId) {
      try {
        contact = await DynamicsService.getRecord('contacts', contactId, { select: CONTACT_SELECT });
      } catch (e) {
        contactReadError = String(e.message || e).slice(0, 120);
      }
    }
    const address = addressFromContact(contact);
    // Mirror BOTH halves of the fresh-accept contract: validity (shape/length/
    // country-ISO2 — respond.js 400s here) AND presence (required set — 422). A
    // legacy contact can hold an unnormalized country like "United States" that
    // fresh accept would reject; minting from it would strand an honorarium whose
    // address the BILL tail (and manual payment) can't use.
    const addrErr = validateAddress(address);
    const missingAddress = missingRequiredAddressFields(address);

    if (addrErr || missingAddress.length) {
      results.skipped += 1;
      const why = !contactId ? 'no linked contact'
        : contactReadError ? `contact read failed (${contactReadError})`
          : addrErr ? `invalid captured address (${addrErr.reason}${addrErr.field ? `: ${addrErr.field}` : ''})`
            : Object.keys(address).length === 0 ? 'no captured address on contact'
              : `incomplete captured address (missing: ${missingAddress.join(', ')})`;
      console.warn(`  ⤬ SKIP — ${lbl}  (${why}); left eligible for a later run`);
      continue;
    }

    const line = `${lbl}  address:${Object.keys(address).join('/')}`;
    const body = { address };

    if (!EXECUTE) {
      console.log(`  • would onboard — ${line}`);
      continue;
    }

    try {
      const res = await ensureHonorariumOnboarding({ suggestion, request, reviewer, body });
      if (res?.status === 'deferred') {
        // Pre-flight should prevent this; treat as an anomaly, not success.
        results.deferred += 1;
        console.warn(`  ⚠ still deferred (env changed mid-run?) — ${line}`);
      } else if (res?.created) {
        results.onboarded += 1;
        bumpOnboard(res.onboardStatus);
        console.log(`  ✓ created honorarium ${res.honorariumRequestId} (onboard:${res.onboardStatus || 'n/a'}) — ${line}`);
      } else {
        results.reused += 1;
        bumpOnboard(res.onboardStatus);
        console.log(`  ✓ reused existing honorarium ${res.honorariumRequestId} (onboard:${res.onboardStatus || 'n/a'}) — ${line}`);
      }
    } catch (e) {
      results.failed += 1;
      console.error(`  ✗ ${id}: onboarding failed — ${String(e.message || e).slice(0, 240)}`);
    }
  }

  if (!EXECUTE) {
    const wouldOnboard = toProcess.length - results.skipped;
    console.log(`\nDry run — ${wouldOnboard} suggestion(s) would be onboarded, ${results.skipped} skipped (no/incomplete captured address). Re-run with --execute to apply.`);
    if (results.skipped > 0) process.exitCode = 1;
    return;
  }

  console.log('\n=== summary ===');
  console.log(`  created : ${results.onboarded}`);
  console.log(`  reused  : ${results.reused}`);
  console.log(`  skipped : ${results.skipped}  (no/incomplete captured address — still eligible)`);
  console.log(`  deferred: ${results.deferred}`);
  console.log(`  failed  : ${results.failed}`);
  // `created`/`reused` mean the honorarium akoya_request exists; BILL vendor
  // creation is the onboard status below (alert_only/deferred/invalid_input do
  // NOT create a BILL vendor — see lib/bill/onboard-reviewer-service.js).
  const statuses = Object.entries(results.byOnboardStatus);
  if (statuses.length) {
    console.log('  BILL onboard status:');
    for (const [k, n] of statuses) console.log(`    ${k}: ${n}`);
  }
  // Non-zero exit if anything did not land cleanly, so an operator/CI wrapper
  // notices a partial run (skipped rows still need an address; failed rows erred).
  if (results.failed > 0 || results.skipped > 0 || results.deferred > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
